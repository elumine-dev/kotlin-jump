import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { scanForUsagesWithTarget, isExcluded, UsageResult } from './FindUsagesEngine';
import { isTestFun } from '../testing/KotlinTestController';

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
  data: { entry: SymbolEntry };
}

export class KotlinCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  // version increments on every evictFile() call; cached entries store the
  // version at which they were created so stale results self-evict on resolve.
  private _cacheVer = 0;
  private _cache = new Map<string, { ver: number; p: Promise<UsageResult[]> }>();
  private _fireTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly index: SymbolIndex) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const enabled = cfg.get<boolean>('codeLens', true);
    if (!enabled) return [];

    const testCodeLens = cfg.get<boolean>('testCodeLens', true);
    const extraSegs    = cfg.get<string[]>('testSourceSets', []);

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

      const range = new vscode.Range(entry.line, 0, entry.line, 0);

      // ── Test run lenses (pre-resolved — no async needed) ─────────────────
      const enclosingClass = classStack.at(-1);
      if (testCodeLens && isTestFun(entry, extraSegs) && !enclosingClass?.entry.isPrivate) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run',
          command: 'kotlin-jump.runTest',
          arguments: [entry.fqn, entry.moduleName],
        }));
      }

      // ── Run All lens on test class ────────────────────────────────────────
      if (testCodeLens && CLASS_LIKE.has(entry.kind) && (entry.isTestClass || classesWithTests.has(entry.fqn))) {
        lenses.push(new vscode.CodeLens(range, {
          title: '▶ Run All',
          command: 'kotlin-jump.runTestClass',
          arguments: [entry.fqn, entry.moduleName],
        }));
      }

      // ── Normal usage/implementation lens ─────────────────────────────────
      // Skip anything that lives exclusively in test context and is never called from prod code
      const isTestContext = isTestFun(entry, extraSegs)
        || (entry.kind === 'fun' && entry.isLifecycle)
        || (CLASS_LIKE.has(entry.kind) && (entry.isTestClass || classesWithTests.has(entry.fqn)));
      if (!isTestContext) {
        const lens = new vscode.CodeLens(range) as KotlinCodeLens;
        lens.data = { entry };
        lenses.push(lens);
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

    const { entry } = (lens as KotlinCodeLens).data;

    // Implementation count — O(1) from bySuper map
    let implCount = 0;
    if (CLASS_LIKE.has(entry.kind)) {
      implCount = this.index.lookupImplementations(entry.name).length;
    }

    // Usage count — async file scan (cached per FQN)
    let usageCount = 0;
    try {
      const cacheKey = entry.fqn; // FQN prevents collisions for same-named symbols in different classes
      if (!this._cache.has(cacheKey)) {
        const ver = this._cacheVer;
        const p = this._scanUsages(entry, token).then(results => {
          // If an eviction happened while this scan was running, self-evict so
          // the next resolveCodeLens call gets a fresh result instead of a stale one.
          if (this._cache.get(cacheKey)?.ver !== ver) this._cache.delete(cacheKey);
          return results;
        });
        this._cache.set(cacheKey, { ver, p });
      }
      const results = await this._cache.get(cacheKey)!.p;
      // Evict cancelled results — scan was aborted early, count is unreliable.
      if (token.isCancellationRequested) {
        this._cache.delete(cacheKey);
      }
      // Subtract 1 for the declaration itself
      usageCount = Math.max(0, results.length - 1);
    } catch {
      usageCount = 0;
    }

    if (token.isCancellationRequested) return lens;

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
    // Debounce: coalesce rapid successive file changes into one re-render
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

  private async _scanUsages(entry: SymbolEntry, token: vscode.CancellationToken): Promise<UsageResult[]> {
    // Apply the same exclude filter as ReferenceProvider so counts are consistent.
    // Pass entry as pre-resolved target — no openTextDocument() needed.
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));
    return scanForUsagesWithTarget(entry.name, entry, this.index, uriStrings, token);
  }
}
