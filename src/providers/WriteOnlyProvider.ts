import * as vscode from 'vscode';
import { parse, RawSymbol } from '../indexer/KotlinParser';
import { sanitizeForUsageScan } from './UnusedImportProvider';
import {
  buildLineStarts,
  offsetToPos,
  collectAnnotationTargets,
  FILE_SUPPRESS_RE,
} from './UnusedParameterProvider';
import { reflectiveOrAnnotatedClassRanges } from './UnusedDeclarationProvider';
import { reportDecorations } from '../util/demoProbe';
import {
  Block,
  blank,
  enclosingBody,
  escapeName,
  innermostBlockAt,
  isPureInitializer,
  scanStructure,
  suppressedRegions,
} from './UnusedLocalProvider';

/**
 * KJ-028: write-only variables — assigned, sometimes repeatedly, but never
 * read. The value nobody observes is dead weight, and an unread flag is
 * sometimes the symptom of a condition that was deleted elsewhere.
 *
 * Covers `var` locals (scope: the enclosing function body) and `private var`
 * members (scope: the file). `val` is out of scope: a val nobody reads is
 * already KJ-026/KJ-027 territory, and the two sets are disjoint by
 * construction — this detector requires at least one write, which is exactly
 * the condition that keeps those two silent.
 *
 * Any occurrence the scanner cannot classify counts as a READ, which can only
 * suppress a warning, never create one.
 *
 * Knowingly missed (do not "fix" these without a test proving safety):
 * `if (c) x = 1`, `x = x + 1`, writes inside `apply`/`run`/`with`, and writes
 * at non-zero paren depth. Each trades recall for the zero-false-positive
 * property the whole family is built on.
 */

export type WriteOnlyKind = 'local' | 'member';

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface WriteOnlyVar {
  kind: WriteOnlyKind;
  name: string;
  /** 0-based position of the name token (diagnostic range). */
  line: number;
  character: number;
  writeCount: number;
  /** Empty when no safe removal exists; the diagnostic still shows. */
  edits: Edit[];
  suppressLine: number;
  suppressIndent: string;
}

/**
 * Scope functions whose lambda rebinds `this`: a bare name inside may belong
 * to the receiver, so an assignment there is not provably ours. `let`/`also`
 * bind `it` instead and stay flaggable.
 */
const RECEIVER_SCOPES = new Set(['apply', 'run', 'with', 'buildString', 'buildList', 'buildMap', 'buildSet']);

