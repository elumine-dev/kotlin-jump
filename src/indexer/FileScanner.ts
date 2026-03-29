import * as vscode from 'vscode';
import * as os from 'os';
import { parse } from './KotlinParser';
import { parseJava } from './JavaParser';
import { SymbolIndex } from './SymbolIndex';
import { WorkerPool } from './WorkerPool';
import { Logger } from '../util/logger';

const MAX_FILE_BYTES = 512 * 1024; // skip files > 512 KB (generated / huge)
const IO_CONCURRENCY_DEFAULT = 20;

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
    const excludeGlob = `{${excludeList.join(',')}}`;

    const ioConcurrency = cfg.get<number>('concurrency') ?? IO_CONCURRENCY_DEFAULT;
    const uris = await vscode.workspace.findFiles('**/*.{kt,kts,java}', excludeGlob, maxFiles);
    this.log.info(`Scanning ${uris.length} files (io=${ioConcurrency}, workers=${this.pool.available ? 'yes' : 'no'})…`);

    await this.pipeline(uris, ioConcurrency, token);
    if (!token.cancelled) this.index.finalize();
  }

  // Re-scan a specific subset of files (used after snapshot load for stale files)
  async rescan(uris: vscode.Uri[]): Promise<void> {
    const token = this.freshToken();
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    await this.pipeline(uris, cfg.get<number>('concurrency') ?? IO_CONCURRENCY_DEFAULT, token);
    if (!token.cancelled) this.index.finalize();
  }

  async scanFile(uri: vscode.Uri): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) return;
      const text   = this.decoder.decode(bytes);
      const parsed = await this.parseText(uri.toString(), text, uri.fsPath.endsWith('.java'));
      this.index.add(parsed, this.moduleFor(uri));
      this.index.finalize();
    } catch { /* deleted between event and read */ }
  }

  async destroy(): Promise<void> {
    await this.pool.destroy();
  }

  // ── I/O pipeline: read files concurrently, offload CPU to worker pool ─────

  private async pipeline(
    uris: vscode.Uri[],
    concurrency: number,
    token: { cancelled: boolean },
  ): Promise<void> {
    let cursor = 0;

    const ioWorker = async (): Promise<void> => {
      while (cursor < uris.length) {
        if (token.cancelled) return; // another scan started — bail out
        // cursor++ is synchronous — safe in single-threaded JS event loop
        const uri = uris[cursor++];
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > MAX_FILE_BYTES) continue;
          const text   = this.decoder.decode(bytes);
          const parsed = await this.parseText(uri.toString(), text, uri.fsPath.endsWith('.java'));
          if (!token.cancelled) this.index.add(parsed, this.moduleFor(uri));
        } catch { /* skip unreadable / deleted files */ }
      }
    };

    // `concurrency` async workers share cursor — each grabs the next URI
    // As soon as a file is read it's immediately sent to a parser worker
    await Promise.all(Array.from({ length: concurrency }, ioWorker));
  }

  private freshToken(): { cancelled: boolean } {
    this.cancelToken.cancelled = true; // invalidate any previous scan
    this.cancelToken = { cancelled: false };
    return this.cancelToken;
  }

  private async parseText(uriString: string, text: string, isJava: boolean) {
    if (isJava) return parseJava(uriString, text); // Java is lightweight — always inline
    if (this.pool.available) return this.pool.run(uriString, text);
    return parse(uriString, text);
  }

  private moduleFor(uri: vscode.Uri): string | undefined {
    const p = uri.fsPath;
    for (const [name, rootPath] of this.moduleMap) {
      if (p.startsWith(rootPath)) return name;
    }
    return undefined;
  }
}
