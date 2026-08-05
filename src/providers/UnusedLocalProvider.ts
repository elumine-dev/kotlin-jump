import * as vscode from 'vscode';
import { buildLineStarts, offsetToPos } from '../util/kotlinScan';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-027: the VS Code layer of the unused locals detector. The detection and
 * the fix computation live in `./unusedLocals`, out of reach of `vscode`.
 */

export type { UnusedLocal, UnusedLocalKind, LocalFixKind, Block, Structure } from './unusedLocals';
export {
  scanStructure, innermostBlockAt, enclosingBody, suppressedRegions,
  escapeName, blank, findUnusedLocals, isPureInitializer,
} from './unusedLocals';
import { findUnusedLocals } from './unusedLocals';
import type { UnusedLocal, UnusedLocalKind, LocalFixKind } from './unusedLocals';

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedLocals';
const DEBOUNCE_MS = 400;

const MESSAGES: Record<UnusedLocalKind, (name: string) => string> = {
  local: name => `Variable '${name}' is never used`,
  lambdaParam: name => `Lambda parameter '${name}' is never used`,
  catchBinding: name => `Caught exception '${name}' is never used`,
};

const FIX_TITLES: Record<Exclude<LocalFixKind, 'none'>, (name: string) => string> = {
  deleteLine: name => `Remove unused variable '${name}'`,
  keepCall: () => 'Remove variable, keep the call',
  renameUnderscore: name => `Replace '${name}' with '_'`,
};

export class UnusedLocalProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-locals');
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
      reportDecorations('unusedLocals', 0);
      return;
    }

    const diags = findUnusedLocals(editor.document.getText()).map(u => {
      const d = new vscode.Diagnostic(
        new vscode.Range(u.line, u.character, u.line, u.character + u.name.length),
        MESSAGES[u.kind](u.name),
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-local';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('unusedLocals', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class UnusedLocalCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findUnusedLocals(text).filter(u => u.line === range.start.line && u.fix !== 'none');
    if (targets.length === 0) return [];

    const lineStarts = buildLineStarts(text);
    return targets.map(u => {
      const action = new vscode.CodeAction(
        FIX_TITLES[u.fix as Exclude<LocalFixKind, 'none'>](u.name),
        vscode.CodeActionKind.QuickFix,
      );
      const s = offsetToPos(lineStarts, u.fixStart);
      const e = offsetToPos(lineStarts, u.fixEnd);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(s.line, s.character, e.line, e.character), u.fixText);
      action.edit = edit;
      action.isPreferred = true;
      return action;
    });
  }
}
