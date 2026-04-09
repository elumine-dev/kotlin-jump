import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import { Logger } from '../util/logger';

const R_STRING_RE   = /\bR\.string\.([A-Za-z_]\w*)\b/g;
const MAX_LABEL_LEN = 40;

export class StringResourceFoldingProvider implements vscode.Disposable {
  private readonly _hideType: vscode.TextEditorDecorationType;
  private readonly _subscriptions: vscode.Disposable[];

  constructor(
    private readonly index: StringResourceIndex,
    private readonly log: Logger,
  ) {
    this._hideType = vscode.window.createTextEditorDecorationType({
      textDecoration: 'none; font-size: 0px;',
    });
    log.info('[StringFolding] provider created');

    this._subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e, new Set<number>());
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document === e.document) {
          const cursorLines = new Set(editor.selections.map(s => s.active.line));
          this._update(editor, cursorLines);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        const cursorLines = new Set(e.selections.map(s => s.active.line));
        this._update(e.textEditor, cursorLines);
      }),
    ];
  }

  invalidateAll(): void {
    const editors = vscode.window.visibleTextEditors;
    this.log.debug(`[StringFolding] invalidateAll — ${editors.length} visible editor(s)`);
    for (const editor of editors) {
      const cursorLines = new Set(editor.selections.map(s => s.active.line));
      this._update(editor, cursorLines);
    }
  }

  private _update(editor: vscode.TextEditor, cursorLines: Set<number>): void {
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('stringResourceFolding', true);
    if (!enabled) {
      editor.setDecorations(this._hideType, []);
      return;
    }

    const lang = editor.document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') { return; }

    const opts: vscode.DecorationOptions[] = [];
    for (let i = 0; i < editor.document.lineCount; i++) {
      if (cursorLines.has(i)) continue;
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
          renderOptions: {
            before: {
              contentText: `"${short}"`,
              color: new vscode.ThemeColor('debugTokenExpression.string'),
            },
          },
        });
      }
    }
    editor.setDecorations(this._hideType, opts);
  }

  dispose(): void {
    this.log.info('[StringFolding] dispose');
    this._hideType.dispose();
    for (const s of this._subscriptions) s.dispose();
  }
}
