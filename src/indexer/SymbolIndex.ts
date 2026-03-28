import * as vscode from 'vscode';
import { ParsedFile, SymbolKind } from './KotlinParser';

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

    for (const sym of file.symbols) {
      const fqn   = pkg ? `${pkg}.${sym.name}` : sym.name;
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

  // O(log N + results) — was O(N) full scan
  search(query: string): SymbolEntry[] {
    if (!query) return EMPTY;

    if (this.dirty) this.rebuildSorted();

    const lower   = query.toLowerCase();
    const results: SymbolEntry[] = [];

    // Binary search: find first sorted name >= query
    let lo = 0, hi = this.sortedLower.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedLower[mid] < lower) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < this.sortedLower.length; i++) {
      if (!this.sortedLower[i].startsWith(lower)) break;
      const set = this.byName.get(this.sortedOrig[i]);
      if (set) {
        for (const e of set) {
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
