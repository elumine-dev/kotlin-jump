import { SymbolEntry } from '../indexer/SymbolIndex';
import { isInsideCommentOrString } from './textUtils';

// For symbol at index i (depth d), returns the last line of its body.
// Scans forward for the next symbol at depth ≤ d (next sibling or parent's sibling)
// and uses the line before it. Falls back to document last line.
// Pick<> so RawSymbol[] (KotlinParser) is accepted as well as SymbolEntry[].
export function rangeEndLine(entries: readonly Pick<SymbolEntry, 'line' | 'depth'>[], index: number, lastLine: number): number {
  const depth = entries[index].depth;
  for (let j = index + 1; j < entries.length; j++) {
    if (entries[j].depth <= depth) {
      return Math.max(entries[j].line - 1, entries[index].line);
    }
  }
  return lastLine;
}

// A line ending with one of these continues its statement on the next line.
const CONTINUES_RE = /(?:[=,.(:]|->|&&|\|\||[+*/-]|\?:)$/;

// An annotation never ends a declaration: something always follows it.
// ktlint wraps an injected constructor as `class Foo @Inject` then
// `constructor(...)`, and reading the header as finished gave the class a
// one line extent, so every member of it overflowed its parent in the Outline
// and folding the class folded nothing.
const TRAILING_ANNOTATION_RE = /@[\w.:]+(?:\s*\([^)]*\))?$/;

// A line made of nothing but annotations introduces the declaration BELOW it,
// the same way a KDoc does. A constructor parameter ends with a comma, so the
// scan ran on into the next parameter's `@SerializedName(...)` and folding the
// first one hid the second one's annotation.
const ANNOTATION_ONLY_RE = /^(?:@[\w.:]+(?:\s*\([^)]*\))?\s*)+$/;

// The three ways a class header goes on below: a secondary `constructor`, the
// supertype list, and a `where` clause. `open class Foo` then `constructor(`
// is what ktlint produces once the header is too long, and reading the first
// line as the whole declaration left the class one line tall.
const HEADER_GOES_ON_RE = /^(?:(?:public|private|internal|protected|actual)\s+)?(?:constructor\b|where\b)|^:/;

// A start line that declares a class-like symbol without opening its body: the
// header is unfinished, so an annotation on the next line belongs to IT rather
// than presenting the declaration below. `class PageExternalUid` then
// `@VisibleForTesting(...)` then `constructor(...) {` is the shape.
const CH_SLASH = 47, CH_STAR = 42, CH_AT = 64;

const CLASS_HEAD_RE = /^(?:@[\w.:]+(?:\s*\([^)]*\))?\s+)*(?:(?:public|private|internal|protected|abstract|open|sealed|data|inner|value|enum|annotation|expect|actual|final|companion)\s+)*(?:class|interface|object)\b/;

/**
 * Last line of the body of entries[index], read from the text: the `}`
 * matching its first `{`, or for a declaration without a block (`val a = 1`,
 * `fun x() =\n expr`) the last line of its statement. rangeEndLine is the
 * ceiling; on its own it ran to the line before the next symbol, which is
 * the neighbour's KDoc and annotations, or the class's own `}`: folding a
 * member hid them, and Expand Selection swallowed the closing brace.
 */
export function bodyEndLine(
  lines: readonly string[],
  entries: readonly Pick<SymbolEntry, 'line' | 'depth'>[],
  index: number,
  lastLine: number,
): number {
  const start = entries[index].line;
  const stop = Math.min(rangeEndLine(entries, index, lastLine), lines.length - 1);
  const startCode = codeOnly(lines[start] ?? '').trim();
  const unfinishedHeader = CLASS_HEAD_RE.test(startCode) && !startCode.includes('{');
  let depth = 0, opened = false, parens = 0;
  for (let i = start; i <= stop; i++) {
    const t = lines[i];
    for (let c = 0; c < t.length; c++) {
      const ch = t[c];
      if (ch !== '{' && ch !== '}' && ch !== '(' && ch !== ')') continue;
      if (isInsideCommentOrString(t, c)) continue;
      // A brace inside a parameter list is never the body: the `{}` default of
      // `(initialValues: Builder.() -> Unit = {})` opened and closed the depth
      // at once, so the class was declared finished on its own first line.
      if (ch === '(') { parens++; continue; }
      if (ch === ')') { if (parens > 0) parens--; continue; }
      if (parens > 0) continue;
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') { if (opened && --depth === 0) return i; }
    }
    if (opened || parens > 0) continue;
    const code = codeOnly(t).trimEnd();
    // First non blank character, without allocating a trimmed copy: this runs
    // on every line of every declaration and folding a file paid for it.
    let k = 0;
    while (k < code.length && (code.charCodeAt(k) === 32 || code.charCodeAt(k) === 9)) k++;
    const first = code.charCodeAt(k);
    // A block comment or a line of annotations belongs to what comes NEXT. A
    // constructor parameter ends with a comma, so the scan ran on into the
    // next parameter's KDoc and the two folds crossed. Only outside a
    // parameter list, and not while a class header is still open: there the
    // annotation is part of the header being read.
    if (i > start && (
      (first === CH_SLASH && code.charCodeAt(k + 1) === CH_STAR)
      || (!unfinishedHeader && first === CH_AT && ANNOTATION_ONLY_RE.test(code.slice(k)))
    )) return i - 1;
    if (CONTINUES_RE.test(code)) continue;
    if (code.indexOf('@') >= 0 && TRAILING_ANNOTATION_RE.test(code)) continue;
    // The next line is read only here, where the answer is about to be
    // returned: reading it on every line doubled the cost of folding a file.
    const next = codeOnly(lines[i + 1] ?? '').trimStart();
    if (HEADER_GOES_ON_RE.test(next) || (unfinishedHeader && ANNOTATION_ONLY_RE.test(next))) continue;
    return i;
  }
  return stop;
}

/** The line without its trailing `//` comment (string aware). */
function codeOnly(t: string): string {
  let inStr: string | false = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '"' || c === '\'') { inStr = c; continue; }
    if (c === '/' && t[i + 1] === '/') return t.slice(0, i);
  }
  return t;
}
