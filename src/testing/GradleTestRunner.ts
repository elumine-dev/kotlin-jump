import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { resolveAll as resolveModules } from '../gradle/ModuleResolver';
import { Logger } from '../util/logger';

const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
} as const;

export interface TestSpec {
  item: vscode.TestItem;
  entry: SymbolEntry;
}

interface TestResult {
  classFqn: string;
  methodName: string;
  state: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  message?: string;
  expected?: string;
  actual?: string;
}

export class GradleTestRunner {
  constructor(
    private readonly log: Logger,
    private readonly workspaceState?: vscode.Memento,
  ) {
    // Restore task cache from previous VS Code session
    const saved = workspaceState?.get<Record<string, string>>('kotlinJump.resolvedTaskCache', {}) ?? {};
    for (const [module, task] of Object.entries(saved)) {
      resolvedTaskCache.set(module, task);
    }
    if (Object.keys(saved).length > 0) {
      log.info(`[test:runner] restored ${Object.keys(saved).length} cached task name(s) from workspaceState`);
    }
  }

  async runAll(
    specs: TestSpec[],
    run: vscode.TestRun,
    token: vscode.CancellationToken,
    index: SymbolIndex,
  ): Promise<void> {
    if (specs.length === 0) return;

    const projectRoot = findProjectRoot(this.log);
    if (!projectRoot) {
      this.log.error('[test:runner] could not find project root (no settings.gradle)');
      run.appendOutput('\r\n[kotlin-jump] Could not find project root (settings.gradle not found)\r\n');
      for (const s of specs) run.errored(s.item, new vscode.TestMessage('Project root not found'));
      return;
    }

    this.log.info(`[test:runner] project root: ${projectRoot}`);
    const moduleMap = await resolveModules();
    this.log.debug(`[test:runner] moduleMap has ${moduleMap.size} entries: [${[...moduleMap.keys()].join(', ')}]`);
    const byModule = groupByModule(specs);
    this.log.info(`[test:runner] grouped into ${byModule.size} module(s): [${[...byModule.keys()].map(m => m || '(root)').join(', ')}]`);

    for (const [moduleName, moduleSpecs] of byModule) {
      if (token.isCancellationRequested) {
        this.log.info('[test:runner] cancelled — stopping');
        break;
      }
      await this.runModule(moduleSpecs, run, token, projectRoot, moduleName, moduleMap, false, this.log);
    }
  }

  async runWithCoverage(
    specs: TestSpec[],
    run: vscode.TestRun,
    token: vscode.CancellationToken,
    index: SymbolIndex,
  ): Promise<void> {
    if (specs.length === 0) return;

    const projectRoot = findProjectRoot(this.log);
    if (!projectRoot) return;

    this.log.info(`[test:runner] coverage run — project root: ${projectRoot}`);
    const moduleMap = await resolveModules();
    const byModule = groupByModule(specs);

    for (const [moduleName, moduleSpecs] of byModule) {
      if (token.isCancellationRequested) break;
      await this.runModule(moduleSpecs, run, token, projectRoot, moduleName, moduleMap, true, this.log);
    }
  }

