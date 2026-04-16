import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn } from 'child_process';
import { findProjectRoot, resolveGradleWrapper } from '../testing/GradleTestRunner';
import { Logger } from '../util/logger';

// ── Types ────────────────────────────────────────────────────────────────────

// Explicit project entry from kotlinJump.androidProjects setting.
// Equivalent to a zshrc alias like: replica() { ... }
interface ExplicitProject {
  name: string;     // display name, e.g. "Replica"
  module: string;   // gradle module path, e.g. "replica/app"
  package: string;  // applicationId, e.g. "ca.lapresse.lapresseplus.debug"
  variant?: string; // build variant, e.g. "ReplicaLaPresseDebug" (skips task discovery)
}

interface AndroidModuleInfo {
  module: string;      // e.g. "replica/app"
  packageName: string; // e.g. "ca.lapresse.lapresseplus.debug"
}

interface AndroidConfig extends AndroidModuleInfo {
  gradleModule: string;   // e.g. ":replica:app"
  installTask:  string;   // fallback only; resolveInstallTask() overrides for auto-detected
  projectRoot:  string;
  gradlew:      string;
  isExplicit?:  boolean;  // true = from kotlinJump.androidProjects → skip task discovery
}

// Resolved from merged manifest after a successful gradle build.
// Mirrors what Android Studio reads before calling `am start`.
interface MergedManifestInfo {
  packageName:      string; // e.g. "ca.lapresse.lapresseplus.debug"
  launcherActivity: string; // e.g. "ca.lapresse.lapresseplus.debug/.ReplicaStartActivity"
}

// Passed to executeWithShellIntegration so adb command is built post-build
// (merged manifest only exists after `./gradlew install*` succeeds)
interface LaunchParams {
  device:       string;
  packageName:  string;
  projectRoot:  string;
  gradleModule: string;
  installTask:  string;
}

// ── Module-level state ───────────────────────────────────────────────────────

let _runButton:       vscode.StatusBarItem | undefined;
let _switchButton:    vscode.StatusBarItem | undefined;
let _isBuilding      = false;
let _currentAppName: string | undefined;
let _hasMultipleApps = false;
// Deduplicate concurrent task discovery calls for the same module
const _taskDiscoveryPromises = new Map<string, Promise<string[]>>();

// ── Cache key helpers ─────────────────────────────────────────────────────────

const TASK_KEY            = (gm: string) => `androidInstallTask:${gm || 'root'}`;
const TASK_CANDIDATES_KEY = (gm: string) => `androidInstallTaskCandidates:${gm || 'root'}`;

// ── Public API ────────────────────────────────────────────────────────────────

export function registerAndroidRunCommand(
  context: vscode.ExtensionContext,
  log: Logger,
): void {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  if (!cfg.get<boolean>('androidRunEnabled', true)) return;

  // ── Main Run button ───────────────────────────────────────────────────────
  const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  button.command = 'kotlin-jump.runAndroid';
  button.tooltip = 'Build, install & launch Android app on connected device/emulator';
  button.name    = 'Kotlin Jump: Run Android';
  _runButton = button;
  context.subscriptions.push(button);

  // ── Switch button (chevron, shown when multiple apps are available) ────────
  const switchBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 9);
  switchBtn.command = 'kotlin-jump.switchAndroidApp';
  switchBtn.text    = '$(chevron-down)';
  switchBtn.tooltip = 'Switch Android app';
  switchBtn.name    = 'Kotlin Jump: Switch Android App';
  _switchButton = switchBtn;
  context.subscriptions.push(switchBtn);

  // Restore app name and multi-app flag from previous session
  const cachedExplicit = context.workspaceState.get<string>('androidRunConfigExplicit');
  const cachedAuto     = context.workspaceState.get<AndroidModuleInfo>('androidRunConfig');
  if (cachedExplicit)      { _currentAppName = cachedExplicit; }
  else if (cachedAuto)     { _currentAppName = cachedAuto.module; }
  const explicitProjects = cfg.get<ExplicitProject[]>('androidProjects', []);
  _hasMultipleApps = explicitProjects.length > 1;

  updateButtonVisibility(log);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateButtonVisibility(log)),
  );

  // Background task discovery: runs silently at startup so first Run click is instant.
  // Only for auto-detected projects; explicit projects use their configured variant.
  if (explicitProjects.length === 0) {
    void backgroundTaskDiscovery(context, log);
  }

  // Main run command
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.runAndroid', async () => {
      if (_isBuilding) return;
      await runAndroid(context, log);
    }),
  );

  // Switch: clear module + task cache, re-show picker immediately
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.switchAndroidApp', async () => {
      if (_isBuilding) return;
      _currentAppName = undefined;
      await clearAllAndroidCache(context);
      setIdle();
      await runAndroid(context, log);
    }),
  );

  // Connect via WiFi (Wireless Debugging, macOS only)
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.connectAdbWifi', () => connectAdbWifi(log)),
  );

  // Reset via command palette (kept for discoverability)
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlin-jump.resetAndroidRunConfig', async () => {
      _currentAppName = undefined;
      await clearAllAndroidCache(context);
      setIdle();
      vscode.window.showInformationMessage('Kotlin Jump: app selection reset — next Run will ask again.');
    }),
  );
}

