import * as vscode from 'vscode';
import { ColorResourceIndex } from '../indexer/ColorResourceIndex';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';

const R_COLOR_RE = /\bR\.color\.([A-Za-z_]\w*)\b/g;
// `<color name="X">VALUE</color>` — captures the name (group 1) and the
// raw value text (group 2). The value can be either a literal hex or a
// `@color/Y` reference; we resolve that downstream.
const XML_COLOR_RE = /<color\s+name="([^"]+)"[^>]*>([^<]*)<\/color>/g;

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
    const isCode = lang === 'kotlin' || lang === 'java';
    const isXml  = lang === 'xml';
    if (!isCode && !isXml) { ed.setDecorations(this._decorType, []); return; }
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('colorResourceFolding', true);
    if (!enabled) { ed.setDecorations(this._decorType, []); return; }

    const opts: vscode.DecorationOptions[] = [];
    for (let i = 0; i < ed.document.lineCount; i++) {
      if (revealed.has(i)) continue;
      const text = ed.document.lineAt(i).text;
      let m: RegExpExecArray | null;

      if (isCode) {
        R_COLOR_RE.lastIndex = 0;
        while ((m = R_COLOR_RE.exec(text))) {
          if (isInsideCommentOrString(text, m.index) && !isInsideStringInterpolation(text, m.index)) continue;
          const entry = this.index.getValue(m[1]);
          if (!entry) continue;
          const resolved = resolveColorRef(entry.value, this.index);
          // Skip the swatch entirely when the value can't be resolved
          // to a real hex literal — a gray fallback is worse than
          // nothing (it implies the color IS gray, misleading).
          if (resolved === null) continue;
          opts.push(buildSwatch(i, m.index, toCSS(resolved)));
        }
      } else {
        // XML pass — `<color name="X">VALUE</color>`. Anchor the swatch
        // at the value's first column so it sits adjacent to the value
        // text, not at the line's left margin. Same resolution rule as
        // the Kotlin path: follow `@color/Y` one hop, skip when
        // unresolvable. Literal hex values render their own swatch via
        // the resolver returning the input verbatim.
        XML_COLOR_RE.lastIndex = 0;
        while ((m = XML_COLOR_RE.exec(text))) {
          if (isInsideXmlComment(text, m.index)) continue;
          const value = m[2];
          // Anchor at the value's first column inside the line.
          const valueOffsetInMatch = m[0].indexOf('>', m[0].indexOf('name="')) + 1;
          const valueStart = m.index + valueOffsetInMatch;
          const resolved = resolveColorRef(value, this.index);
          if (resolved === null) continue;
          opts.push(buildSwatch(i, valueStart, toCSS(resolved)));
        }
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

// True when `pos` falls inside an `<!-- ... -->` comment region on the
// same line. Single-line check is enough — multi-line XML comments are
// rare in colors.xml fixtures, and the regex itself only matches
// single-line `<color>...</color>` declarations.
function isInsideXmlComment(text: string, pos: number): boolean {
  const open = text.lastIndexOf('<!--', pos);
  if (open === -1) return false;
  const close = text.indexOf('-->', open + 4);
  return close === -1 || pos < close + 3;
}

// Single source of truth for the swatch DecorationOption — keeps the
// inline-block sizing identical between Kotlin and XML callers.
function buildSwatch(line: number, col: number, cssColor: string): vscode.DecorationOptions {
  return {
    range: new vscode.Range(line, col, line, col),
    renderOptions: {
      before: {
        contentText: ' ',
        backgroundColor: cssColor,
        margin: '0 4px 0 0',
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.foreground'),
        textDecoration: 'none; display: inline-block; width: 0.65em; height: 0.65em; vertical-align: middle;',
      },
    },
  };
}

// Resolve `@color/X` references one hop. Android lets a `<color>` value
// be either a literal hex (`#FF0000`) or a reference to another color
// (`@color/primary`). We follow exactly one hop: enough for the common
// "brand → primary" indirection, while bounded against accidental
// reference cycles (`a → b → a`). Returns the literal hex on success
// or `null` when unresolvable (target missing or not a hex).
function resolveColorRef(value: string, index: ColorResourceIndex): string | null {
  const v = value.trim();
  if (v.startsWith('#')) return v;
  const ref = /^@(?:android:)?color\/([A-Za-z_]\w*)$/.exec(v);
  if (!ref) return null;
  const target = index.getValue(ref[1]);
  if (!target) return null;
  const t = target.value.trim();
  return t.startsWith('#') ? t : null; // chain of references: don't recurse.
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
