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

export const FILE_SUPPRESS_RE = /@file\s*:\s*Suppress\s*\(([^)]*)\)/;
export const SUPPRESS_NAMES = new Set(['Suppress', 'SuppressLint', 'SuppressWarnings']);
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
