import * as vscode from 'vscode';
import { parse, RawSymbol } from '../indexer/KotlinParser';
import { sanitizeForUsageScan } from './UnusedImportProvider';
import { findMatchingParen } from '../util/SignatureReader';
import { rangeEndLine } from '../util/symbolRanges';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-025: unused parameter detection + removal quick fix.
 *
 * Flags three structurally file-local cases (zero false positives by design,
 * false negatives accepted — same philosophy as KJ-009's wildcard rule):
 *   1. `ctorParam` — primary-constructor parameter without val/var
 *   2. `ctorProp`  — `private val`/`private var` constructor property unused in the file
 *   3. `funParam`  — parameter of a `private fun` with a body
 *
 * Never flagged: override/operator/expect/actual/abstract/external/`main`,
 * data/enum/annotation/value classes, interfaces, objects, annotated
 * declarations or parameters, vararg, backticked names, anything under
 * `@Suppress`. Local shadowing and named-argument labels count as usages
 * (false negatives, locked by tests).
 *
 * Rendering: Warning diagnostic + DiagnosticTag.Unnecessary (VS Code fades
 * the range natively). The quick fix removes the declaration AND the matching
 * argument at every unambiguous call site; ambiguous sites (overloads,
 * homonym classes, `::references`) are skipped, and cross-file edits go
 * through the Refactor Preview (needsConfirmation).
 */

export type UnusedParamKind = 'ctorParam' | 'ctorProp' | 'funParam';

export interface UnusedParam {
  /** 0-based line of the parameter name token. */
  line: number;
  /** 0-based start column of the name token. */
  character: number;
  name: string;
  kind: UnusedParamKind;
  /** Index in the declaration's parameter list (positional argument removal). */
  paramIndex: number;
  /** Class or function owning the parameter (call-site search). */
  ownerName: string;
  /** Absolute offsets of the declaration segment to delete (comma included). */
  declStart: number;
  declEnd: number;
  /** Offset where a param-site annotation can be inserted (before modifiers). */
  annotationInsert: number;
}

export const FILE_SUPPRESS_RE = /@file\s*:\s*Suppress\s*\(([^)]*)\)/;
export const SUPPRESS_NAMES = new Set(['Suppress', 'SuppressLint', 'SuppressWarnings']);
/** Annotations that never change reflective/codegen visibility of a fun's params. */
export const BENIGN_FUN_ANNOTATIONS = new Set(['Composable', 'Preview']);

interface Seg {
  start: number;
  end: number;
}

export function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function offsetToPos(lineStarts: number[], offset: number): { line: number; character: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

interface AnnoTarget {
  /** Offset of the first code character the annotation chain applies to. */
  target: number;
  /** Simple annotation name (`Suppress`, `Composable`, …), package prefix dropped. */
  name: string;
}

/**
 * Finds every annotation chain in the file and the offset of the declaration
 * it attaches to. Paren-matched, so multi-line annotations
 * (`@Suppress(\n"unused"\n)`) are attributed correctly — a naive
 * "lines starting with @ above the decl" walk misses those.
 */
export function collectAnnotationTargets(clean: string): AnnoTarget[] {
  const out: AnnoTarget[] = [];
  const re = /@(?:(?:file|get|set|param|property|field|receiver|delegate|setparam):)?[A-Za-z_]/g;
  let consumedUntil = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m.index < consumedUntil) continue;
    const chain: string[] = [];
    let j = m.index;
    while (j < clean.length && clean[j] === '@') {
      j++;
      const site = /^(?:file|get|set|param|property|field|receiver|delegate|setparam):/.exec(clean.slice(j, j + 12));
      if (site) j += site[0].length;
      const nm = /^[A-Za-z_][\w.]*/.exec(clean.slice(j, j + 120));
      if (!nm) break;
      chain.push(nm[0].split('.').pop()!);
      j += nm[0].length;
      let k = j;
      while (k < clean.length && /\s/.test(clean[k])) k++;
      if (clean[k] === '(') {
        const close = findMatchingParen(clean, k);
        if (close === -1) break;
        j = close + 1;
      }
      while (j < clean.length && /\s/.test(clean[j])) j++;
    }
    consumedUntil = Math.max(j, m.index + 1);
    for (const name of chain) out.push({ target: j, name });
  }
  return out;
}

