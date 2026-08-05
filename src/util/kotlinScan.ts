/**
 * Pure Kotlin text-scanning primitives, shared by every dead-code detector.
 *
 * These lived in provider modules that import `vscode`, which made them
 * unreachable from a plain Node script. KJ-032's dry-run harness must compute
 * byte-identical results to the extension, so the primitives moved here and
 * the old homes re-export them. Nothing in this file may import `vscode`.
 */


/** Blanks out comments and string contents while PRESERVING the code inside
 *  `${…}` templates (lengths are kept). */
export function sanitizeForUsageScan(text: string): string {
  const out: string[] = [];
  let i = 0;
  let mode: 'code' | 'line-comment' | 'block-comment' | 'string' | 'raw' = 'code';
  let templateDepth = 0;

  while (i < text.length) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);

    switch (mode) {
      case 'code':
        if (two === '//') { mode = 'line-comment'; out.push('  '); i += 2; continue; }
        if (two === '/*') { mode = 'block-comment'; out.push('  '); i += 2; continue; }
        if (three === '"""') { mode = 'raw'; out.push('   '); i += 3; continue; }
        if (ch === '"') { mode = 'string'; out.push(' '); i++; continue; }
        if (ch === "'") {
          // char literal: blanked out entirely ('A', '\'', '\\', 'A')
          let j = i + 1;
          if (text[j] === '\\') j += 2 + (text[j + 1] === 'u' ? 4 : 0);
          else j += 1;
          if (text[j] === "'") {
            out.push(' '.repeat(j + 1 - i));
            i = j + 1;
            continue;
          }
        }
        out.push(ch);
        i++;
        continue;

      case 'line-comment':
        if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
        i++;
        continue;

      case 'block-comment':
        if (two === '*/') { mode = 'code'; out.push('  '); i += 2; continue; }
        out.push(ch === '\n' ? '\n' : ' ');
        i++;
        continue;

      case 'string':
      case 'raw':
        if (templateDepth > 0) {
          if (ch === '{') templateDepth++;
          if (ch === '}') {
            templateDepth--;
            out.push(templateDepth === 0 ? ' ' : ch);
            i++;
            continue;
          }
          out.push(ch);
          i++;
          continue;
        }
        if (two === '${') { templateDepth = 1; out.push('  '); i += 2; continue; }
        if (ch === '$' && /[A-Za-z_]/.test(text[i + 1] ?? '')) {
          // simple template "$name": the identifier IS code, keep it scannable
          out.push('$');
          i++;
          while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) { out.push(text[i]); i++; }
          continue;
        }
        if (mode === 'string') {
          if (ch === '\\') { out.push('  '); i += 2; continue; }
          if (ch === '"') { mode = 'code'; out.push(' '); i++; continue; }
          if (ch === '\n') { mode = 'code'; out.push('\n'); i++; continue; }
        } else if (three === '"""') {
          // A raw string closes on the LAST three quotes of the run, so a
          // content ending in a quote (`"""URI="x""""`) keeps the extra ones.
          let run = 0;
          while (i + run < text.length && text[i + run] === '"') run++;
          mode = 'code';
          out.push(' '.repeat(run));
          i += run;
          continue;
        }
        out.push(ch === '\n' ? '\n' : ' ');
        i++;
        continue;
    }
  }
  return out.join('');
}

// Finds the index of the `)` that closes the `(` at `openIdx`.
// Skips string literals (both single and double quoted) to avoid false matches.
export function findMatchingParen(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const ch = s[i];
    // Skip string literals to avoid `)` inside them
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * `@file:Suppress(...)`, bracketed (`@file:[JvmName("X") Suppress("x")]`) or
 * qualified (`@file:kotlin.Suppress("x")`). Group 1 is the argument list,
 * parentheses excluded. Global on purpose: `fileOptsOut` walks every `@file:`
 * annotation of the header.
 */
export const FILE_SUPPRESS_RE =
  /@file\s*:\s*(?:\[[^\]]*?)?(?:[A-Za-z_]\w*\s*\.\s*)*Suppress\s*\(([^)]*)\)/g;
export const SUPPRESS_NAMES = new Set(['Suppress', 'SuppressLint', 'SuppressWarnings']);