const VAR_DECL_RE =
  /(?:^[ \t]*|[{;]\s*|->\s*)(?:@\w+(?:\([^()]*\))?\s+)*(var)\s+([A-Za-z_]\w*)\s*(?=[:=]|\bby\b)/gm;

type Role = 'read' | 'write';

/** Skips spaces and tabs backwards from `i`, returning the new index. */
function skipSpaceBack(clean: string, i: number): number {
  while (i >= 0 && (clean[i] === ' ' || clean[i] === '\t' || clean[i] === '\r')) i--;
  return i;
}

/** Returned by `peelThis` when the qualifier is some other receiver. */
const FOREIGN_RECEIVER = -2;

/**
 * Peels an optional `this.` (or `this@Label.`) qualifier and returns the index
 * just before it. Returns FOREIGN_RECEIVER for `other.x`, which must not be
 * confused with -1 (start of file) — mixing the two made `o.n = 1` count as a
 * write on our own member.
 */
function peelThis(clean: string, before: number): number {
  const i = skipSpaceBack(clean, before);
  if (i < 0 || clean[i] !== '.') return i;
  let j = i - 1;
  while (j >= 0 && /[\w@]/.test(clean[j])) j--;
  return /^this(?:@\w+)?$/.test(clean.slice(j + 1, i)) ? skipSpaceBack(clean, j) : FOREIGN_RECEIVER;
}

/** True when nothing but a statement boundary precedes `i`. */
function atStatementStart(clean: string, i: number): boolean {
  if (i < 0) return true;
  const c = clean[i];
  if (c === '\n' || c === '{' || c === '}' || c === ';') return true;
  return c === '>' && clean[i - 1] === '-'; // a `->` body
}

/** True when nothing but a statement boundary follows `i`. */
function atStatementEnd(clean: string, i: number): boolean {
  let j = i;
  while (j < clean.length && (clean[j] === ' ' || clean[j] === '\t' || clean[j] === '\r')) j++;
  return j >= clean.length || clean[j] === '\n' || clean[j] === ';' || clean[j] === '}';
}

/** True when the occurrence sits inside a lambda that rebinds `this`. */
function insideReceiverScope(clean: string, blocks: Block[], offset: number): boolean {
  for (let i = innermostBlockAt(blocks, offset); i !== -1; i = blocks[i].parent) {
    const header = clean.slice(blocks[i].headerStart, blocks[i].open);
    const call = /([A-Za-z_]\w*)\s*(?:\([^()]*\))?\s*$/.exec(header);
    if (call && RECEIVER_SCOPES.has(call[1])) return true;
  }
  return false;
}

/**
 * The write predicate. Everything that is not provably a pure write reads as
 * a read; see the module docblock for the reasoning.
 */
export function classifyOccurrence(
  clean: string,
  blocks: Block[],
  parenAt: (offset: number) => number,
  offset: number,
  name: string,
  baseParenDepth: number,
): Role {
  // W0: a named argument (`build(\n  x = 1,\n)`) sits deeper in parens
  if (parenAt(offset) !== baseParenDepth) return 'read';
  // W1: `foo.apply { x = 1 }` may be assigning the receiver's property
  if (insideReceiverScope(clean, blocks, offset)) return 'read';

  // W2: statement start, after an optional `this.`
  const beforeQualifier = peelThis(clean, offset - 1);
  if (beforeQualifier === FOREIGN_RECEIVER) return 'read';
  const prefixIncr =
    beforeQualifier >= 1 && (clean.slice(beforeQualifier - 1, beforeQualifier + 1) === '++' ||
      clean.slice(beforeQualifier - 1, beforeQualifier + 1) === '--');
  if (prefixIncr) {
    // `++x` as a whole statement
    return atStatementStart(clean, skipSpaceBack(clean, beforeQualifier - 2)) &&
      atStatementEnd(clean, offset + name.length)
      ? 'write'
      : 'read';
  }
  if (!atStatementStart(clean, beforeQualifier)) return 'read';

  // W3: assignment operator, or an isolated ++/--
  let j = offset + name.length;
  while (j < clean.length && (clean[j] === ' ' || clean[j] === '\t')) j++;
  const c = clean[j];
  const next = clean[j + 1];
  if (c === '=') return next === '=' ? 'read' : 'write';
  if ('+-*/%'.includes(c) && next === '=' && clean[j + 2] !== '=') return 'write';
  if ((c === '+' && next === '+') || (c === '-' && next === '-')) {
    return atStatementEnd(clean, j + 2) ? 'write' : 'read';
  }
  return 'read';
}

interface Candidate {
  kind: WriteOnlyKind;
  name: string;
  nameOffset: number;
  declStart: number;
  extentEnd: number;
  regionStart: number;
  regionEnd: number;
  baseParenDepth: number;
  declLine: number;
  suppressLine: number;
}

/** Extends a declaration to the end of its statement, brackets balanced. */
function declarationExtent(
  clean: string,
  lineStarts: number[],
  declStart: number,
  declLine: number,
  limit: number,
  lineEndOf: (line: number) => number,
): number {
  let extentEnd = Math.min(lineEndOf(declLine), limit);
  let guard = 0;
  while (guard++ < 200) {
    const slice = clean.slice(declStart, extentEnd);
    const balanced =
      (slice.match(/\(/g)?.length ?? 0) === (slice.match(/\)/g)?.length ?? 0) &&
      (slice.match(/\{/g)?.length ?? 0) === (slice.match(/\}/g)?.length ?? 0) &&
      (slice.match(/\[/g)?.length ?? 0) === (slice.match(/\]/g)?.length ?? 0);
    if (balanced) break;
    // `extentEnd` is the START of the next line: ask for the line of its last
    // character, or every round skips one (the KJ-027 false-positive bug).
    const nextLine = offsetToPos(lineStarts, Math.max(extentEnd - 1, 0)).line + 1;
    if (nextLine >= lineStarts.length) break;
    const nextEnd = Math.min(lineEndOf(nextLine), limit);
    if (nextEnd <= extentEnd) break;
    extentEnd = nextEnd;
  }
  return extentEnd;
}

export function findWriteOnlyVariables(text: string): WriteOnlyVar[] {
  if (!/\bvar\b/.test(text)) return [];
  const fileSuppress = FILE_SUPPRESS_RE.exec(text);
  if (fileSuppress && /unused/i.test(fileSuppress[1])) return [];

  const clean = sanitizeForUsageScan(text);
  const lines = text.split('\n');
  const lineStarts = buildLineStarts(text);
  const lastLine = lines.length - 1;
  const { blocks, parenAt } = scanStructure(clean);
  const suppressed = suppressedRegions(clean, blocks, lineStarts);
  const isSuppressed = (offset: number) => suppressed.some(r => offset >= r.from && offset < r.to);
  const lineEndOf = (line: number) => (line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length);

  const symbols = parse('inline', text).symbols;
  const annoTargets = collectAnnotationTargets(clean);
  const annosFor = (sym: RawSymbol): string[] => {
    const lo = lineStarts[sym.line];
    const hi = lo + sym.character;
    return annoTargets.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
  };
  const reflectiveRanges = reflectiveOrAnnotatedClassRanges(clean, symbols, lineStarts, lastLine, annosFor);
  const inReflectiveClass = (line: number) => reflectiveRanges.some(r => line > r.from && line <= r.to);

  const nameCounts = new Map<string, number>();
  for (const s of symbols) nameCounts.set(s.name, (nameCounts.get(s.name) ?? 0) + 1);

  const candidates: Candidate[] = [];

  // ── locals ───────────────────────────────────────────────────────────────
  VAR_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_DECL_RE.exec(clean)) !== null) {
    const name = m[2];
    const tail = new RegExp(`\\bvar\\s+(${escapeName(name)})\\s*$`).exec(m[0]);
    if (!tail) continue;
    const declStart = m.index + tail.index;
    const nameOffset = declStart + tail[0].indexOf(name, 3);

    if (name.startsWith('_') || text[nameOffset - 1] === '`') continue;
    if (isSuppressed(nameOffset)) continue;
    const declLine = offsetToPos(lineStarts, declStart).line;
    if (/^\s*(?::[^=]*)?\bby\b/.test(clean.slice(nameOffset + name.length, lineEndOf(declLine)))) continue;

    const bodyIdx = enclosingBody(clean, blocks, nameOffset);
    if (bodyIdx === -1) continue;
    const body = blocks[bodyIdx];
    if (parenAt(nameOffset) !== body.parenDepth) continue;
    if (/;\s*\S/.test(clean.slice(lineStarts[declLine], lineEndOf(declLine)))) continue;

    const bodyText = clean.slice(body.open, body.close);
    const declCount = (bodyText.match(new RegExp(`\\b(?:val|var)\\s+${escapeName(name)}\\b`, 'g')) ?? []).length;
    if (declCount > 1) continue;
    if (new RegExp(`\\b${escapeName(name)}\\b`).test(clean.slice(body.headerStart, body.open))) continue;

    const extentEnd = declarationExtent(clean, lineStarts, declStart, declLine, body.close, lineEndOf);
    candidates.push({
      kind: 'local', name, nameOffset, declStart, extentEnd,
      regionStart: body.open, regionEnd: body.close,
      baseParenDepth: body.parenDepth, declLine, suppressLine: declLine,
    });
  }

  // ── private members ──────────────────────────────────────────────────────
  for (const sym of symbols) {
    if (sym.kind !== 'var' || !sym.isPrivate) continue;
    if (sym.isPrimaryCtorParam || sym.isLateinit || sym.isOverride || sym.isAbstract) continue;
    if (sym.isExpect || sym.isActual) continue;
    const declLine = lines[sym.line];
    if (/\b(?:override|external|abstract|lateinit)\b/.test(declLine.slice(0, sym.character))) continue;
    if (sym.name.startsWith('_')) continue;
    const nameOffset = lineStarts[sym.line] + sym.character;
    if (text[nameOffset - 1] === '`' || isSuppressed(nameOffset)) continue;
    if (annosFor(sym).length > 0) continue;
    if (inReflectiveClass(sym.line)) continue;
    if ((nameCounts.get(sym.name) ?? 0) > 1) continue;
    if (/;\s*\S/.test(clean.slice(lineStarts[sym.line], lineEndOf(sym.line)))) continue;

    const declStart = lineStarts[sym.line] + (/^[ \t]*/.exec(declLine)?.[0].length ?? 0);
    if (/^\s*(?::[^=]*)?\bby\b/.test(clean.slice(nameOffset + sym.name.length, lineEndOf(sym.line)))) continue;
    // a custom accessor makes a write a side effect and a read invisible
    const nextLine = sym.line + 1 <= lastLine ? lines[sym.line + 1] : '';
    if (/^\s*(?:private\s+|protected\s+|internal\s+)?(?:get|set)\b/.test(nextLine)) continue;

    const extentEnd = declarationExtent(clean, lineStarts, declStart, sym.line, text.length, lineEndOf);
    candidates.push({
      kind: 'member', name: sym.name, nameOffset, declStart, extentEnd,
      regionStart: 0, regionEnd: clean.length,
      baseParenDepth: 0, declLine: sym.line, suppressLine: sym.line,
    });
  }

  // ── classification ───────────────────────────────────────────────────────
  const result: WriteOnlyVar[] = [];
  for (const c of candidates) {
    const masked = blank(clean, c.declStart, c.extentEnd);
    const re = new RegExp(`\\b${escapeName(c.name)}\\b`, 'g');
    re.lastIndex = c.regionStart;
    const writes: number[] = [];
    let dead = true;
    let occ: RegExpExecArray | null;
    while ((occ = re.exec(masked)) !== null && occ.index < c.regionEnd) {
      const role = classifyOccurrence(clean, blocks, parenAt, occ.index, c.name, c.baseParenDepth);
      if (role === 'read') { dead = false; break; }
      writes.push(occ.index);
    }
    if (!dead || writes.length === 0) continue;

    const pos = offsetToPos(lineStarts, c.nameOffset);
    result.push({
      kind: c.kind,
      name: c.name,
      line: pos.line,
      character: pos.character,
      writeCount: writes.length,
      edits: computeEdits(text, clean, lineStarts, lineEndOf, c, writes),
      suppressLine: c.suppressLine,
      suppressIndent: /^[ \t]*/.exec(lines[c.declLine])?.[0] ?? '',
    });
  }

  return result.sort((a, b) => a.line - b.line || a.character - b.character);
}