async function clearAllAndroidCache(context: vscode.ExtensionContext): Promise<void> {
  await context.workspaceState.update('androidRunConfig', undefined);
  await context.workspaceState.update('androidRunConfigExplicit', undefined);
  for (const key of context.workspaceState.keys()) {
    if (key.startsWith('androidInstallTask:') || key.startsWith('androidInstallTaskCandidates:')) {
      await context.workspaceState.update(key, undefined);
    }
  }
}

// ── Visibility ────────────────────────────────────────────────────────────────

function updateButtonVisibility(log: Logger): void {
  const root = findProjectRoot(log);
  if (!root) { _runButton?.hide(); _switchButton?.hide(); return; }

  const hasWrapper =
    fs.existsSync(path.join(root, 'gradlew')) ||
    fs.existsSync(path.join(root, 'gradlew.bat'));

  if (!hasWrapper) { _runButton?.hide(); _switchButton?.hide(); return; }

  setIdle();
  _runButton!.show();
  if (_hasMultipleApps) { _switchButton!.show(); } else { _switchButton?.hide(); }
}

function updateSwitchButtonVisibility(): void {
  if (_hasMultipleApps) { _switchButton?.show(); } else { _switchButton?.hide(); }
}

// ── Run flow ──────────────────────────────────────────────────────────────────

async function runAndroid(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<void> {
  const config = await detectAndroidProject(context, log);
  if (!config) return;

  // Check device BEFORE building — mirrors _android_check_and_select_emulator() in zshrc
  const device = await ensureDeviceConnected(log);
  if (!device) return;

  // Resolve the exact Gradle install task:
  // • Explicit projects: installTask is already correct (variant set by user) → use directly
  // • Auto-detected: query `gradlew tasks --group install` once, cache forever
  let installTask: string;
  if (config.isExplicit) {
    installTask = config.installTask;
  } else {
    const resolved = await resolveInstallTask(
      config.gradlew, config.gradleModule, config.projectRoot, context, log,
    );
    if (!resolved) return;
    installTask = resolved;
  }

  setBuilding();

  const terminal = getOrCreateTerminal(config.projectRoot);
  terminal.show(/* preserveFocus */ true);

  // ANDROID_SERIAL targets the selected device, avoids mDNS duplicates (like zshrc replica())
  const gradleCmd    = `ANDROID_SERIAL="${device}" "${config.gradlew}" ${installTask}`;
  const launchParams: LaunchParams = {
    device,
    packageName:  config.packageName,
    projectRoot:  config.projectRoot,
    gradleModule: config.gradleModule,
    installTask,
  };

  if (terminal.shellIntegration) {
    executeWithShellIntegration(terminal.shellIntegration, gradleCmd, launchParams, terminal, context, log);
  } else {
    log.debug('[android:run] waiting for shell integration…');
    const integration = await waitForShellIntegration(terminal, 4000);
    if (integration) {
      executeWithShellIntegration(integration, gradleCmd, launchParams, terminal, context, log);
    } else {
      // No shell integration — chain both commands; adb step uses monkey as fallback
      // (merged manifest unreadable mid-chain, monkey is still reliable here)
      log.info('[android:run] shell integration unavailable, falling back to sendText');
      const adbFallback = `adb -s "${device}" shell monkey -p "${config.packageName}" -c android.intent.category.LAUNCHER 1`;
      terminal.sendText(`${gradleCmd} && ${adbFallback}`);
      setIdle();
    }
  }
}

function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(undefined); } }, timeoutMs);
    const disposable = vscode.window.onDidChangeTerminalShellIntegration(({ terminal: t, shellIntegration }) => {
      if (t === terminal && !done) {
        done = true;
        clearTimeout(timer);
        disposable.dispose();
        resolve(shellIntegration);
      }
    });
  });
}