  private async runModule(
    specs: TestSpec[],
    run: vscode.TestRun,
    token: vscode.CancellationToken,
    projectRoot: string,
    moduleName: string,
    moduleMap: Map<string, string>,
    withCoverage = false,
    log: Logger,
  ): Promise<void> {
    for (const s of specs) run.enqueued(s.item);
    for (const s of specs) run.started(s.item);

    // Resolve real Gradle module path — moduleName may be a source-set name (e.g.
    // "sharedTest") from the KMP fallback, or empty. Walk up from the test file to
    // find the nearest build.gradle(.kts) and derive the proper ":module:path".
    const gradleModule = resolveGradleModulePath(specs, moduleName, projectRoot, moduleMap, log);

    // Resolve module filesystem path early — needed for Android detection and XML lookup
    const modulePath = gradleModule
      ? (moduleMap.get(gradleModule) ?? path.join(projectRoot, gradleModule.slice(1).replace(/:/g, path.sep)))
      : projectRoot;

    // Android modules use testDebugUnitTest; plain Kotlin/JVM modules use test
    const testTask = resolveTestTask(modulePath, gradleModule, log);

    const gradlew = resolveGradleWrapper(projectRoot);
    const task = gradleModule ? `${gradleModule}:${testTask}` : testTask;
    const filters = buildTestFilters(specs);
    const args = [task, ...filters];
    if (withCoverage) {
      const coverageTask = gradleModule ? `${gradleModule}:koverXmlReport` : 'koverXmlReport';
      args.push(coverageTask);
    }

    log.info(`[test:runner] moduleName="${moduleName}" → gradleModule="${gradleModule || '(root)'}" testTask="${testTask}"`);
    log.info(`[test:runner] spawning: ${gradlew} ${args.join(' ')}`);
    log.debug(`[test:runner] cwd: ${projectRoot}`);
    log.debug(`[test:runner] specs (${specs.length}): [${specs.map(s => s.entry.fqn).join(', ')}]`);
    run.appendOutput(formatRunHeader(specs));

    // Stdout results accumulate as fallback; XML results override afterward
    const stdoutResults = new Map<string, TestResult>();

    const startMs = Date.now();
    const candidates: string[] = [];
    let exitCode = await spawnGradle(gradlew, args, projectRoot, run, token, stdoutResults, log, candidates);

    // Auto-retry when task name is ambiguous (multi-flavor Android modules)
    if (exitCode !== 0 && candidates.length > 0) {
      const pick = await vscode.window.showQuickPick(candidates, {
        title: `Ambiguous test task for ${gradleModule || 'root'}`,
        placeHolder: 'Select the flavor to use for this module (choice will be remembered)',
      }) ?? candidates[0];
      const retryTask = gradleModule ? `${gradleModule}:${pick}` : pick;
      run.appendOutput(`\r\n${C.yellow}⚑  ambiguous task — retrying with: ${pick}${C.reset}\r\n\r\n`);
      log.info(`[test:runner] ambiguous task detected — retrying with: ${retryTask}`);
      stdoutResults.clear();
      const retryArgs = [retryTask, ...filters];
      if (withCoverage) retryArgs.push(gradleModule ? `${gradleModule}:koverXmlReport` : 'koverXmlReport');
      exitCode = await spawnGradle(gradlew, retryArgs, projectRoot, run, token, stdoutResults, log);
      // Cache the resolved task so the next run skips the failing first invocation
      if (exitCode === 0 && gradleModule) {
        resolvedTaskCache.set(gradleModule, pick);
        log.info(`[test:runner] cached resolved task "${pick}" for "${gradleModule}"`);
        this.workspaceState?.update('kotlinJump.resolvedTaskCache', Object.fromEntries(resolvedTaskCache));
      }
    }

    const elapsedMs = Date.now() - startMs;
    log.info(`[test:runner] gradle exited with code ${exitCode} — stdout results: ${stdoutResults.size}`);

    log.debug(`[test:runner] looking for XML results in: ${modulePath}`);
    // Only filter stale XML when the build failed — exitCode === 0 means the task
    // either ran fresh or was UP-TO-DATE (Gradle reused cached results); both are valid.
    const xmlResults = await parseXmlResults(modulePath, testTask, exitCode !== 0 ? startMs : undefined, log);
    log.info(`[test:runner] XML results: ${xmlResults.size}, stdout results: ${stdoutResults.size} — using ${xmlResults.size > 0 ? 'XML' : 'stdout'}`);
    const results = xmlResults.size > 0 ? xmlResults : stdoutResults;

    // When Gradle testLogging is not configured, stdout has no individual result lines.
    // Fall back to printing only failures and skips from XML; passed tests are shown in the summary.
    if (stdoutResults.size === 0 && results.size > 0) {
      for (const spec of specs) {
        const key = `${getClassFqn(spec.entry)}.${spec.entry.name}`;
        const result = results.get(key);
        if (!result || result.state === 'passed') continue;
        const icon  = result.state === 'failed' ? '✗' : '─';
        const color = result.state === 'failed' ? C.red : C.yellow;
        const dur   = result.durationMs !== undefined && result.durationMs > 0
          ? `  ${C.dim}${formatDuration(result.durationMs)}${C.reset}` : '';
        run.appendOutput(`  ${color}${icon}${C.reset}  ${spec.entry.name}${dur}\r\n`);
      }
    }

    applyResults(specs, results, run, log);

    // ── Failure details (from XML) ────────────────────────────────────────────
    const failedResults = [...results.values()].filter(r => r.state === 'failed');
    if (failedResults.length > 0) {
      run.appendOutput('\r\n');
      for (const r of failedResults) {
        const matchingSpec = specs.find(s => s.entry.name === r.methodName);
        run.appendOutput(`  ${C.red}✗  ${r.methodName}${C.reset}\r\n`);
        const detail = formatErrorDetail(r, matchingSpec?.entry.uri.fsPath);
        if (detail) {
          for (const line of detail.split('\n')) {
            run.appendOutput(`     ${line}\r\n`);
          }
        }
        run.appendOutput('\r\n');
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    let passed = 0, failed = 0, skipped = 0;
    for (const r of results.values()) {
      if (r.state === 'passed') passed++;
      else if (r.state === 'failed') failed++;
      else skipped++;
    }
    const parts: string[] = [];
    if (passed > 0)  parts.push(`${C.green}✓  ${passed} passed${C.reset}`);
    if (failed > 0)  parts.push(`${C.red}✗  ${failed} failed${C.reset}`);
    if (skipped > 0) parts.push(`${C.yellow}─  ${skipped} skipped${C.reset}`);
    const summaryLine = parts.length > 0
      ? parts.join(`  ${C.dim}·${C.reset}  `)
      : (exitCode === 0 ? `${C.green}✓  done${C.reset}` : `${C.red}✗  build failed${C.reset}`);
    run.appendOutput(`\r\n${C.dim}──────────────────────────────────────────────────${C.reset}\r\n`);
    run.appendOutput(`  ${summaryLine}  ${C.dim}(${formatDuration(elapsedMs)})${C.reset}\r\n`);

    if (exitCode !== 0 && results.size === 0) {
      log.warn(`[test:runner] gradle failed (exit ${exitCode}) and no results parsed — marking all as errored`);
      for (const s of specs) {
        run.errored(s.item, new vscode.TestMessage(`Gradle exited with code ${exitCode}`));
      }
    }

    // Attach coverage if run with coverage
    if (withCoverage) {
      const fileCoverages = await parseCoverage(modulePath);
      log.info(`[test:runner] coverage: ${fileCoverages.length} file(s) with coverage data`);
      for (const fc of fileCoverages) run.addCoverage(fc);
    }
  }
}

// ── Gradle module resolution ──────────────────────────────────────────────────

/**
 * Returns the real Gradle module path (e.g. ":feature:home") to use for the test task.
 *
 * `moduleName` coming from the indexer can be:
 *   - ":feature:home"  — a proper Gradle path from settings.gradle   → use as-is
 *   - "sharedTest"     — a KMP source-set name from the fallback regex → NOT a task prefix
 *   - ""               — no module detected                          → NOT a task prefix
 *
 * In the latter two cases we walk up from the test file's directory until we find a
 * build.gradle(.kts) file, then convert that relative directory to a Gradle path.
 */
function resolveGradleModulePath(
  specs: TestSpec[],
  moduleName: string,
  projectRoot: string,
  moduleMap: Map<string, string>,
  log: Logger,
): string {
  // Already a proper Gradle module path
  if (moduleName.startsWith(':')) return moduleName;

  // Source-set name or empty: derive from the first spec's file path
  const filePath = specs[0]?.entry.uri.fsPath;
  if (!filePath) {
    log.warn('[test:runner] no file path available — cannot derive Gradle module');
    return '';
  }

  const derived = findGradleModuleByPath(filePath, projectRoot);
  log.debug(`[test:runner] derived Gradle module from file path: "${derived || '(root)'}" (file: ${filePath})`);
  return derived;
}

/**
 * Walk up from `filePath` to `projectRoot` looking for the nearest build.gradle(.kts).
 * Returns the Gradle module path (e.g. ":rubicon:app") or "" for the root project.
 */
function findGradleModuleByPath(filePath: string, projectRoot: string): string {
  const fs = require('fs') as typeof import('fs');
  let dir = path.dirname(filePath);

  while (dir.length >= projectRoot.length && dir !== path.dirname(dir)) {
    if (dir === projectRoot) break; // reached project root — it's the root module
    if (
      fs.existsSync(path.join(dir, 'build.gradle.kts')) ||
      fs.existsSync(path.join(dir, 'build.gradle'))
    ) {
      const rel = path.relative(projectRoot, dir);
      return ':' + rel.split(path.sep).join(':');
    }
    dir = path.dirname(dir);
  }
  return ''; // root project
}

function buildTestFilters(specs: TestSpec[]): string[] {
  const filters: string[] = [];
  const seen = new Set<string>();

  for (const { entry } of specs) {
    const classFqn = getClassFqn(entry);
    const filter = `${classFqn}.${entry.name}`;
    if (!seen.has(filter)) { seen.add(filter); filters.push('--tests', filter); }
  }

  return filters;
}

function getClassFqn(entry: SymbolEntry): string {
  // FQN is "pkg.ClassName.methodName" — strip the last segment
  const parts = entry.fqn.split('.');
  return parts.slice(0, -1).join('.');
}

function groupByModule(specs: TestSpec[]): Map<string, TestSpec[]> {
  const map = new Map<string, TestSpec[]>();
  for (const spec of specs) {
    const mod = spec.entry.moduleName ?? '';
    const arr = map.get(mod) ?? [];
    arr.push(spec);
    map.set(mod, arr);
  }
  return map;
}

export function resolveGradleWrapper(projectRoot: string): string {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const configured = cfg.get<string>('gradleWrapper', './gradlew');
  const wrapper = path.isAbsolute(configured)
    ? configured
    : path.join(projectRoot, configured);

  // Use .bat on Windows
  if (process.platform === 'win32' && !wrapper.endsWith('.bat')) {
    const bat = wrapper + '.bat';
    try { require('fs').accessSync(bat); return bat; } catch { /* fall through */ }
  }
  return wrapper;
}

export function findProjectRoot(log?: Logger): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    log?.warn('[test:runner] no workspace folders open');
    return undefined;
  }

