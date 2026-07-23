import * as vscode from 'vscode';
import { isInsideComment, countTripleQuotes } from '../util/textUtils';

// Matches `TODO(2025-01-01)` with optional spaces inside the parens.
// Date must be ISO yyyy-mm-dd; anything else is not a dated TODO.
const TODO_DATE_RE = /\bTODO\s*\(\s*(\d{4})-(\d{2})-(\d{2})\s*\)/g;

/**
 * Validates the calendar date and returns its UTC timestamp, or undefined.
 * Date.UTC rolls over out-of-range fields (2025-02-30 → March 2), so the
 * round trip check rejects those instead of silently accepting them.
 */
export function parseTodoDate(y: number, m: number, d: number): number | undefined {
  const ts = Date.UTC(y, m - 1, d);
  const back = new Date(ts);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return undefined;
  }
  return ts;
}

/**
 * Scans one line and returns the [start, end) ranges of overdue dated TODOs.
 * `todayUtc` is the UTC midnight timestamp of the local current date; a TODO
 * dated today is not overdue yet.
 * Exported for tests — the provider wires it to editor decorations.
 */
export function findOverdueTodos(
  text: string,
  todayUtc: number,
): { start: number; end: number; dateIso: string }[] {
  const out: { start: number; end: number; dateIso: string }[] = [];
  TODO_DATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TODO_DATE_RE.exec(text)) !== null) {
    // Only comments qualify: `// TODO(...)`, `/* TODO(...) */`, or a
    // block/KDoc continuation line that starts with `*`. A TODO inside a
    // string literal is data, not a note to self.
    const inLineComment = isInsideComment(text, m.index);
    const inBlockContinuation = /^\s*\*/.test(text);
    if (!inLineComment && !inBlockContinuation) continue;

    const ts = parseTodoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (ts === undefined || ts >= todayUtc) continue;

    out.push({
      start: m.index,
      end: m.index + m[0].length,
      dateIso: `${m[1]}-${m[2]}-${m[3]}`,
    });
  }
  return out;
}

/** UTC midnight of the local current date (so "today" matches the user's wall clock). */
function todayUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Paints overdue dated TODO comments red: `// TODO(2025-01-01): migrate`
 * turns red once 2025-01-01 is in the past. Future dates and undated TODOs
 * keep their normal appearance.
 *
 * Full rescan per change, debounced: dated TODOs are orders of magnitude
 * rarer than `!!`, so the incremental line tracking NullAssertionProvider
 * needs would be pure overhead here.
 */
export class TodoExpiryProvider implements vscode.Disposable {
  private readonly _decorType: vscode.TextEditorDecorationType;
  private _scanTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._decorType = vscode.window.createTextEditorDecorationType({
      light: { color: '#B91C1C', fontWeight: 'bold' },  // red-700 on white
      dark:  { color: '#F87171', fontWeight: 'bold' },  // red-400 on dark
    });

    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e => { if (e) this._scan(e); }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const editor = vscode.window.activeTextEditor;
        if (editor && e.document === editor.document) this._scheduleScan(editor);
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.todoExpiry')) this.refreshVisible();
      }),
    ];

    this.refreshVisible();
  }

  refreshVisible(): void {
    for (const editor of vscode.window.visibleTextEditors) this._scan(editor);
  }

  private _scheduleScan(editor: vscode.TextEditor): void {
    if (this._scanTimer !== undefined) clearTimeout(this._scanTimer);
    this._scanTimer = setTimeout(() => {
      this._scanTimer = undefined;
      this._scan(editor);
    }, 100);
  }

  private _scan(editor: vscode.TextEditor): void {
    const lang = editor.document.languageId;
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('todoExpiry', true);
    if ((lang !== 'kotlin' && lang !== 'java') || !enabled) {
      editor.setDecorations(this._decorType, []);
      return;
    }

    const today = todayUtcMidnight();
    const decos: vscode.DecorationOptions[] = [];
    let inRaw = false;
    for (let ln = 0; ln < editor.document.lineCount; ln++) {
      const text = editor.document.lineAt(ln).text;
      if (inRaw) {
        if (countTripleQuotes(text) % 2 !== 0) inRaw = false;
        continue;
      }
      if (countTripleQuotes(text) % 2 !== 0) inRaw = true;
      for (const hit of findOverdueTodos(text, today)) {
        decos.push({
          range: new vscode.Range(ln, hit.start, ln, hit.end),
          hoverMessage: `Overdue TODO: due ${hit.dateIso}`,
        });
      }
    }
    editor.setDecorations(this._decorType, decos);
  }

  dispose(): void {
    if (this._scanTimer !== undefined) clearTimeout(this._scanTimer);
    this._decorType.dispose();
    for (const s of this._subs) s.dispose();
  }
}
