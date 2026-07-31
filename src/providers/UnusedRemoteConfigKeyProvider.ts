import * as vscode from 'vscode';
import { UnusedRemoteConfigKey, deleteTitleFor, messageFor } from './unusedRemoteConfigKeys';

/** KJ-040 VS Code shell: diagnostics and the removal quick fix. */

export * from './unusedRemoteConfigKeys';

const CONFIG_KEY = 'unusedRemoteConfigKeys';

export class UnusedRemoteConfigKeyProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-remote-config-keys');
  private readonly byPath = new Map<string, { key: UnusedRemoteConfigKey; line: number }[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  setFindings(findings: readonly UnusedRemoteConfigKey[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const key of findings) {
      for (const d of key.declarations) {
        const list = this.byPath.get(d.path) ?? [];
        list.push({ key, line: d.line });
        this.byPath.set(d.path, list);

        const range = new vscode.Range(d.line, d.character, d.line, d.character + key.name.length);
        const diag = new vscode.Diagnostic(range, messageFor(key), vscode.DiagnosticSeverity.Warning);
        diag.source = 'kotlin-jump';
        diag.code = 'unused-remote-config-key';
        diag.tags = [vscode.DiagnosticTag.Unnecessary];
        const diags = byFile.get(d.path) ?? [];
        diags.push(diag);
        byFile.set(d.path, diags);
      }
    }

    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!UnusedRemoteConfigKeyProvider.isEnabled()) return [];
    const here = this.byPath.get(document.uri.fsPath)?.find(h => h.line === range.start.line);
    if (!here) return [];
    // Re-verify against the CURRENT text before offering an edit.
    if (!document.lineAt(here.line).text.includes(here.key.name)) return [];

    // Only the open document can convert its own offsets, so the quick fix
    // edits THIS file. Other variants need their text read, which is the
    // workspace command's job; the title says how many are left so nobody
    // thinks the key is gone everywhere.
    const mine = here.key.declarations.find(d => d.path === document.uri.fsPath);
    if (!mine) return [];
    const others = here.key.declarations.length - 1;
    const title = others > 0
      ? `${deleteTitleFor(here.key)} here (${others} other variant${others > 1 ? 's' : ''} left)`
      : deleteTitleFor(here.key);

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    const edit = new vscode.WorkspaceEdit();
    edit.delete(
      document.uri,
      new vscode.Range(document.positionAt(mine.removeStart), document.positionAt(mine.removeEnd)),
      { needsConfirmation: true, label: title },
    );
    action.edit = edit;
    action.isPreferred = false;
    return [action];
  }

  private forget(path: string): void {
    this.collection.delete(vscode.Uri.file(path));
    this.byPath.delete(path);
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.collection.dispose();
  }
}
