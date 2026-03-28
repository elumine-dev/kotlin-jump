import * as vscode from 'vscode';
import { ParsedFile, SymbolKind } from './KotlinParser';

// Kinds that contribute to the FQN chain (nested classes get pkg.Outer.Inner)
const CLASS_LIKE = new Set<SymbolKind>(['class', 'dataClass', 'sealedClass', 'enum', 'object', 'interface', 'annotation']);

export interface SymbolEntry {
  name: string;
  fqn: string;
  kind: SymbolKind;
  uri: vscode.Uri;
  line: number;
  character: number;
  packageName: string;
  isComposable: boolean;
  depth: number;
  moduleName?: string;
  aliasTarget?: string; // raw rhs of typealias — used for follow-through navigation
}

export class SymbolIndex {
  // ── Three maps for O(1) on every hot-path operation ──────────────────────
  // Set gives O(1) Set.delete() on remove — was O(n) indexOf+splice with Array
  private readonly byName = new Map<string, Set<SymbolEntry>>();
  private readonly byFqn  = new Map<string, SymbolEntry>();
  private readonly byFile = new Map<string, SymbolEntry[]>();

  // ── Sorted-names for O(log N) binary-search prefix matching ──────────────
  private sortedLower: string[] = [];
  private sortedOrig:  string[] = [];
  private dirty = true;

  // ── String intern pool — one object per unique packageName in heap ────────
  private readonly pkgPool = new Map<string, string>();

  add(file: ParsedFile, moduleName?: string): void {
    const uri = vscode.Uri.parse(file.uriString);
    const key  = file.uriString;
    this.removeByKey(key);

    if (file.symbols.length === 0) return;

    const pkg = this.intern(file.packageName);
    const fileEntries: SymbolEntry[] = [];
    // Stack tracks enclosing class names so nested symbols get pkg.Outer.Inner FQN
    const classStack: { name: string; depth: number }[] = [];

    for (const sym of file.symbols) {
      // Pop entries that are no longer enclosing this symbol
      while (classStack.length > 0 && classStack[classStack.length - 1].depth >= sym.depth) {
        classStack.pop();
      }

      // Build FQN: pkg.Outer.Inner.symbol  (handles nested classes + companion members)
      const qualifiers = classStack.map(s => s.name);
      const parts = pkg ? [pkg, ...qualifiers, sym.name] : [...qualifiers, sym.name];
      const fqn = parts.join('.');

      // Class-like symbols join the chain so their nested members can reference them
      if (CLASS_LIKE.has(sym.kind)) {
        classStack.push({ name: sym.name, depth: sym.depth });
      }

      const entry: SymbolEntry = {
        name: sym.name,
        fqn,
        kind: sym.kind,
        uri,
        line: sym.line,
        character: sym.character,
        packageName: pkg,
        isComposable: sym.isComposable,
        depth: sym.depth,
        moduleName,
        aliasTarget: sym.aliasTarget,
      };

      fileEntries.push(entry);

      let set = this.byName.get(sym.name);
      if (!set) { set = new Set(); this.byName.set(sym.name, set); }
      set.add(entry);

      this.byFqn.set(fqn, entry);
    }

    this.byFile.set(key, fileEntries);
    this.dirty = true;
  }

  remove(uri: vscode.Uri): void {
    this.removeByKey(uri.toString());
  }

  // O(1) — hot path for Cmd+Click
  lookup(name: string): SymbolEntry[] {
    const s = this.byName.get(name);
    return s ? [...s] : EMPTY;
  }

  // O(1) — hot path for FQN import resolution
  lookupFqn(fqn: string): SymbolEntry | undefined {
    return this.byFqn.get(fqn);
  }

