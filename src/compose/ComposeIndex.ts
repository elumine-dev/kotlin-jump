import { SymbolEntry, SymbolIndex } from '../indexer/SymbolIndex';

/**
 * Filtered view over SymbolIndex for @Composable functions.
 * No separate storage — delegates to SymbolIndex to keep invalidation simple.
 */
export class ComposeIndex {
  constructor(private readonly index: SymbolIndex) {}

  lookup(name: string): SymbolEntry[] {
    return this.index.lookup(name).filter(e => e.isComposable);
  }

  search(query: string): SymbolEntry[] {
    return this.index.search(query).filter(e => e.isComposable);
  }
}
