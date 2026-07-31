import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { GradleTestRunner, TestSpec } from './GradleTestRunner';
import { Logger } from '../util/logger';
// Moved to a dependency-free module so CodeLensProvider.ts (web-reachable)
// can use isTestFun without transitively pulling GradleTestRunner
// (child_process/fs) into the web bundle. Re-exported here for existing
// importers of this file.
import { DEFAULT_TEST_SEGS, isTestFun } from './TestAnnotations';
export { DEFAULT_TEST_SEGS, isTestFun } from './TestAnnotations';

export class KotlinTestController implements vscode.Disposable {
  private readonly ctrl: vscode.TestController;
  private readonly runner: GradleTestRunner;
  private readonly watcher: vscode.FileSystemWatcher;
  // Track class FQN → TestItem for incremental refresh
  private readonly classItems = new Map<string, vscode.TestItem>();
  // Track inner class → parent class ID for correct nesting/removal
  private readonly classParents = new Map<string, string>();
  // Items that failed in the last run — used by the "Run Failed" profile
  private lastFailedItems: vscode.TestItem[] = [];

  constructor(
    private readonly index: SymbolIndex,
    context: vscode.ExtensionContext,
    private readonly log: Logger,
  ) {
    this.ctrl = vscode.tests.createTestController('kotlin-jump.tests', 'Kotlin Tests');
    this.runner = new GradleTestRunner(log, context.workspaceState);

    // ── Run profile (default) ──────────────────────────────────────────────
    this.ctrl.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (req, tok) => this.runHandler(req, tok),
      true,
    );

    // ── Watch profile (continuous run) ────────────────────────────────────
    const watchProfile = this.ctrl.createRunProfile(
      'Watch',
      vscode.TestRunProfileKind.Run,
      (req, tok) => this.watchHandler(req, tok),
      false,
    );
    watchProfile.supportsContinuousRun = true;

    // ── Coverage profile ──────────────────────────────────────────────────
    this.ctrl.createRunProfile(
      'Coverage',
      vscode.TestRunProfileKind.Coverage,
      (req, tok) => this.coverageHandler(req, tok),
      false,
    );

    // ── Run Failed profile ────────────────────────────────────────────────
    this.ctrl.createRunProfile(
      'Run Failed',
      vscode.TestRunProfileKind.Run,
      (_req, tok) => {
        if (this.lastFailedItems.length === 0) {
          this.log.info('[test:run-failed] no failed items from last run');
          return;
        }
        this.log.info(`[test:run-failed] re-running ${this.lastFailedItems.length} failed item(s)`);
        return this.runHandler(new vscode.TestRunRequest(this.lastFailedItems), tok);
      },
      false,
    );

    this.log.info('[test] KotlinTestController initialised — profiles: Run, Watch, Coverage, Run Failed');

    // ── Lazy resolution ───────────────────────────────────────────────────
    this.ctrl.resolveHandler = async (item) => {
      if (!item) {
        this.log.info('[test:resolve] root → discoverAllClasses');
        await this.discoverAllClasses();
      } else if (item.id.startsWith('cls|')) {
        this.log.info(`[test:resolve] class "${item.label}" → discoverMethods`);
        await this.discoverMethodsInClass(item);
      }
    };

    // ── Manual refresh ────────────────────────────────────────────────────
    this.ctrl.refreshHandler = async () => {
      this.log.info('[test:refresh] manual refresh — clearing tree');
      this.ctrl.items.replace([]);
      this.classItems.clear();
      this.classParents.clear();
      await this.discoverAllClasses();
    };

    // ── Incremental file watcher ──────────────────────────────────────────
    // onChange/onCreate are driven by notifyFileIndexed() (called from FileWatcher after
    // index update) so the index is always up to date when we refresh.
    // onDidDelete fires immediately — no index update needed for removals.
    // Java too: a JUnit class in a .java file must refresh the Test Explorer.
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{kt,java}');
    this.watcher.onDidDelete(uri => this.removeFileTests(uri));

