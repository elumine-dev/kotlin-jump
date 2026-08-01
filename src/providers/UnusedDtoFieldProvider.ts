import * as vscode from 'vscode';
import { UnusedDtoField, deleteTitleFor, messageFor } from './unusedDtoFields';

/** KJ-044 VS Code shell. */

export * from './unusedDtoFields';

const CONFIG_KEY = 'unusedDtoFields';

export class UnusedDtoFieldProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-dto-fields');
  private readonly byPath = new Map<string, UnusedDtoField[]>();
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

  setFindings(findings: readonly UnusedDtoField[]): void {
    this.collection.clear();
    this.byPath.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of findings) {
      const list = this.byPath.get(f.path) ?? [];
      list.push(f);
      this.byPath.set(f.path, list);
      const range = new vscode.Range(f.line, f.character, f.line, f.character + f.name.length);
      const d = new vscode.Diagnostic(range, messageFor(f), f.verdict === 'unreferenced'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information);
      if (f.verdict === 'unreferenced') d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = f.verdict === 'unreferenced' ? 'unused-dto-field' : 'test-only-dto-field';
      const diags = byFile.get(f.path) ?? [];
      diags.push(d);
      byFile.set(f.path, diags);
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
    if (!UnusedDtoFieldProvider.isEnabled()) return [];
    const hit = this.byPath.get(document.uri.fsPath)?.find(f => f.line === range.start.line);
    if (!hit) return [];
    if (!document.lineAt(hit.line).text.includes(hit.name)) return [];

    const actions: vscode.CodeAction[] = [];
    if (hit.verdict === 'unreferenced' && hit.removeStart !== -1) {
      const action = new vscode.CodeAction(deleteTitleFor(hit), vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      edit.delete(
        document.uri,
        new vscode.Range(document.positionAt(hit.removeStart), document.positionAt(hit.removeEnd)),
        { needsConfirmation: true, label: deleteTitleFor(hit) },
      );
      action.edit = edit;
      actions.push(action);
    }
    const suppress = new vscode.CodeAction(
      'Suppress with // kotlin-jump:ignore unused-dto-field',
      vscode.CodeActionKind.QuickFix,
    );
    const suppressEdit = new vscode.WorkspaceEdit();
    const indent = /^[ \t]*/.exec(document.lineAt(hit.line).text)?.[0] ?? '';
    suppressEdit.insert(document.uri, new vscode.Position(hit.line, 0),
      `${indent}// kotlin-jump:ignore unused-dto-field\n`);
    suppress.edit = suppressEdit;
    actions.push(suppress);
    return actions;
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
