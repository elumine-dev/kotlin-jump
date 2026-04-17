import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';

// Only fold SCREAMING_SNAKE_CASE names (≥3 chars) to minimise false positives
const CONST_NAME_RE = /\b([A-Z][A-Z0-9_]{2,})\b/g;
const MAX_LABEL_LEN = 40;

function revealedLines(sels: readonly vscode.Selection[]): Set<number> {
  const s = new Set<number>();
  for (const sel of sels) for (let l = sel.start.line; l <= sel.end.line; l++) s.add(l);
  return s;
}

export class ConstValFoldingProvider implements vscode.Disposable {
  private readonly _hideType  = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none; font-size: 0px;',
  });
  private readonly _swatchType = vscode.window.createTextEditorDecorationType({});
  private readonly _subs: vscode.Disposable[];
  private _docDebounce: ReturnType<typeof setTimeout> | undefined;
  private _selDebounce: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly index: SymbolIndex) {
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
    if (lang !== 'kotlin' && lang !== 'java') {
      ed.setDecorations(this._hideType, []);
      ed.setDecorations(this._swatchType, []);
      return;
    }
    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('constValFolding', true);
    if (!enabled) {
      ed.setDecorations(this._hideType, []);
      ed.setDecorations(this._swatchType, []);
      return;
    }

    const opts: vscode.DecorationOptions[] = [];
    const swatches: vscode.DecorationOptions[] = [];
    for (let i = 0; i < ed.document.lineCount; i++) {
      if (revealed.has(i)) continue;
      const text = ed.document.lineAt(i).text;
      // Skip declaration lines — don't fold the const val itself
      if (/\bconst\s+val\b/.test(text)) continue;
      CONST_NAME_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CONST_NAME_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index) && !isInsideStringInterpolation(text, m.index)) continue;
        const entries = this.index.lookup(m[1]).filter(e => e.isConst && e.constValue);
        if (entries.length !== 1) continue; // skip ambiguous or unknown
        const val   = entries[0].constValue!;
        const short = val.length > MAX_LABEL_LEN ? val.slice(0, MAX_LABEL_LEN) + '…' : val;
        const isStr = val.startsWith('"') || val.startsWith("'");

        // Extend the decoration range left to also hide any qualifier (ClassName. prefix).
        // If the token is preceded by ).CONST or ].CONST, skip it entirely — we can't
        // determine the type of the expression before the dot.
        let rangeStart = m.index;
        const dotIdx = m.index - 1;
        if (dotIdx >= 0 && text[dotIdx] === '.') {
          const prevIdx = dotIdx - 1;
          if (prevIdx >= 0 && /\w/.test(text[prevIdx])) {
            let j = prevIdx;
            while (j > 0 && /\w/.test(text[j - 1])) j--;
            // Walk further for chained qualifiers: A.B.CONST → hide A.B.
            while (j > 0 && text[j - 1] === '.' && j >= 2 && /\w/.test(text[j - 2])) {
              j -= 2;
              while (j > 0 && /\w/.test(text[j - 1])) j--;
            }
            rangeStart = j;
          } else {
            continue; // preceded by ) or ] — not a class qualifier, skip
          }
        }

        opts.push({
          range: new vscode.Range(i, rangeStart, i, m.index + m[0].length),
          renderOptions: {
            before: {
              contentText: short,
              color: new vscode.ThemeColor(
                isStr ? 'debugTokenExpression.string' : 'debugTokenExpression.number',
              ),
            },
          },
        });

        const cssColor = constValueToCSS(val);
        if (cssColor) {
          swatches.push({
            range: new vscode.Range(i, rangeStart, i, rangeStart),
            renderOptions: {
              before: {
                contentText: '\u00A0',
                backgroundColor: cssColor,
                margin: '0 2px 0 0',
                border: '1px solid',
                borderColor: new vscode.ThemeColor('editor.foreground'),
                textDecoration: 'none; display: inline-block; width: 0.65em; height: 0.65em; vertical-align: middle;',
              },
            },
          });
        }
      }
    }
    ed.setDecorations(this._swatchType, swatches);
    ed.setDecorations(this._hideType, opts);
  }

  dispose(): void {
    clearTimeout(this._docDebounce);
    clearTimeout(this._selDebounce);
    this._hideType.dispose();
    this._swatchType.dispose();
    for (const s of this._subs) s.dispose();
  }
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function constValueToCSS(val: string): string | null {
  const m0x = val.match(/^0x([0-9A-Fa-f]{8})$/i);
  if (m0x) {
    const h = m0x[1];
    const r = parseInt(h.slice(2, 4), 16), g = parseInt(h.slice(4, 6), 16), b = parseInt(h.slice(6, 8), 16);
    const a = parseInt(h.slice(0, 2), 16);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  const mHex = val.match(/^"(#[0-9A-Fa-f]{3,8})"$/);
  if (!mHex) return null;
  const h = mHex[1].slice(1);
  switch (h.length) {
    case 3:  return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    case 6:  return mHex[1];
    case 4: { const a = parseInt(h[0]+h[0],16), r = parseInt(h[1]+h[1],16), g = parseInt(h[2]+h[2],16), b = parseInt(h[3]+h[3],16); return `rgba(${r},${g},${b},${(a/255).toFixed(2)})`; }
    case 8: { const a = parseInt(h.slice(0,2),16), r = parseInt(h.slice(2,4),16), g = parseInt(h.slice(4,6),16), b = parseInt(h.slice(6,8),16); return `rgba(${r},${g},${b},${(a/255).toFixed(2)})`; }
    default: return null;
  }
}