/**
 * True when a `Suppress` argument list names one of `diagnostics`.
 *
 * The distinction matters more than it looks. `"unused"` is the inspection for
 * a declaration nothing references, and opting out of it opts out of every
 * detector in the family. `"UNUSED_PARAMETER"`, `"UNUSED_VARIABLE"` and
 * `"UNUSED_EXPRESSION"` are compiler warnings about something else entirely: a
 * file that silences the parameter warning has said nothing about whether its
 * classes are reachable.
 *
 * A plain `/unused/i` cannot tell them apart, because `UNUSED_PARAMETER`
 * contains `unused`. Matching on a whole diagnostic name can, since `_` counts
 * as a word character and so blocks the short match.
 */
export function suppressesDiagnostic(args: string, diagnostics: readonly string[]): boolean {
  return diagnostics.some(d => new RegExp(`(?:^|[^\\w])${d}(?![\\w])`, 'i').test(args));
}

// A file annotation must sit above `package`, so only what precedes it is ever
// read. 64 KB rather than a few lines because the thing above `package` is
// often a licence header, and a file whose header exceeds this has bigger
// problems than a missed opt-out.
const HEADER_BYTES = 64 * 1024;
// Fallback for a file with neither `package` nor `import` (a `.kts` script, the
// default package). Applied ONLY after the whole slice failed to yield either
// keyword: a licence header longer than this must not cost the file its opt-out.
const HEADER_LINES_WITHOUT_PACKAGE = 50;
const BODY_START_RE = /^(?:package|import)\b/;

/**
 * Blanks comments while PRESERVING string contents, and every length with them.
 *
 * Deliberately not `sanitizeForUsageScan`, and deliberately not exported. That
 * one blanks strings too, which would erase the very argument list this file
 * reads: `@file:Suppress("unused")` would come back as `@file:Suppress(      )`
 * and every legitimate opt-out would stop working. This one runs on the header
 * only, so it needs no char-literal branch either: above `package` there are
 * none.
 */
/**
 * The text above the first `package` or `import`, comments blanked.
 *
 * One pass that stops at the body, rather than blanking the whole window and
 * splitting it into lines afterwards: on a real corpus that pass cost 1.6 ms
 * where the whole-text regex it replaces cost 0.2 ms, and a header is usually
 * a few hundred bytes of a file that can run to 64 KB.
 *
 * Blanking has to precede the keyword test, so a commented-out `// package`
 * cannot end the header early, and the test needs a word boundary:
 * `packageName = 1` and `importantFlag = 1` are identifiers, not the body.
 *
 * String contents are preserved (`sanitizeForUsageScan` would blank the very
 * argument list the caller reads), and so are all lengths, so an offset taken
 * in the result still points into the source.
 */
