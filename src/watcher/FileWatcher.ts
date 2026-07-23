import * as vscode from 'vscode';
import { FileScanner } from '../indexer/FileScanner';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { evict } from '../util/ImportResolver';
import { Logger } from '../util/logger';

/**
 * Above this many files in one quiet-window, the flush switches from
 * per-file parallel handling to sequential batch mode. A human edits a
 * handful of files; a git checkout / rebase / stash pop changes hundreds
 * at once, and handling those in parallel starves the extension host —
 * including VS Code's own git extension, which shares it.
 */
const BURST_THRESHOLD = 8;

export class FileWatcher implements vscode.Disposable {
  private readonly ktWatcher:   vscode.FileSystemWatcher;
  private readonly javaWatcher: vscode.FileSystemWatcher;
  private readonly pendingScan = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly scanner: FileScanner,
    private readonly index: SymbolIndex,
    private readonly onFileIndexed?: (uri: vscode.Uri) => void,
    private readonly log?: Logger,
    // Called ONCE after a burst-sized batch instead of onFileIndexed per
    // file: per-file test-tree refreshes are O(tests) each, so N of them
    // during a checkout is O(N × tests) for a result one discovery pass
    // gets in O(tests).
    private readonly onBurstIndexed?: (uris: vscode.Uri[]) => void,
  ) {
    this.ktWatcher = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts}');
    this.ktWatcher.onDidCreate(uri => this.queue(uri));
    this.ktWatcher.onDidChange(uri => this.queue(uri));
    this.ktWatcher.onDidDelete(uri => this.onDeleted(uri));

    this.javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
    this.javaWatcher.onDidCreate(uri => this.queue(uri));
    this.javaWatcher.onDidChange(uri => this.queue(uri));
    this.javaWatcher.onDidDelete(uri => this.onDeleted(uri));
  }

  /**
   * Create and change events share one queue with a GLOBAL quiet-window
   * timer: every new event pushes the flush back, so a checkout's whole
   * event storm lands in a single batch once the storm goes quiet. The
   * old per-file debounce turned a 500-file checkout into 500 timers
   * expiring simultaneously.
   */
  private queue(uri: vscode.Uri): void {
    this.pendingScan.add(uri.toString());
    if (this.flushTimer) clearTimeout(this.flushTimer);
    const debounceMs = vscode.workspace.getConfiguration('kotlinJump').get<number>('watcherDebounceMs', 150);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, debounceMs);
  }

  private async flush(): Promise<void> {
    if (this.pendingScan.size === 0) return;
    const uris = [...this.pendingScan].map(s => vscode.Uri.parse(s));
    this.pendingScan.clear();

    if (uris.length <= BURST_THRESHOLD) {
      // Normal editing: parallel scans, per-file notification (existing behavior).
      for (const uri of uris) {
        this.log?.debug(`[watcher] changed: ${fileName(uri)} — re-indexing`);
        evict(uri);
        this.index.remove(uri);
        void this.scanner.scanFile(uri).then(() => this.onFileIndexed?.(uri));
      }
      return;
    }

    // Burst mode: sequential with an event-loop yield between files, so the
    // extension host stays responsive while git churns the working tree.
    this.log?.info(`[watcher] burst of ${uris.length} files (checkout/rebase?) — sequential scan, single refresh`);
    for (const uri of uris) {
      evict(uri);
      this.index.remove(uri);
      try { await this.scanner.scanFile(uri); } catch { /* unreadable mid-checkout — skip */ }
      await new Promise<void>(r => setTimeout(r, 0));
    }
    if (this.onBurstIndexed) this.onBurstIndexed(uris);
    else for (const uri of uris) this.onFileIndexed?.(uri);
  }

  private onDeleted(uri: vscode.Uri): void {
    this.log?.info(`[watcher] deleted: ${fileName(uri)}`);
    this.pendingScan.delete(uri.toString());
    evict(uri);
    this.index.remove(uri);
  }

  dispose(): void {
    this.ktWatcher.dispose();
    this.javaWatcher.dispose();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pendingScan.clear();
  }
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}
