import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { isInsideCommentOrString, countTripleQuotes } from '../util/textUtils';
import { Logger } from '../util/logger';

/** Step-by-step trace sink — wired to the Kotlin Jump output channel so a
 *  user can answer "why is there no lens on this when?" from the logs. */
export type SealedWhenTrace = (msg: string) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Sealed `when` coverage — CodeLens above `when (subject)` expressions whose
// branches match subtypes of one sealed class/interface (or entries of one
// enum class):
//
//   ✓ 3/3 branches
//   ⚠ 2/3 branches, missing: Draw          (click → insert the missing arms)
//   ✓ else covers 1 remaining: Draw
//
// No type inference: the hierarchy is recovered from the branches themselves.
// Every `is X` / bare `X.Y` branch is resolved through the import-aware
// resolver and must vote unanimously for a single parent. Any unresolved or
// ambiguous branch silences the lens — a wrong count is worse than no lens.
//
// Kotlin rules this relies on (verified against kotlinlang.org / KEEP):
//   - Sealed subtypes live in the same package (and module) as the parent
//     since Kotlin 1.5 → package equality filters homonyms soundly.
//   - Guard branches (`is A if cond ->`, Kotlin 2.1+) do NOT count toward
//     exhaustiveness → resolved but excluded from `covered`.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DOC_LINES = 20_000;
const MAX_WHEN_BODY_LINES = 1_000;
const MAX_WHENS_PER_DOC = 200;
const MAX_NAMES_IN_TITLE = 3;

