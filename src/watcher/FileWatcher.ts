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

const SOURCE_EXT_RE = /\.(?:kt|kts|java)$/;

export class FileWatcher implements vscode.Disposable {
  private readonly ktWatcher:   vscode.FileSystemWatcher;
  private readonly javaWatcher: vscode.FileSystemWatcher;
  private readonly treeWatcher: vscode.FileSystemWatcher;
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
    // Matches the same excludePatterns the initial findFiles scan used
    // (build/, .gradle/). Without it, a Gradle build's regenerated sources
    // storm the watcher even though we never index them.
    private readonly isExcluded: (path: string) => boolean = () => false,
  ) {
    this.ktWatcher = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts}');
    this.ktWatcher.onDidCreate(uri => this.queue(uri));
    this.ktWatcher.onDidChange(uri => this.queue(uri));
    this.ktWatcher.onDidDelete(uri => this.onDeleted(uri));

    this.javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
    this.javaWatcher.onDidCreate(uri => this.queue(uri));
    this.javaWatcher.onDidChange(uri => this.queue(uri));
    this.javaWatcher.onDidDelete(uri => this.onDeleted(uri));

    // A folder deleted outside VS Code (rm -rf, a checkout) is one event for
    // the folder path, which `**/*.kt` never matches: its files stayed
    // indexed, Cmd+T still listed them and Cmd+Click opened "file not found".
    this.treeWatcher = vscode.workspace.createFileSystemWatcher('**', true, true, false);
    this.treeWatcher.onDidDelete(uri => { if (!SOURCE_EXT_RE.test(uri.path)) this.removeTree(uri); });
  }

  /** Drops every indexed file under `folder` (a deleted or renamed folder, a removed workspace folder). */
  removeTree(folder: vscode.Uri): vscode.Uri[] {
    if (SOURCE_EXT_RE.test(folder.path)) return [];
    const prefix = folder.toString().replace(/\/$/, '') + '/';
    const gone = this.index.fileUriStrings().filter(k => k.startsWith(prefix)).map(k => vscode.Uri.parse(k));
    if (gone.length === 0) return gone;
    this.log?.info(`[watcher] folder gone: ${fileName(folder)} — ${gone.length} file(s) dropped`);
    for (const uri of gone) {
      this.pendingScan.delete(uri.toString());
      evict(uri);
      this.index.remove(uri);
    }
    this.notify(gone);
    return gone;
  }

  /** Indexes every source file under a folder that appeared (rename target, added workspace folder). */
  async addTree(folder: vscode.Uri): Promise<vscode.Uri[]> {
    if (SOURCE_EXT_RE.test(folder.path)) return [];
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const excludeList = cfg.get<string[]>('excludePatterns') ?? ['**/build/**', '**/.gradle/**'];
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*.{kt,kts,java}'),
      `{${excludeList.join(',')}}`,
      cfg.get<number>('maxIndexedFiles') ?? 10000,
    );
    const uris = found.filter(u => !this.isExcluded(u.path));
    if (uris.length === 0) return uris;
    this.log?.info(`[watcher] folder added: ${fileName(folder)} — ${uris.length} file(s)`);
    for (const uri of uris) { evict(uri); this.index.remove(uri); }
    await this.scanner.rescan(uris);
    this.notify(uris);
    return uris;
  }

  private notify(uris: vscode.Uri[]): void {
    if (uris.length > BURST_THRESHOLD && this.onBurstIndexed) this.onBurstIndexed(uris);
    else for (const uri of uris) this.onFileIndexed?.(uri);
  }

  /**
   * Create and change events share one queue with a GLOBAL quiet-window
   * timer: every new event pushes the flush back, so a checkout's whole
   * event storm lands in a single batch once the storm goes quiet. The
   * old per-file debounce turned a 500-file checkout into 500 timers
   * expiring simultaneously.
   */
  private queue(uri: vscode.Uri): void {
    // Drop build/ and .gradle/ churn before it ever enters the batch.
    if (this.isExcluded(uri.path)) return;
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
    // The same listeners as after a scan: without them a deleted sealed
    // subtype kept its "missing branch" lens, a deleted class kept its
    // colour in open editors and its "N usages" kept counting.
    this.onFileIndexed?.(uri);
  }

  dispose(): void {
    this.ktWatcher.dispose();
    this.javaWatcher.dispose();
    this.treeWatcher.dispose();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pendingScan.clear();
  }
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}