  // O(log N) prefix match + O(N) fuzzy fallback
  search(query: string): SymbolEntry[] {
    if (!query) return EMPTY;

    if (this.dirty) this.rebuildSorted();

    const lower = query.toLowerCase();
    const results: SymbolEntry[] = [];

    // ── 1. Prefix matches (fast, binary search) ──────────────────────────────
    let lo = 0, hi = this.sortedLower.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedLower[mid] < lower) lo = mid + 1;
      else hi = mid;
    }
    const prefixNames = new Set<string>();
    for (let i = lo; i < this.sortedLower.length; i++) {
      if (!this.sortedLower[i].startsWith(lower)) break;
      const orig = this.sortedOrig[i];
      prefixNames.add(orig);
      const set = this.byName.get(orig);
      if (set) {
        for (const e of set) {
          results.push(e);
          if (results.length >= 200) return results;
        }
      }
    }

    // ── 2. Fuzzy matches (sequential char match, scored) ─────────────────────
    if (lower.length >= 2) {
      const scored: { entries: SymbolEntry[]; score: number }[] = [];
      for (let i = 0; i < this.sortedOrig.length; i++) {
        const name = this.sortedOrig[i];
        if (prefixNames.has(name)) continue;
        const score = fuzzyScore(lower, this.sortedLower[i]);
        if (score > 0) {
          const set = this.byName.get(name);
          if (set) scored.push({ entries: [...set], score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      for (const { entries } of scored) {
        for (const e of entries) {
          results.push(e);
          if (results.length >= 200) return results;
        }
      }
    }

    return results;
  }

  // Call once after bulk indexing — builds sorted list in one O(N log N) pass
  // instead of rebuilding lazily for every search() call during scan
  finalize(): void {
    this.rebuildSorted();
  }

  getFileSymbols(uriString: string): SymbolEntry[] {
    return this.byFile.get(uriString) ?? EMPTY;
  }

  fileUriStrings(): string[] {
    return [...this.byFile.keys()];
  }

  // Returns up to `limit` entries whose kind is in the given set — used for "@class:" queries
  filterByKind(kinds: Set<string>, limit = 200): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const entries of this.byFile.values()) {
      for (const e of entries) {
        if (kinds.has(e.kind)) {
          results.push(e);
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  stats(): { files: number; symbols: number } {
    return { files: this.byFile.size, symbols: this.byFqn.size };
  }

  clear(): void {
    this.byName.clear();
    this.byFqn.clear();
    this.byFile.clear();
    this.sortedLower = [];
    this.sortedOrig  = [];
    this.dirty = true;
  }

  // ── IndexStore access (save/restore without re-parsing) ───────────────────

  // Yields [uriString, entries] for every indexed file — used by IndexStore.save()
  *fileEntries(): Generator<[string, SymbolEntry[]]> {
    yield* this.byFile.entries();
  }

  // Directly restores pre-built entries from a snapshot — no ParsedFile needed
  restoreFile(uriString: string, entries: SymbolEntry[]): void {
    this.byFile.set(uriString, entries);
    for (const e of entries) {
      let set = this.byName.get(e.name);
      if (!set) { set = new Set(); this.byName.set(e.name, set); }
      set.add(e);
      this.byFqn.set(e.fqn, e);
    }
    this.dirty = true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private removeByKey(key: string): void {
    const entries = this.byFile.get(key);
    if (!entries) return;

    for (const entry of entries) {
      const set = this.byName.get(entry.name);
      if (set) {
        set.delete(entry); // O(1) — was O(n) indexOf
        if (set.size === 0) this.byName.delete(entry.name);
      }
      this.byFqn.delete(entry.fqn);
    }
    this.byFile.delete(key);
    this.dirty = true;
  }

  private rebuildSorted(): void {
    const pairs: [string, string][] = [];
    for (const name of this.byName.keys()) {
      pairs.push([name, name.toLowerCase()]);
    }
    pairs.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    this.sortedOrig  = pairs.map(p => p[0]);
    this.sortedLower = pairs.map(p => p[1]);
    this.dirty = false;
  }

  private intern(s: string): string {
    if (!s) return s;
    const hit = this.pkgPool.get(s);
    if (hit) return hit;
    this.pkgPool.set(s, s);
    return s;
  }
}

const EMPTY: SymbolEntry[] = [];

// Sequential character match: "KS" matches "KioskScreen".
// Bonuses for consecutive chars and word-boundary starts.
function fuzzyScore(queryLower: string, nameLower: string): number {
  let qi = 0, score = 0, prevMatch = -2;
  for (let ni = 0; ni < nameLower.length && qi < queryLower.length; ni++) {
    if (nameLower[ni] === queryLower[qi]) {
      const consecutive   = ni === prevMatch + 1 ? 3 : 0;
      const wordBoundary  = ni === 0 || !/[a-z0-9]/.test(nameLower[ni - 1]) ? 5 : 0;
      score += 1 + consecutive + wordBoundary;
      prevMatch = ni;
      qi++;
    }
  }
  return qi === queryLower.length ? score : 0;
}
