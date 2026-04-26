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

interface CachedDecorations {
  version:        number;
  optsByLine:     Map<number, vscode.DecorationOptions[]>;
  swatchesByLine: Map<number, vscode.DecorationOptions[]>;
}

export class ConstValFoldingProvider implements vscode.Disposable {
  private readonly _hideType  = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none; font-size: 0px;',
  });
  private readonly _swatchType = vscode.window.createTextEditorDecorationType({});
  private readonly _subs: vscode.Disposable[];
  private _docDebounce: ReturnType<typeof setTimeout> | undefined;
  private _selDebounce: ReturnType<typeof setTimeout> | undefined;
  // Per-document decoration cache, keyed by document.version so a doc edit
  // invalidates automatically. Selection changes (cursor up/down) only
  // re-emit the cached buckets — they NEVER trigger the heavy regex +
  // index pass, which was the source of perceived fold/unfold lag.
  private _cache = new WeakMap<vscode.TextDocument, CachedDecorations>();

  constructor(private readonly index: SymbolIndex) {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._apply(e, revealedLines(e.selections));
      }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const ed = vscode.window.activeTextEditor;
        if (ed?.document !== e.document) return;
        // Doc changed — drop the cache so the next _apply rebuilds.
        this._cache.delete(e.document);
        clearTimeout(this._docDebounce);
        this._docDebounce = setTimeout(() => this._apply(ed, revealedLines(ed.selections)), 100);
      }),
      vscode.window.onDidChangeTextEditorSelection(e => {
        clearTimeout(this._selDebounce);
        // Bumped 30→80 ms: rapid arrow navigation no longer steamrolls the
        // event loop with redundant repaints. The cache makes each
        // repaint cheap, but firing fewer of them is even cheaper.
        this._selDebounce = setTimeout(() => this._apply(e.textEditor, revealedLines(e.selections)), 80);
      }),
      // SymbolIndex doesn't expose an onDidChange event yet — but it
      // updates whenever a Kotlin/Java file is parsed (initial scan,
      // edits, saves). When a foreign file saves, our local cache may
      // now be stale (e.g. user just typed `const val NEW = …` in
      // Constants.kt and switched to a file that references it). Drop
      // ALL caches; they rebuild lazily on next selection/edit.
      vscode.workspace.onDidSaveTextDocument(saved => {
        if (saved.languageId !== 'kotlin' && saved.languageId !== 'java') return;
        this._cache = new WeakMap();
        this.invalidateAll();
      }),
    ];
    this.invalidateAll();
  }

  invalidateAll(): void {
    for (const ed of vscode.window.visibleTextEditors) this._apply(ed, revealedLines(ed.selections));
  }

  /** Rebuild the cache for `doc` from scratch. Called on first visit and
   *  whenever the document version advances. Per-rebuild memoization
   *  caches the index lookup result for each name — without it,
   *  `SymbolIndex.lookup()` allocates `[...set]` on every call and the
   *  `.filter()` allocates again, which on a 1 000-line constant-heavy
   *  file produced ~50 000 redundant array allocations and visible GC
   *  pauses. */
  private _rebuild(doc: vscode.TextDocument): CachedDecorations {
    const optsByLine     = new Map<number, vscode.DecorationOptions[]>();
    const swatchesByLine = new Map<number, vscode.DecorationOptions[]>();
    const lookupMemo     = new Map<string, /* constValue */ string | null>();

    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (/\bconst\s+val\b/.test(text)) continue;
      const lineOpts = this._scanLine(i, text, lookupMemo);
      if (lineOpts.opts.length      > 0) optsByLine.set(i,     lineOpts.opts);
      if (lineOpts.swatches.length  > 0) swatchesByLine.set(i, lineOpts.swatches);
    }
    const cache: CachedDecorations = { version: doc.version, optsByLine, swatchesByLine };
    this._cache.set(doc, cache);
    return cache;
  }

  /** Resolve a SCREAMING_SNAKE_CASE name to its const value (or `null`
   *  for "ambiguous"). Two declarations with the SAME literal value are
   *  not ambiguous — both render the same fold, so we accept them. We
   *  only bail when values disagree (e.g. `DevConfig.PORT = 8080` vs
   *  `ProdConfig.PORT = 9090` — folding either would lie). Memoized for
   *  the rebuild's lifetime. */
  private _resolveConstValue(name: string, memo: Map<string, string | null>): string | null {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    const entries = this.index.lookup(name);
    let unique: string | null = null;
    let conflict = false;
    for (const e of entries) {
      if (!e.isConst || !e.constValue) continue;
      if (unique === null) unique = e.constValue;
      else if (unique !== e.constValue) { conflict = true; break; }
    }
    const value = conflict ? null : unique;
    memo.set(name, value);
    return value;
  }

  /** Push cached decorations to the editor, omitting lines under the cursor. */
  private _apply(ed: vscode.TextEditor, revealed: Set<number>): void {
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

    let cache = this._cache.get(ed.document);
    if (!cache || cache.version !== ed.document.version) {
      cache = this._rebuild(ed.document);
    }

    const opts:     vscode.DecorationOptions[] = [];
    const swatches: vscode.DecorationOptions[] = [];
    for (const [line, lineOpts] of cache.optsByLine) {
      if (revealed.has(line)) continue;
      opts.push(...lineOpts);
    }
    for (const [line, lineSwatches] of cache.swatchesByLine) {
      if (revealed.has(line)) continue;
      swatches.push(...lineSwatches);
    }
    ed.setDecorations(this._swatchType, swatches);
    ed.setDecorations(this._hideType, opts);
  }

  private _scanLine(i: number, text: string, lookupMemo: Map<string, string | null>): { opts: vscode.DecorationOptions[]; swatches: vscode.DecorationOptions[] } {
    const opts:     vscode.DecorationOptions[] = [];
    const swatches: vscode.DecorationOptions[] = [];
    CONST_NAME_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CONST_NAME_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index) && !isInsideStringInterpolation(text, m.index)) continue;
        // Skip declaration-site identifiers: `val NAME =` / `var NAME =`.
        // Cheap regex on the prefix BEFORE doing any allocation-heavy
        // index lookup — this is on the hottest path.
        const before = text.slice(0, m.index);
        if (/\b(?:val|var)\s+$/.test(before)) continue;
        const val = this._resolveConstValue(m[1], lookupMemo);
        if (val === null) continue;
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
    return { opts, swatches };
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