/**
 * Builds the atomic edit list: the declaration plus every assignment. Returns
 * an empty list as soon as one site is ambiguous — a partial removal would
 * not compile, so it is all or nothing.
 */
function computeEdits(
  text: string,
  clean: string,
  lineStarts: number[],
  lineEndOf: (line: number) => number,
  c: Candidate,
  writes: number[],
): Edit[] {
  const edits: Edit[] = [];

  /**
   * Deletes a statement. Takes the whole line only when the statement owns it;
   * `fun a() { flag = true }` must lose the assignment, not the function.
   */
  const removeStatement = (start: number, end: number): Edit => {
    const startLine = offsetToPos(lineStarts, start).line;
    const endLine = offsetToPos(lineStarts, Math.max(end - 1, start)).line;
    const ownsStart = clean.slice(lineStarts[startLine], start).trim() === '';
    const ownsEnd = clean.slice(end, lineEndOf(endLine)).trim() === '';
    if (ownsStart && ownsEnd) {
      return { start: lineStarts[startLine], end: lineEndOf(endLine), text: '' };
    }
    // inline: swallow one trailing separator so `a; b` stays valid
    let stop = end;
    while (stop < clean.length && (clean[stop] === ' ' || clean[stop] === '\t')) stop++;
    if (clean[stop] === ';') stop++;
    return { start, end: stop, text: '' };
  };

  // declaration
  const declEq = findAssignEq(clean, c.nameOffset + c.name.length, c.extentEnd);
  if (declEq === -1) {
    edits.push(removeStatement(c.declStart, c.extentEnd));
  } else {
    let initStart = declEq + 1;
    while (initStart < c.extentEnd && /[ \t]/.test(text[initStart])) initStart++;
    const initText = trimmedInit(text, clean, initStart, c.extentEnd);
    if (isPureInitializer(initText)) {
      edits.push(removeStatement(c.declStart, c.extentEnd));
    } else if (c.kind === 'local') {
      edits.push({ start: c.declStart, end: initStart, text: '' });
    } else {
      return []; // a bare expression is not a legal class-body member
    }
  }

  // assignments
  for (const offset of writes) {
    const line = offsetToPos(lineStarts, offset).line;
    const lineStart = lineStarts[line];
    if (/;\s*\S/.test(clean.slice(lineStart, lineEndOf(line)))) return [];
    // a `->` body would be left without a statement
    if (/->\s*$/.test(clean.slice(lineStart, offset))) return [];

    // statement start: back to the nearest separator, not to the line start
    let stmtStart = offset;
    while (stmtStart > lineStart && !'{};'.includes(clean[stmtStart - 1])) stmtStart--;
    while (stmtStart < offset && /[ \t]/.test(clean[stmtStart])) stmtStart++;

    const eq = findAssignEq(clean, offset + c.name.length, lineEndOf(line));
    if (eq === -1) {
      // `x++` or `++x`
      let end = offset + c.name.length;
      while (end < clean.length && /[ \t]/.test(clean[end])) end++;
      if (clean[end] === '+' || clean[end] === '-') end += 2;
      edits.push(removeStatement(stmtStart, end));
      continue;
    }
    // `+=` and friends: the operator is two characters wide
    let rhsStart = clean[eq] === '=' ? eq + 1 : eq + 2;
    const stmtEnd = statementEnd(clean, rhsStart);
    while (rhsStart < stmtEnd && /[ \t]/.test(text[rhsStart])) rhsStart++;
    const rhs = trimmedInit(text, clean, rhsStart, stmtEnd);
    if (isPureInitializer(rhs)) edits.push(removeStatement(stmtStart, stmtEnd));
    else edits.push({ start: stmtStart, end: rhsStart, text: '' });
  }

  edits.sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end) return []; // overlap: refuse
  }
  return edits;
}

