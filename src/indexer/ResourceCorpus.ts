import * as vscode from 'vscode';
import { mapBatched } from '../util/batched';
import { rememberCorpusUri } from '../util/corpusUri';
import { makeExclusionMatcher } from '../util/pathExclusion';
import { FileResourceIndex } from './FileResourceIndex';
import { ResourceSource } from '../providers/UnusedResourceProvider';
import { excludeGlob } from '../util/pathExclusion';

/**
 * The workspace corpus KJ-029 reasons over: every source that could reference
 * a resource, plus the index of resource files themselves.
 *
 * Nothing scans at activation. Reads go through `mapBatched` rather than the
 * serial loop the older badge providers use, and a scan that hits the file cap
 * is reported as `truncated` — the detector then produces nothing at all,
 * because an incomplete corpus cannot prove absence.
 */

// NEVER add `.txt` here: R8 writes every resource and class name of the
// build into seeds/usage/mapping.txt, and reading one marks the whole
// project alive. KJ-031 and KJ-032 both depend on that absence.
const SOURCE_GLOB = '**/*.{kt,kts,java,xml,gradle,pro,properties,toml}';
// ServiceLoader entries have no extension and the SPI name IS the file name.
const SERVICES_GLOB = '**/META-INF/services/*';
const RES_GLOB = '**/res/*/*.*';
const CACHE_MS = 60_000;
export const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
/** A module other projects consume: maven-publish under every spelling, or a KMP export. */
export const PUBLISHED_MODULE_RE = /maven-publish|mavenPublish|\.publish(?:ing)?\b|\bpublishing\s*\{|cocoapods\s*\{|XCFramework/;

/**
 * The ROOT build file lists every plugin of the project with `apply false`:
 * it declares them without applying them. Counting those marked the root as a
 * published module, so the whole workspace read as public API and the dead
 * symbol detector went silent everywhere.
 */
export function withoutUnappliedPlugins(gradleText: string): string {
  return gradleText.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');
}
export const declaresLibraryPlugin = (text: string): boolean => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(text));
export const declaresPublishing   = (text: string): boolean => PUBLISHED_MODULE_RE.test(withoutUnappliedPlugins(text));

export interface Corpus {
  sources: ResourceSource[];
  index: FileResourceIndex;
  modulesWithCode: string[];
  libraryModules: string[];
  /** OR of every cap and read failure. Kept for existing consumers. */
  truncated: boolean;
  /**
   * Only the SOURCE side: the file cap or a read failure, never the `res/`
   * cap. A project with 12000 files under `res/*​/` would otherwise disable
   * KJ-032 for a reason that has nothing to do with Kotlin symbols.
   */
  sourcesTruncated: boolean;
  /** Module directories, for callers that need the module layout. */
  moduleDirs: string[];
}

export class ResourceCorpus {
  private cache: { at: number; corpus: Corpus } | undefined;
  private refreshing = false;

  invalidate(): void {
    this.cache = undefined;
  }

  /**
   * An open editor edited since the scan: the cached offsets no longer match
   * its text, and a quick fix computed on them deleted the wrong lines.
   */
  private cacheIsStale(corpus: Corpus): boolean {
    for (const d of vscode.workspace.textDocuments) {
      if (!d.isDirty) continue;
      const src = corpus.sources.find(s => s.path === d.uri.fsPath);
      if (src && src.text !== d.getText()) return true;
    }
    return false;
  }

  /** Serves a stale corpus immediately while refreshing behind it. */
  async get(token?: vscode.CancellationToken): Promise<Corpus> {
    if (this.cache && this.cacheIsStale(this.cache.corpus)) this.cache = undefined;
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.corpus;
    if (this.cache && !this.refreshing) {
      this.refreshing = true;
      void this.scan()
        .then(c => { this.cache = { at: Date.now(), corpus: c }; })
        .finally(() => { this.refreshing = false; });
      return this.cache.corpus;
    }
    const corpus = await this.scan(token);
    // A scan cut short by Cancel skipped files without marking anything:
    // cached, it served "unreferenced" verdicts for symbols the unread files
    // use, and "Remove All" deleted live code on the next click.
    if (!token?.isCancellationRequested) this.cache = { at: Date.now(), corpus };
    return corpus;
  }

  private async scan(token?: vscode.CancellationToken): Promise<Corpus> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const maxFiles = cfg.get<number>('maxIndexedFiles', 10000);
    const patterns = cfg.get<string[]>('excludePatterns', ['**/build/**', '**/.gradle/**', '**/generated/**']);
    // Belt for what the glob cannot express (picomatch is stricter than the
    // VS Code glob), applied on the already-narrowed result.
    const isExcluded = makeExclusionMatcher(patterns, (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.path));

    // The cap MUST be applied after exclusion, not before. Passing no exclude
    // here let VS Code fill the 10000 slots with `build/` output on a project
    // that has been built, hit the cap, and report a truncated corpus, which
    // silently disables every detector that reasons over absence.
    const motifExclu = excludeGlob(patterns);

    const [sourceUris, resUris, buildUris, serviceUris] = await Promise.all([
      vscode.workspace.findFiles(SOURCE_GLOB, motifExclu, maxFiles),
      vscode.workspace.findFiles(RES_GLOB, motifExclu, maxFiles),
      vscode.workspace.findFiles('**/build.gradle{,.kts}', motifExclu, 500),
      vscode.workspace.findFiles(SERVICES_GLOB, motifExclu, 200),
    ]);

    // Hitting the cap means we may have missed the one reference that matters.
    const sourcesCapped = sourceUris.length >= maxFiles;
    const truncated = sourcesCapped || resUris.length >= maxFiles;

    const keptSources = [...sourceUris, ...serviceUris].filter(u => !isExcluded(u.fsPath));
    const keptRes = resUris.filter(u => !isExcluded(u.fsPath));

    const moduleDirs = buildUris
      .filter(u => !isExcluded(u.fsPath))
      .map(u => u.fsPath.replace(/[\\/]build\.gradle(\.kts)?$/, ''));

    const decoder = new TextDecoder();
    let readFailed = false;
    const sources: ResourceSource[] = [];
    // Offsets from the disk copy were applied to open documents with unsaved
    // edits, and a deletion landed a few characters off, leaving a fragment
    // that did not compile. The editor's text is the truth for open files.
    const open = new Map<string, string>();
    for (const d of vscode.workspace.textDocuments) {
      if (d.isDirty) open.set(d.uri.fsPath, d.getText());
    }
    await mapBatched(keptSources, async uri => {
      if (token?.isCancellationRequested) { readFailed = true; return; }
      try {
        const fromEditor = open.get(uri.fsPath);
        sources.push({ path: rememberCorpusUri(uri), text: fromEditor ?? decoder.decode(await vscode.workspace.fs.readFile(uri)) });
      } catch {
        // one unreadable file is enough to void the "nothing references it" claim
        readFailed = true;
      }
    });

    const index = new FileResourceIndex();
    for (const uri of keptRes) index.addFile(rememberCorpusUri(uri), moduleDirs);

    const modulesWithCode = moduleDirs.filter(dir =>
      sources.some(s => s.path.startsWith(`${dir}/`) && /\.(kt|java)$/.test(s.path)),
    );
    const libraryModules = moduleDirs.filter(dir =>
      // `alias(libs.plugins.android.library)` and convention plugins spell the
      // plugin without `com.android.library`.
      sources.some(s => s.path.startsWith(`${dir}/build.gradle`) && declaresLibraryPlugin(s.text)),
    );

    return {
      sources, index, modulesWithCode, libraryModules, moduleDirs,
      truncated: truncated || readFailed,
      sourcesTruncated: sourcesCapped || readFailed,
    };
  }
}
