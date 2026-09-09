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
  let depth = 0, opened = false, parens = 0;
  for (let i = start; i <= stop; i++) {
    const t = lines[i];
    for (let c = 0; c < t.length; c++) {
      const ch = t[c];
      if (ch !== '{' && ch !== '}' && ch !== '(' && ch !== ')') continue;
      if (isInsideCommentOrString(t, c)) continue;
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') { if (opened && --depth === 0) return i; }
      else if (ch === '(') parens++;
      else if (parens > 0) parens--;
    }
    const code = codeOnly(t).trimEnd();
    // A block comment that opens a line belongs to what comes NEXT. A
    // constructor parameter ends with a comma, so the scan ran on into the
    // next parameter's KDoc and the two folds crossed.
    // Only OUTSIDE a parameter list: inside a primary constructor the KDoc and
    // the annotation introduce the next parameter, which still belongs to the
    // class. Stopping there closed the class on its own line and its
    // properties climbed to the root of the Outline, level with it.
    const trimmed = code.trim();
    if (!opened && parens === 0 && i > start
      && (trimmed.startsWith('/*') || ANNOTATION_ONLY_RE.test(trimmed))) return i - 1;
    if (!opened && parens === 0 && !CONTINUES_RE.test(code) && !TRAILING_ANNOTATION_RE.test(code)) return i;
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