/**
 * End of the statement starting at `from`: the first newline, `;` or closing
 * brace seen at depth zero. Unlike the declaration extent, this stops before
 * the `}` that closes an enclosing inline block (`fun a() { x = 1 }`).
 */
function statementEnd(clean: string, from: number): number {
  let depth = 0;
  for (let i = from; i < clean.length; i++) {
    const c = clean[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') { if (depth > 0) depth--; }
    else if (c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((c === '\n' || c === ';') && depth === 0) return i;
  }
  return clean.length;
}

/** First depth-0 assignment `=` between `from` and `to`, or -1. */
function findAssignEq(clean: string, from: number, to: number): number {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = clean[i];
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') { if (depth > 0) depth--; }
    else if (c === '=' && depth === 0) {
      if (clean[i + 1] === '=') return -1;
      // `+=` and friends: the operator starts one char earlier
      return '+-*/%'.includes(clean[i - 1]) ? i - 1 : i;
    }
  }
  return -1;
}

/** Initializer text with a trailing comment removed, string literals intact. */
function trimmedInit(text: string, clean: string, start: number, end: number): string {
  let stop = end;
  for (let i = start; i < end - 1; i++) {
    if (text[i] === '/' && text[i + 1] === '/' && clean[i] === ' ' && clean[i + 1] === ' ') {
      stop = i;
      break;
    }
  }
  while (stop > start && /\s/.test(text[stop - 1])) stop--;
  const raw = text.slice(start, stop);
  // `x += 1` hands us `= 1` when the operator was compound
  return raw.replace(/^=\s*/, '').trim();
}

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'writeOnlyVariables';
const DEBOUNCE_MS = 400;

export class WriteOnlyProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-write-only');
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
      reportDecorations('writeOnly', 0);
      return;
    }

    const diags = findWriteOnlyVariables(editor.document.getText()).map(v => {
      const d = new vscode.Diagnostic(
        new vscode.Range(v.line, v.character, v.line, v.character + v.name.length),
        `Variable '${v.name}' is assigned but never read`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'write-only-variable';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('writeOnly', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class WriteOnlyCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findWriteOnlyVariables(text).filter(v => v.line === range.start.line);
    if (targets.length === 0) return [];

    const lineStarts = buildLineStarts(text);
    const toRange = (start: number, end: number) => {
      const s = offsetToPos(lineStarts, start);
      const e = offsetToPos(lineStarts, end);
      return new vscode.Range(s.line, s.character, e.line, e.character);
    };

    const actions: vscode.CodeAction[] = [];
    for (const v of targets) {
      if (v.edits.length > 0) {
        const plural = v.writeCount > 1 ? 's' : '';
        const remove = new vscode.CodeAction(
          `Remove '${v.name}' and its ${v.writeCount} assignment${plural}`,
          vscode.CodeActionKind.QuickFix,
        );
        const edit = new vscode.WorkspaceEdit();
        for (const e of v.edits) edit.replace(document.uri, toRange(e.start, e.end), e.text);
        remove.edit = edit;
        remove.isPreferred = true;
        actions.push(remove);
      }

      const suppress = new vscode.CodeAction('Suppress with @Suppress("unused")', vscode.CodeActionKind.QuickFix);
      const suppressEdit = new vscode.WorkspaceEdit();
      suppressEdit.insert(
        document.uri,
        new vscode.Position(v.suppressLine, 0),
        `${v.suppressIndent}@Suppress("unused")\n`,
      );
      suppress.edit = suppressEdit;
      actions.push(suppress);
    }
    return actions;
  }
}
