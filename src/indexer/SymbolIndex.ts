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
  aliasTarget?: string;   // raw rhs of typealias — used for follow-through navigation
  supertypes?: string[];  // simple names of superclasses/interfaces
  constValue?:      string;  // raw literal for const val, e.g. `5000` or `"v2"`
  isSuspend?:       boolean;
  isAbstract?:      boolean;
  isConst?:         boolean;
  isExpect?:        boolean; // KMP `expect` — signature-only, no body
  isActual?:        boolean; // KMP `actual` — platform implementation
  isExtension?:     boolean;
  isInline?:        boolean;
  isInfix?:         boolean;
  isLateinit?:      boolean;
  isHiltViewModel?: boolean;
  isOperator?:      boolean;
  isOverride?:      boolean;
  isPreview?:       boolean;
  isPrivate?:       boolean;
  isDeprecated?:    boolean;
  isTest?:          boolean; // fun annotated with @Test / @ParameterizedTest etc.
  isTestClass?:     boolean; // class annotated with @RunWith
  isIgnored?:       boolean; // fun annotated with @Ignore / @Disabled
  isLifecycle?:     boolean; // fun annotated with @Before / @After etc.
}

export class SymbolIndex {
  // ── Three maps for O(1) on every hot-path operation ──────────────────────
  // Set gives O(1) Set.delete() on remove — was O(n) indexOf+splice with Array
  private readonly byName    = new Map<string, Set<SymbolEntry>>();
  private readonly byFqn     = new Map<string, SymbolEntry>();
  private readonly byFile    = new Map<string, SymbolEntry[]>();
  private readonly bySuper   = new Map<string, Set<SymbolEntry>>();
  // ── Trigram index for O(candidates) fuzzy search ─────────────────────────
  // trigram (3-char lowercase substring) → set of original symbol names
  private readonly byTrigram = new Map<string, Set<string>>();

  // ── Inverted word index — pre-filters Find Usages candidates ─────────────
  // word → file URIs that declare/import/extend that identifier
  private readonly byWord     = new Map<string, Set<string>>();
  // URI → set of words contributed to byWord (enables O(words) removal)
  private readonly byWordFile = new Map<string, Set<string>>();
  // package name → file URIs in that package
  private readonly byPkg      = new Map<string, Set<string>>();
  // wildcard prefix (pkg from `import pkg.*`) → file URIs that wildcard-import it
  private readonly byWildcard = new Map<string, Set<string>>();
  // raw import strings per file — enables O(1) byPkg/byWildcard cleanup in removeByKey()
  // and snapshot restoration of the word index
  private readonly fileImports = new Map<string, string[]>();
  // Activated by finalize() — prevents use of a partial index
  private _wordIndexReady = false;

  // ── Sorted-names for O(log N) binary-search prefix matching ──────────────
  private sortedLower: string[] = [];
  private sortedOrig:  string[] = [];
  private dirty = true;

  // Counter incremented on every `add()` / `removeByKey()`. `finalize()`
  // skips the rebuild when nothing has changed since the last call —
  // avoids redundant O(N log N) work when multiple scanners (Gradle,
  // Maven, JDK, bundled stdlib) finish concurrently inside Promise.all
  // and each invokes finalize(). Cf. plan §Cross-cutting.
  private _modificationsSinceFinalize = 0;