    context.subscriptions.push(this.ctrl, this.watcher);
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  private async discoverAllClasses(): Promise<void> {
    const segs = this.getExtraSegs();
    let classCount = 0;
    for (const uriStr of this.index.fileUriStrings()) {
      if (!isTestFile(uriStr, segs)) continue;
      const entries = this.index.getFileSymbols(uriStr);
      classCount += this.buildClassItems(entries, segs);
    }
    this.log.info(`[test:discover] discovered ${classCount} test class(es)`);
  }

  /**
   * Builds TestItems for one file's entries. Returns the count of classes with direct test methods.
   * Handles nested inner test classes: outer classes are created as containers even if they have
   * no direct @Test methods themselves.
   */
  private buildClassItems(entries: SymbolEntry[], segs: string[]): number {
    const allClassEntries = new Map<string, SymbolEntry>(
      entries.filter(e => isClassLike(e.kind) && !e.isPrivate).map(e => [e.fqn, e]),
    );

    // Find classes with at least one direct test method (depth + 1, same FQN prefix)
    const classesWithTests = new Set<string>();
    for (const [fqn, classEntry] of allClassEntries) {
      const prefix = fqn + '.';
      if (entries.some(e => isTestFun(e, segs) && e.depth === classEntry.depth + 1 && e.fqn.startsWith(prefix))) {
        classesWithTests.add(fqn);
      }
    }
    if (classesWithTests.size === 0) return 0;

    // Expand: also include ancestor containers required for nesting (outer classes with no @Test)
    const allFqns = new Set<string>(classesWithTests);
    for (const fqn of classesWithTests) {
      let entry = allClassEntries.get(fqn);
      while (entry) {
        const parentFqn = deriveParentClassFqn(entry.fqn, entry.packageName);
        if (parentFqn && allClassEntries.has(parentFqn)) { allFqns.add(parentFqn); entry = allClassEntries.get(parentFqn); }
        else break;
      }
    }

    // Process outer classes before inner classes so parents exist when children attach
    const sorted = [...allFqns].map(fqn => allClassEntries.get(fqn)!).sort((a, b) => a.fqn.length - b.fqn.length);

    for (const classEntry of sorted) {
      const classItem = this.getOrCreateClassItem(classEntry, allFqns);
      if (!classesWithTests.has(classEntry.fqn)) continue; // container only — no direct tests

      const prefix = classEntry.fqn + '.';
      const methods = entries.filter(e => isTestFun(e, segs) && e.depth === classEntry.depth + 1 && e.fqn.startsWith(prefix));
      this.log.debug(`[test:discover] class ${classEntry.name} — ${methods.length} test method(s)`);
      for (const method of methods) this.upsertMethodItem(classItem, method);
    }

    return classesWithTests.size;
  }

  private async discoverMethodsInClass(classItem: vscode.TestItem): Promise<void> {
    const { fqn: classFqn, uriStr } = parseItemId(classItem.id);
    // Resolve within the item's own file — lookupFqn keeps one entry per FQN,
    // so same-FQN classes across workspace roots would resolve arbitrarily.
    const fileEntries = this.index.getFileSymbols(uriStr);
    const classEntry = fileEntries.find(e => e.fqn === classFqn);
    if (!classEntry) {
      this.log.warn(`[test:discover] class not found in index: ${classFqn} (${uriStr})`);
      return;
    }

    const segs = this.getExtraSegs();
    const fqnPrefix = classEntry.fqn + '.';
    const methods = fileEntries.filter(e =>
      isTestFun(e, segs) && e.depth === classEntry.depth + 1 && e.fqn.startsWith(fqnPrefix),
    );

    this.log.info(`[test:discover] class "${classEntry.name}" — ${methods.length} methods: [${methods.map(m => m.name).join(', ')}]`);
    for (const method of methods) {
      this.upsertMethodItem(classItem, method);
    }
  }

  // ── Incremental refresh ───────────────────────────────────────────────────