function executeWithShellIntegration(
  shellIntegration: vscode.TerminalShellIntegration,
  gradleCmd: string,
  launchParams: LaunchParams,
  terminal: vscode.Terminal,
  context: vscode.ExtensionContext,
  log: Logger,
): void {
  // Step 1: Gradle install
  const gradleExecution = shellIntegration.executeCommand(gradleCmd);
  const d1 = vscode.window.onDidEndTerminalShellExecution(event => {
    if (event.execution !== gradleExecution) return;
    d1.dispose();
    log.info(`[android:run] gradle — exit ${event.exitCode ?? '?'}`);

    if (event.exitCode !== 0) { onBuildFailure(terminal); return; }

    if (vscode.workspace.getConfiguration('kotlinJump').get<boolean>('androidSkipLaunch', false)) {
      log.info('[android:run] ADB launch skipped (kotlinJump.androidSkipLaunch)');
      onSuccess();
      return;
    }

    // Build ADB command after gradle succeeds: merged manifest is now on disk.
    // Mirrors exactly what Android Studio does — reads the real package + LAUNCHER activity.
    const { device, packageName, projectRoot, gradleModule, installTask } = launchParams;
    const merged = readMergedManifest(projectRoot, gradleModule, installTask);
    let adbCmd: string;
    if (merged) {
      log.info(`[android:run] merged manifest → ${merged.launcherActivity}`);
      adbCmd = `adb -s "${device}" shell am start -n "${merged.launcherActivity}"`;
    } else {
      log.info('[android:run] no merged manifest — fallback to monkey');
      adbCmd = `adb -s "${device}" shell monkey -p "${packageName}" -c android.intent.category.LAUNCHER 1`;
    }

    // Step 2: ADB launch
    setLaunching();
    const adbExecution = shellIntegration.executeCommand(adbCmd);
    const d2 = vscode.window.onDidEndTerminalShellExecution(event2 => {
      if (event2.execution !== adbExecution) return;
      d2.dispose();
      log.info(`[android:run] adb — exit ${event2.exitCode ?? '?'}`);
      if (event2.exitCode === 0) { onSuccess(); } else { onLaunchFailed(terminal); }
    });
    context.subscriptions.push(d2);
  });
  context.subscriptions.push(d1);
}

// ── Background task discovery ─────────────────────────────────────────────────
// Runs silently at workspace open. Warms up the task cache so first Run is instant.