/**
 * From just after a class name, finds the `(` opening the primary-constructor
 * parameter list. Tolerates generics, `constructor`, visibility modifiers and
 * simple annotations (`@Inject constructor(`). Returns -1 when the class has
 * no primary constructor OR when an annotation carries arguments (ambiguous —
 * we skip the class rather than risk a misparse).
 */
export function findCtorParen(clean: string, from: number): number {
  let i = from;
  while (i < clean.length && /\s/.test(clean[i])) i++;
  if (clean[i] === '<') {
    let depth = 0;
    while (i < clean.length) {
      const c = clean[i];
      if (c === '-' && clean[i + 1] === '>') { i += 2; continue; }
      if (c === '<') depth++;
      else if (c === '>') { depth--; i++; if (depth === 0) break; else continue; }
      i++;
    }
  }
  while (i < clean.length) {
    const c = clean[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') return i;
    if (c === '@') {
      i++;
      while (i < clean.length && /[\w.]/.test(clean[i])) i++;
      let j = i;
      while (j < clean.length && /\s/.test(clean[j])) j++;
      if (clean[j] === '(') return -1; // annotation with args before ctor
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < clean.length && /\w/.test(clean[j])) j++;
      const word = clean.slice(i, j);
      if (['constructor', 'private', 'protected', 'internal', 'public', 'actual'].includes(word)) {
        i = j;
        continue;
      }
      return -1;
    }
    return -1; // ':', '{', … → no primary ctor param list
  }
  return -1;
}

/**
 * Splits `clean[from..to)` at depth-0 commas. Depth counts (), <>, {}, [] and
 * skips `->` so lambda types don't unbalance angles. Structure comes from the
 * sanitized text; emptiness is judged on `raw`, because a blanked string
 * argument (`"a"` → spaces) is still a real argument — only trailing commas
 * and empty lists are whitespace in the raw text too.
 */
export function splitParamSegments(clean: string, from: number, to: number, raw: string): Seg[] {
  const segs: Seg[] = [];
  let depth = 0;
  let start = from;
  let i = from;
  while (i < to) {
    const ch = clean[i];
    if (ch === '-' && clean[i + 1] === '>') { i += 2; continue; }
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') { if (depth > 0) depth--; }
    else if (ch === ',' && depth === 0) {
      segs.push({ start, end: i });
      start = i + 1;
    }
    i++;
  }
  segs.push({ start, end: to });
  return segs.filter(s => raw.slice(s.start, s.end).trim().length > 0);
}