const SUBTYPE_KINDS = new Set(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum']);

const RE_WHEN = /\bwhen\s*\(/g;
// `is Foo.Bar<T>?` — generics and nullability stripped later.
const RE_IS_BRANCH = /^is\s+([\w.]+)/;
const RE_BARE_REF = /^([A-Z]\w*(?:\.[A-Z_]\w*)*)$/;

/** Minimal document shape — satisfied by vscode.TextDocument and test mocks. */
export interface TextDocLike {
  uri: vscode.Uri | { toString(): string };
  version: number;
  languageId: string;
  getText(): string;
}

export interface WhenAnalysis {
  /** Line of the `when (` keyword. */
  whenLine: number;
  /** Where missing branches get inserted (line start, before `else` or `}`). */
  insertLine: number;
  /** Indentation copied from the first branch line. */
  branchIndent: string;
  /** Qualification prefix copied from the first type branch — `'LoadState.'`
   *  when the file writes `is LoadState.Error`, `''` when it imports the
   *  subtype and writes `is Error`. Inserted branches mirror the style. */
  insertPrefix: string;
  hasElse: boolean;
  parent: SymbolEntry;
  parentKind: 'sealed' | 'enum';
  /** All known subtypes/entries, declaration order, deduped by FQN. */
  expected: SymbolEntry[];
  /** FQNs covered by unguarded branches. */
  covered: Set<string>;
  missing: SymbolEntry[];
}

interface BranchRef {
  path: string;       // dotted reference as written, generics/`?` stripped
  guarded: boolean;   // `is A if cond ->` — excluded from exhaustiveness
  qualified: boolean; // contains a '.'
}

interface RawWhen {
  whenLine: number;
  bodyOpenLine: number;
  bodyCloseLine: number;
  elseLine: number | undefined;
  firstBranchLine: number;
  branchIndent: string;
  refs: BranchRef[];
  hasElse: boolean;
  bailed: boolean;
  bailReason?: string;
}

// ── Pure analysis ─────────────────────────────────────────────────────────────

export function analyzeDocument(
  doc: TextDocLike,
  index: SymbolIndex,
  trace?: SealedWhenTrace,
): WhenAnalysis[] {
  const text = doc.getText();
  const lines = text.split('\n');
  const lineCount = Math.min(lines.length, MAX_DOC_LINES);

  const results: WhenAnalysis[] = [];
  let inBlockComment = false;
  let inRawString = false;

  for (let ln = 0; ln < lineCount && results.length < MAX_WHENS_PER_DOC; ln++) {
    let line = lines[ln];
    if (inRawString) {
      if (line.includes('"""') && countTripleQuotes(line) % 2 === 1) inRawString = false;
      continue;
    }
    if (inBlockComment) {
      const close = line.indexOf('*/');
      if (close === -1) continue;
      inBlockComment = false;
      line = ' '.repeat(close + 2) + line.slice(close + 2);
    }

    // Fast path: most lines mention neither `when` nor a comment/raw-string
    // opener. Three native includes() beat the char-by-char state tracking
    // below by ~10× — this is the per-keystroke tax EVERY open Kotlin file
    // pays, so it has to stay flat on 20k-line documents.
    const hasWhen = line.includes('when');
    if (!hasWhen && !line.includes('/*') && !line.includes('"""')) continue;

    RE_WHEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (hasWhen && (m = RE_WHEN.exec(line)) !== null) {
      if (isInsideCommentOrString(line, m.index)) continue;
      const raw = scanWhen(lines, ln, m.index + m[0].length - 1, lineCount);
      if (!raw) continue; // no block body found — expression context or unclosed
      if (raw.bailed) {
        trace?.(`when@${ln + 1}: skipped — ${raw.bailReason ?? 'unsupported syntax'}`);
        continue;
      }
      if (raw.refs.length === 0) {
        trace?.(`when@${ln + 1}: skipped — no type branches (literals/calls only)`);
        continue;
      }
      const analysis = resolveWhen(raw, doc, index, trace);
      if (analysis) {
        results.push(analysis);
        trace?.(
          `when@${ln + 1}: ${analysis.parentKind} ${analysis.parent.fqn} — ` +
          `${analysis.covered.size}/${analysis.expected.length} covered` +
          (analysis.missing.length > 0 ? `, missing: ${analysis.missing.map(e => e.name).join(', ')}` : '') +
          (analysis.hasElse ? ' (has else)' : ''),
        );
      }
    }

    if (line.includes('/*')) inBlockComment = endsInsideBlockComment(line, inBlockComment);
    if (line.includes('"""') && countTripleQuotes(line) % 2 === 1) inRawString = true;
  }
  return results;
}

/** Does `line` open a /* block comment it doesn't close (outside strings)? */
function endsInsideBlockComment(line: string, _state: boolean): boolean {
  let i = 0;
  let open = false;
  while (i < line.length - 1) {
    if (!open && line[i] === '/' && line[i + 1] === '/' && !isInsideCommentOrString(line, i - 1)) {
      return false; // rest of line is a line comment
    }
    if (!open && line[i] === '/' && line[i + 1] === '*' && !insideQuote(line, i)) {
      open = true; i += 2; continue;
    }
    if (open && line[i] === '*' && line[i + 1] === '/') {
      open = false; i += 2; continue;
    }
    i++;
  }
  return open;
}

/** Lightweight "am I inside a plain quote" check that ignores comments. */
function insideQuote(line: string, pos: number): boolean {
  let inStr: string | false = false;
  for (let i = 0; i < pos; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = false;
    } else if (ch === '"' || ch === '\'') {
      inStr = ch;
    }
  }
  return inStr !== false;
}

/**
 * Scans one `when (` occurrence: matches the subject parens, finds the body
 * braces, and extracts branch conditions at relative brace depth 1.
 * `openParenCol` points at the `(` of the subject.
 */
function scanWhen(
  lines: string[],
  whenLine: number,
  openParenCol: number,
  lineCount: number,
): RawWhen | undefined {
  // ── Match the subject's closing paren (may span lines) ──
  let parenDepth = 0;
  let ln = whenLine;
  let col = openParenCol;
  let bodyOpenLine = -1;
  let bodyOpenCol = -1;

  outer:
  for (; ln < Math.min(whenLine + 20, lineCount); ln++) {
    const line = lines[ln];
    for (; col < line.length; col++) {
      if (isInsideCommentOrString(line, col)) continue;
      const ch = line[col];
      if (ch === '(') parenDepth++;
      else if (ch === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          // First `{` after the subject opens the body.
          for (let l2 = ln; l2 < Math.min(ln + 3, lineCount); l2++) {
            const start = l2 === ln ? col + 1 : 0;
            const text2 = lines[l2];
            for (let c2 = start; c2 < text2.length; c2++) {
              if (isInsideCommentOrString(text2, c2)) continue;
              if (text2[c2] === '{') { bodyOpenLine = l2; bodyOpenCol = c2; break; }
              if (/\S/.test(text2[c2])) return undefined; // expression-body `when (x) =`? not a block
            }
            if (bodyOpenLine !== -1) break;
          }
          break outer;
        }
      }
    }
    col = 0;
  }
  if (bodyOpenLine === -1) return undefined;

  // ── Walk the body, collecting branch conditions at relative depth 1 ──
  const raw: RawWhen = {
    whenLine,
    bodyOpenLine,
    bodyCloseLine: -1,
    elseLine: undefined,
    firstBranchLine: -1,
    branchIndent: '    ',
    refs: [],
    hasElse: false,
    bailed: false,
  };

  let depth = 0;
  const endLine = Math.min(bodyOpenLine + MAX_WHEN_BODY_LINES, lineCount);
  for (let l = bodyOpenLine; l < endLine; l++) {
    const line = lines[l];
    const startCol = l === bodyOpenLine ? bodyOpenCol : 0;
    const depthAtLineStart = depth;

    // Branch conditions live on lines that START at depth 1 (after the
    // opening line). One-liner `when (x) { is A -> 1 }` is out of scope.
    if (l > bodyOpenLine && depthAtLineStart === 1) {
      const arrow = findTopLevelArrow(line);
      if (arrow !== -1) {
        const cond = line.slice(0, arrow).trim();
        if (raw.firstBranchLine === -1) {
          raw.firstBranchLine = l;
          raw.branchIndent = line.slice(0, line.length - line.trimStart().length);
        }
        parseCondition(cond, l, raw);
        if (raw.bailed) return raw;
      } else if (looksLikeConditionFragment(line)) {
        // A multi-line condition (`is A,` continued on the next line, or the
        // arrow itself wrapped) would split across iterations and under-count
        // coverage. Wrong counts are worse than no lens — bail the whole when.
        raw.bailed = true;
        raw.bailReason = `multi-line branch condition at line ${l + 1}`;
        return raw;
      }
    }

    for (let c = startCol; c < line.length; c++) {
      if (isInsideCommentOrString(line, c)) continue;
      const ch = line[c];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { raw.bodyCloseLine = l; return raw; }
      }
    }
  }
  return undefined; // unclosed within cap — bail
}