async function backgroundTaskDiscovery(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<void> {
  try {
    const root = findProjectRoot(log);
    if (!root) return;
    const gradlew = resolveGradleWrapper(root);

    const uris = await vscode.workspace.findFiles(
      '**/AndroidManifest.xml',
      '{**/build/**,**/.gradle/**,**/generated/**}',
      200,
    );
    if (uris.length === 0) return;

    const byModule = new Map<string, vscode.Uri[]>();
    for (const uri of uris) {
      const rel    = path.relative(root, uri.fsPath).replace(/\\/g, '/');
      const module = rel.replace(/\/?src\/.*$/, '');
      if (!byModule.has(module)) byModule.set(module, []);
      byModule.get(module)!.push(uri);
    }

    for (const [module, manifestUris] of byModule) {
      const hasLauncher = manifestUris.some(uri => {
        try { return fs.readFileSync(uri.fsPath, 'utf8').includes('android.intent.category.LAUNCHER'); }
        catch { return false; }
      });
      if (!hasLauncher) continue;

      const gradleModule = module ? ':' + module.replace(/\//g, ':') : '';

      // Skip if already cached from a previous session
      if (context.workspaceState.get<string>(TASK_KEY(gradleModule))) continue;

      log.debug(`[android:run] bg discovery: ${gradleModule || 'root'}`);
      const tasks = await discoverInstallTasksRaw(gradlew, gradleModule, root, log);

      if (tasks.length === 1) {
        const fullTask = `${gradleModule}:${tasks[0]}`;
        await context.workspaceState.update(TASK_KEY(gradleModule), fullTask);
        log.info(`[android:run] bg cached: ${gradleModule || 'root'} → ${fullTask}`);
      } else if (tasks.length > 1) {
        await context.workspaceState.update(TASK_CANDIDATES_KEY(gradleModule), tasks);
        log.info(`[android:run] bg cached candidates: ${gradleModule || 'root'} → [${tasks.join(', ')}]`);
      }
    }
  } catch (e) {
    log.debug(`[android:run] bg discovery error: ${e}`);
  }
}

// ── Task resolution ───────────────────────────────────────────────────────────

// Cache-first. Discovery runs at most once per module per session (deduplicated).
async function resolveInstallTask(
  gradlew: string,
  gradleModule: string,
  projectRoot: string,
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<string | undefined> {
  // 1. Already resolved (background found 1 task, or user already picked)
  const resolved = context.workspaceState.get<string>(TASK_KEY(gradleModule));
  if (resolved) {
    log.debug(`[android:run] task (cached): ${resolved}`);
    return resolved;
  }

  // 2. Candidates ready from background — instant QuickPick
  const candidates = context.workspaceState.get<string[]>(TASK_CANDIDATES_KEY(gradleModule));
  if (candidates && candidates.length > 0) {
    return pickFromCandidates(candidates, gradleModule, context, log);
  }

  // 3. Neither cache exists — run discovery now (first click on a fresh project)
  setDiscoveringTasks();
  const tasks = await discoverInstallTasksRaw(gradlew, gradleModule, projectRoot, log);

  if (tasks.length === 0) {
    // Fallback: honour the legacy androidVariant setting
    const variant  = vscode.workspace.getConfiguration('kotlinJump').get<string>('androidVariant', 'Debug');
    const fallback = `${gradleModule}:install${variant}`;
    log.warn(`[android:run] no install tasks found — fallback: ${fallback}`);
    await context.workspaceState.update(TASK_KEY(gradleModule), fallback);
    return fallback;
  }

  if (tasks.length === 1) {
    const task = `${gradleModule}:${tasks[0]}`;
    log.info(`[android:run] auto-selected task: ${task}`);
    await context.workspaceState.update(TASK_KEY(gradleModule), task);
    return task;
  }

  // Multiple candidates — ask user once, cache forever
  await context.workspaceState.update(TASK_CANDIDATES_KEY(gradleModule), tasks);
  return pickFromCandidates(tasks, gradleModule, context, log);
}

async function pickFromCandidates(
  candidates: string[],
  gradleModule: string,
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<string | undefined> {
  // Debug variants first, then alphabetical
  const sorted = [...candidates].sort((a, b) => {
    const aD = a.toLowerCase().includes('debug') ? 0 : 1;
    const bD = b.toLowerCase().includes('debug') ? 0 : 1;
    return (aD - bD) || a.localeCompare(b);
  });

  const pick = await vscode.window.showQuickPick(
    sorted.map(t => ({ label: t, description: `${gradleModule || ''}:${t}`, task: t })),
    { placeHolder: 'Multiple build variants found — select one', title: 'Kotlin Jump — Select Build Variant' },
  );
  if (!pick) return undefined;

  const fullTask = `${gradleModule}:${pick.task}`;
  log.info(`[android:run] user selected: ${fullTask}`);
  await context.workspaceState.update(TASK_KEY(gradleModule), fullTask);
  return fullTask;
}

// Runs `gradlew [module]:tasks --group install --console=plain` and parses result.
// Concurrent calls for the same module share one exec (deduplication via promise map).
async function discoverInstallTasksRaw(
  gradlew: string,
  gradleModule: string,
  projectRoot: string,
  log: Logger,
): Promise<string[]> {
  const key      = gradleModule || 'root';
  const existing = _taskDiscoveryPromises.get(key);
  if (existing) return existing;

  const cmd = gradleModule
    ? `"${gradlew}" ${gradleModule}:tasks --group install --console=plain`
    : `"${gradlew}" tasks --group install --console=plain`;

  log.info(`[android:run] discovering tasks: ${cmd}`);

  const promise = new Promise<string[]>(resolve => {
    const timer = setTimeout(() => {
      log.warn('[android:run] task discovery timeout (30s)');
      resolve([]);
    }, 30_000);

    exec(cmd, { cwd: projectRoot }, (err, stdout) => {
      clearTimeout(timer);
      if (err) {
        log.warn(`[android:run] task discovery failed: ${err.message.split('\n')[0]}`);
        resolve([]);
        return;
      }
      const tasks = parseInstallTasks(stdout);
      log.info(`[android:run] tasks for ${key}: [${tasks.join(', ')}]`);
      resolve(tasks);
    });
  });

  _taskDiscoveryPromises.set(key, promise);
  void promise.finally(() => _taskDiscoveryPromises.delete(key));
  return promise;
}

// Extracts install task names from `gradlew tasks` output.
// Keeps only the "Install tasks" section, skips *AndroidTest tasks.
function parseInstallTasks(output: string): string[] {
  const tasks: string[] = [];
  let inInstallSection = false;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (/^Install tasks/i.test(trimmed)) {
      inInstallSection = true;
      continue;
    }

    if (inInstallSection) {
      // Any new section header ends the install block
      if (/^[A-Z][\w ]+tasks$/i.test(trimmed) && !/^Install/i.test(trimmed)) break;

      const match = trimmed.match(/^(\w+)\s+-/);
      if (match && !match[1].endsWith('AndroidTest')) tasks.push(match[1]);
    }
  }

  return tasks;
}

// ── Terminal management ───────────────────────────────────────────────────────

function getOrCreateTerminal(projectRoot: string): vscode.Terminal {
  const existing = vscode.window.terminals.find(
    t => t.name === 'Android Run' && t.exitStatus === undefined,
  );
  if (existing) return existing;

  return vscode.window.createTerminal({
    name: 'Android Run',
    cwd: projectRoot,
    isTransient: true,
  });
}

// ── Device & emulator management ─────────────────────────────────────────────
// Mirrors _android_check_and_select_emulator() in zshrc

function runShell(cmd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    exec(cmd, (err, stdout) => resolve(err ? undefined : stdout.trim()));
  });
}

// ── ADB WiFi discovery (macOS only — dns-sd / mDNS) ─────────────────────────

// host = .local hostname (macOS resolves via mDNS natively — no IP resolution needed)
type WifiDevice = { instance: string; host: string; port: string };

function runDnsSd(args: string[], timeoutMs: number): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn('dns-sd', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    setTimeout(() => { try { proc.kill(); } catch {} resolve(out); }, timeoutMs);
  });
}

