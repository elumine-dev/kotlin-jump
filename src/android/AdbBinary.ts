import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';
import * as vscode from 'vscode';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdbDevice {
  serial: string;          // "emulator-5554", USB serial, "192.168.1.10:5555", "adb-XXXX-YYYY"
  state: 'device' | 'offline' | 'unauthorized' | 'unknown';
  model?: string;          // e.g. "Pixel_8" — from `-l` extended output
  transport: 'usb' | 'tcp' | 'mdns';
}

// ── Path resolution ──────────────────────────────────────────────────────────

let _cachedAdbPath: string | undefined;

/**
 * Resolves the `adb` binary path.
 *
 * Priority: `kotlinJump.adbPath` setting → ANDROID_HOME → ANDROID_SDK_ROOT →
 * common SDK install paths → bare `adb` (relies on PATH at exec time).
 *
 * Cached after first call. Invalidate via {@link invalidateAdbPathCache} when
 * the setting changes — see {@link watchAdbPathSetting} for the auto-wired version.
 */
export function resolveAdbPath(): string {
  if (_cachedAdbPath) return _cachedAdbPath;

  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';

  const configured = vscode.workspace.getConfiguration('kotlinJump').get<string>('adbPath');
  if (configured && configured.trim() && existsQuiet(configured)) {
    return _cachedAdbPath = configured;
  }

  const envDirs = [process.env['ANDROID_HOME'], process.env['ANDROID_SDK_ROOT']].filter(Boolean) as string[];
  for (const dir of envDirs) {
    const candidate = path.join(dir, 'platform-tools', exe);
    if (existsQuiet(candidate)) return _cachedAdbPath = candidate;
  }

  const home = os.homedir();
  const common = process.platform === 'win32'
    ? [path.join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', exe)]
    : process.platform === 'darwin'
      ? [
          path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', exe),
          '/opt/homebrew/bin/adb',
          '/usr/local/bin/adb',
        ]
      : [
          path.join(home, 'Android', 'Sdk', 'platform-tools', exe),
          '/usr/local/bin/adb',
          '/usr/bin/adb',
        ];

  for (const candidate of common) {
    if (existsQuiet(candidate)) return _cachedAdbPath = candidate;
  }

  // Fallback: rely on PATH. exec/spawn will surface ENOENT if missing.
  return _cachedAdbPath = exe;
}

export function invalidateAdbPathCache(): void {
  _cachedAdbPath = undefined;
}

/**
 * Watches `kotlinJump.adbPath` and clears the cache on change.
 * Returns a disposable to register with `context.subscriptions`.
 */
export function watchAdbPathSetting(): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('kotlinJump.adbPath')) invalidateAdbPathCache();
  });
}

// ── Process invocation ───────────────────────────────────────────────────────

/**
 * Runs `adb <args>` (one-shot) and resolves with trimmed stdout, or `undefined`
 * on non-zero exit / spawn error / timeout.
 *
 * Uses argv (no shell) — safe against injection through device serials, package
 * names, etc.
 */
export function runAdb(args: string[], opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string | undefined> {
  return new Promise(resolve => {
    const adb = resolveAdbPath();
    const cmd = `${quoteShell(adb)} ${args.map(quoteShell).join(' ')}`;
    exec(cmd, {
      signal:  opts?.signal,
      timeout: opts?.timeoutMs ?? 30_000,
      maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim());
    });
  });
}

/**
 * Spawns `adb <args>` for long-running streams (logcat, track-devices, …).
 * Caller owns the lifecycle (kill, stdout/stderr handlers, exit listener).
 */
export type AdbProcess = ChildProcessByStdio<null, Readable, Readable>;

export function spawnAdb(args: string[]): AdbProcess {
  return spawn(resolveAdbPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Runs an arbitrary shell command. Used for the small set of cases that need
 * a shell pipeline (e.g. `echo "$code" | adb pair host:port`) or for non-adb
 * tools (`dns-sd`, `emulator`).
 *
 * Prefer {@link runAdb} for plain adb invocations.
 */
export function runShell(cmd: string): Promise<string | undefined> {
  return new Promise(resolve => {
    exec(cmd, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim());
    });
  });
}

// ── Device enumeration ───────────────────────────────────────────────────────

/**
 * Lists devices via `adb devices -l`. Returns structured entries — every line
 * past the header, including offline/unauthorized devices (callers filter as needed).
 */
export async function listConnectedDevices(): Promise<AdbDevice[]> {
  const output = await runAdb(['devices', '-l']);
  if (!output) return [];
  return parseDevicesOutput(output);
}

/**
 * Pure parser for the output of `adb devices -l`. Exported separately so that
 * the parser can be exercised by unit tests without spawning adb.
 *
 * Filters daemon-startup chatter ("* daemon not running...", "* daemon started")
 * and the localized headers, plus any line that does not parse as a real
 * device entry (must end with a recognised state token).
 */
export function parseDevicesOutput(output: string): AdbDevice[] {
  const devices: AdbDevice[] = [];
  const lines = output.split('\n');

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Skip daemon notification lines and the "List of devices attached" header.
    if (trimmed.startsWith('*')) continue;
    if (trimmed.toLowerCase().startsWith('list of devices')) continue;
    if (trimmed.toLowerCase().startsWith('error:')) continue;

    const firstWs = trimmed.search(/\s/);
    if (firstWs < 0) continue;
    const serial = trimmed.slice(0, firstWs);
    const rest   = trimmed.slice(firstWs).trim();
    const stateRaw = rest.split(/\s+/)[0] ?? '';

    // Must be one of the known states — anything else is noise we mistakenly
    // matched (e.g. a daemon line we failed to filter, a localized header).
    if (stateRaw !== 'device' && stateRaw !== 'offline' && stateRaw !== 'unauthorized') {
      continue;
    }
    const state = stateRaw as AdbDevice['state'];

    const model = rest.match(/model:(\S+)/)?.[1];

    let transport: AdbDevice['transport'] = 'usb';
    if (serial.startsWith('adb-') || rest.includes('_adb-tls-connect')) {
      transport = 'mdns';
    } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(serial)) {
      transport = 'tcp';
    } else if (serial.startsWith('emulator-')) {
      transport = 'tcp';
    }

    devices.push({ serial, state, model, transport });
  }
  return devices;
}

/**
 * Returns the first usable device serial. USB / explicit-IP devices win over
 * mDNS auto-entries (which can be stale and fail `adb install`).
 *
 * Drop-in replacement for the legacy `getConnectedDevice()` in AndroidRunCommand.
 */
export async function getFirstConnectedDevice(): Promise<string | undefined> {
  const ready = (await listConnectedDevices()).filter(d => d.state === 'device');
  return (ready.find(d => d.transport !== 'mdns') ?? ready[0])?.serial;
}

// ── Internals ────────────────────────────────────────────────────────────────

function existsQuiet(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

/**
 * Quotes a token for inclusion in a shell command line.
 * Keeps the existing `runShell`-via-exec pattern safe when paths or args contain spaces.
 */
function quoteShell(s: string): string {
  if (process.platform === 'win32') {
    // cmd.exe metacharacters: & | < > ^ in addition to space and quote. Without
    // these we leave a small command-injection foothold open if a serial,
    // package name, or path ever contains them.
    return /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  return /[\s"'$`\\!&|<>;()]/.test(s) ? `'${s.replace(/'/g, `'"'"'`)}'` : s;
}
