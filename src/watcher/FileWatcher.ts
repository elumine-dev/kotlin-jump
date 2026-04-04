import * as vscode from 'vscode';
import { FileScanner } from '../indexer/FileScanner';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { evict } from '../util/ImportResolver';

export class FileWatcher implements vscode.Disposable {
  private readonly ktWatcher:   vscode.FileSystemWatcher;
  private readonly javaWatcher: vscode.FileSystemWatcher;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly scanner: FileScanner,
    private readonly index: SymbolIndex,
    private readonly onFileIndexed?: (uri: vscode.Uri) => void,
  ) {
    this.ktWatcher = vscode.workspace.createFileSystemWatcher('**/*.{kt,kts}');
    this.ktWatcher.onDidCreate(uri => this.onCreated(uri));
    this.ktWatcher.onDidChange(uri => this.onChanged(uri));
    this.ktWatcher.onDidDelete(uri => this.onDeleted(uri));

    this.javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
    this.javaWatcher.onDidCreate(uri => this.onCreated(uri));
    this.javaWatcher.onDidChange(uri => this.onChanged(uri));
    this.javaWatcher.onDidDelete(uri => this.onDeleted(uri));
  }

  private onCreated(uri: vscode.Uri): void {
    this.scanner.scanFile(uri).then(() => this.onFileIndexed?.(uri));
  }

  private onChanged(uri: vscode.Uri): void {
    const key = uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);

    const debounceMs = vscode.workspace.getConfiguration('kotlinJump').get<number>('watcherDebounceMs', 150);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      evict(uri);
      this.index.remove(uri);
      this.scanner.scanFile(uri).then(() => this.onFileIndexed?.(uri));
    }, debounceMs));
  }

  private onDeleted(uri: vscode.Uri): void {
    evict(uri);
    this.index.remove(uri);
  }

  dispose(): void {
    this.ktWatcher.dispose();
    this.javaWatcher.dispose();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
