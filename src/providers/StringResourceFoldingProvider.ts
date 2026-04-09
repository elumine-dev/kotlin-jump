import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import { Logger } from '../util/logger';

const R_STRING_RE   = /\bR\.string\.([A-Za-z_]\w*)\b/g;
const MAX_LABEL_LEN = 40;

function revealedLinesForSelections(selections: readonly vscode.Selection[]): Set<number> {
  const set = new Set<number>();
  for (const s of selections) {
    const lo = Math.min(s.start.line, s.end.line);
    const hi = Math.max(s.start.line, s.end.line);
    for (let l = lo; l <= hi; l++) set.add(l);
  }
  return set;
}

export class StringResourceFoldingProvider implements vscode.Disposable {
  private readonly _hideType: vscode.TextEditorDecorationType;
  private readonly _statusBar: vscode.StatusBarItem;
  private readonly _subscriptions: vscode.Disposable[];

  constructor(private readonly index: StringResourceIndex, private readonly log: Logger) {
    this._hideType = vscode.window.createTextEditorDecorationType({
      textDecoration: 'none; font-size: 0px;',
    });
    this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._statusBar.tooltip = 'R.string references folded in this file (Kotlin Jump)';
    log.info('[StringFolding] provider created');
    this._subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e, new Set<number>());
        else this._statusBar.hide();
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) {
          this._update(editor, revealedLinesForSelections(editor.selections));
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        this._update(e.textEditor, revealedLinesForSelections(e.selections));
      }),
    ];
  }

  invalidateAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this._update(editor, revealedLinesForSelections(editor.selections));
    }
  }

  private _update(editor: vscode.TextEditor, revealedLines: Set<number>): void {
    const isActive = editor === vscode.window.activeTextEditor;
    const lang = editor.document.languageId;

    if (lang !== 'kotlin' && lang !== 'java') {
      if (isActive) this._statusBar.hide();
      return;
    }

    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('stringResourceFolding', true);

    if (!enabled) {
      editor.setDecorations(this._hideType, []);
      if (isActive) {
        this._statusBar.text = '$(eye-closed) strings';
        this._statusBar.show();
      }
      return;
    }

    const opts: vscode.DecorationOptions[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      if (revealedLines.has(i)) continue;
      const text = editor.document.lineAt(i).text;
      R_STRING_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = R_STRING_RE.exec(text))) {
        const entry = this.index.getValue(m[1]);
        if (!entry) continue;
        const short = entry.value.length > MAX_LABEL_LEN
          ? entry.value.slice(0, MAX_LABEL_LEN) + '…' : entry.value;
        opts.push({
          range: new vscode.Range(i, m.index, i, m.index + m[0].length),
          renderOptions: { before: { contentText: `"${short}"`, color: new vscode.ThemeColor('debugTokenExpression.string') } },
        });
      }
    }

    editor.setDecorations(this._hideType, opts);

    if (isActive) {
      this._statusBar.text = `$(symbol-string) ${opts.length}`;
      this._statusBar.show();
    }
  }

  dispose(): void {
    this.log.info('[StringFolding] dispose');
    this._hideType.dispose();
    this._statusBar.dispose();
    for (const s of this._subscriptions) s.dispose();
  }
}
