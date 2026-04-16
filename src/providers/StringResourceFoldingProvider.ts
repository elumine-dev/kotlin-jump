import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';
import { Logger } from '../util/logger';
import { isInsideCommentOrString } from '../util/textUtils';

const R_STRING_RE  = /\bR\.string\.([A-Za-z_]\w*)\b/g;
const R_PLURALS_RE = /\bR\.plurals\.([A-Za-z_]\w*)\b/g;
const R_ARRAY_RE   = /\bR\.array\.([A-Za-z_]\w*)\b/g;
const MAX_LABEL_LEN = 40;

// Matches format(R.string.key or getString(R.string.key — captures the R.string ref
// and the key name so we can extract trailing args and render the format string.
const FORMAT_CALL_RE = /\b(?:format|getString)\s*\(\s*(R\.string\.([A-Za-z_]\w*))/g;

// Matches printf-style format specifiers for substitution.
const FMT_RE_RENDER = /%((\d+)\$)?[-+0 #]*\d*(?:\.\d+)?([sdfeoxXcb%])/g;

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
  private _docDebounce: ReturnType<typeof setTimeout> | undefined;
  private _selDebounce: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly index: StringResourceIndex, private readonly log: Logger) {
    this._hideType = vscode.window.createTextEditorDecorationType({
      textDecoration: 'none; font-size: 0px;',
    });
    this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._statusBar.tooltip = 'R.string / R.plurals / R.array references folded in this file (Kotlin Jump)';
    log.info('[StringFolding] provider created');
    this._subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(e => {
        if (e) this._update(e, new Set<number>());
        else this._statusBar.hide();
      }),
      // Debounced to avoid O(n) scan on each keystroke
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document !== e.document) return;
        clearTimeout(this._docDebounce);
        this._docDebounce = setTimeout(() => {
          this._update(editor, revealedLinesForSelections(editor.selections));
        }, 100);
      }),
      // Shorter debounce for selection: responds to direct cursor movement
      vscode.window.onDidChangeTextEditorSelection(e => {
        clearTimeout(this._selDebounce);
        this._selDebounce = setTimeout(() => {
          this._update(e.textEditor, revealedLinesForSelections(e.selections));
        }, 30);
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

      // Pass 1 — format(R.string.key, args...) / getString(R.string.key, args...)
      // Render the format string with the provided argument expressions substituted in.
      const formattedCols = new Set<number>();
      FORMAT_CALL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FORMAT_CALL_RE.exec(text))) {
        if (isInsideCommentOrString(text, m.index)) continue;
        const key   = m[2];
        const entry = this.index.getValue(key);
        if (!entry) continue;
        const args     = extractFormatArgs(text, m.index + m[0].length);
        const rendered = args.length > 0 ? renderFormatString(entry.value, args) : entry.value;
        const rStart   = m.index + m[0].length - m[1].length; // start of "R.string.key"
        opts.push(buildStringDecoration(i, rStart, m[1].length, rendered));
        formattedCols.add(rStart);
      }

      // Pass 2 — standalone R.string.key (skip positions already rendered in pass 1)
      R_STRING_RE.lastIndex = 0;
      while ((m = R_STRING_RE.exec(text))) {
        if (formattedCols.has(m.index)) continue;
        const entry = this.index.getValue(m[1]);
        if (!entry) continue;
        opts.push(buildStringDecoration(i, m.index, m[0].length, entry.value));
      }

      R_PLURALS_RE.lastIndex = 0;
      while ((m = R_PLURALS_RE.exec(text))) {
        const entry = this.index.getPluralsValue(m[1]);
        if (!entry) continue;
        opts.push(buildStringDecoration(i, m.index, m[0].length, entry.value));
      }

      R_ARRAY_RE.lastIndex = 0;
      while ((m = R_ARRAY_RE.exec(text))) {
        const entry = this.index.getArrayValue(m[1]);
        if (!entry) continue;
        opts.push(buildStringDecoration(i, m.index, m[0].length, entry.value));
      }
    }

    editor.setDecorations(this._hideType, opts);

    if (isActive) {
      this._statusBar.text = `$(symbol-string) ${opts.length}`;
      this._statusBar.show();
    }
  }

  dispose(): void {
    clearTimeout(this._docDebounce);
    clearTimeout(this._selDebounce);
    this.log.info('[StringFolding] dispose');
    this._hideType.dispose();
    this._statusBar.dispose();
    for (const s of this._subscriptions) s.dispose();
  }
}

// ── Format-string rendering helpers ──────────────────────────────────────────

// Starting at `pos` (right after the R.string.key match inside a format(…) call),
// collects the remaining arguments up to the matching closing ')'.
function extractFormatArgs(text: string, pos: number): string[] {
  let i = pos;
  // Skip whitespace between end of key and next token
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  if (i >= text.length || text[i] !== ',') return []; // no trailing args
  i++; // skip the comma

  // Collect until the matching ')' of the outer call (we enter at depth=1)
  let depth = 1;
  let inStr: string | false = false;
  const start = i;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = false;
    } else {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') { depth--; if (depth === 0) break; }
      else if (ch === '"' || ch === '\'') inStr = ch;
    }
    i++;
  }

  return splitArgs(text.slice(start, i));
}

// Splits a comma-separated argument string while respecting nested parens and strings.
function splitArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inStr: string | false = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = false;
      continue;
    }
    if (ch === '"' || ch === '\'') { inStr = ch; continue; }
    if (ch === '(' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === ']') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      const a = s.slice(start, i).trim();
      if (a) args.push(a);
      start = i + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) args.push(last);
  return args;
}

// Substitutes format args into a printf-style template.
// Positional specifiers (%1$s) use 1-based indexing; sequential specifiers consume in order.
// String literal args have their surrounding quotes stripped for cleaner display.
function renderFormatString(template: string, args: string[]): string {
  let seq = 0;
  FMT_RE_RENDER.lastIndex = 0;
  return template.replace(FMT_RE_RENDER, (match, _, positional, conv) => {
    if (conv === '%') return '%';
    const idx = positional ? parseInt(positional, 10) - 1 : seq++;
    const arg = args[idx];
    if (arg === undefined) return match;
    const t = arg.trim();
    if (t.length >= 2 &&
        ((t[0] === '"' && t[t.length - 1] === '"') ||
         (t[0] === '\'' && t[t.length - 1] === '\''))) {
      return t.slice(1, -1); // strip surrounding quotes
    }
    return t;
  });
}

function buildStringDecoration(
  line: number,
  start: number,
  length: number,
  value: string,
): vscode.DecorationOptions {
  const short = value.length > MAX_LABEL_LEN
    ? value.slice(0, MAX_LABEL_LEN) + '…' : value;
  return {
    range: new vscode.Range(line, start, line, start + length),
    renderOptions: {
      before: {
        contentText: `"${short}"`,
        color: new vscode.ThemeColor('debugTokenExpression.string'),
      },
    },
  };
}