/**
 * Heuristic for an arrow-less depth-1 line that is probably PART of a branch
 * condition rather than a multi-line branch body: starts with `is Type` or a
 * bare `Type.Ref,` trailing comma at top level. Conservative on purpose —
 * matching an innocent body expression only costs a hidden lens.
 */
function looksLikeConditionFragment(line: string): boolean {
  const trimmed = line.trim();
  if (/^is\s+[A-Z]/.test(trimmed)) return true;
  return /^[A-Z][\w.]*\s*,\s*(\/\/.*)?$/.test(trimmed);
}

/** Index of the branch `->` at paren/bracket/brace depth 0, or -1. */
function findTopLevelArrow(line: string): number {
  let d = 0;
  for (let i = 0; i < line.length - 1; i++) {
    if (isInsideCommentOrString(line, i)) continue;
    const ch = line[i];
    if (ch === '(' || ch === '[' || ch === '{') d++;
    else if (ch === ')' || ch === ']' || ch === '}') d--;
    else if (d === 0 && ch === '-' && line[i + 1] === '>') return i;
  }
  return -1;
}

/** Splits a branch condition on top-level commas and classifies segments. */
function parseCondition(cond: string, lineNum: number, raw: RawWhen): void {
  for (const segment of splitTopLevel(cond)) {
    let seg = segment.trim();
    if (!seg) continue;
    if (seg === 'else') {
      raw.hasElse = true;
      if (raw.elseLine === undefined) raw.elseLine = lineNum;
      continue;
    }
    if (/^!is\b/.test(seg)) {
      raw.bailed = true;
      raw.bailReason = `!is branch at line ${lineNum + 1} (coverage needs type analysis)`;
      return;
    }

    // Kotlin 2.1+ guard: `is A if cond` — resolve the type, exclude from
    // coverage. The guard expression itself is ignored.
    let guarded = false;
    const guardIdx = findTopLevelGuard(seg);
    if (guardIdx !== -1) {
      guarded = true;
      seg = seg.slice(0, guardIdx).trim();
    }

    const isMatch = RE_IS_BRANCH.exec(seg);
    if (isMatch) {
      const path = stripTypeNoise(isMatch[1], seg.slice(isMatch[0].length));
      raw.refs.push({ path, guarded, qualified: path.includes('.') });
      continue;
    }
    const bare = RE_BARE_REF.exec(seg);
    if (bare) {
      raw.refs.push({ path: bare[1], guarded, qualified: bare[1].includes('.') });
      continue;
    }
    // Literal, range, function call… — not a type branch, ignore the segment.
  }
}

/** `Foo.Bar` + trailing `<T>?` noise → `Foo.Bar`. */
function stripTypeNoise(path: string, _rest: string): string {
  return path.replace(/[<?].*$/, '');
}

