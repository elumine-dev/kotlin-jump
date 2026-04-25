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
  data: { entry: SymbolEntry; enclosingKind?: string; usageOnly?: boolean };
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
      // Skip synthetic anonymous-object entries ($anon$N — no named symbol to display)
      if (entry.name.startsWith('$')) continue;

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
      let usageCount = 0;
      try {
        const cacheKey = entry.fqn;
        if (!this._cache.has(cacheKey)) {
          const ver = this._cacheVer;
          const p = this._scanUsages(entry, token).then(results => {
            if (this._cache.get(cacheKey)?.ver !== ver) this._cache.delete(cacheKey);
            return results;
          });
          this._cache.set(cacheKey, { ver, p });
        }
        const results = await this._cache.get(cacheKey)!.p;
        if (token.isCancellationRequested) { this._cache.delete(cacheKey); }
        usageCount = Math.max(0, results.length - 1);
      } catch { usageCount = 0; }
      if (token.isCancellationRequested) return lens;
      lens.command = {
        title: `${usageCount} ${usageCount === 1 ? 'usage' : 'usages'}`,
        command: 'kotlin-jump.codeLensAction',
        arguments: [entry.uri, entry.line, entry.character, entry.name, entry.fqn],
      };
      return lens;
    }

    // ── Class/interface: implementation count (O(1)) ───────────────────────────
    let implCount = 0;
    if (CLASS_LIKE.has(entry.kind)) {
      const allImpls   = this.index.lookupImplementations(entry.name);
      const allParents = this.index.lookup(entry.name).filter(e => CLASS_LIKE.has(e.kind));
      if (allParents.length <= 1) {
        implCount = allImpls.length;
      } else {
        implCount = allImpls.filter(impl =>
          impl.packageName === entry.packageName ||
          !allParents.some(p => p.packageName === impl.packageName)
        ).length;
      }
    }

    // ── Usage count — async file scan (cached per FQN) ────────────────────────
    let usageCount = 0;
    try {
      const cacheKey = entry.fqn;
      if (!this._cache.has(cacheKey)) {
        const ver = this._cacheVer;
        const p = this._scanUsages(entry, token).then(results => {
          if (this._cache.get(cacheKey)?.ver !== ver) this._cache.delete(cacheKey);
          return results;
        });
        this._cache.set(cacheKey, { ver, p });
      }
      const results = await this._cache.get(cacheKey)!.p;
      if (token.isCancellationRequested) {
        this._cache.delete(cacheKey);
      }
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
