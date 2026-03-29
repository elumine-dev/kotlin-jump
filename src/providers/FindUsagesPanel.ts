import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { scanForUsages, DEFAULT_TEST_SEGMENTS } from './FindUsagesEngine';

// ── Tree node types ───────────────────────────────────────────────────────────

export type FileKind = 'production' | 'test' | 'preview';

export interface FileNode {
  readonly nodeKind: 'file';
  readonly uri: vscode.Uri;
  readonly fileKind: FileKind;
  readonly label: string;    // basename e.g. "UserViewModel.kt"
  readonly usages: UsageNode[];
}

export interface UsageNode {
  readonly nodeKind: 'usage';
  readonly uri: vscode.Uri;
  readonly line: number;      // 0-based
  readonly character: number; // 0-based
  readonly wordLength: number;
  readonly lineText: string;  // raw source line
  readonly parent: FileNode;  // required for getParent() / reveal()
}

export type UsageTreeNode = FileNode | UsageNode;

const FILE_KIND_ORDER: Record<FileKind, number> = { production: 0, test: 1, preview: 2 };

// ── Panel ─────────────────────────────────────────────────────────────────────

export class FindUsagesPanel
  implements vscode.TreeDataProvider<UsageTreeNode>, vscode.Disposable
{
  // Resolved after createTreeView() — see attachTreeView()
  private treeView!: vscode.TreeView<UsageTreeNode>;

  private readonly _onChange =
    new vscode.EventEmitter<UsageTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onChange.event;

  private allFiles: FileNode[] = [];
  private currentWord = '';
  showTests    = true;
  showPreviews = true;

  private cancelSource: vscode.CancellationTokenSource | undefined;

  constructor(private readonly index: SymbolIndex) {}

  /** Called once from extension.ts after vscode.window.createTreeView() */
  attachTreeView(tv: vscode.TreeView<UsageTreeNode>): void {
    this.treeView = tv;
  }

  dispose(): void {
    this.cancelSource?.cancel();
    this._onChange.dispose();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Returns true if it navigated directly (single result after exclude). */
  async search(
    document: vscode.TextDocument,
    position: vscode.Position,
    exclude?: { excludeUri?: string; excludeLine?: number },
  ): Promise<boolean> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
    if (!wordRange) return false;
    const word = document.getText(wordRange);
    if (word.length < 2) return false;

    // Cancel any in-flight search
    this.cancelSource?.cancel();
    this.cancelSource = new vscode.CancellationTokenSource();
    const token = this.cancelSource.token;

    this.currentWord = word;
    this.allFiles = [];
    this.treeView.message = `Searching for "${word}"…`;
    this.treeView.description = undefined;
    this._onChange.fire();

    let raw = await scanForUsages(
      word,
      document,
      this.index,
      this.index.fileUriStrings(),
      token,
    );

    if (token.isCancellationRequested) return false;

    // Exclude the declaration the user just clicked on
    if (exclude?.excludeUri !== undefined) {
      raw = raw.filter(r => !(r.uriString === exclude.excludeUri && r.line === exclude.excludeLine));

      // Single result → navigate directly instead of showing the panel
      if (raw.length === 1) {
        const r = raw[0];
        await vscode.commands.executeCommand('vscode.open', r.uri, {
          preview: true,
          selection: new vscode.Range(r.line, r.character, r.line, r.character + word.length),
        } as vscode.TextDocumentShowOptions);
        this.treeView.message = undefined;
        return true;
      }
    }

    const cfg = vscode.workspace.getConfiguration('kotlinNav');
    const testSegments = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);

    this.allFiles = buildFileNodes(raw, word, testSegments);
    this.treeView.message = this.allFiles.length === 0
      ? `No usages found for "${word}"`
      : undefined;
    this._updateDescription();
    this._onChange.fire();
    return false;
  }

  toggleTests(): void {
    this.showTests = !this.showTests;
    vscode.commands.executeCommand('setContext', 'kotlinNav.findUsages.showTests', this.showTests);
    this._updateDescription();
    this._onChange.fire();
  }

  togglePreviews(): void {
    this.showPreviews = !this.showPreviews;
    vscode.commands.executeCommand('setContext', 'kotlinNav.findUsages.showPreviews', this.showPreviews);
    this._updateDescription();
    this._onChange.fire();
  }

  // ── TreeDataProvider ───────────────────────────────────────────────────────

  getTreeItem(node: UsageTreeNode): vscode.TreeItem {
    if (node.nodeKind === 'file') return buildFileItem(node);
    return buildUsageItem(node);
  }

  getChildren(node?: UsageTreeNode): UsageTreeNode[] {
    if (!node) return this._visibleFiles();
    if (node.nodeKind === 'file') return node.usages;
    return [];
  }

  getParent(node: UsageTreeNode): FileNode | undefined {
    return node.nodeKind === 'usage' ? node.parent : undefined;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _visibleFiles(): FileNode[] {
    return this.allFiles.filter(f =>
      (f.fileKind !== 'test'    || this.showTests) &&
      (f.fileKind !== 'preview' || this.showPreviews),
    );
  }

  private _updateDescription(): void {
    if (!this.currentWord) return;
    const visible = this._visibleFiles();
    const total = visible.reduce((n, f) => n + f.usages.length, 0);
    const hidden: string[] = [];
    if (!this.showTests)    hidden.push('tests');
    if (!this.showPreviews) hidden.push('previews');
    const suffix = hidden.length > 0 ? ` · ${hidden.join(' + ')} hidden` : '';
    this.treeView.description = `${total} usages of "${this.currentWord}"${suffix}`;
  }
}