  log?.debug(`[test:runner] workspace folders: [${folders.map(f => f.uri.fsPath).join(', ')}]`);

  for (const folder of folders) {
    const fsPath = folder.uri.fsPath;
    for (const name of ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle']) {
      try {
        require('fs').accessSync(path.join(fsPath, name));
        log?.debug(`[test:runner] project root detected via "${name}": ${fsPath}`);
        return fsPath;
      } catch { /* not found */ }
    }
  }

  const fallback = folders[0]?.uri.fsPath;
  log?.warn(`[test:runner] no Gradle build file found — falling back to first workspace folder: ${fallback}`);
  return fallback;
}

/**
 * Returns the Gradle test task name for the given module.
 *
 * Priority:
 *   1. `kotlinJump.testTaskOverrides` — explicit per-module task (handles multi-flavor projects)
 *   2. In-session cache — populated after a successful auto-retry (avoids double Gradle run)
 *   3. `kotlinJump.androidTestVariant` — global variant override (e.g. "release")
 *   4. Auto-detect: Android → testDebugUnitTest, JVM → test
 */

// In-memory cache: populated after a successful ambiguous-task retry so subsequent
// runs skip the failing first invocation. Resets on extension reload.
const resolvedTaskCache = new Map<string, string>();

function resolveTestTask(modulePath: string, gradleModule: string, log: Logger): string {
  const fs = require('fs') as typeof import('fs');
  const cfg = vscode.workspace.getConfiguration('kotlinJump');

  // 1. Per-module explicit override (highest priority)
  const overrides = cfg.get<Record<string, string>>('testTaskOverrides', {});
  if (gradleModule && overrides[gradleModule]) {
    log.debug(`[test:runner] task override for "${gradleModule}": ${overrides[gradleModule]}`);
    return overrides[gradleModule];
  }

  // 2. In-session cache from previous auto-retry resolution
  if (gradleModule && resolvedTaskCache.has(gradleModule)) {
    const cached = resolvedTaskCache.get(gradleModule)!;
    log.debug(`[test:runner] task cache hit for "${gradleModule}": ${cached}`);
    return cached;
  }

  // 2. Android detection + optional variant override
  for (const name of ['build.gradle.kts', 'build.gradle']) {
    try {
      const content = fs.readFileSync(path.join(modulePath, name), 'utf8');
      if (/\bandroid\s*\{/.test(content) || /com\.android\.(application|library|test|dynamic-feature)\b/.test(content)) {
        const variant = cfg.get<string>('androidTestVariant', '');
        const task = variant
          ? `test${variant.charAt(0).toUpperCase()}${variant.slice(1)}UnitTest`
          : 'testDebugUnitTest';
        log.debug(`[test:runner] Android module detected — using ${task}`);
        return task;
      }
    } catch { /* file not found */ }
  }

  return 'test';
}

// ── Gradle spawn ──────────────────────────────────────────────────────────────

const INIT_SCRIPT_CONTENT = `allprojects {
  tasks.withType(Test).configureEach {
    testLogging {
      events "failed", "skipped"
    }
  }
}`;

function ensureTestLoggingInitScript(): string | undefined {
  const os  = require('os')  as typeof import('os');
  const fs  = require('fs')  as typeof import('fs');
  const dst = path.join(os.tmpdir(), 'kotlin-jump-testlogging.gradle');
  try { fs.writeFileSync(dst, INIT_SCRIPT_CONTENT, 'utf8'); return dst; } catch { return undefined; }
}

async function spawnGradle(
  gradlew: string,
  args: string[],
  cwd: string,
  run: vscode.TestRun,
  token: vscode.CancellationToken,
  stdoutResults: Map<string, TestResult>,
  log: Logger,
  ambiguousCandidates?: string[],
): Promise<number> {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const injectTestLogging = cfg.get<boolean>('injectTestLogging', true);
  let finalArgs = args;
  if (injectTestLogging) {
    const initScript = ensureTestLoggingInitScript();
    if (initScript) {
      finalArgs = ['--init-script', initScript, ...args];
      log.debug(`[test:runner] injecting testLogging init-script: ${initScript}`);
    }
  }

  return new Promise((resolve) => {
    const proc = cp.spawn(gradlew, finalArgs, { cwd, shell: process.platform === 'win32' });
    log.debug(`[test:runner] process spawned (pid ${proc.pid})`);

    let lastWasFailed = false;
    const onLine = (line: string) => {
      // Detect ambiguous task candidates for auto-retry
      if (ambiguousCandidates) {
        const am = /Candidates are:\s*((?:['"][^'"]+['"][,\s]*)+)/.exec(line);
        if (am) {
          const RE_Q = /['"]([^'"]+)['"]/g;
          let q: RegExpExecArray | null;
          while ((q = RE_Q.exec(am[1])) !== null) ambiguousCandidates.push(q[1]);
        }
      }

      // Parse for result tracking regardless of display decision
      const before = stdoutResults.size;
      parseStdoutLine(line, stdoutResults);
      if (stdoutResults.size > before) {
        const last = [...stdoutResults.values()].at(-1)!;
        log.debug(`[test:runner] stdout result: ${last.classFqn}.${last.methodName} → ${last.state}`);
      }

      // Format for display — only show failures and skips; passed tests are counted in the summary
      const m = RE_GRADLE_RESULT.exec(line.trim());
      if (m) {
        const [, , methodName, stateStr] = m;
        lastWasFailed = stateStr === 'FAILED';
        if (stateStr === 'PASSED') {
          // silent — will appear in the summary count
        } else {
          const icon  = stateStr === 'FAILED' ? '✗' : '─';
          const color = stateStr === 'FAILED' ? C.red : C.yellow;
          run.appendOutput(`  ${color}${icon}${C.reset}  ${methodName}\r\n`);
        }
      } else if (lastWasFailed && /^\s/.test(line)) {
        // suppress raw Java stack trace — richer detail shown after XML parsing
      } else if (!isNoiseLine(line)) {
        lastWasFailed = false;
        run.appendOutput(line + '\r\n');
      }
    };

    let buf = '';
    const drain = (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    };

    proc.stdout.on('data', (d: Buffer) => drain(d.toString()));
    proc.stderr.on('data', (d: Buffer) => drain(d.toString()));

    token.onCancellationRequested(() => {
      log.info(`[test:runner] cancellation requested — killing process (pid ${proc.pid})`);
      proc.kill();
    });

    proc.on('close', (code) => {
      if (buf) onLine(buf);
      log.debug(`[test:runner] process closed (pid ${proc.pid}) exit=${code}`);
      resolve(code ?? 1);
    });
  });
}

// Gradle test output pattern:
// "nuglif.rubicon.FooTest > testBar PASSED"
// "> Task :app:test FAILED"
// Method name uses .+? (lazy) to support backtick-named tests with spaces,
// e.g. "KioskConnectivityUseCaseTest > given device is connected then state should be Connected PASSED"
const RE_GRADLE_RESULT = /^(\S+)\s+>\s+(.+?)\s+(PASSED|FAILED|SKIPPED)\s*$/;

// ── Output formatting helpers ─────────────────────────────────────────────────

const RE_NOISE: RegExp[] = [
  /^> Task :/,
  /^\[Incubating\]/,
  /^\[WARN\]/,
  /^w: /,                              // Kotlin compiler warnings (deprecated, type inference, etc.)
  /^WARNING: /,                        // JVM unsafe / restricted method warnings
  /^exception: /,                      // Kotlin daemon exception prefix
  /^Note: /,                           // Java compiler notes (unchecked, deprecated API)
  /^Java HotSpot/,                     // JVM version info
  /^Starting a Gradle Daemon/,
  /^Configuration on demand is/,
  /^Calculating task graph/,
  /^Kotlin build report is written to/,
  /^Configuration cache entry/,
  /^Deprecated Gradle/,
  /^You can use '--warning-mode/,
  /^For more on this, please refer/,
  /^Consider enabling configuration cache/,
  /^> Run with --/,
  /^> Get more help at/,
  /^> Run gradlew tasks/,
  /^> For more on name expansion/,
  /^\* Try:$/,
  /^BUILD (SUCCESSFUL|FAILED)/,
  /^FAILURE: Build failed with an exception/,
  /^\d+ actionable tasks?:/,
  /^\d+ tests? completed/,
  /^Execution failed for task '.*:test['"]/,
  /^> There were failing tests\./,
  /^\* What went wrong:$/,
];

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || RE_NOISE.some(re => re.test(t));
}

