import { SymbolEntry } from '../indexer/SymbolIndex';

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