/** First depth-0 `:` inside a segment (the name/type separator), -1 if none. */
function depthZeroColon(clean: string, seg: Seg): number {
  let depth = 0;
  for (let i = seg.start; i < seg.end; i++) {
    const ch = clean[i];
    if (ch === '-' && clean[i + 1] === '>') { i++; continue; }
    if (ch === '(' || ch === '<' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '>' || ch === '}' || ch === ']') { if (depth > 0) depth--; }
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Deletion range for one segment of a comma-separated list: the trimmed
 * segment plus its separator comma. When the segment owns its whole line
 * (multi-line lists), the entire line goes, newline included.
 */
function segmentDeletionRange(text: string, segs: Seg[], index: number, lineStarts: number[]): { start: number; end: number } {
  const seg = segs[index];
  let start = seg.start;
  while (start < seg.end && /\s/.test(text[start])) start++;
  let end = seg.end;
  while (end > start && /\s/.test(text[end - 1])) end--;

  if (index < segs.length - 1) {
    // not last: eat the following comma + spaces (not newlines)
    end = seg.end + 1;
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  } else if (text[seg.end] === ',') {
    end = seg.end + 1; // trailing comma
  } else if (index > 0) {
    // last of several: eat the preceding comma
    start = segs[index - 1].end;
  }

  // full-line segment → delete the line
  const { line: startLine } = offsetToPos(lineStarts, start);
  const lineStart = lineStarts[startLine];
  const lineEnd = startLine + 1 < lineStarts.length ? lineStarts[startLine + 1] : text.length;
  if (
    text.slice(lineStart, start).trim() === '' &&
    text.slice(end, lineEnd).trim() === '' &&
    end <= lineEnd
  ) {
    return { start: lineStart, end: lineEnd };
  }
  return { start, end };
}

/** Matching `}` for the `{` at openIdx. Expects sanitized text. */
export function matchBrace(clean: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function findUnusedParameters(text: string): UnusedParam[] {
  if (!/\b(?:class|fun)\b/.test(text)) return [];
  const fileSuppress = FILE_SUPPRESS_RE.exec(text);
  if (fileSuppress && /unused/i.test(fileSuppress[1])) return [];

  const symbols = parse('inline', text).symbols;
  const clean = sanitizeForUsageScan(text);
  const lines = text.split('\n');
  const lineStarts = buildLineStarts(text);
  const lastLine = lines.length - 1;
  const annoTargets = collectAnnotationTargets(clean);
  // Annotations attached to this declaration: their target is the first code
  // character of the decl (between line start and the symbol name column).
  const annosFor = (sym: RawSymbol): string[] => {
    const lo = lineStarts[sym.line];
    const hi = lo + sym.character;
    return annoTargets.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
  };
  const result: UnusedParam[] = [];

  // The symbol-based extent (rangeEndLine) truncates too early when the body
  // is an expression containing an object/lambda: the parser records that
  // `object :` as a SIBLING (braces not open yet on the decl line), e.g.
  // `private fun city(id: String) = object : Model { fun getId() = id }`.
  // The balanced-brace extent of the real body wins; over-scanning can only
  // produce false negatives, never false positives.
  const scanCandidates = (
    owner: RawSymbol,
    ownerIndex: number,
    openParen: number,
    candidates: { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[],
    structuralEnd = 0,
  ): void => {
    if (candidates.length === 0) return;
    const endLine = rangeEndLine(symbols, ownerIndex, lastLine);
    const endOffset = Math.max(
      endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length,
      structuralEnd,
    );
    for (const c of candidates) {
      const regionStart = c.kind === 'ctorProp' ? 0 : openParen;
      const regionEnd = c.kind === 'ctorProp' ? clean.length : endOffset;
      // blank the candidate's own declaration segment, then look for the name
      const scanStr =
        clean.slice(regionStart, c.seg.start) +
        ' '.repeat(c.seg.end - c.seg.start) +
        clean.slice(c.seg.end, regionEnd);
      if (new RegExp(`\\b${c.name}\\b`).test(scanStr)) continue;
      const pos = offsetToPos(lineStarts, c.nameOffset);
      const del = segmentDeletionRange(text, c.segs, c.segIndex, lineStarts);
      let trimStart = c.seg.start;
      while (trimStart < c.seg.end && /\s/.test(text[trimStart])) trimStart++;
      result.push({
        line: pos.line,
        character: pos.character,
        name: c.name,
        kind: c.kind,
        paramIndex: c.segIndex,
        ownerName: owner.name,
        declStart: del.start,
        declEnd: del.end,
        annotationInsert: trimStart,
      });
    }
  };

  const collectParams = (
    openParen: number,
    closeParen: number,
    forClass: boolean,
  ): { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[] => {
    const segs = splitParamSegments(clean, openParen + 1, closeParen, text);
    const out: { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[] = [];
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      const segText = clean.slice(seg.start, seg.end);
      if (segText.includes('@')) continue; // annotated param
      const colon = depthZeroColon(clean, seg);
      if (colon === -1) continue;
      const before = clean.slice(seg.start, colon);
      if (before.includes('`')) continue; // backticked name
      if (/\bvararg\b/.test(before)) continue;
      if (/\boverride\b/.test(before)) continue;
      const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(before);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      if (name.startsWith('_')) continue; // `_event`: intentionally-unused convention
      const nameOffset = seg.start + nameMatch.index;
      const hasValVar = /\b(?:val|var)\b/.test(before.slice(0, nameMatch.index));
      const isPrivate = /\bprivate\b/.test(before);
      let kind: UnusedParamKind;
      if (forClass) {
        if (hasValVar) {
          if (!isPrivate) continue; // public property: visible outside the file
          kind = 'ctorProp';
        } else {
          kind = 'ctorParam';
        }
      } else {
        kind = 'funParam';
      }
      out.push({ seg, segs, segIndex: si, nameOffset, name, kind });
    }
    return out;
  };

  for (let idx = 0; idx < symbols.length; idx++) {
    const sym = symbols[idx];

    if (sym.kind === 'class' || sym.kind === 'sealedClass') {
      const declLine = lines[sym.line];
      const annoNames = annosFor(sym);
      if (annoNames.some(n => SUPPRESS_NAMES.has(n) || n === 'JvmInline')) continue;
      if (/\bvalue\s+class\b/.test(declLine)) continue;
      // ctorProp only: any class annotation may imply codegen/reflection reads
      const classIsAnnotated = annoNames.length > 0;
      const nameEnd = lineStarts[sym.line] + sym.character + sym.name.length;
      const openParen = findCtorParen(clean, nameEnd);
      if (openParen === -1) continue;
      const closeParen = findMatchingParen(clean, openParen);
      if (closeParen === -1) continue;
      let candidates = collectParams(openParen, closeParen, true);
      if (classIsAnnotated) candidates = candidates.filter(c => c.kind !== 'ctorProp');
      // class body extent by brace matching (first `{` after the header)
      const bodyBrace = clean.indexOf('{', closeParen);
      const bodyClose = bodyBrace === -1 ? -1 : matchBrace(clean, bodyBrace);
      scanCandidates(sym, idx, openParen, candidates, bodyClose === -1 ? 0 : bodyClose + 1);
      continue;
    }

    if (sym.kind === 'fun' || sym.kind === 'composable') {
      if (!sym.isPrivate) continue;
      if (sym.isOverride || sym.isOperator || sym.isAbstract || sym.isExpect || sym.isActual) continue;
      if (sym.name === 'main' || sym.name.startsWith('`')) continue;
      const annoNames = annosFor(sym);
      if (annoNames.some(a => !BENIGN_FUN_ANNOTATIONS.has(a))) continue;
      let i = lineStarts[sym.line] + sym.character + sym.name.length;
      while (i < clean.length && /\s/.test(clean[i])) i++;
      if (clean[i] !== '(') continue;
      const openParen = i;
      const closeParen = findMatchingParen(clean, openParen);
      if (closeParen === -1) continue;
      // body required: `{` or `=` after the signature but BEFORE the next
      // sibling symbol — otherwise a bodiless fun (external, header) followed
      // by another fun would borrow that fun's body opener
      const endLine = rangeEndLine(symbols, idx, lastLine);
      const endOffset = endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length;
      const after = clean.slice(closeParen + 1, Math.min(endOffset, closeParen + 801));
      const bodyRel = after.search(/[{=]/);
      if (bodyRel === -1) continue;
      // structural body extent: block body → its balanced braces; expression
      // body → the balanced extent of the first `{` in the expression, if any
      // (lambda or object expression)
      const bodyAbs = closeParen + 1 + bodyRel;
      let braceAbs = -1;
      if (after[bodyRel] === '{') {
        braceAbs = bodyAbs;
      } else {
        const rel = clean.slice(bodyAbs, bodyAbs + 400).indexOf('{');
        if (rel !== -1) braceAbs = bodyAbs + rel;
      }
      let structuralEnd = 0;
      if (braceAbs !== -1) {
        const close = matchBrace(clean, braceAbs);
        if (close !== -1) structuralEnd = close + 1;
      }
      scanCandidates(sym, idx, openParen, collectParams(openParen, closeParen, false), structuralEnd);
    }
  }

  return result;
}

// ── Call-site argument removal ───────────────────────────────────────────────

export interface CallEdit {
  start: number;
  end: number;
}

export interface CallScanResult {
  edits: CallEdit[];
  /** Ambiguous or unparseable sites left untouched. */
  skipped: number;
}

/**
 * Computes the argument deletions needed in ONE file when removing
 * `param` from `param.ownerName`'s signature. Pure and offset-based.
 */
export function computeCallSiteEdits(
  text: string,
  param: Pick<UnusedParam, 'name' | 'paramIndex' | 'ownerName' | 'kind'>,
): CallScanResult {
  const clean = sanitizeForUsageScan(text);
  const lineStarts = buildLineStarts(text);
  const isCtor = param.kind !== 'funParam';
  const edits: CallEdit[] = [];
  let skipped = 0;

  // A function/constructor reference changes arity with the removal: bail on the file.
  if (new RegExp(`::\\s*${param.ownerName}\\b`).test(clean)) return { edits: [], skipped: 1 };
  // Subclass whose supertype list names the class WITHOUT calling its ctor
  // (`class Sub : Owner { constructor(x) : super(x, 2) }`) hides the call in
  // `super(…)`. Only bail when a `super(` actually exists — a plain type
  // annotation (`val x: Owner`) must not silence the whole file.
  if (
    isCtor &&
    /:\s*super\s*\(/.test(clean) &&
    new RegExp(`:\\s*${param.ownerName}\\b(?!\\s*[<(])`).test(clean)
  ) {
    return { edits: [], skipped: 1 };
  }

  const nameRe = new RegExp(`\\b${param.ownerName}\\b`, 'g');
  const openParens: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(clean)) !== null) {
    // optional generic arguments: `Box<Int>(…)` — '<' must touch the name so
    // a comparison (`count < 3`) is never mistaken for type arguments
    let j = m.index + param.ownerName.length;
    if (clean[j] === '<') {
      let depth = 0;
      while (j < clean.length) {
        const c = clean[j];
        if (c === '-' && clean[j + 1] === '>') { j += 2; continue; }
        if (c === '<') depth++;
        else if (c === '>') { depth--; j++; if (depth === 0) break; continue; }
        j++;
      }
    }
    while (j < clean.length && (clean[j] === ' ' || clean[j] === '\t')) j++;
    if (clean[j] !== '(') continue;
    const openParen = j;
    // exclude the declaration itself (fun/class/interface/object keyword before the name)
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(clean[k])) k--;
    const wordEnd = k + 1;
    while (k >= 0 && /\w/.test(clean[k])) k--;
    const prevWord = clean.slice(k + 1, wordEnd);
    if (['fun', 'class', 'interface', 'object', 'enum'].includes(prevWord)) continue;
    // method call on another receiver (`other.render(…)`) may be a different
    // symbol — only `this.` and bare calls are provably ours. Qualified ctor
    // calls (`com.pkg.ClassName(…)`) stay allowed.
    if (!isCtor) {
      const before = clean.slice(Math.max(0, m.index - 12), m.index);
      if (/\.\s*$/.test(before) && !/\bthis\s*\.\s*$/.test(before)) {
        skipped++;
        continue;
      }
    }
    openParens.push(openParen);
  }
  // Secondary-constructor delegation, only INSIDE the declaring class's body:
  // a `: this(…)` in another class of the same file targets that other class.
  if (isCtor) {
    const syms = parse('call-scan', text).symbols;
    const ci = syms.findIndex(
      s => (s.kind === 'class' || s.kind === 'sealedClass' || s.kind === 'dataClass') && s.name === param.ownerName,
    );
    if (ci !== -1) {
      const endLine = rangeEndLine(syms, ci, lineStarts.length - 1);
      const from = lineStarts[syms[ci].line];
      const to = endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length;
      const region = clean.slice(from, to);
      // 2+ secondary ctors: `this(…)` may delegate to another secondary, not
      // the primary — positional mapping would be wrong
      const secondaryCtors = (region.match(/\bconstructor\s*\(/g) ?? []).length;
      const thisRe = /:\s*this\s*\(/g;
      let tm: RegExpExecArray | null;
      while ((tm = thisRe.exec(region)) !== null) {
        if (secondaryCtors > 1) { skipped++; continue; }
        openParens.push(from + tm.index + tm[0].length - 1);
      }
    }
  }

  for (const openParen of openParens) {
    const closeParen = findMatchingParen(clean, openParen);
    if (closeParen === -1) { skipped++; continue; }
    const segs = splitParamSegments(clean, openParen + 1, closeParen, text);
    if (segs.length === 0) continue; // no args passed (defaults)

    const namedIdx = segs.findIndex(s =>
      new RegExp(`^\\s*${param.name}\\s*=(?!=)`).test(clean.slice(s.start, s.end)),
    );
    if (namedIdx !== -1) {
      edits.push(segmentDeletionRange(text, segs, namedIdx, lineStarts));
      continue;
    }
    // not passed at all: not by name (namedIdx === -1) and not positionally
    // (fewer args than paramIndex+1 — positional args keep their index even
    // mixed with named-in-position args) → nothing to remove at this site
    if (segs.length <= param.paramIndex) continue;
    // positional removal: every arg up to paramIndex must itself be positional
    const namedFlags = segs.map(s => /^\s*\w+\s*=(?!=)/.test(clean.slice(s.start, s.end)));
    if (namedFlags.every(Boolean)) continue; // fully-named call without our param
    const anyNamedBefore = namedFlags.slice(0, param.paramIndex + 1).some(Boolean);
    if (anyNamedBefore) { skipped++; continue; }
    edits.push(segmentDeletionRange(text, segs, param.paramIndex, lineStarts));
  }

  return { edits, skipped };
}

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedParameters';
const DEBOUNCE_MS = 400;

function toRange(text: string, start: number, end: number): vscode.Range {
  const lineStarts = buildLineStarts(text);
  const s = offsetToPos(lineStarts, start);
  const e = offsetToPos(lineStarts, end);
  return new vscode.Range(s.line, s.character, e.line, e.character);
}

export class UnusedParameterProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-parameters');
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
      reportDecorations('unusedParams', 0);
      return;
    }

    const unused = findUnusedParameters(editor.document.getText());
    const diags = unused.map(u => {
      const noun = u.kind === 'ctorProp' ? 'Property' : 'Parameter';
      const d = new vscode.Diagnostic(
        new vscode.Range(u.line, u.character, u.line, u.character + u.name.length),
        `${noun} '${u.name}' is never used`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-parameter';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('unusedParams', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class UnusedParameterCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findUnusedParameters(text).filter(u => u.line === range.start.line);
    if (targets.length === 0) return [];

    const actions: vscode.CodeAction[] = [];
    for (const param of targets) {
      actions.push(await this._buildRemoveAction(document, text, param));
      actions.push(this._buildSuppressAction(document, text, param));
    }
    return actions;
  }

  private async _buildRemoveAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): Promise<vscode.CodeAction> {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, toRange(text, param.declStart, param.declEnd));

    const symbols = parse('inline', text).symbols;
    const ownerDecls = symbols.filter(s => s.name === param.ownerName).length;

    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;

    if (ownerDecls > 1) {
      // overloads / homonym in the same file: every call site is ambiguous
      skipped++;
    } else {
      const local = computeCallSiteEdits(text, param);
      skipped += local.skipped;
      for (const e of local.edits) {
        // the declaration deletion may overlap a `this(…)` match — guard
        if (e.start >= param.declStart && e.start < param.declEnd) continue;
        edit.delete(document.uri, toRange(text, e.start, e.end));
        argCount++;
      }
      if (local.edits.length > 0) fileCount = 1;

      if (param.kind !== 'funParam') {
        const cross = await this._crossFileEdits(document, param, edit);
        argCount += cross.argCount;
        fileCount += cross.fileCount;
        skipped += cross.skipped;
      }
    }

    let title = `Remove unused parameter '${param.name}'`;
    if (argCount > 0) {
      title += ` and ${argCount} argument${argCount > 1 ? 's' : ''}`;
      if (fileCount > 1) title += ` in ${fileCount} files`;
    }
    if (skipped > 0) title += ` (${skipped} ambiguous site${skipped > 1 ? 's' : ''} skipped)`;

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.isPreferred = true;
    return action;
  }

  private async _crossFileEdits(
    document: vscode.TextDocument,
    param: UnusedParam,
    edit: vscode.WorkspaceEdit,
  ): Promise<{ argCount: number; fileCount: number; skipped: number }> {
    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;
    const files = await vscode.workspace.findFiles('**/*.kt', '**/{node_modules,build,.git,out,dist}/**', 2000);
    const declRe = new RegExp(`\\b(?:class|interface|object)\\s+${param.ownerName}\\b`);
    const decoder = new TextDecoder();
    for (const uri of files) {
      if (uri.toString() === document.uri.toString()) continue;
      let other: string;
      try {
        other = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        continue;
      }
      if (!other.includes(param.ownerName)) continue;
      if (declRe.test(other)) {
        // homonym class declared elsewhere: this file's call sites are ambiguous
        skipped++;
        continue;
      }
      const res = computeCallSiteEdits(other, param);
      skipped += res.skipped;
      if (res.edits.length === 0) continue;
      fileCount++;
      for (const e of res.edits) {
        edit.delete(uri, toRange(other, e.start, e.end), {
          needsConfirmation: true,
          label: `Remove argument for '${param.name}'`,
        });
        argCount++;
      }
    }
    return { argCount, fileCount, skipped };
  }

  private _buildSuppressAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): vscode.CodeAction {
    // parameter-site suppression works for all three kinds and keeps the edit
    // local; inserted before the modifiers (`@Suppress(…) private val x`)
    const id = param.kind === 'ctorProp' ? 'unused' : 'UNUSED_PARAMETER';
    const pos = offsetToPos(buildLineStarts(text), param.annotationInsert);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(pos.line, pos.character), `@Suppress("${id}") `);
    const action = new vscode.CodeAction(`Suppress with @Suppress("${id}")`, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    return action;
  }
}