function formatRunHeader(specs: TestSpec[]): string {
  if (specs.length === 0) return '';
  const classNames = [...new Set(specs.map(s => {
    const parts = s.entry.fqn.split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  }))];
  const arrow = `${C.cyan}▶${C.reset}`;
  const dot   = `${C.dim}·${C.reset}`;
  if (specs.length === 1)
    return `\r\n  ${arrow}  ${specs[0].entry.name}  ${dot}  ${C.dim}${classNames[0]}${C.reset}\r\n\r\n`;
  if (classNames.length === 1)
    return `\r\n  ${arrow}  ${specs.length} tests  ${dot}  ${C.dim}${classNames[0]}${C.reset}\r\n\r\n`;
  return `\r\n  ${arrow}  ${specs.length} tests\r\n\r\n`;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatErrorDetail(result: TestResult, filePath?: string): string | undefined {
  if (!result.message) return undefined;
  const lines = result.message.split('\n');

  // Extract line number from stack trace, e.g. "(PokemonRepositoryTest.kt:51)"
  const fileLineMatch = lines.map(l => /\((\w+\.kt):(\d+)\)/.exec(l)).find(Boolean);
  const lineNum = fileLineMatch?.[2];
  // Use full absolute path when available so VS Code renders a clickable link
  const locPath = filePath && lineNum ? `${filePath}:${lineNum}`
    : fileLineMatch ? `${fileLineMatch[1]}:${fileLineMatch[2]}`
    : undefined;
  const loc = locPath ? `${C.dim}→  ${locPath}${C.reset}` : undefined;

  if (result.expected !== undefined && result.actual !== undefined) {
    const parts = [
      `${C.dim}expected${C.reset}  ${C.green}${result.expected}${C.reset}`,
      `${C.dim}got     ${C.reset}  ${C.red}${result.actual}${C.reset}`,
    ];
    if (loc) parts.push(loc);
    return parts.join('\n');
  }

  // Non-assertion failure: first meaningful message line + location
  const firstLine = lines[0]?.trim() ?? '';
  return loc ? `${firstLine}\n${loc}` : firstLine;
}

function parseStdoutLine(line: string, results: Map<string, TestResult>): void {
  const m = RE_GRADLE_RESULT.exec(line.trim());
  if (!m) return;

  const [, classFqn, methodName, stateStr] = m;
  const state = stateStr === 'PASSED' ? 'passed' : stateStr === 'SKIPPED' ? 'skipped' : 'failed';
  results.set(`${classFqn}.${methodName}`, { classFqn, methodName, state });
}

// ── XML result parsing ────────────────────────────────────────────────────────

async function parseXmlResults(modulePath: string, testTask: string, startMs: number | undefined, log: Logger): Promise<Map<string, TestResult>> {
  const results = new Map<string, TestResult>();
  const fs = await import('fs');
  const baseDir = path.join(modulePath, 'build', 'test-results');

  // Try the specific task directory first (e.g. testDebugUnitTest or test),
  // then fall back to scanning all subdirectories.
  const primaryDir = path.join(baseDir, testTask);
  const dirs: string[] = [];
  try {
    fs.readdirSync(primaryDir);
    dirs.push(primaryDir);
  } catch {
    // Primary dir not found — scan all subdirs of build/test-results/
    try {
      for (const sub of fs.readdirSync(baseDir)) {
        const p = path.join(baseDir, sub);
        try { if (fs.statSync(p).isDirectory()) dirs.push(p); } catch { /* skip */ }
      }
    } catch {
      log.debug(`[test:runner] no XML results dir at: ${baseDir}`);
      return results;
    }
  }

  for (const xmlDir of dirs) {
    let files: string[];
    try { files = fs.readdirSync(xmlDir).filter(f => f.endsWith('.xml')); }
    catch { continue; }

    log.info(`[test:runner] parsing ${files.length} XML file(s) from: ${xmlDir}`);
    for (const file of files) {
      const xmlPath = path.join(xmlDir, file);
      try {
        // When startMs is set (build failed), skip files that predate this run
        if (startMs !== undefined) {
          const mtime = fs.statSync(xmlPath).mtimeMs;
          if (mtime < startMs) {
            log.debug(`[test:runner] skipping stale XML: ${file}`);
            continue;
          }
        }
        const xml = fs.readFileSync(xmlPath, 'utf8');
        const before = results.size;
        parseJUnitXml(xml, results);
        log.debug(`[test:runner] parsed ${file} — ${results.size - before} test case(s)`);
      } catch (err) {
        log.warn(`[test:runner] failed to read XML file ${file}: ${err}`);
      }
    }
  }

  return results;
}

function parseJUnitXml(xml: string, results: Map<string, TestResult>): void {
  // Parse <testcase classname="..." name="..." time="..."> elements.
  // Uses alternation: either full open/close form or self-closing form.
  // NOTE: [^>]*? (lazy) is critical — prevents self-closing attrs from absorbing the next element's body.
  const RE_TESTCASE = /<testcase\s([^>]*?)(?:>([\s\S]*?)<\/testcase>|\/>)/g;
  const RE_ATTR = /(\w+)="([^"]*)"/g;

  let m: RegExpExecArray | null;
  while ((m = RE_TESTCASE.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrStr = m[1] ?? m[3] ?? '';
    let a: RegExpExecArray | null;
    RE_ATTR.lastIndex = 0;
    while ((a = RE_ATTR.exec(attrStr)) !== null) attrs[a[1]] = a[2];

    // JVM uses '$' for nested classes (e.g. "Outer$Inner"); normalise to '.' to match Kotlin FQN
    const classFqn  = (attrs['classname'] ?? '').replace(/\$/g, '.');
    // Normalize method name to match symbol index (which has no annotations or params).
    // Handles JUnit 5 @ParameterizedTest patterns: "myTest(String)[1] - val", "myTest[1]"
    // and plain JUnit 5 "()" suffix: "myTest()"
    const name = (attrs['name'] ?? '')
      .replace(/\(.*?\)\s*\[\d+\].*$/, '') // "myTest(String)[1] - val" → "myTest"
      .replace(/\s*\[\d+\].*$/, '')         // "myTest[1]" → "myTest"
      .replace(/\(.*\)$/, '');              // "myTest()" → "myTest"
    const timeStr   = attrs['time'] ?? '0';
    const durationMs = Math.round(parseFloat(timeStr) * 1000);
    const body = m[2] ?? '';

    let state: 'passed' | 'failed' | 'skipped' = 'passed';
    let message: string | undefined;
    let expected: string | undefined;
    let actual: string | undefined;

    if (/<skipped/i.test(body)) {
      state = 'skipped';
    } else if (/<(?:failure|error)/i.test(body)) {
      state = 'failed';
      const failMatch = /<(?:failure|error)[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/(?:failure|error)>/i.exec(body);
      if (failMatch) {
        message = unescapeXml(failMatch[1]);
        const stackTrace = failMatch[2].trim();
        if (stackTrace) message = `${message}\n${stackTrace}`;

        // Extract expected / actual from JUnit assertion messages
        // "expected:<foo> but was:<bar>" — both JUnit 4 and 5
        const diffMatch = /expected[^<]*<([^>]*)>[^<]*(?:but was|was)[^<]*<([^>]*)>/i.exec(message);
        if (diffMatch) { expected = diffMatch[1]; actual = diffMatch[2]; }
        // AssertEquals format: "expected [foo] but found [bar]"
        const diffMatch2 = /expected \[([^\]]*)\] but (?:found|was) \[([^\]]*)\]/i.exec(message);
        if (diffMatch2) { expected = diffMatch2[1]; actual = diffMatch2[2]; }
      }
    }

    const key = `${classFqn}.${name}`;
    const existing = results.get(key);
    if (existing) {
      // Aggregate @ParameterizedTest invocations: one failure marks the whole method as failed
      if (state === 'failed') {
        existing.state = 'failed';
        if (message)            existing.message  = message;
        if (expected !== undefined) existing.expected = expected;
        if (actual   !== undefined) existing.actual   = actual;
      }
      existing.durationMs = (existing.durationMs ?? 0) + durationMs;
    } else {
      results.set(key, { classFqn, methodName: name, state, durationMs, message, expected, actual });
    }
  }
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Apply results to TestRun ──────────────────────────────────────────────────

