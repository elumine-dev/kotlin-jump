import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';
import { buildLineStarts, offsetToPos } from '../util/kotlinScan';


/**
 * KJ-026: the VS Code layer of the unused private declaration detector. The
 * detection itself lives in `./unusedDeclarations`, out of reach of `vscode`.
 */

export type { UnusedDecl, UnusedDeclKind } from './unusedDeclarations';
export { findUnusedDeclarations, reflectiveOrAnnotatedClassRanges } from './unusedDeclarations';
export { CONVENTION_FUN_NAMES, REFLECTIVE_SUPERTYPES } from '../util/kotlinScan';
import { findUnusedDeclarations } from './unusedDeclarations';
import type { UnusedDeclKind } from './unusedDeclarations';

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedDeclarations';
const DEBOUNCE_MS = 400;

const KIND_NOUNS: Record<UnusedDeclKind, string> = {
  fun: 'function',
  val: 'property',
  var: 'property',
  class: 'class',
  object: 'object',
  interface: 'interface',
};

export class UnusedDeclarationProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-declarations');
  private readonly _subs: vscode.Disposable[];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) this._refreshDebounced();
      }),
      vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`kotlinJump.${CONFIG_KEY}`)) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refreshDebounced(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refresh(), DEBOUNCE_MS);
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const languageId = editor.document.languageId;
    if (languageId !== 'kotlin' && languageId !== 'java') return;

    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
    if (!enabled) {
      this._collection.clear();
      reportDecorations('unusedDecls', 0);
      return;
    }

    const unused = findUnusedDeclarations(editor.document.getText(), languageId === 'java' ? 'java' : 'kotlin');
    const diags = unused.map(u => {
      const noun = KIND_NOUNS[u.kind];
      const d = new vscode.Diagnostic(
        new vscode.Range(u.line, u.character, u.line, u.character + u.name.length),
        `${noun[0].toUpperCase()}${noun.slice(1)} '${u.name}' is never used`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-declaration';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('unusedDecls', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class UnusedDeclarationCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return [];

    const text = document.getText();
    const lang = document.languageId === 'java' ? 'java' as const : 'kotlin' as const;
    const targets = findUnusedDeclarations(text, lang).filter(u => u.line === range.start.line);
    if (targets.length === 0) return [];

    const lineStarts = buildLineStarts(text);
    const actions: vscode.CodeAction[] = [];
    for (const decl of targets) {
      if (decl.removeStart !== -1) {
        const s = offsetToPos(lineStarts, decl.removeStart);
        const e = offsetToPos(lineStarts, decl.removeEnd);
        const remove = new vscode.CodeAction(
          `Remove unused ${KIND_NOUNS[decl.kind]} '${decl.name}'`,
          vscode.CodeActionKind.QuickFix,
        );
        const edit = new vscode.WorkspaceEdit();
        edit.delete(document.uri, new vscode.Range(s.line, s.character, e.line, e.character));
        remove.edit = edit;
        remove.isPreferred = true;
        actions.push(remove);
      }
      const annotation = lang === 'java' ? '@SuppressWarnings("unused")' : '@Suppress("unused")';
      const suppress = new vscode.CodeAction(`Suppress with ${annotation}`, vscode.CodeActionKind.QuickFix);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(
        document.uri,
        new vscode.Position(decl.suppressLine, 0),
        `${decl.suppressIndent}${annotation}\n`,
      );
      suppress.edit = edit;
      actions.push(suppress);
    }
    return actions;
  }
}
