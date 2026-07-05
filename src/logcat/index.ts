import * as vscode from 'vscode';
import type { SymbolIndex } from '../indexer/SymbolIndex';
import type { Logger } from '../util/logger';
import { LogcatService } from './LogcatService';
import { LogcatViewProvider } from './LogcatViewProvider';
import { LogcatDevicesTreeProvider } from './LogcatDevicesTreeProvider';
import { LogcatStatusBar } from './LogcatStatusBar';
import { onRunSuccess, type RunSuccessEvent } from '../android/RunEvents';

/**
 * workspaceState key — set when the user explicitly stops Logcat with
 * `kotlinJump.logcat.stop` and cleared on `kotlinJump.logcat.start` /
 * `kotlinJump.logcat.resume`. Cleared at activation so a stale value from a
 * previous window does not block auto-start.
 */
export const SNOOZE_KEY = 'kotlinJump.logcat.autoStart.snoozedThisSession';

/**
 * Pure auto-start handler — extracted so tests can exercise the snooze, the
 * disabled-setting branch, the panel-visible quiet path, and the disconnected
 * device guard without booting the whole `registerLogcat` integration.
 */
export interface AutoStartDeps {
  service:         Pick<LogcatService, 'listDevices' | 'switchDevice' | 'setFollowedPackage' | 'startWatching'>;
  viewProvider:    { readonly visible: boolean };
  devicesProvider: { setActive(s: string): void };
  workspaceState:  { get<T>(k: string): T | undefined; update(k: string, v: unknown): Thenable<void> };
  configEnabled:   () => boolean;   // kotlinJump.logcat.autoStart
  showToast:       (pkg: string) => Thenable<string | undefined>;
  showLogcat:      () => Thenable<unknown>;
  log:             Pick<Logger, 'debug' | 'warn'>;
}

export async function handleAutoStart(deps: AutoStartDeps, ev: RunSuccessEvent): Promise<void> {
  if (!deps.configEnabled()) return;
  // A successful Android Run is a strong engagement signal even if the user
  // never opened the Logcat panel — start the (idempotent) device watcher so
  // the Devices tree reacts live if they open the panel after a disconnect.
  deps.service.startWatching();
  if (deps.workspaceState.get<boolean>(SNOOZE_KEY) === true) {
    deps.log.debug('[logcat:auto] snoozed — skipping');
    return;
  }
  // Don't trust the device serial blindly — the device may have been unplugged
  // between the install step and now.
  const devices = await deps.service.listDevices();
  if (!devices.some(d => d.serial === ev.device)) {
    deps.log.warn(`[logcat:auto] ${ev.device} not present at run-success — skip`);
    return;
  }

  deps.service.switchDevice(ev.device);
  deps.service.setFollowedPackage(ev.packageName);
  deps.devicesProvider.setActive(ev.device);

  // Quiet path: panel already open → no toast, the user is watching.
  if (deps.viewProvider.visible) return;

  const action = await deps.showToast(ev.packageName);
  if (action === 'Show Logcat') {
    await deps.showLogcat();
  }
}