function applyResults(
  specs: TestSpec[],
  results: Map<string, TestResult>,
  run: vscode.TestRun,
  log: Logger,
): void {
  for (const { item, entry } of specs) {
    const classFqn = getClassFqn(entry);
    const key = `${classFqn}.${entry.name}`;
    const result = results.get(key);

    if (!result) {
      log.warn(`[test:runner] no result for key "${key}" — marking skipped. Available keys: [${[...results.keys()].join(', ')}]`);
      run.skipped(item);
      continue;
    }

    log.info(`[test:runner] ${key} → ${result.state}${result.durationMs !== undefined ? ` (${result.durationMs}ms)` : ''}`);

    switch (result.state) {
      case 'passed':
        run.passed(item, result.durationMs);
        break;
      case 'skipped':
        run.skipped(item);
        break;
      case 'failed': {
        if (result.expected !== undefined) {
          log.debug(`[test:runner] failure diff — expected: "${result.expected}", actual: "${result.actual}"`);
        }
        const msg = new vscode.TestMessage(result.message ?? 'Test failed');
        msg.location = new vscode.Location(entry.uri, new vscode.Position(entry.line, 0));
        if (result.expected !== undefined) msg.expectedOutput = result.expected;
        if (result.actual   !== undefined) msg.actualOutput   = result.actual;
        run.failed(item, msg, result.durationMs);
        break;
      }
    }
  }
}

