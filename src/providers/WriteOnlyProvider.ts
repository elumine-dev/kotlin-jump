import * as vscode from 'vscode';
import { reportDecorations } from '../util/demoProbe';
import { buildLineStarts, offsetToPos } from '../util/kotlinScan';

/**
 * KJ-028: the VS Code layer of the write-only variable detector. The detection
 * and the edits it proposes live in `./writeOnlyVariables`, out of reach of
 * `vscode`.
 */

export type { WriteOnlyKind, WriteOnlyVar, Edit } from './writeOnlyVariables';
export { findWriteOnlyVariables, classifyOccurrence } from './writeOnlyVariables';
import { findWriteOnlyVariables } from './writeOnlyVariables';

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'writeOnlyVariables';
const DEBOUNCE_MS = 400;

export class WriteOnlyProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-write-only');
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
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
    if (!enabled) {
      this._collection.clear();
      reportDecorations('writeOnly', 0);
      return;
    }

    const diags = findWriteOnlyVariables(editor.document.getText()).map(v => {
      const d = new vscode.Diagnostic(
        new vscode.Range(v.line, v.character, v.line, v.character + v.name.length),
        `Variable '${v.name}' is assigned but never read`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'write-only-variable';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('writeOnly', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class WriteOnlyCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findWriteOnlyVariables(text).filter(v => v.line === range.start.line);
    if (targets.length === 0) return [];

    const lineStarts = buildLineStarts(text);
    const toRange = (start: number, end: number) => {
      const s = offsetToPos(lineStarts, start);
      const e = offsetToPos(lineStarts, end);
      return new vscode.Range(s.line, s.character, e.line, e.character);
    };

    const actions: vscode.CodeAction[] = [];
    for (const v of targets) {
      if (v.edits.length > 0) {
        const plural = v.writeCount > 1 ? 's' : '';
        const remove = new vscode.CodeAction(
          `Remove '${v.name}' and its ${v.writeCount} assignment${plural}`,
          vscode.CodeActionKind.QuickFix,
        );
        const edit = new vscode.WorkspaceEdit();
        for (const e of v.edits) edit.replace(document.uri, toRange(e.start, e.end), e.text);
        remove.edit = edit;
        remove.isPreferred = true;
        actions.push(remove);
      }

      const suppress = new vscode.CodeAction('Suppress with @Suppress("unused")', vscode.CodeActionKind.QuickFix);
      const suppressEdit = new vscode.WorkspaceEdit();
      suppressEdit.insert(
        document.uri,
        new vscode.Position(v.suppressLine, 0),
        `${v.suppressIndent}@Suppress("unused")\n`,
      );
      suppress.edit = suppressEdit;
      actions.push(suppress);
    }
    return actions;
  }
}
