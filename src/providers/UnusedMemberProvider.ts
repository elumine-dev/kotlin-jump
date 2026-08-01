import * as vscode from 'vscode';
import {
  UnusedMember,
  deleteTitleFor,
  makePrivateTitleFor,
  messageFor,
} from './unusedMembers';

/**
 * KJ-042 VS Code shell.
 *
 * A dedicated provider rather than a generalisation of UnusedSymbolProvider:
 * the audit gate requires KJ-032 unchanged to the bit, and the cheapest way to
 * guarantee that is not to touch its shell.
 */

export * from './unusedMembers';

const CONFIG_KEY = 'unusedMembers';

export class UnusedMemberProvider implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  private readonly collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-members');
  private readonly byPath = new Map<string, UnusedMember[]>();
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

  setFindings(findings: readonly UnusedMember[]): void {
    this.collection.clear();
    this.byPath.clear();

    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const m of findings) {
      const list = this.byPath.get(m.path) ?? [];
      list.push(m);
      this.byPath.set(m.path, list);

      const range = new vscode.Range(m.line, m.character, m.line, m.character + m.name.length);
      const d = new vscode.Diagnostic(range, messageFor(m), m.verdict === 'unreferenced'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information);
      // Only a truly unreferenced member is unnecessary. A testOnly member is
      // exercised, and a selfOnly one is merely over-exposed.
      if (m.verdict === 'unreferenced') d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = m.verdict === 'unreferenced' ? 'unused-member' : `${m.verdict}-member`;
      const diags = byFile.get(m.path) ?? [];
      diags.push(d);
      byFile.set(m.path, diags);
    }

    for (const [p, diags] of byFile) this.collection.set(vscode.Uri.file(p), diags);
  }

  clear(): void {
    this.collection.clear();
    this.byPath.clear();
  }

  findingsFor(path: string): UnusedMember[] | undefined {
    return this.byPath.get(path);
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!UnusedMemberProvider.isEnabled()) return [];
    const hit = this.byPath.get(document.uri.fsPath)?.find(m => m.line === range.start.line);
    if (!hit) return [];
    // Re-verify against the CURRENT text before offering any edit.
    const lineText = document.lineAt(hit.line).text;
    if (!lineText.includes(hit.name)) return [];

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

    if (hit.verdict === 'selfOnly') {
      // The one fix in the family the compiler fully re-checks behind us. And
      // once private, KJ-026 tracks the member file-locally, in real time.
      const makePrivate = new vscode.CodeAction(makePrivateTitleFor(hit), vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      const visibility = /\b(public|internal|protected)\s+/.exec(lineText);
      if (visibility) {
        const start = new vscode.Position(hit.line, visibility.index);
        const end = new vscode.Position(hit.line, visibility.index + visibility[0].length);
        edit.replace(document.uri, new vscode.Range(start, end), 'private ');
      } else {
        const indent = /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
        edit.insert(document.uri, new vscode.Position(hit.line, indent), 'private ');
      }
      makePrivate.edit = edit;
      makePrivate.isPreferred = true;
      actions.push(makePrivate);
    }

    if (hit.verdict === 'testOnly') {
      const annotate = new vscode.CodeAction(
        `Annotate ${hit.name} with @VisibleForTesting`,
        vscode.CodeActionKind.QuickFix,
      );
      const edit = new vscode.WorkspaceEdit();
      const indent = /^[ \t]*/.exec(lineText)?.[0] ?? '';
      edit.insert(document.uri, new vscode.Position(hit.line, 0), `${indent}@VisibleForTesting\n`);
      annotate.edit = edit;
      actions.push(annotate);
    }

    const suppress = new vscode.CodeAction(
      'Suppress with @Suppress("unused")',
      vscode.CodeActionKind.QuickFix,
    );
    const suppressEdit = new vscode.WorkspaceEdit();
    const indent = /^[ \t]*/.exec(lineText)?.[0] ?? '';
    suppressEdit.insert(document.uri, new vscode.Position(hit.line, 0), `${indent}@Suppress("unused")\n`);
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
