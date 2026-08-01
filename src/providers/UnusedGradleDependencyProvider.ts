import * as vscode from 'vscode';
import { UnusedCatalogAlias, deleteTitleFor, messageFor } from './unusedGradleDependencies';

/** KJ-041 VS Code shell: diagnostics and the removal quick fix. */

export * from './unusedGradleDependencies';

const CONFIG_KEY = 'unusedGradleDependencies';

export class UnusedGradleDependencyProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-gradle-dependencies');
  private readonly byPath = new Map<string, UnusedCatalogAlias[]>();
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

  setFindings(findings: readonly UnusedCatalogAlias[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const alias of findings) {
      const list = this.byPath.get(alias.path) ?? [];
      list.push(alias);
      this.byPath.set(alias.path, list);

      const range = new vscode.Range(
        alias.line, alias.character, alias.line, alias.character + alias.name.length);
      const diag = new vscode.Diagnostic(range, messageFor(alias), vscode.DiagnosticSeverity.Warning);
      diag.source = 'kotlin-jump';
      diag.code = 'unused-gradle-dependency';
      diag.tags = [vscode.DiagnosticTag.Unnecessary];
      const diags = byFile.get(alias.path) ?? [];
      diags.push(diag);
      byFile.set(alias.path, diags);
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
    if (!UnusedGradleDependencyProvider.isEnabled()) return [];
    const hit = this.byPath.get(document.uri.fsPath)?.find(a => a.line === range.start.line);
    if (!hit) return [];
    // Re-verify against the CURRENT text before offering an edit.
    if (!document.lineAt(hit.line).text.includes(hit.name)) return [];

    const action = new vscode.CodeAction(deleteTitleFor(hit), vscode.CodeActionKind.QuickFix);
    const edit = new vscode.WorkspaceEdit();
    // Both removals in ONE edit: leaving the version behind is harmless but a
    // separate finding for it would be noise, and two undos would be worse.
    const spans = [{ start: hit.removeStart, end: hit.removeEnd }];
    if (hit.orphanedVersion) {
      spans.push({ start: hit.orphanedVersion.removeStart, end: hit.orphanedVersion.removeEnd });
    }
    // Back to front, so an earlier removal never shifts a later offset.
    for (const span of spans.sort((a, b) => b.start - a.start)) {
      edit.delete(
        document.uri,
        new vscode.Range(document.positionAt(span.start), document.positionAt(span.end)),
        { needsConfirmation: true, label: deleteTitleFor(hit) },
      );
    }
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