  refreshFileTests(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    const segs = this.getExtraSegs();
    if (!isTestFile(uriStr, segs)) {
      this.log.debug(`[test:watcher] not a test file — skipping: ${uri.fsPath}`);
      this.removeFileTests(uri);
      return;
    }

    this.log.info(`[test:watcher] test file changed — refreshing: ${uri.fsPath}`);
    const entries = this.index.getFileSymbols(uriStr);
    if (entries.length === 0) {
      this.log.warn(`[test:watcher] no symbols found — removing: ${uri.fsPath}`);
      this.removeFileTests(uri);
      return;
    }

    // Remove existing items for this file (leaves-first to avoid dangling children), then rebuild
    const toRemove = [...this.classItems.entries()]
      .filter(([, item]) => item.uri?.toString() === uriStr)
      .map(([id]) => id)
      .sort((a, b) => b.length - a.length);
    for (const classId of toRemove) this.deleteClassItem(classId);

    this.buildClassItems(entries, segs);
  }

  removeFileTests(uri: vscode.Uri): void {
    const uriStr = uri.toString();
    const toRemove = [...this.classItems.entries()]
      .filter(([, item]) => item.uri?.toString() === uriStr)
      .map(([id]) => id)
      .sort((a, b) => b.length - a.length); // leaves-first
    for (const classId of toRemove) this.deleteClassItem(classId);
    if (toRemove.length > 0) this.log.info(`[test:watcher] removed ${toRemove.length} class(es) for: ${uri.fsPath}`);
  }

  private deleteClassItem(classId: string): void {
    const parentId = this.classParents.get(classId);
    const parentItem = parentId ? this.classItems.get(parentId) : undefined;
    if (parentItem) {
      parentItem.children.delete(classId);
    } else {
      this.ctrl.items.delete(classId);
    }
    this.classItems.delete(classId);
    this.classParents.delete(classId);
  }

  // ── TestItem helpers ──────────────────────────────────────────────────────

  private getOrCreateClassItem(classEntry: SymbolEntry, allFqns: Set<string>): vscode.TestItem {
    const uriStr = classEntry.uri.toString();
    const id = itemId('cls', classEntry.fqn, uriStr);
    let item = this.classItems.get(id);
    if (!item) {
      item = this.ctrl.createTestItem(id, classEntry.name, classEntry.uri);
      item.canResolveChildren = true;
      item.sortText = classEntry.name.toLowerCase();

      const parentFqn = deriveParentClassFqn(classEntry.fqn, classEntry.packageName);
      const parentItem = parentFqn && allFqns.has(parentFqn)
        ? this.classItems.get(itemId('cls', parentFqn, uriStr))
        : undefined;

      if (parentItem) {
        parentItem.children.add(item);
        this.classParents.set(id, parentItem.id);
      } else {
        this.ctrl.items.add(item);
      }
      this.classItems.set(id, item);
    }
    return item;
  }

  private upsertMethodItem(classItem: vscode.TestItem, entry: SymbolEntry): vscode.TestItem {
    const id = itemId('mth', entry.fqn, entry.uri.toString());
    let item = classItem.children.get(id);
    if (!item) {
      item = this.ctrl.createTestItem(id, entry.name, entry.uri);
      item.range = new vscode.Range(entry.line, entry.character, entry.line, entry.character + entry.name.length);
      item.sortText = entry.name.toLowerCase();
      classItem.children.add(item);
    }
    return item;
  }

