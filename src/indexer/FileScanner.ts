import * as vscode from 'vscode';
import * as os from 'os';
import { parse } from './KotlinParser';
import { parseJava } from './JavaParser';
import { SymbolIndex } from './SymbolIndex';
import { WorkerPool } from './WorkerPool';
import { Logger } from '../util/logger';
import { excludeGlob } from '../util/pathExclusion';

const IO_CONCURRENCY_DEFAULT = 20;

// Matches KMP source sets: commonMain, androidMain, iosMain, jvmMain, jsMain, etc.
// Does NOT match plain `main` or `test` (no prefix before Main/Test).
const KMP_SOURCE_SET_RE = /[/\\]src[/\\]([a-z]\w+(?:Main|Test))[/\\]/;

export class FileScanner {
  private readonly decoder = new TextDecoder();
  private readonly pool: WorkerPool;
  // Each scan gets its own token; cancel() flags the current one so workers stop
  // between files without killing the process or requiring complex coordination.
  private cancelToken: { cancelled: boolean } = { cancelled: false };

  constructor(
    private readonly index: SymbolIndex,
    private readonly log: Logger,
    private readonly moduleMap: Map<string, string> = new Map(),
  ) {
    const cfg         = vscode.workspace.getConfiguration('kotlinJump');
    const workerCount = cfg.get<number>('parserWorkers') ??
      Math.max(2, Math.min(8, os.cpus().length - 1));

    this.pool = new WorkerPool(workerCount);

    if (this.pool.available) {
      this.log.info(`Worker pool: ${workerCount} parser threads`);
    } else {
      this.log.info('Worker pool unavailable — using inline parsing');
    }
  }

  // Invalidates any in-flight scan — workers stop after their current file.
  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  async scanAll(): Promise<void> {
    const token = this.freshToken();

    const cfg         = vscode.workspace.getConfiguration('kotlinJump');
    const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
    const maxFiles    = cfg.get<number>('maxIndexedFiles') ?? 10000;
    const motifExclu = excludeGlob(excludeList);

    const ioConcurrency = cfg.get<number>('concurrency') ?? IO_CONCURRENCY_DEFAULT;
    const maxFileBytes  = (cfg.get<number>('fileSizeLimit', 512)) * 1024;
    const uris = await vscode.workspace.findFiles('**/*.{kt,kts,java}', motifExclu, maxFiles);
    this.log.info(`Scanning ${uris.length} files (io=${ioConcurrency}, workers=${this.pool.available ? 'yes' : 'no'})…`);

    await this.pipeline(uris, ioConcurrency, token, maxFileBytes);
    if (!token.cancelled) this.index.finalize();
  }

  // Re-scan a specific subset of files (used after snapshot load for stale files)
  async rescan(uris: vscode.Uri[]): Promise<void> {
    const token = this.freshToken();
    const cfg          = vscode.workspace.getConfiguration('kotlinJump');
    const maxFileBytes = (cfg.get<number>('fileSizeLimit', 512)) * 1024;
    await this.pipeline(uris, cfg.get<number>('concurrency') ?? IO_CONCURRENCY_DEFAULT, token, maxFileBytes);
    if (!token.cancelled) this.index.finalize();
  }

  /**
   * Indexes a list of files WITHOUT cancelling any scan in flight. `rescan`
   * invalidates the previous scan by design; using it for a folder that was
   * added or renamed killed the initial scan, and two renames in a row
   * cancelled each other.
   */
  async scanFiles(uris: vscode.Uri[]): Promise<void> {
    const token = { cancelled: false };
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const maxFileBytes = (cfg.get<number>('fileSizeLimit', 512)) * 1024;
    await this.pipeline(uris, cfg.get<number>('concurrency') ?? IO_CONCURRENCY_DEFAULT, token, maxFileBytes);
    this.index.finalize();
  }

