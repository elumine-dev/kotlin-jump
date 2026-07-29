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

const SOURCE_GLOB = '**/*.{kt,kts,java,xml,gradle,pro,properties,toml}';
const RES_GLOB = '**/res/*/*.*';
const CACHE_MS = 60_000;

export interface Corpus {
  sources: ResourceSource[];
  index: FileResourceIndex;
  modulesWithCode: string[];
  libraryModules: string[];
  truncated: boolean;
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
    const isExcluded = makeExclusionMatcher(
      cfg.get<string[]>('excludePatterns', ['**/build/**', '**/.gradle/**', '**/generated/**']),
    );

    const [sourceUris, resUris, buildUris] = await Promise.all([
      vscode.workspace.findFiles(SOURCE_GLOB, undefined, maxFiles),
      vscode.workspace.findFiles(RES_GLOB, undefined, maxFiles),
      vscode.workspace.findFiles('**/build.gradle{,.kts}', undefined, 500),
    ]);

    // Hitting the cap means we may have missed the one reference that matters.
    const truncated = sourceUris.length >= maxFiles || resUris.length >= maxFiles;

    const keptSources = sourceUris.filter(u => !isExcluded(u.fsPath));
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

    return { sources, index, modulesWithCode, libraryModules, truncated: truncated || readFailed };
  }
}