  // ── Run handlers ──────────────────────────────────────────────────────────

  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);

    // Intercept run.failed() to track items for the "Run Failed" profile
    const failedItems: vscode.TestItem[] = [];
    const origFailed = run.failed.bind(run);
    (run as { failed: typeof run.failed }).failed = (item, msg, dur) => {
      failedItems.push(item);
      return origFailed(item, msg, dur);
    };

    const specs = this.collectSpecs(request);

    if (specs.length === 0) {
      this.log.warn('[test:run] runHandler called but collectSpecs returned 0 specs');
      run.end();
      return;
    }

    const [toRun, toSkip] = partition(specs, s => !s.entry.isIgnored);
    if (toSkip.length > 0) {
      this.log.info(`[test:run] skipping ${toSkip.length} @Ignore/@Disabled test(s): [${toSkip.map(s => s.entry.name).join(', ')}]`);
      for (const s of toSkip) run.skipped(s.item);
    }
    this.log.info(`[test:run] running ${toRun.length} test(s): [${toRun.map(s => s.entry.name).join(', ')}]`);

    try {
      await this.runner.runAll(toRun, run, token, this.index);
    } finally {
      run.end();
      this.lastFailedItems = failedItems;
      if (failedItems.length > 0)
        this.log.info(`[test:run] ${failedItems.length} failed — available via "Run Failed" profile`);
    }
  }

  private async watchHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (!request.continuous) { return this.runHandler(request, token); }

    const run = this.ctrl.createTestRun(request);
    const specs = this.collectSpecs(request);

    const runTests = async () => {
      if (token.isCancellationRequested) return;
      const [toRun, toSkip] = partition(specs, s => !s.entry.isIgnored);
      for (const s of toSkip) run.skipped(s.item);
      await this.runner.runAll(toRun, run, token, this.index);
    };

    await runTests();

    const sub = this.watcher.onDidChange(async (uri) => {
      const segs = this.getExtraSegs();
      if (isTestFile(uri.toString(), segs)) await runTests();
    });
    token.onCancellationRequested(() => { sub.dispose(); run.end(); });
  }

  private async coverageHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const run = this.ctrl.createTestRun(request);
    const specs = this.collectSpecs(request);
    const [toRun, toSkip] = partition(specs, s => !s.entry.isIgnored);
    for (const s of toSkip) run.skipped(s.item);
    try {
      await this.runner.runWithCoverage(toRun, run, token, this.index);
    } finally {
      run.end();
    }
  }

  // ── Collect TestSpecs from a TestRunRequest ───────────────────────────────

  private collectSpecs(request: vscode.TestRunRequest): TestSpec[] {
    const segs = this.getExtraSegs();
    const specs: TestSpec[] = [];
    const excludeIds = new Set((request.exclude ?? []).map(i => i.id));

    const visitItem = (item: vscode.TestItem) => {
      if (excludeIds.has(item.id)) return;
      if (item.id.startsWith('mth|')) {
        // Resolve within the item's own file, not via lookupFqn — same-FQN
        // tests in another workspace root would run against the wrong
        // Gradle project (issue #3).
        const { fqn, uriStr } = parseItemId(item.id);
        const entry = this.index.getFileSymbols(uriStr).find(e => e.fqn === fqn);
        if (entry && isTestFun(entry, segs)) specs.push({ item, entry });
        else this.log.warn(`[test:run] stale test item skipped: ${fqn} (${uriStr})`);
        return;
      }
      for (const [, child] of item.children) visitItem(child);
    };

    if (request.include) {
      for (const item of request.include) visitItem(item);
    } else {
      for (const [, item] of this.ctrl.items) visitItem(item);
    }

    return specs;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private getExtraSegs(): string[] {
    return vscode.workspace.getConfiguration('kotlinJump').get<string[]>('testSourceSets', []);
  }

  /** Expose the controller so extension.ts can pass it to commands */
  getController(): vscode.TestController { return this.ctrl; }

  /** Lookup a TestItem by method FQN — used by Code Lens commands.
   *  `uriStr` pins the lookup to one file so same-FQN tests in another
   *  workspace root are not matched; without it, first match wins. */
  findMethodItem(fqn: string, uriStr?: string): vscode.TestItem | undefined {
    if (uriStr) return findInTree(this.ctrl.items, itemId('mth', fqn, uriStr));
    return findInTreeByPrefix(this.ctrl.items, `mth|${fqn}|`);
  }

  /** Lookup a TestItem by class FQN — used by Code Lens Run All command */
  findClassItem(fqn: string, uriStr?: string): vscode.TestItem | undefined {
    if (uriStr) return this.classItems.get(itemId('cls', fqn, uriStr));
    const prefix = `cls|${fqn}|`;
    for (const [id, item] of this.classItems) {
      if (id.startsWith(prefix)) return item;
    }
    return undefined;
  }

  /** Run one or more TestItems directly — used by Code Lens commands */
  async runItems(items: vscode.TestItem[]): Promise<void> {
    const request = new vscode.TestRunRequest(items);
    const cts = new vscode.CancellationTokenSource();
    await this.runHandler(request, cts.token);
    cts.dispose();
  }

  /** Called by FileWatcher after the index is updated — replaces the 200ms setTimeout hack. */
  notifyFileIndexed(uri: vscode.Uri): void {
    this.refreshFileTests(uri);
  }

  /**
   * Called after the full workspace scan (scanAll / rescan) completes.
   * Triggers a discovery pass over the now-populated index so tests are
   * visible in the Test Explorer even if resolveHandler ran on an empty index.
   */
  notifyScanComplete(): void {
    this.log.info('[test:discover] post-scan discovery pass');
    void this.discoverAllClasses();
  }

  dispose(): void {
    this.watcher.dispose();
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * TestItem ids embed the file URI so two same-FQN classes in different
 * workspace roots get distinct items (issue #3: the wrong root's Gradle
 * project was resolved, running `test` instead of `testDebugUnitTest`).
 * FQNs never contain `|`, so the first two `|` delimit kind and fqn; the
 * rest is the URI (which may itself contain `|` in theory).
 */
function itemId(kind: 'cls' | 'mth', fqn: string, uriStr: string): string {
  return `${kind}|${fqn}|${uriStr}`;
}

function parseItemId(id: string): { fqn: string; uriStr: string } {
  const first = id.indexOf('|');
  const second = id.indexOf('|', first + 1);
  return { fqn: id.slice(first + 1, second), uriStr: id.slice(second + 1) };
}

function isTestFile(uriStr: string, extraSegs: string[]): boolean {
  const segs = extraSegs.length > 0 ? [...DEFAULT_TEST_SEGS, ...extraSegs] : DEFAULT_TEST_SEGS;
  return segs.some(s => uriStr.includes(s));
}

/**
 * Given a class FQN and its package, returns the FQN of its enclosing class, or undefined
 * if the class is a top-level class. Used to detect and build inner-class nesting in the Test Explorer.
 *
 * Example: fqn="com.example.OuterTest.InnerTest", pkg="com.example" → "com.example.OuterTest"
 */
function deriveParentClassFqn(fqn: string, pkg: string): string | undefined {
  const local = pkg ? fqn.slice(pkg.length + 1) : fqn;
  const parts = local.split('.');
  if (parts.length < 2) return undefined;
  const parentLocal = parts.slice(0, -1).join('.');
  return pkg ? `${pkg}.${parentLocal}` : parentLocal;
}

function isClassLike(kind: string): boolean {
  return kind === 'class' || kind === 'dataClass' || kind === 'sealedClass'
    || kind === 'object' || kind === 'interface' || kind === 'annotation';
}

function partition<T>(arr: T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [], no: T[] = [];
  for (const x of arr) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

function findInTree(
  collection: vscode.TestItemCollection,
  id: string,
): vscode.TestItem | undefined {
  for (const [, item] of collection) {
    if (item.id === id) return item;
    const found = findInTree(item.children, id);
    if (found) return found;
  }
  return undefined;
}

function findInTreeByPrefix(
  collection: vscode.TestItemCollection,
  idPrefix: string,
): vscode.TestItem | undefined {
  for (const [, item] of collection) {
    if (item.id.startsWith(idPrefix)) return item;
    const found = findInTreeByPrefix(item.children, idPrefix);
    if (found) return found;
  }
  return undefined;
}
