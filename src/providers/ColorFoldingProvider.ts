import * as vscode from 'vscode';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';

const R_COLOR_RE = /\bR\.color\.([A-Za-z_]\w*)\b/g;

function revealedLines(sels: readonly vscode.Selection[]): Set<number> {
  const s = new Set<number>();
  for (const sel of sels) for (let l = sel.start.line; l <= sel.end.line; l++) s.add(l);
  return s;
}

export class ColorFoldingProvider implements vscode.Disposable {
  private readonly _decorType = vscode.window.createTextEditorDecorationType({});
  private readonly _subs: vscode.Disposable[];
  private _docDebounce: ReturnType<typeof setTimeout> | undefined;
  private _selDebounce: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly index: ColorResourceIndex) {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e, new Set());
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const ed = vscode.window.activeTextEditor;
        if (ed?.document !== e.document) return;
        clearTimeout(this._docDebounce);
        this._docDebounce = setTimeout(() => this._update(ed, revealedLines(ed.selections)), 100);
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        clearTimeout(this._selDebounce);
        this._selDebounce = setTimeout(() => this._update(e.textEditor, revealedLines(e.selections)), 30);
      }),
    ];
    this.invalidateAll();
  }

  invalidateAll(): void {
    for (const ed of vscode.window.visibleTextEditors) this._update(ed, revealedLines(ed.selections));
  }

  private _update(ed: vscode.TextEditor, revealed: Set<number>): void {
    const lang = ed.document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') { ed.setDecorations(this._decorType, []); return; }
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('colorResourceFolding', true);
    if (!enabled) { ed.setDecorations(this._decorType, []); return; }

    const opts: vscode.DecorationOptions[] = [];
    for (let i = 0; i < ed.document.lineCount; i++) {
      if (revealed.has(i)) continue;
      const text = ed.document.lineAt(i).text;
      R_COLOR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = R_COLOR_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index) && !isInsideStringInterpolation(text, m.index)) continue;
        const entry = this.index.getValue(m[1]);
        if (!entry) continue;
        const cssColor = toCSS(entry.value);
        opts.push({
          range: new vscode.Range(i, m.index, i, m.index),
          renderOptions: {
            before: {
              contentText: '\u00A0',
              backgroundColor: cssColor,
              margin: '0 4px 0 0',
              border: '1px solid',
              borderColor: new vscode.ThemeColor('editor.foreground'),
              textDecoration: 'none; display: inline-block; width: 0.65em; height: 0.65em; vertical-align: middle;',
            },
          },
        });
      }
    }
    ed.setDecorations(this._decorType, opts);
  }

  dispose(): void {
    clearTimeout(this._docDebounce);
    clearTimeout(this._selDebounce);
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}

function toCSS(v: string): string {
  const c = v.trim();
  if (!c.startsWith('#')) return '#808080';
  if (c.length === 5) {           // #ARGB (Android shorthand, 4 hex digits)
    const a = parseInt(c[1], 16);
    const r = parseInt(c[2], 16);
    const g = parseInt(c[3], 16);
    const b = parseInt(c[4], 16);
    return `rgba(${r * 17},${g * 17},${b * 17},${(a * 17 / 255).toFixed(2)})`;
  }
  if (c.length === 9) {           // #AARRGGBB (Android full, 8 hex digits)
    const a = parseInt(c.slice(1, 3), 16);
    const r = parseInt(c.slice(3, 5), 16);
    const g = parseInt(c.slice(5, 7), 16);
    const b = parseInt(c.slice(7, 9), 16);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  return c;
}