// ── Coverage (Kover / JaCoCo XML) ────────────────────────────────────────────

async function parseCoverage(modulePath: string): Promise<vscode.FileCoverage[]> {
  const results: vscode.FileCoverage[] = [];
  const fs = await import('fs');

  // Try Kover first, then JaCoCo
  const candidates = [
    path.join(modulePath, 'build', 'reports', 'kover', 'report.xml'),
    path.join(modulePath, 'build', 'reports', 'jacoco', 'test', 'jacocoTestReport.xml'),
  ];

  for (const xmlPath of candidates) {
    try {
      const xml = fs.readFileSync(xmlPath, 'utf8');
      parseCoverageXml(xml, results);
      if (results.length > 0) break; // use first successful parse
    } catch { /* file not found */ }
  }

  return results;
}

function parseCoverageXml(xml: string, results: vscode.FileCoverage[]): void {
  // Parse <class name="..." sourcefilename="..."> with <counter type="LINE" covered="X" missed="Y"/>
  const RE_CLASS_BLOCK = /<class\s[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/class>/g;
  const RE_COUNTER = /<counter\s+type="(\w+)"\s+missed="(\d+)"\s+covered="(\d+)"/g;

  let cm: RegExpExecArray | null;
  while ((cm = RE_CLASS_BLOCK.exec(xml)) !== null) {
    const name = cm[1].replace(/\//g, '/'); // already path format
    const body = cm[2];

    let linesCovered = 0, linesMissed = 0;
    let branchesCovered = 0, branchesMissed = 0;

    RE_COUNTER.lastIndex = 0;
    let co: RegExpExecArray | null;
    while ((co = RE_COUNTER.exec(body)) !== null) {
      const type = co[1], missed = parseInt(co[2]), covered = parseInt(co[3]);
      if (type === 'LINE')   { linesMissed = missed; linesCovered = covered; }
      if (type === 'BRANCH') { branchesMissed = missed; branchesCovered = covered; }
    }

    // Find the source file URI via workspace
    const sourceFile = findSourceUri(name);
    if (!sourceFile) continue;

    const statementCov = new vscode.TestCoverageCount(linesCovered, linesCovered + linesMissed);
    const fc = vscode.FileCoverage.fromDetails(sourceFile, []);
    (fc as { statementCoverage: vscode.TestCoverageCount }).statementCoverage = statementCov;
    if (branchesCovered + branchesMissed > 0) {
      (fc as { branchCoverage?: vscode.TestCoverageCount }).branchCoverage =
        new vscode.TestCoverageCount(branchesCovered, branchesCovered + branchesMissed);
    }
    results.push(fc);
  }
}

function findSourceUri(className: string): vscode.Uri | undefined {
  // className is like "nuglif/rubicon/foo/Bar" — convert to file path fragment
  const fragment = className.replace(/\$/g, '.') + '.kt';
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return undefined;
  // Best-effort: construct URI from first workspace folder
  const root = folders[0].uri.fsPath;
  const candidates = [
    path.join(root, 'src', 'main', 'kotlin', fragment),
    path.join(root, 'src', 'main', 'java', fragment),
  ];
  const fs = require('fs');
  for (const c of candidates) {
    try { fs.accessSync(c); return vscode.Uri.file(c); } catch { /* not found */ }
  }
  return undefined;
}