// ── Tree item builders ────────────────────────────────────────────────────────

function buildFileItem(node: FileNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
  item.resourceUri = node.uri; // enables file-colour theming from the active icon theme
  item.description = String(node.usages.length);
  if (node.fileKind === 'test')    { item.description += '  test';    item.iconPath = new vscode.ThemeIcon('beaker'); }
  else if (node.fileKind === 'preview') { item.description += '  preview'; item.iconPath = new vscode.ThemeIcon('eye'); }
  else                             { item.iconPath = vscode.ThemeIcon.File; }
  return item;
}

function buildUsageItem(node: UsageNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.lineText.trimStart());
  item.description = `line ${node.line + 1}`;
  item.tooltip     = node.lineText.trim();
  item.iconPath    = new vscode.ThemeIcon('arrow-right');
  item.command     = {
    command:   'vscode.open',
    title:     'Go to usage',
    arguments: [
      node.uri,
      {
        preview:   true,
        selection: new vscode.Range(node.line, node.character, node.line, node.character + node.wordLength),
      } as vscode.TextDocumentShowOptions,
    ],
  };
  return item;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFileNodes(
  raw: import('./FindUsagesEngine').UsageResult[],
  word: string,
  testSegments: string[],
): FileNode[] {
  // Group by URI
  const byUri = new Map<string, import('./FindUsagesEngine').UsageResult[]>();
  for (const r of raw) {
    let arr = byUri.get(r.uriString);
    if (!arr) { arr = []; byUri.set(r.uriString, arr); }
    arr.push(r);
  }

  const fileNodes: FileNode[] = [];
  for (const [, results] of byUri) {
    const uri      = results[0].uri;
    const fileKind = classifyFile(uri.path, testSegments);
    const label    = uri.path.split('/').pop() ?? uri.path;

    // Build file node first so usage nodes can back-reference it
    const fileNode: FileNode = {
      nodeKind: 'file',
      uri,
      fileKind,
      label,
      usages: [],
    };

    const usages: UsageNode[] = results.map(r => ({
      nodeKind: 'usage',
      uri: r.uri,
      line: r.line,
      character: r.character,
      wordLength: word.length,
      lineText: r.lineText,
      parent: fileNode,
    }));

    // Assign usages after creation (can't set readonly after the fact — cast once)
    (fileNode as { usages: UsageNode[] }).usages = usages;

    fileNodes.push(fileNode);
  }

  // Sort: production → tests → previews; alphabetical within each group
  fileNodes.sort((a, b) => {
    const diff = FILE_KIND_ORDER[a.fileKind] - FILE_KIND_ORDER[b.fileKind];
    return diff !== 0 ? diff : a.label.localeCompare(b.label);
  });

  return fileNodes;
}

function classifyFile(path: string, testSegments: string[]): FileKind {
  if (testSegments.some(s => path.includes(s))) return 'test';
  if (path.includes('/src/debug/') && path.endsWith('Preview.kt')) return 'preview';
  return 'production';
}