  // ── String intern pools — one canonical object per unique value in heap ───
  // Values that repeat heavily across a 50K-symbol index: package names,
  // `kind` strings (e.g. 'fun' / 'class' duplicated 10K+ times), and
  // supertype names (interfaces extended by many classes). Interning
  // keeps a single backing string per value, cutting heap by ~5-10 %
  // on large workspaces with no measurable lookup cost.
  private readonly pkgPool   = new Map<string, string>();
  private readonly kindPool  = new Map<string, string>();
  private readonly superPool = new Map<string, string>();

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
        kind: this.internKind(sym.kind) as typeof sym.kind,
        uri,
        line: sym.line,
        character: sym.character,
        packageName: pkg,
        isComposable: sym.isComposable,
        depth: sym.depth,
        moduleName,
        aliasTarget: sym.aliasTarget,
        supertypes: sym.supertypes ? sym.supertypes.map(s => this.internSuper(s)) : undefined,
        constValue:      sym.constValue,
        isSuspend:       sym.isSuspend,
        isAbstract:      sym.isAbstract,
        isConst:         sym.isConst,
        isExpect:        sym.isExpect,
        isActual:        sym.isActual,
        isExtension:     sym.isExtension,
        isInline:        sym.isInline,
        isInfix:         sym.isInfix,
        isLateinit:      sym.isLateinit,
        isHiltViewModel: sym.isHiltViewModel,
        isOperator:      sym.isOperator,
        isOverride:      sym.isOverride,
        isPreview:       sym.isPreview,
        isPrivate:       sym.isPrivate,
        isDeprecated:    sym.isDeprecated,
        isTest:          sym.isTest,
        isTestClass:     sym.isTestClass,
        isIgnored:       sym.isIgnored,
        isLifecycle:     sym.isLifecycle,
      };

      fileEntries.push(entry);

      let set = this.byName.get(sym.name);
      if (!set) { set = new Set(); this.byName.set(sym.name, set); this.addToTrigram(sym.name); }
      set.add(entry);

      // Prefer `actual` (real implementation) over `expect` (signature-only)
      // for the same FQN. Without this, a KMP library like kotlinx.coroutines
      // that declares `runBlocking` as both `expect` (commonMain/concurrentMain)
      // and `actual` (jvmMain) would silently resolve Cmd+Click to whichever
      // file the jar's zip entries happened to iterate last — surfacing a
      // signature with no body and a useless "Go to Definition" experience.
      const existing = this.byFqn.get(fqn);
      if (!existing || !entry.isExpect || existing.isExpect) {
        this.byFqn.set(fqn, entry);
      }

      if (sym.supertypes) {
        for (const st of sym.supertypes) {
          let sset = this.bySuper.get(st);
          if (!sset) { sset = new Set(); this.bySuper.set(st, sset); }
          sset.add(entry);
        }
      }
    }

    this.byFile.set(key, fileEntries);
    this.dirty = true;
    this._modificationsSinceFinalize++;

    // ── Populate inverted word index ─────────────────────────────────────────
    const fileWords = new Set<string>();
    for (const sym of file.symbols) {
      this._addWordToFile(key, sym.name, fileWords);
      if (sym.supertypes) {
        for (const st of sym.supertypes) this._addWordToFile(key, st, fileWords);
      }
    }
    for (const imp of file.imports) {
      if (imp.endsWith('.*')) {
        const pkg = imp.slice(0, -2);
        let s = this.byWildcard.get(pkg);
        if (!s) { s = new Set(); this.byWildcard.set(pkg, s); }
        s.add(key);
      } else {
        const seg = imp.split('.').pop();
        if (seg) this._addWordToFile(key, seg, fileWords);
      }
    }
    this.byWordFile.set(key, fileWords);
    this.fileImports.set(key, file.imports);
    if (file.packageName) {
      let s = this.byPkg.get(file.packageName);
      if (!s) { s = new Set(); this.byPkg.set(file.packageName, s); }
      s.add(key);
    }
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

  // O(1) — returns all classes/interfaces that extend/implement the given name
  lookupImplementations(name: string): SymbolEntry[] {
    const s = this.bySuper.get(name);
    return s ? [...s] : EMPTY;
  }

  // For an interface method, find the corresponding override methods in implementing classes
  lookupMethodImplementations(methodName: string, uriString: string, methodLine: number): SymbolEntry[] {
    // Find the containing class/interface by scanning the file's symbols backward
    const fileSymbols = this.getFileSymbols(uriString);
    let container: SymbolEntry | undefined;
    for (const s of fileSymbols) {
      if (s.line > methodLine) break;
      if (CLASS_LIKE.has(s.kind)) container = s;
    }
    if (!container) return EMPTY;

    // Find all classes that implement the container
    const impls = this.lookupImplementations(container.name);
    if (impls.length === 0) return EMPTY;

    // Find methods with the same name inside implementing classes (not the interface itself)
    const results: SymbolEntry[] = [];
    for (const impl of impls) {
      const implSymbols = this.getFileSymbols(impl.uri.toString());
      // Find the end boundary: next class-level symbol at same depth after the impl
      let implEnd = Infinity;
      for (const s of implSymbols) {
        if (s.line > impl.line && s.depth <= impl.depth && CLASS_LIKE.has(s.kind)) {
          implEnd = s.line;
          break;
        }
      }
      for (const s of implSymbols) {
        if (s.name === methodName && s.line > impl.line && s.line < implEnd
            && (s.kind === 'fun' || s.kind === 'composable')) {
          results.push(s);
        }
      }
    }
    return results;
  }

  // O(log N) prefix match + O(N) fuzzy fallback.
  // kindFilter: when provided, the 200-result cap applies only within that kind —
  // symbols of other kinds are skipped before the cap is checked.
  search(query: string, kindFilter?: string): SymbolEntry[] {
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
          if (kindFilter && e.kind !== kindFilter) continue;
          results.push(e);
          if (results.length >= 200) return results;
        }
      }
    }

    // ── 2. Fuzzy matches (sequential char match, scored) ─────────────────────
    // For queries ≥ 3 chars: trigram prefilter reduces O(N) scan to O(candidates).
    // For queries of 2 chars: no trigrams available — fall back to linear scan.
    const scored: { entries: SymbolEntry[]; score: number }[] = [];
    if (lower.length >= 3) {
      const candidates = this.trigramCandidates(lower);
      if (candidates !== null) {
        for (const name of candidates) {
          if (prefixNames.has(name)) continue;
          const score = fuzzyScore(lower, name.toLowerCase());
          if (score > 0) {
            const set = this.byName.get(name);
            if (set) {
              const entries = kindFilter ? [...set].filter(e => e.kind === kindFilter) : [...set];
              if (entries.length > 0) scored.push({ entries, score });
            }
          }
        }
      }
    } else if (lower.length === 2) {
      for (let i = 0; i < this.sortedOrig.length; i++) {
        const name = this.sortedOrig[i];
        if (prefixNames.has(name)) continue;
        const score = fuzzyScore(lower, this.sortedLower[i]);
        if (score > 0) {
          const set = this.byName.get(name);
          if (set) {
            const entries = kindFilter ? [...set].filter(e => e.kind === kindFilter) : [...set];
            if (entries.length > 0) scored.push({ entries, score });
          }
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { entries } of scored) {
      for (const e of entries) {
        results.push(e);
        if (results.length >= 200) return results;
      }
    }

    return results;
  }

  // Call once after bulk indexing — builds sorted list in one O(N log N) pass
  // instead of rebuilding lazily for every search() call during scan.
  //
  // Idempotent: skips the rebuild when nothing has changed since the last
  // finalize() call. Multiple scanners running concurrently can each call
  // finalize() without triggering N redundant sorts on a 50K-symbol index.
  finalize(): void {
    if (this._wordIndexReady && this._modificationsSinceFinalize === 0) return;
    this.rebuildSorted();
    this._wordIndexReady = true;
    this._modificationsSinceFinalize = 0;
  }

  /**
   * Returns file URIs that could reference `word`, or null when the index is
   * not ready (triggers full-scan fallback in FindUsagesEngine).
   *
   * Covers explicit imports, same-package files, wildcard imports, and
   * nested-symbol ancestor imports — no false negatives for these patterns.
   */
  getFilesContainingWord(word: string, target?: SymbolEntry): Set<string> | null {
    if (!this._wordIndexReady) return null;

    const candidates = new Set<string>(this.byWord.get(word) ?? []);
    const pkg = target?.packageName;

    if (pkg) {
      for (const u of this.byPkg.get(pkg) ?? []) candidates.add(u);
      for (const u of this.byWildcard.get(pkg) ?? []) candidates.add(u);
    }

    // Nested symbols (depth > 0): files that import any ancestor class also
    // qualify because they may access the nested member via OuterClass.Inner.
    if (target && target.depth > 0 && pkg) {
      const pkgPrefix = pkg + '.';
      const relativeFqn = target.fqn.startsWith(pkgPrefix)
        ? target.fqn.slice(pkgPrefix.length)
        : target.fqn;
      const ancestors = relativeFqn.split('.');
      for (let i = 0; i < ancestors.length - 1; i++) {
        for (const u of this.byWord.get(ancestors[i]) ?? []) candidates.add(u);
      }
    }

    return candidates;
  }

  getFileSymbols(uriString: string): SymbolEntry[] {
    return this.byFile.get(uriString) ?? EMPTY;
  }

  // For an override method, find the corresponding declaration in the parent interface/class.
  // Recurses through intermediate overrides to handle chain inheritance (A → B → C).
  findBaseMethod(
    entry: { name: string; uri: vscode.Uri; line: number; depth?: number },
    _recursionLevel = 0,
  ): SymbolEntry | undefined {
    if (_recursionLevel > 10) return undefined; // guard against degenerate hierarchies

    const fileSymbols = this.getFileSymbols(entry.uri.toString());
    let enclosingSupertypes: readonly string[] | undefined;
    for (const s of fileSymbols) {
      if (s.line > entry.line) break;
      if (CLASS_LIKE.has(s.kind)) {
        // Only adopt supertypes from the DIRECT enclosing class (depth - 1).
        // Without this filter a sibling inner class declared before the method
        // would overwrite the outer class's supertypes with its own (often empty).
        if (entry.depth === undefined || s.depth === entry.depth - 1) {
          enclosingSupertypes = s.supertypes;
        }
      }
    }
    if (!enclosingSupertypes || enclosingSupertypes.length === 0) return undefined;

    for (const supertype of enclosingSupertypes) {
      for (const supertypeEntry of this.lookup(supertype)) {
        if (!CLASS_LIKE.has(supertypeEntry.kind)) continue;
        const superSymbols = this.getFileSymbols(supertypeEntry.uri.toString());
        for (const s of superSymbols) {
          if (s.name === entry.name && (s.kind === 'fun' || s.kind === 'composable')) {
            if (!s.isOverride) return s; // found the original declaration
            // intermediate override — recurse up
            const deeper = this.findBaseMethod(s, _recursionLevel + 1);
            if (deeper) return deeper;
          }
        }
      }
    }
    return undefined;
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

  allEntries(): SymbolEntry[] {
    const out: SymbolEntry[] = [];
    for (const entries of this.byFile.values()) {
      for (const e of entries) out.push(e);
    }
    return out;
  }

  stats(): { files: number; symbols: number } {
    return { files: this.byFile.size, symbols: this.byFqn.size };
  }

  clear(): void {
    this.byName.clear();
    this.byFqn.clear();
    this.byFile.clear();
    this.bySuper.clear();
    this.byTrigram.clear();
    this.byWord.clear();
    this.byWordFile.clear();
    this.byPkg.clear();
    this.byWildcard.clear();
    this.fileImports.clear();
    this.pkgPool.clear();
    this.kindPool.clear();
    this.superPool.clear();
    this._wordIndexReady = false;
    this.sortedLower = [];
    this.sortedOrig  = [];
    this.dirty = true;
    this._modificationsSinceFinalize++;
  }

  removeExternal(): void {
    for (const key of [...this.byFile.keys()]) {
      if (key.startsWith('kotlin-jar:')) this.removeByKey(key);
    }
    // removeByKey deletes a FQN from byFqn when the removed entry was the current pointer.
    // If a workspace entry had the same FQN (overwritten by the JAR entry), it is now
    // missing from byFqn. Restore any such orphaned FQNs from the remaining byFile entries.
    for (const entries of this.byFile.values()) {
      for (const entry of entries) {
        if (!this.byFqn.has(entry.fqn)) this.byFqn.set(entry.fqn, entry);
      }
    }
  }

  // ── IndexStore access (save/restore without re-parsing) ───────────────────

  // Yields [uriString, entries] for every indexed file — used by IndexStore.save()
  *fileEntries(): Generator<[string, SymbolEntry[]]> {
    yield* this.byFile.entries();
  }

  // Returns raw import strings for a file — used by IndexStore.save() to persist the word index
  getFileImports(uriStr: string): string[] | undefined {
    return this.fileImports.get(uriStr);
  }

  // Directly restores pre-built entries from a snapshot — no ParsedFile needed
  restoreFile(uriString: string, entries: SymbolEntry[], imports: string[] = []): void {
    this.byFile.set(uriString, entries);
    for (const e of entries) {
      let set = this.byName.get(e.name);
      if (!set) { set = new Set(); this.byName.set(e.name, set); this.addToTrigram(e.name); }
      set.add(e);
      this.byFqn.set(e.fqn, e);
      if (e.supertypes) {
        for (const st of e.supertypes) {
          let sset = this.bySuper.get(st);
          if (!sset) { sset = new Set(); this.bySuper.set(st, sset); }
          sset.add(e);
        }
      }
    }
    this.dirty = true;
    this._modificationsSinceFinalize++;

    // ── Populate inverted word index (mirrors add() logic) ───────────────────
    const fileWords = new Set<string>();
    for (const e of entries) {
      this._addWordToFile(uriString, e.name, fileWords);
      if (e.supertypes) {
        for (const st of e.supertypes) this._addWordToFile(uriString, st, fileWords);
      }
    }
    for (const imp of imports) {
      if (imp.endsWith('.*')) {
        const prefix = imp.slice(0, -2);
        let s = this.byWildcard.get(prefix);
        if (!s) { s = new Set(); this.byWildcard.set(prefix, s); }
        s.add(uriString);
      } else {
        const seg = imp.split('.').pop();
        if (seg) this._addWordToFile(uriString, seg, fileWords);
      }
    }
    this.byWordFile.set(uriString, fileWords);
    const pkg = entries[0]?.packageName;
    if (pkg) {
      let s = this.byPkg.get(pkg);
      if (!s) { s = new Set(); this.byPkg.set(pkg, s); }
      s.add(uriString);
    }
    this.fileImports.set(uriString, imports);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private removeByKey(key: string): void {
    const entries = this.byFile.get(key);
    if (!entries) return;

    for (const entry of entries) {
      const set = this.byName.get(entry.name);
      if (set) {
        set.delete(entry); // O(1) — was O(n) indexOf
        if (set.size === 0) { this.byName.delete(entry.name); this.removeFromTrigram(entry.name); }
      }
      // Only delete if byFqn still points to THIS entry — a newer file may have overwritten it
      if (this.byFqn.get(entry.fqn) === entry) {
        this.byFqn.delete(entry.fqn);
        // Restore to a surviving entry with the same FQN (entry already removed from byName above)
        const survivors = this.byName.get(entry.name);
        if (survivors) {
          for (const s of survivors) {
            if (s.fqn === entry.fqn) { this.byFqn.set(entry.fqn, s); break; }
          }
        }
      }
      if (entry.supertypes) {
        for (const st of entry.supertypes) {
          const sset = this.bySuper.get(st);
          if (sset) {
            sset.delete(entry);
            if (sset.size === 0) this.bySuper.delete(st);
          }
        }
      }
    }

    // Remove from inverted word index
    const fileWords = this.byWordFile.get(key);
    if (fileWords) {
      for (const w of fileWords) {
        const s = this.byWord.get(w);
        if (s) { s.delete(key); if (s.size === 0) this.byWord.delete(w); }
      }
      this.byWordFile.delete(key);
    }
    // O(1) — package is the same on all entries
    const filePkg = entries[0]?.packageName;
    if (filePkg) {
      const s = this.byPkg.get(filePkg);
      if (s) { s.delete(key); if (s.size === 0) this.byPkg.delete(filePkg); }
    }
    // O(wildcards in file) — use stored imports rather than scanning all packages
    const savedImports = this.fileImports.get(key);
    if (savedImports) {
      for (const imp of savedImports) {
        if (imp.endsWith('.*')) {
          const prefix = imp.slice(0, -2);
          const s = this.byWildcard.get(prefix);
          if (s) { s.delete(key); if (s.size === 0) this.byWildcard.delete(prefix); }
        }
      }
      this.fileImports.delete(key);
    }

    this.byFile.delete(key);
    this.dirty = true;
  }

  // ── Word index helpers ────────────────────────────────────────────────────

  private _addWordToFile(uriStr: string, word: string, fileWords: Set<string>): void {
    let s = this.byWord.get(word);
    if (!s) { s = new Set(); this.byWord.set(word, s); }
    s.add(uriStr);
    fileWords.add(word);
  }

  // ── Trigram helpers ───────────────────────────────────────────────────────

  private addToTrigram(name: string): void {
    const lower = name.toLowerCase();
    for (let i = 0; i <= lower.length - 3; i++) {
      const t = lower.slice(i, i + 3);
      let set = this.byTrigram.get(t);
      if (!set) { set = new Set(); this.byTrigram.set(t, set); }
      set.add(name);
    }
  }

  private removeFromTrigram(name: string): void {
    const lower = name.toLowerCase();
    for (let i = 0; i <= lower.length - 3; i++) {
      const t = lower.slice(i, i + 3);
      const set = this.byTrigram.get(t);
      if (set) {
        set.delete(name);
        if (set.size === 0) this.byTrigram.delete(t);
      }
    }
  }

  // Returns names containing ALL trigrams in `lower`. Returns null when any
  // trigram has no bucket — impossible to find a match, skip scoring entirely.
  //
  // Optimisation: collect every bucket first, sort by size ascending, then
  // intersect smallest-first. The Set we materialise has at most |smallest|
  // entries — for a query like "ApiDataController", the rarest trigram
  // ("api"+"con"+"…") might bucket 30 names while a common one ("ata")
  // buckets 3000. Without the sort we'd clone the 3000-entry bucket and
  // shrink it; with the sort we clone 30 and probe the 3000 via O(1) `has`.
  private trigramCandidates(lower: string): Set<string> | null {
    const triCount = lower.length - 2;
    if (triCount <= 0) return null;
    // Collect bucket refs without copying. Bail immediately on any miss.
    const buckets: Set<string>[] = new Array(triCount);
    for (let i = 0; i < triCount; i++) {
      const bucket = this.byTrigram.get(lower.slice(i, i + 3));
      if (!bucket || bucket.size === 0) return null;
      buckets[i] = bucket;
    }
    // Sort ascending so the materialised Set is as small as possible.
    buckets.sort((a, b) => a.size - b.size);
    const candidates = new Set(buckets[0]);
    for (let i = 1; i < buckets.length; i++) {
      const probe = buckets[i];
      for (const name of candidates) {
        if (!probe.has(name)) candidates.delete(name);
      }
      if (candidates.size === 0) return null;
    }
    return candidates;
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

  private internKind(s: string): string {
    const hit = this.kindPool.get(s);
    if (hit) return hit;
    this.kindPool.set(s, s);
    return s;
  }

  private internSuper(s: string): string {
    const hit = this.superPool.get(s);
    if (hit) return hit;
    this.superPool.set(s, s);
    return s;
  }
}

const EMPTY: SymbolEntry[] = [];

// Sequential character match: "UR" matches "UserRepository".
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
