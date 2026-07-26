import * as vscode from 'vscode';

/**
 * KJ-004: hardcoded string lint. Flags literals passed directly to a known
 * UI function instead of an R.string. Heuristic based on the function name
 * (no type inference), opt-in, false positives possible.
 */

/** UI functions whose 1st string argument is visible text. */
const UI_CALLS = [
  'Text',
  'setText',
  'setTitle',
  'setHint',
  'setContentDescription',
  'showToast',
  'showSnackbar',
  'setError',
  'setSubtitle',
] as const;

// \s* crosses line breaks: covers Text(\n    "Battle"\n).
// The literal itself cannot contain a \n (plain Kotlin string).
const UI_CALL_RE = new RegExp(
  `\\b(${UI_CALLS.join('|')})\\s*\\(\\s*"((?:[^"\\\\\\n]|\\\\.)*)"`,
  'g',
);

export interface HardcodedStringHit {
  /** 0-based line (that of the literal, not of the call). */
  line: number;
  /** Content of the literal (without the quotes). */
  literal: string;
  /** 0-based column of the opening quote. */
  column: number;
  /** UI function called (Text, setText…). */
  callee: string;
}

/** Replaces comments (`//`, blocks) and raw strings with spaces, lengths
 *  preserved, so the multi-line scan never matches inside them. */
function blankNonCode(text: string): string {
  const lines = text.split('\n');
  let inRaw = false;
  let inBlockComment = false;

  const out = lines.map(line => {
    if (inRaw) {
      const closing = line.indexOf('"""');
      if (closing >= 0) {
        inRaw = false;
        return ' '.repeat(closing + 3) + blankLine(line.slice(closing + 3));
      }
      return ' '.repeat(line.length);
    }
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        inBlockComment = false;
        return ' '.repeat(end + 2) + blankLine(line.slice(end + 2));
      }
      return ' '.repeat(line.length);
    }
    return blankLine(line);
  });

  // Manual state scanner: strings (with escapes), raw strings, //, /* */.
  // isInsideCommentOrString is NOT used here: it treats the opening of a
  // comment as already "inside", which prevented detecting it.
  function blankLine(line: string): string {
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (line.startsWith('"""', i)) {
        const close = line.indexOf('"""', i + 3);
        if (close >= 0) {
          return (
            line.slice(0, i) + ' '.repeat(close + 3 - i) + blankLine(line.slice(close + 3))
          );
        }
        inRaw = true;
        return line.slice(0, i) + ' '.repeat(line.length - i);
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '/' && line[i + 1] === '/') {
        return line.slice(0, i) + ' '.repeat(line.length - i);
      }
      if (ch === '/' && line[i + 1] === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end >= 0) {
          return line.slice(0, i) + ' '.repeat(end + 2 - i) + blankLine(line.slice(end + 2));
        }
        inBlockComment = true;
        return line.slice(0, i) + ' '.repeat(line.length - i);
      }
    }
    return line;
  }

  return out.join('\n');
}

export function findHardcodedStrings(text: string): HardcodedStringHit[] {
  const hits: HardcodedStringHit[] = [];
  const sanitized = blankNonCode(text);

  UI_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UI_CALL_RE.exec(sanitized)) !== null) {
    const literal = m[2];
    if (literal.length === 0) continue;

    // First quote of the match = opening quote of the literal.
    const quoteIndex = m.index + m[0].indexOf('"');
    const before = sanitized.slice(0, quoteIndex);
    const line = (before.match(/\n/g) ?? []).length;
    const column = quoteIndex - (before.lastIndexOf('\n') + 1);
    hits.push({ line, literal, column, callee: m[1] });
  }
  return hits;
}

export class HardcodedStringProvider implements vscode.Disposable {
  private readonly _diag = vscode.languages.createDiagnosticCollection('kotlin-jump-hardcoded');
  private readonly _subs: vscode.Disposable[];

  constructor() {
    this._subs = [
      vscode.workspace.onDidOpenTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidSaveTextDocument(doc => this._scan(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => this._diag.delete(doc.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.hardcodedStringLint')) this._rescanAll();
      }),
    ];
    this._rescanAll();
  }

  private _rescanAll(): void {
    this._diag.clear();
    for (const doc of vscode.workspace.textDocuments) this._scan(doc);
  }

  private _scan(doc: vscode.TextDocument): void {
    if (doc.languageId !== 'kotlin' && doc.languageId !== 'java') return;
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('hardcodedStringLint', false);
    if (!enabled) {
      this._diag.delete(doc.uri);
      return;
    }

    const diagnostics = findHardcodedStrings(doc.getText()).map(hit => {
      const range = new vscode.Range(
        hit.line, hit.column, hit.line, hit.column + hit.literal.length + 2,
      );
      const d = new vscode.Diagnostic(
        range,
        `Hardcoded string in ${hit.callee}() — extract to strings.xml (R.string)`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.source = 'kotlin-jump';
      d.code = 'hardcoded-string';
      return d;
    });
    this._diag.set(doc.uri, diagnostics);
  }

  dispose(): void {
    this._diag.dispose();
    for (const s of this._subs) s.dispose();
  }
}
