import * as vscode from 'vscode';
import {
  UnusedEnumEntry,
  deleteTitleFor,
  messageFor,
} from './unusedEnumEntries';

/**
 * KJ-039 VS Code shell: diagnostics and the removal quick fix.
 *
 * The detector lives in `unusedEnumEntries.ts` so it runs without an extension
 * host; everything it exports is re-exported here.
 */

export * from './unusedEnumEntries';

const CONFIG_KEY = 'unusedEnumEntries';

export class UnusedEnumEntryProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-enum-entries');
  private readonly byPath = new Map<string, UnusedEnumEntry[]>();
  private readonly subs: vscode.Disposable[];

  constructor() {
    this.subs = [
      // A cross-file claim cannot be recomputed from one buffer, so an edited
      // file loses its findings until the next scan.
      vscode.workspace.onDidChangeTextDocument(e => this.forget(e.document.uri.fsPath)),
      vscode.workspace.onDidDeleteFiles(e => {
        for (const uri of e.files) this.forget(uri.fsPath);
      }),
    ];
  }

  static isEnabled(): boolean {
    return vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
  }

  setFindings(findings: readonly UnusedEnumEntry[]): void {
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
      // Same rule as KJ-032: an entry the tests exercise is not unnecessary.
      if (f.verdict === 'unreferenced') d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = f.verdict === 'unreferenced' ? 'unused-enum-entry' : 'test-only-enum-entry';
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

  findingsFor(path: string): UnusedEnumEntry[] | undefined {
    return this.byPath.get(path);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!UnusedEnumEntryProvider.isEnabled()) return [];
    const findings = this.byPath.get(document.uri.fsPath);
    if (!findings?.length) return [];

    const hit = findings.find(f => f.line === range.start.line);
    if (!hit) return [];
    // Re-verify against the CURRENT text: an offset from the last scan must
    // never aim a deletion at a line that has since moved.
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
      action.isPreferred = false;
      actions.push(action);
    }

    const suppress = new vscode.CodeAction(
      'Suppress with // kotlin-jump:ignore unused-enum-entry',
      vscode.CodeActionKind.QuickFix,
    );
    const suppressEdit = new vscode.WorkspaceEdit();
    const indent = /^[ \t]*/.exec(document.lineAt(hit.line).text)?.[0] ?? '';
    suppressEdit.insert(
      document.uri,
      new vscode.Position(hit.line, 0),
      `${indent}// kotlin-jump:ignore unused-enum-entry\n`,
    );
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