export function registerLogcat(
  context: vscode.ExtensionContext,
  log: Logger,
  index: SymbolIndex,
): LogcatService {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  if (!cfg.get<boolean>('logcat.enabled', true)) {
    log.info('[logcat] disabled via kotlinJump.logcat.enabled');
    return new LogcatService(index, log);
  }

  // Reset the auto-start snooze on every activation. workspaceState persists
  // across reloads; we want "snooze for this session" semantics.
  void context.workspaceState.update(SNOOZE_KEY, undefined);

  const bufferCap = cfg.get<number>('logcat.bufferSize', 100_000);
  const service   = new LogcatService(index, log, bufferCap);
  // NOTE: the ADB device watcher is started lazily, not here. Starting it
  // unconditionally at activation meant every workspace with a single .kt file
  // spawned `adb track-devices` (or retried every 3s if adb was missing) for
  // the entire VS Code session, regardless of whether Logcat was ever used.
  // startWatching() is idempotent, so it's called instead from the first real
  // signal of relevance: LogcatViewProvider.resolveWebviewView (panel opened),
  // the pickDevice/start commands below, and handleAutoStart (an Android Run
  // succeeded).

  const viewProvider    = new LogcatViewProvider(context.extensionUri, service);
  const devicesProvider = new LogcatDevicesTreeProvider(service);

  const pill = new LogcatStatusBar();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LogcatViewProvider.VIEW_ID, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerTreeDataProvider('kotlinJump.logcat.devices', devicesProvider),
    pill,
    service,
    viewProvider,
  );

  // ── Status-bar pill wiring ────────────────────────────────────────────────
  service.on('state', (s: { paused: boolean; bufferUsed: number; bufferCap: number; throughputPerSec: number; streaming: boolean }) => {
    pill.setState({
      hasSession:       !!service.getCurrentSerial(),
      paused:           s.paused,
      streaming:        s.streaming,
      bufferUsed:       s.bufferUsed,
      bufferCap:        s.bufferCap,
      throughputPerSec: s.throughputPerSec,
      device:           service.getCurrentDevice(),
      pkg:              service.getFollowedPackage(),
    });
  });
  service.on('reset',   () => pill.setState({ error: undefined }));
  service.on('devices', () => pill.setState({ hasSession: !!service.getCurrentSerial() }));
  service.on('stream-error', (err: unknown) => {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
    pill.setState({ error: { message, at: Date.now() } });
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kotlinJump.statusBarEnabled') ||
          e.affectsConfiguration('kotlinJump.logcat.statusBarPill') ||
          e.affectsConfiguration('kotlinJump.logcat.enabled')) {
        pill.refreshVisibility();
      }
    }),
  );

  // ── Commands ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlinJump.logcat.show', async () => {
      await vscode.commands.executeCommand(`${LogcatViewProvider.VIEW_ID}.focus`);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.pause', () => service.pause()),
    vscode.commands.registerCommand('kotlinJump.logcat.resume', () => {
      service.resume();
      void context.workspaceState.update(SNOOZE_KEY, undefined);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.clear', () => service.clear()),
    vscode.commands.registerCommand('kotlinJump.logcat.stop', () => {
      // Real stop — tears down the adb process and its timers, not just a mute.
      service.stop();
      // User-initiated stop snoozes the next auto-start until they resume manually.
      void context.workspaceState.update(SNOOZE_KEY, true);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.start', () => {
      service.startWatching();
      service.start();
      void context.workspaceState.update(SNOOZE_KEY, undefined);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.export', async () => {
      const text = service.exportFiltered();
      const doc = await vscode.workspace.openTextDocument({ content: text, language: 'log' });
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
    vscode.commands.registerCommand('kotlinJump.logcat.pickDevice', async (serial?: string) => {
      // Safety net — the panel isn't necessarily open yet if this was invoked
      // from the Command Palette. startWatching() is idempotent.
      service.startWatching();
      let chosen = serial;
      if (!chosen) {
        const devices = await service.listDevices();
        const items = devices.map(d => ({
          label:       d.model ?? d.serial,
          description: `${d.serial}  ${d.state}`,
          serial:      d.serial,
        }));
        if (items.length === 0) {
          vscode.window.showInformationMessage('Kotlin Jump Logcat: no devices connected.');
          return;
        }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Pick device for Logcat' });
        chosen = pick?.serial;
      }
      if (chosen) {
        service.switchDevice(chosen);
        devicesProvider.setActive(chosen);
      }
    }),
  );

  // ── Hidden demo commands (gated by env var; not declared in package.json) ─
  // These power the marketplace demo recording. They MUST stay unreachable
  // from a normal user session — `record.ts` sets KJ_DEMO_MODE=1.
  const inDemoMode = () => process.env['KJ_DEMO_MODE'] === '1';
  context.subscriptions.push(
    vscode.commands.registerCommand('kotlinJump.logcat._streamFixture', async (fixturePath: string, opts?: { speed?: number }) => {
      if (!inDemoMode()) {
        log.warn('[logcat:demo] _streamFixture refused — KJ_DEMO_MODE not set');
        return;
      }
      await service.streamFixture(fixturePath, opts);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat._demoClickFrame', async (matcher, frameIndex: number) => {
      if (!inDemoMode()) return;
      await service.demoClickFrame(matcher, frameIndex);
    }),
    vscode.commands.registerCommand('kotlinJump.logcat._demoFlashFrame', (matcher, frameIndex: number) => {
      if (!inDemoMode()) return;
      service.demoFlashFrame(matcher, frameIndex);
    }),
  );

  // ── Auto-start: subscribe to runAndroid success ───────────────────────────
  context.subscriptions.push(
    onRunSuccess(ev => handleAutoStart({
      service, viewProvider, devicesProvider,
      workspaceState: context.workspaceState,
      configEnabled: () => vscode.workspace.getConfiguration('kotlinJump').get<boolean>('logcat.autoStart', true),
      showToast:  pkg => vscode.window.showInformationMessage(`Logcat capturing ${pkg}`, 'Show Logcat'),
      showLogcat: ()  => vscode.commands.executeCommand('kotlinJump.logcat.show'),
      log,
    }, ev)),
  );

  // React to buffer-size changes without requiring a reload.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('kotlinJump.logcat.bufferSize')) {
        const next = vscode.workspace.getConfiguration('kotlinJump').get<number>('logcat.bufferSize', 100_000);
        service.setBufferCap(next);
        log.info(`[logcat] buffer capacity → ${next}`);
      }
    }),
  );

  return service;
}