export async function discoverWifiDevices(log: Logger): Promise<WifiDevice[]> {
  // Step 1: browse — list service instances broadcasting ADB over WiFi
  const browseOut = await runDnsSd(['-B', '_adb-tls-connect._tcp', 'local'], 3000);
  const instances = browseOut.split('\n')
    .filter(l => l.includes(' Add '))
    .map(l => l.trim().split(/\s+/).at(-1))
    .filter((x): x is string => Boolean(x));

  log.debug(`[android:wifi] browse found ${instances.length} instance(s)`);
  if (instances.length === 0) return [];

  const devices: WifiDevice[] = [];
  const seenHosts = new Set<string>();

  for (const instance of instances) {
    // Step 2: lookup — resolve "can be reached at HOSTNAME:PORT"
    const lookupOut = await runDnsSd(['-L', instance, '_adb-tls-connect._tcp', 'local'], 3000);
    const reached = lookupOut.match(/can be reached at (\S+)/)?.[1];
    if (!reached) continue;
    const colonIdx = reached.lastIndexOf(':');
    const rawHost = reached.slice(0, colonIdx);
    const port = reached.slice(colonIdx + 1);
    if (!rawHost || !port) continue;
    // Strip trailing DNS dot (FQDN → plain hostname for adb connect)
    const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
    if (seenHosts.has(host)) continue;

    seenHosts.add(host);
    devices.push({ instance, host, port });
    log.info(`[android:wifi] found: ${host}:${port}`);
  }
  return devices;
}

async function connectAdbWifi(log: Logger): Promise<string | undefined> {
  if (process.platform !== 'darwin') {
    vscode.window.showErrorMessage(
      'Kotlin Jump: ADB WiFi discovery requires macOS (uses dns-sd). On Linux, run: avahi-browse -r -t _adb-tls-connect._tcp',
    );
    return undefined;
  }

  let devices: WifiDevice[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Kotlin Jump — ADB WiFi', cancellable: false },
    async progress => {
      progress.report({ message: 'Scanning network for Android devices…' });
      devices = await discoverWifiDevices(log);
    },
  );

  if (devices.length === 0) {
    vscode.window.showErrorMessage(
      'No Android device found via Wireless Debugging.',
      { modal: true, detail: 'Check:\n• Developer options are enabled\n• Wireless debugging is ON\n• Device and computer are on the same WiFi network' },
    );
    return undefined;
  }

  let chosen: WifiDevice;
  if (devices.length === 1) {
    chosen = devices[0];
  } else {
    const pick = await vscode.window.showQuickPick(
      devices.map(d => ({ label: `$(device-mobile) ${d.instance}`, description: `port ${d.port}`, device: d })),
      { placeHolder: 'Multiple devices found — select one', title: 'Kotlin Jump — ADB WiFi' },
    );
    if (!pick) return undefined;
    chosen = pick.device;
  }

  // Use hostname directly — macOS resolves .local names via mDNS natively.
  // Avoids IP resolution (saves 3 s) and the IP-lookup race condition.
  const serial = `${chosen.host}:${chosen.port}`;
  const result = await runShell(`adb connect ${serial}`);
  log.info(`[android:wifi] adb connect ${serial} → ${result}`);

  if (result?.includes('connected to') || result?.includes('already connected')) {
    vscode.window.showInformationMessage(`Kotlin Jump: Connected to ${chosen.instance} ✓`);
    return serial;
  }
  if (result?.includes('failed to authenticate')) {
    vscode.window.showErrorMessage(
      'ADB authentication failed — device not paired yet.',
      { modal: true, detail: 'Pair first: Settings → Developer options → Wireless debugging → Pair device with pairing code.\nThen try again.' },
    );
    return undefined;
  }
  vscode.window.showErrorMessage(`Kotlin Jump: ADB WiFi failed. ${result ?? 'Unknown error'}`);
  return undefined;
}

// Returns first connected device serial, filtering mDNS duplicates (like zshrc replica())
async function getConnectedDevice(): Promise<string | undefined> {
  const output = await runShell('adb devices');
  if (!output) return undefined;

  for (const line of output.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('_adb-tls-connect')) continue;
    if (trimmed.endsWith('\tdevice') || /\tdevice\b/.test(trimmed)) {
      const serial = trimmed.split(/\s+/)[0];
      if (serial) return serial;
    }
  }
  return undefined;
}

function findEmulatorBin(): string | undefined {
  const candidates = [
    process.env['ANDROID_HOME']     && path.join(process.env['ANDROID_HOME'],     'emulator', 'emulator'),
    process.env['ANDROID_SDK_ROOT'] && path.join(process.env['ANDROID_SDK_ROOT'], 'emulator', 'emulator'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'emulator', 'emulator'),
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'emulator', 'emulator.exe'),
  ].filter(Boolean) as string[];

  return candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}

async function listAvds(log: Logger): Promise<string[]> {
  const bin = findEmulatorBin();
  if (!bin) { log.debug('[android:run] emulator binary not found'); return []; }
  const output = await runShell(`"${bin}" -list-avds`);
  if (!output) return [];
  return output.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('Android SDK') && !l.includes('found at:'));
}

async function startEmulatorAndWait(avdName: string, log: Logger): Promise<string | undefined> {
  const bin = findEmulatorBin();
  if (!bin) return undefined;

  log.info(`[android:run] starting emulator: ${avdName}`);
  spawn(bin, ['-avd', avdName], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const device = await getConnectedDevice();
    if (device) { log.info(`[android:run] emulator ready: ${device}`); return device; }
  }

  log.warn('[android:run] emulator boot timeout (90s)');
  return undefined;
}

