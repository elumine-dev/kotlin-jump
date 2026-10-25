import { fileKindOf, readProjectContext, type GradleFile, type ProjectContext, type RefreshResult, type UpgradeEngine } from '../upgrades/UpgradeEngine';
import type { UpgradeReport } from '../upgrades/model';

/**
 * KJ-082, the session between the editor and the engine.
 *
 * Which Gradle files a workspace folder holds, their texts, and one
 * evaluation of the whole project at a time: the rails need the Kotlin, AGP
 * and wrapper versions across files, and the repositories come from the
 * settings. Texts are cached so a hover costs no disk read; a saved file
 * invalidates its own text, a watcher event invalidates the list.
 *
 * The file source is handed in: `findFiles` plus `workspace.fs` on the
 * desktop, a map in the tests.
 */

export interface GradleFileSource {
  /** Absolute paths of the Gradle files under a folder: catalogs, settings, build files, the wrapper. */
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string | undefined>;
}

export interface Evaluation { files: GradleFile[]; ctx: ProjectContext; report: UpgradeReport }

interface FolderCache { paths: string[]; texts: Map<string, string> }

export class UpgradeSession {
  private readonly folders = new Map<string, FolderCache>();

  constructor(
    private readonly engine: UpgradeEngine,
    private readonly source: GradleFileSource,
    private readonly opts: { trusted: () => boolean },
  ) {}

  async files(folder: string): Promise<GradleFile[]> {
    let cache = this.folders.get(folder);
    if (!cache) {
      cache = { paths: (await this.source.list(folder)).filter(p => fileKindOf(p) !== undefined), texts: new Map() };
      this.folders.set(folder, cache);
    }
    const out: GradleFile[] = [];
    for (const path of cache.paths) {
      let text = cache.texts.get(path);
      if (text === undefined) {
        text = await this.source.read(path);
        if (text === undefined) continue;
        cache.texts.set(path, text);
      }
      out.push({ path, text, kind: fileKindOf(path)! });
    }
    return out;
  }

  /** The cached text of a file, for the comment fix and for edits in another file. */
  textOf(path: string): string | undefined {
    for (const c of this.folders.values()) {
      const t = c.texts.get(path);
      if (t !== undefined) return t;
    }
    return undefined;
  }

  folderOf(path: string): string | undefined {
    let best: string | undefined;
    for (const [folder, c] of this.folders) {
      if ((c.paths.includes(path) || path.startsWith(`${folder}/`)) && (!best || folder.length > best.length)) best = folder;
    }
    return best;
  }

  /** A path drops its text; no path drops every list and text. */
  invalidate(path?: string): void {
    if (path === undefined) { this.folders.clear(); return; }
    for (const c of this.folders.values()) c.texts.delete(path);
    if (fileKindOf(path) !== undefined) {
      // A new or deleted Gradle file changes the list itself.
      for (const [folder, c] of this.folders) if (path.startsWith(`${folder}/`) && !c.paths.includes(path)) this.folders.delete(folder);
    }
  }

  async evaluate(folder: string): Promise<Evaluation> {
    const files = await this.files(folder);
    const ctx = readProjectContext(files, this.opts.trusted());
    await this.engine.warm(files, ctx);
    return { files, ctx, report: this.engine.evaluate(files, ctx) };
  }

  async refresh(folder: string, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<RefreshResult> {
    const files = await this.files(folder);
    const ctx = readProjectContext(files, this.opts.trusted());
    return this.engine.refresh(files, ctx, opts);
  }
}
