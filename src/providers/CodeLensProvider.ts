import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { scanForUsagesWithTarget, isExcluded, UsageResult, withoutDeclarations } from './FindUsagesEngine';
import { isTestFun } from '../testing/TestAnnotations';
import { capMap, USAGE_CACHE_LIMIT } from '../util/boundedCache';
import { buildAllowFilter } from '../util/testFilter';

const LENS_KINDS = new Set<SymbolKind>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
  'fun', 'composable',
]);

const CLASS_LIKE = new Set<SymbolKind>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

interface KotlinCodeLens extends vscode.CodeLens {
  data: { entry: SymbolEntry; enclosingKind?: string; usageOnly?: boolean };
}

// One background scan per FQN, shared by every lens request that needs it.
// The scan runs on its own token: it is cancelled only once every request
// waiting on it has been cancelled, so a lens re-request never inherits the
// partial count of a scan cut short by the previous request.
interface UsageCacheEntry {
  ver: number;
  p: Promise<UsageResult[]>;
  results?: UsageResult[];
  cts: vscode.CancellationTokenSource;
  waiters: number;
}

export class KotlinCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  // version increments on every evictFile() call; cached entries store the
  // version at which they were created so stale results self-evict on resolve.
  private _cacheVer = 0;
  private _cache = new Map<string, UsageCacheEntry>();
  private _fireTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly index: SymbolIndex) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const enabled = cfg.get<boolean>('codeLens', true);
    if (!enabled) return [];

    const testCodeLens = cfg.get<boolean>('testCodeLens', true);
    const extraSegs    = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);

    const symbols = this.index.getFileSymbols(document.uri.toString());
    const lenses: (KotlinCodeLens | vscode.CodeLens)[] = [];
    const classStack: { kind: string; depth: number; entry: SymbolEntry }[] = [];

    // Pre-scan: find class FQNs with @Test methods (covers JUnit 5 classes without @RunWith)
    const classesWithTests = new Set<string>();
    for (const sym of symbols) {
      if (sym.isTest && (sym.kind === 'fun' || sym.kind === 'composable') && !sym.isPrivate) {
        const parts = sym.fqn.split('.');
        if (parts.length > 1) classesWithTests.add(parts.slice(0, -1).join('.'));
      }
    }

    for (const entry of symbols) {
      while (classStack.length > 0 && classStack[classStack.length - 1].depth >= entry.depth) {
        classStack.pop();
      }

      // Skip enum entries (enum kind nested inside another enum)
      if (entry.kind === 'enum' && classStack.length > 0 && classStack[classStack.length - 1].kind === 'enum') {
        if (CLASS_LIKE.has(entry.kind)) classStack.push({ kind: entry.kind, depth: entry.depth, entry });
        continue;
      }

      if (!LENS_KINDS.has(entry.kind)) {
        if (CLASS_LIKE.has(entry.kind)) classStack.push({ kind: entry.kind, depth: entry.depth, entry });
        continue;
      }
      // Skip synthetic anonymous-object entries ($anon$N — no named symbol to display)
      if (entry.name.startsWith('$')) continue;
      // An unnamed companion is "Companion" only for the Outline: a usage count
      // for that word would be noise on the `companion object` line.
      if (entry.isCompanion) {
        classStack.push({ kind: entry.kind, depth: entry.depth, entry });
        continue;
      }

      const range = new vscode.Range(entry.line, 0, entry.line, 0);

      // ── Test run lenses (pre-resolved — no async needed) ─────────────────
      const enclosingClass = classStack.at(-1);
      if (testCodeLens && isTestFun(entry, extraSegs) && !enclosingClass?.entry.isPrivate) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run',
          command: 'kotlin-jump.runTest',
          // URI pins the run to this file — same-FQN tests can exist in
          // another workspace root (issue #3).
          arguments: [entry.fqn, entry.moduleName, document.uri.toString()],
        }));
      }

      // ── Run All lens on test class ────────────────────────────────────────
      if (testCodeLens && CLASS_LIKE.has(entry.kind) && (entry.isTestClass || classesWithTests.has(entry.fqn))) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run All',
          command: 'kotlin-jump.runTestClass',
          arguments: [entry.fqn, entry.moduleName, document.uri.toString()],
        }));
      }

      // ── Normal usage/implementation lens ─────────────────────────────────
      // Skip anything that lives exclusively in test context and is never called from prod code
      const isTestContext = isTestFun(entry, extraSegs)
        || (entry.kind === 'fun' && entry.isLifecycle)
        || (CLASS_LIKE.has(entry.kind) && (entry.isTestClass || classesWithTests.has(entry.fqn)));
      if (!isTestContext && !entry.isOverride && !entry.isPrivate) {
        const isFun = entry.kind === 'fun' || entry.kind === 'composable';
        // For interface / abstract members, OverrideGutterProvider already
        // shows the ⬇ "N implementations" arrow. We must NOT add a normal
        // lens (it would duplicate the implementation count) but we DO want
        // a usage count above the same line — IntelliJ shows both side by
        // side ("1 Usage  1 Implementation"), and a previous version of
        // this provider shipped without the usage count which made the
        // interface/method declarations feel orphaned.
        const isAbstractFun  = isFun && (enclosingClass?.kind === 'interface' || entry.isAbstract);
        const isAbstractType = entry.kind === 'interface' || entry.kind === 'sealedClass'
          || (entry.kind === 'class' && entry.isAbstract);
        if (isAbstractFun || isAbstractType) {
          const lens = new vscode.CodeLens(range) as KotlinCodeLens;
          lens.data = { entry, enclosingKind: enclosingClass?.kind, usageOnly: true };
          lenses.push(lens);
        } else {
          const lens = new vscode.CodeLens(range) as KotlinCodeLens;
          lens.data = { entry, enclosingKind: enclosingClass?.kind };
          lenses.push(lens);
        }
      }

      if (CLASS_LIKE.has(entry.kind)) {
        classStack.push({ kind: entry.kind, depth: entry.depth, entry });
      }
    }

    return lenses;
  }

  async resolveCodeLens(
    lens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens> {
    // Test lenses (▶ Run / ▶ Run All) have no .data — already resolved, return as-is
    if (!(lens as KotlinCodeLens).data) return lens;

    const { entry, usageOnly } = (lens as KotlinCodeLens).data;

    // ── usageOnly lens (interface / abstract class / sealed class) ────────────
    // OverrideGutterProvider handles the ⬇ implementations arrow; we only show usage count.
    if (usageOnly) {
      const usageCount = await this._usageCount(entry, token);
      if (usageCount === undefined) return lens;
      lens.command = {
        title: `${usageCount} ${usageCount === 1 ? 'usage' : 'usages'}`,
        command: 'kotlin-jump.codeLensAction',
        arguments: [entry.uri, entry.line, entry.character, entry.name, entry.fqn],
      };
      return lens;
    }

    // ── Class/interface: implementation count ─────────────────────────────────
    // Walks the whole subtree: a class implementing this interface through an
    // intermediate one is an implementation too, and counting only the direct
    // namers put "2 implementations" on an interface 33 classes implement.
    // The same test-source filter the picker and the gutter lens apply: the
    // count used to include implementors the list then refused to show.
    let implCount = 0;
    if (CLASS_LIKE.has(entry.kind)) {
      const allow = buildAllowFilter(entry.uri.fsPath);
      implCount = this.index.lookupImplementationsDeep(entry).filter(e => allow(e.uri.path)).length;
    }

    // ── Usage count — async file scan (cached per FQN) ────────────────────────
    const usageCount = await this._usageCount(entry, token);
    if (usageCount === undefined) return lens;

    // Build title
    const parts: string[] = [];
    if (usageCount > 0) {
      parts.push(`${usageCount} ${usageCount === 1 ? 'usage' : 'usages'}`);
    } else {
      parts.push('0 usages');
    }
    if (implCount > 0) {
      parts.push(`${implCount} ${implCount === 1 ? 'implementation' : 'implementations'}`);
    }

    lens.command = {
      title: parts.join(' | '),
      command: 'kotlin-jump.codeLensAction',
      arguments: [entry.uri, entry.line, entry.character, entry.name, entry.fqn],
    };

    return lens;
  }

  /** Full refresh — clears entire cache. Use for config changes and initial load. */
  refresh(): void {
    if (this._fireTimer) { clearTimeout(this._fireTimer); this._fireTimer = undefined; }
    this._cacheVer++;
    this._cache.clear();
    this._onDidChange.fire();
  }

  /**
   * Surgical eviction — only evicts cache entries for symbols defined in the
   * changed file, then schedules a debounced re-render. Increments the version
   * counter so any in-flight Promise for those symbols self-evicts on resolve
   * instead of caching a potentially stale result.
   */
  evictFile(uriStr: string): void {
    this._cacheVer++;
    const symbols = this.index.getFileSymbols(uriStr);
    for (const sym of symbols) {
      this._cache.delete(sym.fqn);
    }
    // A usage count for a symbol declared in A depends on every other file:
    // add a call to foo() in B, save, and A kept reading "1 usage". Drop the
    // entries whose results reached into this file (a usage removed) and
    // those whose name appears in its text (a usage added). The open document
    // is read synchronously; a file changed on disk (checkout) is read in the
    // background so the eviction stays surgical, not a wholesale clear.
    for (const [fqn, c] of this._cache) {
      if (c.results?.some(r => r.uriString === uriStr)) this._cache.delete(fqn);
    }
    if (this._cache.size > 0) {
      const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr);
      if (open) {
        this._evictNamedIn(open.getText());
      } else {
        void vscode.workspace.fs.readFile(vscode.Uri.parse(uriStr)).then(
          bytes => { if (this._evictNamedIn(new TextDecoder().decode(bytes))) this._scheduleFire(); },
          () => { /* deleted file: its usages were covered by the results check above */ },
        );
      }
    }
    this._scheduleFire();
  }

  /** @returns whether anything was evicted. */
  private _evictNamedIn(text: string): boolean {
    let evicted = false;
    for (const fqn of [...this._cache.keys()]) {
      const name = fqn.slice(fqn.lastIndexOf('.') + 1);
      if (text.includes(name) && wordRe(name).test(text)) { this._cache.delete(fqn); evicted = true; }
    }
    return evicted;
  }

  // Debounce: coalesce rapid successive file changes into one re-render
  private _scheduleFire(): void {
    if (this._fireTimer) clearTimeout(this._fireTimer);
    this._fireTimer = setTimeout(() => {
      this._fireTimer = undefined;
      this._onDidChange.fire();
    }, 80);
  }

  dispose(): void {
    if (this._fireTimer) clearTimeout(this._fireTimer);
    this._onDidChange.dispose();
  }

  /**
   * Returns the cached scan results for a given FQN, if available.
   * Used by codeLensAction to avoid re-scanning when the user clicks a lens.
   */
  getCachedResults(fqn: string): Promise<UsageResult[]> | undefined {
    return this._cache.get(fqn)?.p;
  }

  /**
   * Usage count for `entry`, or undefined once `token` is cancelled: the
   * caller then leaves the lens unresolved and VS Code asks again later.
   */
  private async _usageCount(entry: SymbolEntry, token: vscode.CancellationToken): Promise<number | undefined> {
    const cacheKey = entry.fqn;
    let shared = this._cache.get(cacheKey);
    if (!shared) {
      const cts = new vscode.CancellationTokenSource();
      const created: UsageCacheEntry = { ver: this._cacheVer, cts, waiters: 0, p: Promise.resolve([]) };
      created.p = this._scanUsages(entry, cts.token).then(
        results => {
          if (this._cache.get(cacheKey) !== created) return results; // evicted meanwhile
          // A cancelled scan stopped early: its partial count must never be cached.
          if (cts.token.isCancellationRequested || created.ver !== this._cacheVer) this._cache.delete(cacheKey);
          else created.results = results;
          return results;
        },
        err => {
          if (this._cache.get(cacheKey) === created) this._cache.delete(cacheKey);
          throw err;
        },
      );
      this._cache.set(cacheKey, created);
      // Keyed by symbol and never trimmed, this grew with every lens the user
      // ever scrolled past: 23 628 of them on the reference project, each
      // holding a usage list. A scan still running is never dropped.
      capMap(this._cache, USAGE_CACHE_LIMIT, e => e.results !== undefined && e.waiters === 0);
      shared = created;
    }
    const entryRef = shared;
    entryRef.waiters++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entryRef.waiters--;
      // Last interested request gone while the scan still runs: stop it.
      if (entryRef.waiters === 0 && entryRef.results === undefined) {
        entryRef.cts.cancel();
        if (this._cache.get(cacheKey) === entryRef) this._cache.delete(cacheKey);
      }
    };
    if (token.isCancellationRequested) { release(); return undefined; }
    const sub = token.onCancellationRequested?.(release);
    let results: UsageResult[];
    try { results = await entryRef.p; } catch { results = []; }
    finally { sub?.dispose(); }
    release();
    if (token.isCancellationRequested) return undefined;
    return withoutDeclarations(results, this._declarationsOf(entry)).length;
  }

  /**
   * Every declaration of this name, whatever type carries it.
   *
   * An `override fun getAudio(…)` in an implementing class is a declaration,
   * not a call: the lens already counts it under "3 implementations", and
   * counting it again under "usages" made an interface method with 3 real
   * callers read "8 usages", five of which were the override lines.
   * Filtering on the FQN could not see them, since an override carries its
   * own class in its FQN.
   */
  private _declarationsOf(entry: SymbolEntry): SymbolEntry[] {
    const all = this.index.lookup(entry.name);
    return all.length > 0 ? all : [entry];
  }

  private async _scanUsages(entry: SymbolEntry, token: vscode.CancellationToken): Promise<UsageResult[]> {
    // Apply the same exclude filter as ReferenceProvider so counts are consistent.
    // Pass entry as pre-resolved target — no openTextDocument() needed.
    // `private` has no cross-file callers in valid code — scan only the
    // declaring file. The lens count is then unambiguous and the
    // background scan finishes in a few ms.
    const uriStrings = entry.isPrivate
      ? [entry.uri.toString()]
      : this.index.fileUriStrings().filter(u => !isExcluded(u));
    return scanForUsagesWithTarget(entry.name, entry, this.index, uriStrings, token);
  }
}

function wordRe(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, m => '\\' + m);
  return new RegExp('\\b' + escaped + '\\b');
}