// Ensures a device is connected; offers WiFi discovery or AVD launch if not.
async function ensureDeviceConnected(log: Logger): Promise<string | undefined> {
  const device = await getConnectedDevice();
  if (device) { log.debug(`[android:run] device: ${device}`); return device; }

  log.info('[android:run] no device — showing connection picker');
  const avds = await listAvds(log);

  type DevicePick =
    | { label: string; description: string; tag: 'wifi' }
    | { label: string; description: string; tag: 'avd'; avd: string }
    | { label: string; kind: vscode.QuickPickItemKind; tag: 'sep' };

  const items: DevicePick[] = [
    { label: '$(wifi) Connect via WiFi…', description: 'Wireless Debugging — device on same network', tag: 'wifi' },
  ];
  if (avds.length > 0) {
    items.push({ label: 'Emulators', kind: vscode.QuickPickItemKind.Separator, tag: 'sep' });
    items.push(...avds.map(name => ({
      label: `$(vm) ${name}`, description: 'Android Virtual Device', tag: 'avd' as const, avd: name,
    })));
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'No device connected — connect via WiFi or start an emulator',
    title: 'Kotlin Jump — Connect Device',
  });
  if (!pick || pick.tag === 'sep') return undefined;

  if (pick.tag === 'wifi') {
    return connectAdbWifi(log);
  }

  // tag === 'avd'
  setStartingEmulator();

  const booted = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Starting ${pick.avd}…`, cancellable: false },
    () => startEmulatorAndWait(pick.avd, log),
  );

  if (!booted) {
    vscode.window.showWarningMessage('Kotlin Jump: Emulator may still be booting — try Run again in a moment.');
    setIdle();
    return undefined;
  }

  return booted;
}

// ── Status bar states ─────────────────────────────────────────────────────────

function setBuilding(): void {
  _isBuilding = true;
  if (!_runButton) return;
  _runButton.text            = '$(sync~spin) Building…';
  _runButton.backgroundColor = undefined;
}

function setLaunching(): void {
  if (!_runButton) return;
  _runButton.text            = '$(rocket) Launching…';
  _runButton.backgroundColor = undefined;
}

function setStartingEmulator(): void {
  if (!_runButton) return;
  _runButton.text            = '$(vm~spin) Starting emulator…';
  _runButton.backgroundColor = undefined;
}

function setDiscoveringTasks(): void {
  if (!_runButton) return;
  _runButton.text            = '$(sync~spin) Detecting tasks…';
  _runButton.backgroundColor = undefined;
}

function setIdle(): void {
  _isBuilding = false;
  if (!_runButton) return;
  _runButton.text            = _currentAppName ? `$(play) ${_currentAppName}` : '$(play) Run';
  _runButton.backgroundColor = undefined;
}

function onSuccess(): void {
  _isBuilding = false;
  if (!_runButton) return;
  _runButton.text            = '$(check) Launched!';
  _runButton.backgroundColor = undefined;
  setTimeout(setIdle, 3000);
}

function onBuildFailure(terminal: vscode.Terminal): void {
  _isBuilding = false;
  if (_runButton) {
    _runButton.text            = '$(error) Build failed';
    _runButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    setTimeout(setIdle, 8000);
  }
  terminal.show(/* preserveFocus */ false);
}

function onLaunchFailed(terminal: vscode.Terminal): void {
  _isBuilding = false;
  if (_runButton) {
    _runButton.text            = '$(warning) Launch failed';
    _runButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    setTimeout(setIdle, 6000);
  }
  vscode.window.showWarningMessage(
    'Kotlin Jump: Build succeeded but app launch failed — check the terminal for details.',
    'Show Terminal',
  ).then(choice => { if (choice) terminal.show(false); });
}

// ── Project detection ─────────────────────────────────────────────────────────

async function detectAndroidProject(
  context: vscode.ExtensionContext,
  log: Logger,
): Promise<AndroidConfig | undefined> {
  const projectRoot = findProjectRoot(log);
  if (!projectRoot) {
    vscode.window.showErrorMessage('Kotlin Jump: No Gradle project found in the workspace.');
    return undefined;
  }
  const gradlew = resolveGradleWrapper(projectRoot);

  // ── Explicit project list (highest priority) ──────────────────────────────
  const explicitProjects = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<ExplicitProject[]>('androidProjects', []);

  if (explicitProjects.length > 0) {
    return detectFromExplicit(explicitProjects, context, projectRoot, gradlew, log);
  }

  // ── Auto-detection ────────────────────────────────────────────────────────
  const cached = context.workspaceState.get<AndroidModuleInfo>('androidRunConfig');
  if (cached) {
    // Guard against stale values from older versions (file paths like "src/main/AndroidManifest.xml")
    const lastSegment = cached.module.split('/').pop() ?? '';
    if (lastSegment.includes('.')) {
      log.warn(`[android:run] clearing stale cached path: "${cached.module}"`);
      await context.workspaceState.update('androidRunConfig', undefined);
    } else {
      log.debug(`[android:run] cached module: ${cached.module} (${cached.packageName})`);
      return buildConfig(cached, projectRoot, gradlew);
    }
  }

  // Scan ALL AndroidManifest.xml (any source set — flavors may have LAUNCHER in src/debug/)
  const uris = await vscode.workspace.findFiles(
    '**/AndroidManifest.xml',
    '{**/build/**,**/.gradle/**,**/generated/**}',
    200,
  );

  if (uris.length === 0) {
    vscode.window.showErrorMessage(
      'Kotlin Jump: No AndroidManifest.xml found — is this an Android project?\n' +
      'Tip: set kotlinJump.androidProjects in settings.json for complex monorepos.',
    );
    return undefined;
  }

  // Group by module: "rubicon/app/src/debug/AndroidManifest.xml" → "rubicon/app"
  const byModule = new Map<string, vscode.Uri[]>();
  for (const uri of uris) {
    const rel    = path.relative(projectRoot, uri.fsPath).replace(/\\/g, '/');
    const module = rel.replace(/\/?src\/.*$/, '');
    if (!byModule.has(module)) byModule.set(module, []);
    byModule.get(module)!.push(uri);
  }

  // Keep only modules with a LAUNCHER activity in any source set
  const modules: AndroidModuleInfo[] = [];
  for (const [module, manifestUris] of byModule) {
    const hasLauncher = manifestUris.some(uri => {
      try { return fs.readFileSync(uri.fsPath, 'utf8').includes('android.intent.category.LAUNCHER'); }
      catch { return false; }
    });
    if (!hasLauncher) continue;

    const packageName =
      findApplicationId(projectRoot, module) ??
      manifestUris.reduce<string | undefined>((found, uri) => {
        if (found) return found;
        try { return fs.readFileSync(uri.fsPath, 'utf8').match(/\bpackage="([^"]+)"/)?.[1]; }
        catch { return undefined; }
      }, undefined);

    if (!packageName) continue;
    modules.push({ module, packageName });
  }

  if (modules.length === 0) {
    vscode.window.showErrorMessage(
      'Kotlin Jump: No Android app module found.\n' +
      'Set kotlinJump.androidProjects in settings.json to configure your apps explicitly.',
    );
    return undefined;
  }

  let selected: AndroidModuleInfo;
  if (modules.length === 1) {
    selected = modules[0];
    log.info(`[android:run] single module: ${selected.module}`);
  } else {
    log.info(`[android:run] ${modules.length} modules — picker`);
    const pick = await vscode.window.showQuickPick(
      modules.map(m => ({ label: m.module, description: m.packageName, meta: m })),
      { placeHolder: 'Select the Android app module to run', title: 'Kotlin Jump — Run Android App' },
    );
    if (!pick) return undefined;
    selected = pick.meta;
  }

  await context.workspaceState.update('androidRunConfig', selected);
  _currentAppName  = selected.module;
  _hasMultipleApps = modules.length > 1;
  updateSwitchButtonVisibility();
  return buildConfig(selected, projectRoot, gradlew);
}

// ── Explicit project path ─────────────────────────────────────────────────────

async function detectFromExplicit(
  projects: ExplicitProject[],
  context: vscode.ExtensionContext,
  projectRoot: string,
  gradlew: string,
  log: Logger,
): Promise<AndroidConfig | undefined> {
  let selected: ExplicitProject;

  if (projects.length === 1) {
    selected = projects[0];
  } else {
    const cachedName    = context.workspaceState.get<string>('androidRunConfigExplicit');
    const cachedProject = cachedName ? projects.find(p => p.name === cachedName) : undefined;
    if (cachedProject) {
      log.debug(`[android:run] cached explicit: ${cachedProject.name}`);
      selected = cachedProject;
    } else {
      log.info(`[android:run] ${projects.length} explicit projects — picker`);
      const pick = await vscode.window.showQuickPick(
        projects.map(p => ({ label: p.name, description: `${p.module} — ${p.package}`, meta: p })),
        { placeHolder: 'Select app to run', title: 'Kotlin Jump — Run Android App' },
      );
      if (!pick) return undefined;
      selected = pick.meta;
    }
  }

  await context.workspaceState.update('androidRunConfigExplicit', selected.name);
  _currentAppName  = selected.name;
  _hasMultipleApps = projects.length > 1;
  updateSwitchButtonVisibility();

  const variant     = selected.variant ?? vscode.workspace.getConfiguration('kotlinJump').get<string>('androidVariant', 'Debug');
  const gradleModule = selected.module ? ':' + selected.module.replace(/\//g, ':') : '';
  const installTask  = `${gradleModule}:install${variant}`;

  log.info(`[android:run] explicit: ${selected.name} → ${installTask} (${selected.package})`);

  return {
    module: selected.module, gradleModule, packageName: selected.package,
    installTask, projectRoot, gradlew,
    isExplicit: true,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Reads the merged AndroidManifest.xml produced by Gradle after a successful build.
// Returns the real package name and fully-qualified LAUNCHER activity — exactly what
// Android Studio reads before calling `adb shell am start -n`.
// Consistent across AGP 7.x and 8.x.
function readMergedManifest(
  projectRoot: string,
  gradleModule: string,   // e.g. ":replica:app" or "" for flat layout
  installTask: string,    // e.g. ":replica:app:installReplicaLaPresseDebug"
): MergedManifestInfo | undefined {
  // Derive variant directory from install task name:
  // ":replica:app:installReplicaLaPresseDebug" → strip up to last "install" → "ReplicaLaPresseDebug"
  // → lowercase first char → "replicaLaPresseDebug"
  const taskLocal        = installTask.replace(/^.*:install/, 'install');  // "installReplicaLaPresseDebug"
  const variantCapitalized = taskLocal.replace(/^install/, '');            // "ReplicaLaPresseDebug"
  if (!variantCapitalized) return undefined;
  const variantDir = variantCapitalized.charAt(0).toLowerCase() + variantCapitalized.slice(1);

  // Module directory: ":replica:app" → "replica/app" → {projectRoot}/replica/app
  const moduleRelPath = gradleModule ? gradleModule.replace(/^:/, '').replace(/:/g, '/') : '';
  const moduleDir     = moduleRelPath ? path.join(projectRoot, moduleRelPath) : projectRoot;

  // AGP 7.x: merged_manifests/{variant}/AndroidManifest.xml
  // AGP 8.x: merged_manifests/{variant}/process{Variant}Manifest/merged/AndroidManifest.xml
  const candidates = [
    path.join(moduleDir, 'build', 'intermediates', 'merged_manifests', variantDir, 'AndroidManifest.xml'),
    path.join(moduleDir, 'build', 'intermediates', 'merged_manifests', variantDir, `process${variantCapitalized}Manifest`, 'merged', 'AndroidManifest.xml'),
  ];

  let content: string | undefined;
  for (const p of candidates) {
    try { content = fs.readFileSync(p, 'utf8'); break; }
    catch { /* try next */ }
  }
  if (!content) return undefined;

  const packageName = content.match(/<manifest[^>]*\bpackage="([^"]+)"/)?.[1];
  if (!packageName) return undefined;

  const launcherActivity = parseLauncherActivity(content, packageName);
  if (!launcherActivity) return undefined;

  return { packageName, launcherActivity };
}

// Finds the activity with android.intent.category.LAUNCHER in a merged manifest
// and returns the fully-qualified "package/ActivityClass" component string.
function parseLauncherActivity(content: string, packageName: string): string | undefined {
  const blocks = content.split('<activity');
  for (const block of blocks.slice(1)) {
    if (!block.includes('android.intent.category.LAUNCHER')) continue;

    const name = block.match(/android:name="([^"]+)"/)?.[1];
    if (!name) continue;

    if (name.startsWith('.')) {
      // ".ReplicaStartActivity" → "com.example/.ReplicaStartActivity"
      return `${packageName}/${name}`;
    } else if (!name.includes('.')) {
      // "MainActivity" (no dots = relative shorthand) → "com.example/.MainActivity"
      return `${packageName}/.${name}`;
    } else {
      // "com.example.app.MainActivity" (fully qualified) → "com.example/com.example.app.MainActivity"
      return `${packageName}/${name}`;
    }
  }
  return undefined;
}

// Reads applicationId (+ optional applicationIdSuffix) from build.gradle(.kts).
// Handles both Kotlin DSL (=) and Groovy DSL (space) syntax.
function findApplicationId(projectRoot: string, module: string): string | undefined {
  const dirs = module ? [path.join(projectRoot, module), projectRoot] : [projectRoot];

  for (const dir of dirs) {
    for (const name of ['build.gradle.kts', 'build.gradle']) {
      try {
        const content = fs.readFileSync(path.join(dir, name), 'utf8');
        const baseId  = content.match(/\bapplicationId\s*[=\s]\s*"([^"]+)"/)?.[1];
        if (!baseId) continue;
        const suffix  = content.match(/\bapplicationIdSuffix\s*[=\s]\s*"([^"]+)"/)?.[1] ?? '';
        return baseId + suffix;
      } catch { /* skip */ }
    }
  }
  return undefined;
}

// Builds a fallback AndroidConfig using the legacy androidVariant setting.
// For auto-detected modules, resolveInstallTask() will override installTask at run time.
function buildConfig(
  info: AndroidModuleInfo,
  projectRoot: string,
  gradlew: string,
): AndroidConfig {
  const variant     = vscode.workspace.getConfiguration('kotlinJump').get<string>('androidVariant', 'Debug');
  const gradleModule = info.module ? ':' + info.module.replace(/\//g, ':') : '';
  const installTask  = `${gradleModule}:install${variant}`;
  return { ...info, gradleModule, installTask, projectRoot, gradlew };
}