/** Position of a top-level ` if ` guard keyword inside a branch segment. */
function findTopLevelGuard(seg: string): number {
  let d = 0;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') d++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') d--;
    else if (d === 0 && ch === 'i' && seg[i + 1] === 'f') {
      const before = i === 0 ? ' ' : seg[i - 1];
      const after = i + 2 < seg.length ? seg[i + 2] : ' ';
      if (/\s/.test(before) && /[\s(]/.test(after)) return i;
    }
  }
  return -1;
}

/** Splits on commas at paren/bracket/brace/generic depth 0. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let d = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') d++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') d--;
    else if (ch === ',' && d === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

// ── Resolution against the index ──────────────────────────────────────────────

function resolveWhen(
  raw: RawWhen,
  doc: TextDocLike,
  index: SymbolIndex,
  trace?: SealedWhenTrace,
): WhenAnalysis | undefined {
  const at = `when@${raw.whenLine + 1}: no lens —`;
  const resolved: Array<{ entry: SymbolEntry; guarded: boolean }> = [];
  for (const ref of raw.refs) {
    const entry = resolveRef(ref.path, doc, index);
    if (!entry) {
      trace?.(`${at} branch '${ref.path}' unresolved or ambiguous in the index`);
      return undefined; // unresolved → silence
    }
    resolved.push({ entry, guarded: ref.guarded });
  }

  // ── Each resolved entry must vote for the same parent ──
  let parent: SymbolEntry | undefined;
  let parentKind: 'sealed' | 'enum' | undefined;
  for (const { entry } of resolved) {
    const p = parentOf(entry, index);
    if (!p) {
      trace?.(`${at} '${entry.fqn}' has no unique sealed/enum parent`);
      return undefined;
    }
    if (parent && parent.fqn !== p.parent.fqn) {
      trace?.(`${at} branches mix two hierarchies (${parent.fqn} vs ${p.parent.fqn})`);
      return undefined;
    }
    parent = p.parent;
    parentKind = p.kind;
  }
  if (!parent || !parentKind) return undefined;

  // ── Expected set ──
  let expected: SymbolEntry[];
  if (parentKind === 'sealed') {
    const seen = new Set<string>();
    expected = index.lookupImplementations(parent.name).filter(e => {
      if (e.packageName !== parent!.packageName) return false;
      if (!e.supertypes?.includes(parent!.name)) return false;
      if (e.name.startsWith('$')) return false;
      if (!SUBTYPE_KINDS.has(e.kind)) return false;
      if (seen.has(e.fqn)) return false;
      seen.add(e.fqn);
      return true;
    });
  } else {
    expected = index
      .getFileSymbols(parent.uri.toString())
      .filter(e => e.kind === 'enum' && e.fqn === parent!.fqn + '.' + e.name);
  }
  if (expected.length === 0) {
    trace?.(`${at} '${parent.fqn}' has no known subtypes/entries in the index`);
    return undefined;
  }

  const expectedFqns = new Set(expected.map(e => e.fqn));
  const covered = new Set<string>();
  for (const { entry, guarded } of resolved) {
    if (!expectedFqns.has(entry.fqn)) {
      trace?.(`${at} branch '${entry.fqn}' is not a direct subtype of ${parent.fqn}`);
      return undefined; // foreign subtype
    }
    if (!guarded) covered.add(entry.fqn);
  }

  const missing = expected.filter(e => !covered.has(e.fqn));
  const firstPath = raw.refs[0].path;
  const lastDot = firstPath.lastIndexOf('.');
  return {
    whenLine: raw.whenLine,
    insertLine: raw.hasElse && raw.elseLine !== undefined ? raw.elseLine : raw.bodyCloseLine,
    branchIndent: raw.branchIndent,
    insertPrefix: lastDot === -1 ? '' : firstPath.slice(0, lastDot + 1),
    hasElse: raw.hasElse,
    parent,
    parentKind,
    expected,
    covered,
    missing,
  };
}

/** Resolves a (possibly dotted) branch reference to a unique index entry. */
function resolveRef(path: string, doc: TextDocLike, index: SymbolIndex): SymbolEntry | undefined {
  const segs = path.split('.');
  if (segs.length === 1) {
    const r = resolveBest(segs[0], doc as vscode.TextDocument, fqn => index.lookupFqn(fqn));
    return r.matches.length === 1 ? r.matches[0] : undefined;
  }
  // Qualified: resolve the head, then walk the rest as FQN segments.
  const head = resolveBest(segs[0], doc as vscode.TextDocument, fqn => index.lookupFqn(fqn));
  if (head.matches.length === 1) {
    const full = index.lookupFqn(head.matches[0].fqn + '.' + segs.slice(1).join('.'));
    if (full) return full;
  }
  // Fallback: unique simple-name match whose FQN ends with the written path.
  const last = segs[segs.length - 1];
  const candidates = index
    .lookup(last)
    .filter(e => e.fqn === path || e.fqn.endsWith('.' + path));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Sealed parent (via supertypes, same package) or owning enum class. */
function parentOf(
  entry: SymbolEntry,
  index: SymbolIndex,
): { parent: SymbolEntry; kind: 'sealed' | 'enum' } | undefined {
  if (entry.kind === 'enum') {
    const cut = entry.fqn.lastIndexOf('.');
    if (cut === -1) return undefined;
    const owner = index.lookupFqn(entry.fqn.slice(0, cut));
    if (owner?.kind === 'enum') return { parent: owner, kind: 'enum' };
    // `entry` was the enum class itself (or an enum implementing a sealed
    // interface) — fall through to the supertype walk below.
  }
  const parents: SymbolEntry[] = [];
  for (const st of entry.supertypes ?? []) {
    for (const cand of index.lookup(st)) {
      if (cand.kind === 'sealedClass' && cand.packageName === entry.packageName) {
        if (!parents.some(p => p.fqn === cand.fqn)) parents.push(cand);
      }
    }
  }
  return parents.length === 1 ? { parent: parents[0], kind: 'sealed' } : undefined;
}

// ── Lens title helpers ────────────────────────────────────────────────────────

export function lensTitle(a: WhenAnalysis): string {
  const total = a.expected.length;
  if (a.missing.length === 0) return `✓ ${total}/${total} branches`;
  const names = a.missing.slice(0, MAX_NAMES_IN_TITLE).map(e => e.name).join(', ');
  const suffix = a.missing.length > MAX_NAMES_IN_TITLE ? '…' : '';
  if (a.hasElse) {
    return `✓ else covers ${a.missing.length} remaining: ${names}${suffix}`;
  }
  return `⚠ ${a.covered.size}/${total} branches, missing: ${names}${suffix}`;
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface CacheEntry { version: number; epoch: number; lenses: vscode.CodeLens[]; }

export class SealedWhenCoverageProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  private readonly _cache = new Map<string, CacheEntry>();
  private _epoch = 0;
  private _fireTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly index: SymbolIndex, private readonly log?: Logger) {
    log?.info('[SealedWhen] provider registered');
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'kotlin') return [];
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('sealedWhenCoverage', true);
    if (!enabled) return [];

    const key = document.uri.toString();
    const hit = this._cache.get(key);
    if (hit && hit.version === document.version && hit.epoch === this._epoch) {
      return hit.lenses;
    }

    const fileName = key.split('/').pop() ?? key;
    const trace: SealedWhenTrace = msg => this.log?.debug(`[SealedWhen] ${fileName} ${msg}`);
    const t0 = Date.now();
    const lenses = analyzeDocument(document, this.index, trace).map(a => {
      const range = new vscode.Range(a.whenLine, 0, a.whenLine, 0);
      const command: vscode.Command = a.missing.length === 0
        ? { title: lensTitle(a), command: '' }
        : {
            title: lensTitle(a),
            command: 'kotlin-jump.addMissingWhenBranches',
            arguments: [document.uri, a.whenLine],
            tooltip: 'Insert the missing branches',
          };
      return new vscode.CodeLens(range, command);
    });

    this._cache.set(key, { version: document.version, epoch: this._epoch, lenses });
    this.log?.debug(`[SealedWhen] ${fileName} — ${lenses.length} lens(es) in ${Date.now() - t0}ms (v${document.version}, epoch ${this._epoch})`);
    return lenses;
  }

  /** Index contents changed (any file) — sealed subtype sets may differ. */
  bumpEpoch(): void {
    this._epoch++;
    // Debounced refresh: scans touch many files in a burst on startup.
    if (this._fireTimer) clearTimeout(this._fireTimer);
    this._fireTimer = setTimeout(() => { this._onDidChange.fire(); }, 80);
  }

  /** Config toggled — re-render immediately. */
  fireChange(): void {
    this._epoch++;
    this._onDidChange.fire();
  }

  dispose(): void {
    if (this._fireTimer) clearTimeout(this._fireTimer);
    this._onDidChange.dispose();
    this._cache.clear();
  }
}