  async scanFile(uri: vscode.Uri): Promise<void> {
    const t0 = Date.now();
    this.entrer();
    try {
      const maxFileBytes = vscode.workspace.getConfiguration('kotlinJump').get<number>('fileSizeLimit', 512) * 1024;
      if (uri.fsPath.includes('.kapt_metadata')) return;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > maxFileBytes) { this.index.remove(uri); return; }
      const text   = this.decoder.decode(bytes);
      const parsed = await this.parseText(uri.toString(), text, uri.fsPath.endsWith('.java'));
      this.index.add(parsed, this.moduleFor(uri));
      this.index.finalize();
      const name = uri.path.split('/').pop() ?? uri.path;
      this.log.debug(`[scan] ${name} → ${parsed.symbols.length} symbols (${Date.now() - t0}ms)`);
    } catch { /* deleted between event and read */ }
    finally { this.sortir(); }
  }

  async destroy(): Promise<void> {
    await this.pool.destroy();
  }

  // ── I/O pipeline: read files concurrently, offload CPU to worker pool ─────

  private async pipeline(
    uris: vscode.Uri[],
    concurrency: number,
    token: { cancelled: boolean },
    maxFileBytes: number,
  ): Promise<void> {
    let cursor = 0;

    const ioWorker = async (): Promise<void> => {
      while (cursor < uris.length) {
        if (token.cancelled) return; // another scan started — bail out
        // cursor++ is synchronous — safe in single-threaded JS event loop
        const uri = uris[cursor++];
        if (uri.fsPath.includes('.kapt_metadata')) continue;
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          // A file that outgrew the limit since the snapshot kept its old
          // symbols and lines: a skipped file is an emptied file.
          if (bytes.byteLength > maxFileBytes) { this.index.remove(uri); continue; }
          const text   = this.decoder.decode(bytes);
          const parsed = await this.parseText(uri.toString(), text, uri.fsPath.endsWith('.java'));
          if (!token.cancelled) this.index.add(parsed, this.moduleFor(uri));
        } catch { if (!token.cancelled) this.index.remove(uri); /* unreadable / deleted */ }
      }
    };

    // `concurrency` async workers share cursor — each grabs the next URI
    // As soon as a file is read it's immediately sent to a parser worker
    this.entrer();
    try { await Promise.all(Array.from({ length: concurrency }, ioWorker)); }
    finally { this.sortir(); }
  }

  // ── Suivi d'activite ──────────────────────────────────────────────────────
  // Un dossier supprime PENDANT un balayage echappe au veilleur : ses fichiers
  // ne sont ni dans l'index, ni dans sa file, ni dans ses scans en vol, parce
  // que le balayage initial ne passe pas par lui. Ceux dont les octets sont
  // deja lus sont ajoutes apres la suppression. Plutot que de filtrer chaque
  // fichier, ce qui couterait sur le chemin chaud, le veilleur rejoue sa
  // suppression une fois le balayage fini.
  private actifs = 0;
  private attentes: Array<() => void> = [];

  /** Un balayage tourne en ce moment. */
  busy(): boolean { return this.actifs > 0; }

  /** Resolue des qu'aucun balayage ne tourne plus. */
  whenIdle(): Promise<void> {
    if (this.actifs === 0) return Promise.resolve();
    return new Promise<void>(r => this.attentes.push(r));
  }

  private entrer(): void { this.actifs++; }

  private sortir(): void {
    if (--this.actifs > 0) return;
    const a = this.attentes;
    this.attentes = [];
    for (const r of a) r();
  }

  private freshToken(): { cancelled: boolean } {
    this.cancelToken.cancelled = true; // invalidate any previous scan
    this.cancelToken = { cancelled: false };
    return this.cancelToken;
  }

  private async parseText(uriString: string, text: string, isJava: boolean) {
    if (isJava) return parseJava(uriString, text); // Java is lightweight — always inline
    if (this.pool.available) {
      // Un worker peut mourir entre ce test et la reponse. Le rejet ramene
      // ici, ou le parse en ligne prend le relais : sans ce filet le fichier
      // n'etait tout simplement pas indexe.
      try { return await this.pool.run(uriString, text); } catch { /* pool hors service */ }
    }
    return parse(uriString, text);
  }

  private moduleFor(uri: vscode.Uri): string | undefined {
    const p = uri.fsPath;
    const hit = moduleRootFor(p, this.moduleMap);
    if (hit) {
      const kmp = KMP_SOURCE_SET_RE.exec(hit.rel);
      return kmp ? `${hit.name} (${kmp[1]})` : hit.name;
    }
    // Fallback: detect KMP source set without a module map entry (no settings.gradle)
    const kmp = KMP_SOURCE_SET_RE.exec(p);
    if (kmp) return kmp[1];
    return undefined;
  }
}

/**
 * The module whose root contains `fsPath`: the longest root that is a whole
 * path prefix. A bare `startsWith` put `app-widgets/` files in `:app` and
 * `feature/home/` in `:feature` (so "Run test" ran the wrong Gradle task),
 * and never matched on Windows, where settings.gradle roots were joined with
 * `/` while fsPath uses `\`.
 */
export function moduleRootFor(
  fsPath: string,
  moduleMap: ReadonlyMap<string, string>,
): { name: string; rel: string } | undefined {
  const p = fsPath.replace(/\\/g, '/');
  let best: { name: string; rel: string; len: number } | undefined;
  for (const [name, rootPath] of moduleMap) {
    const rootDir = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (p !== rootDir && !p.startsWith(rootDir + '/')) continue;
    if (!best || rootDir.length > best.len) best = { name, rel: p.slice(rootDir.length), len: rootDir.length };
  }
  return best && { name: best.name, rel: best.rel };
}
