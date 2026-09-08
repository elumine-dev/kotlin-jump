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
    if (!opened && parens === 0 && !CONTINUES_RE.test(codeOnly(t).trimEnd())) return i;
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