export function fileHeader(text: string): string {
  const limit = Math.min(text.length, HEADER_BYTES);
  let out = '';
  let copied = 0;
  let i = 0;
  let lineStart = 0;
  let lines = 0;
  let capped = -1;

  const upTo = (end: number) => out + text.slice(copied, end);
  const blankOut = (start: number, end: number) => {
    out += text.slice(copied, start);
    out += text.slice(start, end).split('\n').map(l => ' '.repeat(l.length)).join('\n');
    copied = end;
  };
  // A line is the body's first only when it opens with the keyword in code
  // position; `atLineStart` is false anywhere a comment or a string is still open.
  const startsBody = (from: number): boolean => {
    let s = from;
    while (s < limit && (text[s] === ' ' || text[s] === '\t')) s++;
    return BODY_START_RE.test(text.slice(s, Math.min(s + 8, limit)));
  };

  if (startsBody(0)) return '';

  while (i < limit) {
    if (text.startsWith('"""', i)) {
      i += 3;
      while (i < limit && !text.startsWith('"""', i)) i++;
      i = Math.min(i + 3, limit);
      continue;
    }
    if (text[i] === '"') {
      i++;
      while (i < limit && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const start = i;
      while (i < limit && text[i] !== '\n') i++;
      blankOut(start, i);
      continue;
    }
    if (two === '/*') {
      // Kotlin nests block comments, so `/* /* */ @file:Suppress("x") */` is
      // entirely commented out. Stopping at the first `*/` would hand the
      // annotation back as code, which is the exact failure this function
      // exists to prevent.
      const start = i;
      let depth = 1;
      i += 2;
      while (i < limit && depth > 0) {
        if (text.startsWith('/*', i)) { depth++; i += 2; continue; }
        if (text.startsWith('*/', i)) { depth--; i += 2; continue; }
        i++;
      }
      blankOut(start, i);
      continue;
    }
    if (text[i] === '\n') {
      i++;
      lineStart = i;
      if (++lines === HEADER_LINES_WITHOUT_PACKAGE) capped = i;
      if (startsBody(lineStart)) return upTo(lineStart);
      continue;
    }
    i++;
  }
  // Neither keyword in the whole window: a `.kts` script or the default
  // package, where the line cap is the only sane bound left.
  return capped === -1 ? upTo(limit) : upTo(capped);
}

/**
 * True when the file's HEADER carries a `@file:Suppress` naming one of
 * `diagnostics`.
 *
 * The header is the whole point. Run against the raw file, the same regex turns
 * a detector off for a file whose only sin is quoting the annotation in a KDoc,
 * a string or a commented-out TODO, and nothing reports that it happened.
 * `matchAll` clones the regex, so the global flag leaves no `lastIndex` behind
 * between two files.
 */
export function fileOptsOut(text: string, diagnostics: readonly string[]): boolean {
  if (!text.includes('@file')) return false;
  for (const m of fileHeader(text).matchAll(FILE_SUPPRESS_RE)) {
    if (suppressesDiagnostic(m[1], diagnostics)) return true;
  }
  return false;
}

/** Opts out of "nothing references this declaration" everywhere in the family. */
export const UNUSED_DECLARATION = ['unused'] as const;
/** …plus the compiler warning a parameter detector is the counterpart of. */
export const UNUSED_PARAMETER = ['unused', 'UNUSED_PARAMETER'] as const;
/** …plus the ones a local-variable detector is the counterpart of. */
export const UNUSED_VARIABLE = ['unused', 'UNUSED_VARIABLE', 'UNUSED_EXPRESSION'] as const;
/** Annotations that never change reflective/codegen visibility of a fun's params. */
export const BENIGN_FUN_ANNOTATIONS = new Set(['Composable', 'Preview']);

export interface Seg {
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
  /**
   * Offsets of the argument list, parens excluded, or -1 when there is none.
   *
   * The sanitizer blanks string BODIES while preserving length, so these
   * offsets are valid against the original text and an argument has to be read
   * from there: slicing `clean` would yield `@Suppress("       ")`.
   */
  argStart: number;
  argEnd: number;
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
    const chain: { name: string; argStart: number; argEnd: number }[] = [];
    let j = m.index;
    while (j < clean.length && clean[j] === '@') {
      j++;
      const site = /^(?:file|get|set|param|property|field|receiver|delegate|setparam):/.exec(clean.slice(j, j + 12));
      if (site) j += site[0].length;
      const nm = /^[A-Za-z_][\w.]*/.exec(clean.slice(j, j + 120));
      if (!nm) break;
      chain.push({ name: nm[0].split('.').pop()!, argStart: -1, argEnd: -1 });
      j += nm[0].length;
      let k = j;
      while (k < clean.length && /\s/.test(clean[k])) k++;
      if (clean[k] === '(') {
        const close = findMatchingParen(clean, k);
        if (close === -1) break;
        chain[chain.length - 1].argStart = k + 1;
        chain[chain.length - 1].argEnd = close;
        j = close + 1;
      }
      while (j < clean.length && /\s/.test(clean[j])) j++;
    }
    consumedUntil = Math.max(j, m.index + 1);
    for (const c of chain) out.push({ target: j, name: c.name, argStart: c.argStart, argEnd: c.argEnd });
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
export function depthZeroColon(clean: string, seg: Seg): number {
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
/**
 * Functions callable without their name appearing at the call site.
 * `isOperator`/`isOverride` already cover the own-line parser path; this
 * table is the belt for the inline-body path where those flags are partial.
 */
export const CONVENTION_FUN_NAMES = new Set([
  'invoke', 'getValue', 'setValue', 'provideDelegate',
  'equals', 'hashCode', 'toString', 'compareTo', 'contains',
  'iterator', 'next', 'hasNext', 'rangeTo', 'rangeUntil',
  'plus', 'minus', 'times', 'div', 'rem', 'mod', 'get', 'set',
  'inc', 'dec', 'unaryPlus', 'unaryMinus', 'not',
  'plusAssign', 'minusAssign', 'timesAssign', 'divAssign', 'remAssign',
]);

/**
 * Supertypes whose runtime reads fields the code never names: Java
 * serialization, Android Parcelable. A private property of such a class is
 * never provably dead from the source alone.
 */
export const REFLECTIVE_SUPERTYPES = new Set(['Serializable', 'Externalizable', 'Parcelable']);
