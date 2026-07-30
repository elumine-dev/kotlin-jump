import * as vscode from 'vscode';
import { mapBatched } from '../util/batched';
import { makeExclusionMatcher } from '../util/pathExclusion';
import { FileResourceIndex } from './FileResourceIndex';
import { ResourceSource } from '../providers/UnusedResourceProvider';

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

  /** Serves a stale corpus immediately while refreshing behind it. */
  async get(token?: vscode.CancellationToken): Promise<Corpus> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.corpus;
    if (this.cache && !this.refreshing) {
      this.refreshing = true;
      void this.scan()
        .then(c => { this.cache = { at: Date.now(), corpus: c }; })
        .finally(() => { this.refreshing = false; });
      return this.cache.corpus;
    }
    const corpus = await this.scan(token);
    this.cache = { at: Date.now(), corpus };
    return corpus;
  }

  private async scan(token?: vscode.CancellationToken): Promise<Corpus> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const maxFiles = cfg.get<number>('maxIndexedFiles', 10000);
    const patterns = cfg.get<string[]>('excludePatterns', ['**/build/**', '**/.gradle/**', '**/generated/**']);
    // Belt for what the glob cannot express (picomatch is stricter than the
    // VS Code glob), applied on the already-narrowed result.
    const isExcluded = makeExclusionMatcher(patterns);

    // The cap MUST be applied after exclusion, not before. Passing no exclude
    // here let VS Code fill the 10000 slots with `build/` output on a project
    // that has been built, hit the cap, and report a truncated corpus, which
    // silently disables every detector that reasons over absence.
    const excludeGlob = patterns.length > 0 ? `{${patterns.join(',')}}` : undefined;

    const [sourceUris, resUris, buildUris, serviceUris] = await Promise.all([
      vscode.workspace.findFiles(SOURCE_GLOB, excludeGlob, maxFiles),
      vscode.workspace.findFiles(RES_GLOB, excludeGlob, maxFiles),
      vscode.workspace.findFiles('**/build.gradle{,.kts}', excludeGlob, 500),
      vscode.workspace.findFiles(SERVICES_GLOB, excludeGlob, 200),
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
    await mapBatched(keptSources, async uri => {
      if (token?.isCancellationRequested) return;
      try {
        sources.push({ path: uri.fsPath, text: decoder.decode(await vscode.workspace.fs.readFile(uri)) });
      } catch {
        // one unreadable file is enough to void the "nothing references it" claim
        readFailed = true;
      }
    });

    const index = new FileResourceIndex();
    for (const uri of keptRes) index.addFile(uri.fsPath, moduleDirs);

    const modulesWithCode = moduleDirs.filter(dir =>
      sources.some(s => s.path.startsWith(`${dir}/`) && /\.(kt|java)$/.test(s.path)),
    );
    const libraryModules = moduleDirs.filter(dir =>
      sources.some(s => s.path.startsWith(`${dir}/build.gradle`) && /com\.android\.library|android-library/.test(s.text)),
    );

    return {
      sources, index, modulesWithCode, libraryModules, moduleDirs,
      truncated: truncated || readFailed,
      sourcesTruncated: sourcesCapped || readFailed,
    };
  }
}
