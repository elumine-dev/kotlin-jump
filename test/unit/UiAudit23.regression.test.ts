import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as AdbBinary from '../../src/android/AdbBinary';
import * as PackageList from '../../src/android/PackageList';
import { AdbDeviceWatcher } from '../../src/android/AdbDeviceWatcher';
import { LogcatLineParser, STACK_FRAME_REGEX } from '../../src/logcat/LogcatLineParser';
import { LogcatStackResolver, looksObfuscated } from '../../src/logcat/LogcatStackResolver';
import { LogcatStream } from '../../src/logcat/LogcatStream';
import { LogcatService, logcatTimeArg } from '../../src/logcat/LogcatService';
import { LogMirror, ALL_LEVELS } from '../../media/logcat/logMirror';
import { parseLauncherActivity, gradleCommandFor } from '../../src/commands/AndroidRunCommand';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import type { LogEntry } from '../../src/logcat/messages';
import type { Logger } from '../../src/util/logger';

// Audit 23 : panneau Logcat, stream adb, lancement Android.

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const noopLog: Logger = { channel: { appendLine: () => {} } as any, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
const noopIndex = { lookupFqn: () => undefined } as unknown as SymbolIndex;
let seq = 0;
const entry = (over: Partial<LogEntry>): LogEntry =>
  ({ seq: seq++, ts: 0, tsDisplay: '00:00:00.000', pid: 1, tid: 1, level: 'I', tag: 't', message: 'm', ...over });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ── Parseur de lignes ─────────────────────────────────────────────────────────

describe('LogcatLineParser', () => {
  it('un marqueur de buffer ne se colle pas au message précédent', () => {
    const p = new LogcatLineParser();
    const s = () => seq++;
    expect(p.feed('2026-01-15 12:34:56.789  1234  5678 D MyTag: hello', s)).toBeNull();
    expect(p.feed('--------- beginning of system', s)).toBeNull();
    expect(p.feed('--------- switch to main', s)).toBeNull();
    const done = p.feed('2026-01-15 12:34:56.790  1234  5678 D MyTag: next', s);
    expect(done?.message).toBe('hello');
  });

  it('reconnaît les frames Kotlin manglées et les fichiers R8 SourceFile / Unknown Source', () => {
    for (const line of [
      '\tat com.app.UserId.toString-impl(UserId.kt:12)',
      '\tat androidx.compose.ui.unit.Dp.compareTo-0680j_4(Dp.kt:100)',
      '\tat com.app.MainKt.main$lambda-3(Main.kt:9)',
      '\tat a.b.c.d(SourceFile:12)',
      '\tat a.b.c.d(Unknown Source:12)',
    ]) expect(STACK_FRAME_REGEX.test(line), line).toBe(true);
    expect(STACK_FRAME_REGEX.test('Caused by: java.lang.IllegalStateException: oops')).toBe(false);
    expect(STACK_FRAME_REGEX.test('\tat java.lang.Thread.run(Native Method)')).toBe(false);
  });
});

describe('LogcatStackResolver', () => {
  it('résout une fonction top-level via FooKt et marque un build R8 comme obfusqué', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///app/Utils.kt', 'package com.app\nfun helper() {}'));
    const resolver = new LogcatStackResolver(index);
    const e = entry({ message: 'boom\n\tat com.app.UtilsKt.helper(Utils.kt:10)' });
    resolver.resolve(e);
    expect(e.frames?.[0]?.uri).toBe('file:///app/Utils.kt');

    const r8 = entry({ message: 'boom\n\tat a.b.c.d(SourceFile:12)\n\tat a.b.e.f(Unknown Source:3)' });
    resolver.resolve(r8);
    expect(r8.frames?.length).toBe(2);
    expect(looksObfuscated(r8)).toBe(true);
  });
});

// ── Stream adb ────────────────────────────────────────────────────────────────

function fakeProc() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => {}, pid: 1,
  });
}

describe('LogcatStream', () => {
  it('une séquence UTF-8 coupée entre deux chunks reste intacte', () => {
    const proc = fakeProc();
    vi.spyOn(AdbBinary, 'spawnAdb').mockReturnValue(proc as any);
    const stream = new LogcatStream({ serial: 'x' }, () => seq++);
    const entries: LogEntry[] = [];
    stream.on('entry', e => entries.push(e));
    stream.start();
    const bytes = Buffer.from('2026-01-15 12:34:56.789  1  1 I T: café été\n2026-01-15 12:34:56.790  1  1 I T: fin\n');
    const cut = bytes.indexOf('é') + 1; // au milieu des deux octets du premier é
    proc.stdout.emit('data', bytes.subarray(0, cut));
    proc.stdout.emit('data', bytes.subarray(cut));
    expect(entries[0]?.message).toBe('café été');
  });

  it('passe -T à adb quand une borne est fournie et signale une sortie non nulle', () => {
    const proc = fakeProc();
    const spawn = vi.spyOn(AdbBinary, 'spawnAdb').mockReturnValue(proc as any);
    const stream = new LogcatStream({ serial: 'x', since: '2026-01-15 12:34:56.789' }, () => seq++);
    const errors: string[] = [];
    const closes: unknown[] = [];
    stream.on('error', e => errors.push(e.message));
    stream.on('close', c => closes.push(c));
    stream.start();
    expect(spawn.mock.calls[0]?.[0]).toEqual(['-s', 'x', 'logcat', '-v', 'threadtime,year', '-b', 'main,system,crash', '-T', '2026-01-15 12:34:56.789']);
    proc.stderr.emit('data', Buffer.from("error: device 'x' not found\n"));
    proc.emit('close', 1);
    expect(errors).toEqual(["error: device 'x' not found"]);
    expect(closes).toEqual([1]);
  });

  it('un processus secondaire :sync est signalé comme secondaire', () => {
    const proc = fakeProc();
    vi.spyOn(AdbBinary, 'spawnAdb').mockReturnValue(proc as any);
    const stream = new LogcatStream({ serial: 'x' }, () => seq++);
    const starts: unknown[] = [];
    stream.on('process-start', (pid, pkg, secondary) => starts.push([pid, pkg, secondary]));
    stream.start();
    proc.stdout.emit('data', Buffer.from([
      '2026-01-15 12:00:00.000  1  1 I ActivityManager: Start proc 4521:com.example.app/u0a99 for activity {x}',
      '2026-01-15 12:00:00.001  1  1 I ActivityManager: Start proc 4600:com.example.app:sync/u0a99 for service {y}',
      '2026-01-15 12:00:00.002  1  1 I T: end',
    ].join('\n') + '\n'));
    expect(starts).toEqual([[4521, 'com.example.app', false], [4600, 'com.example.app', true]]);
  });
});

// ── Service ───────────────────────────────────────────────────────────────────

type Internals = {
  filter: { followedPid?: number; followedPids: Set<number>; followAppPid: boolean };
  pending: LogEntry[];
  stream?: any;
  currentSerial?: string;
  onEntry(e: LogEntry): void;
  flushPending(): void;
  watcher: AdbDeviceWatcher;
};

describe('LogcatService', () => {
  it('changer d\'appareil oublie le PID de l\'ancien et le résout sur le nouveau', async () => {
    const calls: string[] = [];
    vi.spyOn(PackageList, 'resolvePids').mockImplementation(async (serial) => { calls.push(serial); return serial === 'B' ? [999] : [4521]; });
    vi.spyOn(AdbBinary, 'spawnAdb').mockImplementation(() => fakeProc() as any);
    const svc = new LogcatService(noopIndex, noopLog, 100);
    const i = svc as unknown as Internals;
    svc.switchDevice('A');
    svc.setFollowedPackage('com.example.app');
    await new Promise(r => setTimeout(r, 5));
    expect(i.filter.followedPid).toBe(4521);
    svc.switchDevice('B');
    expect(i.filter.followedPid).toBeUndefined();
    await new Promise(r => setTimeout(r, 5));
    expect(calls).toEqual(['A', 'B']);
    expect(i.filter.followedPid).toBe(999);
    svc.dispose();
  });

  it('un processus secondaire est suivi sans remplacer le PID principal', () => {
    vi.spyOn(AdbBinary, 'spawnAdb').mockImplementation(() => fakeProc() as any);
    const svc = new LogcatService(noopIndex, noopLog, 100);
    const i = svc as unknown as Internals;
    svc.switchDevice('A');
    svc.setFollowedPackage('com.example.app');
    i.stream.emit('process-start', 4521, 'com.example.app', false);
    i.stream.emit('process-start', 4600, 'com.example.app', true);
    i.stream.emit('process-start', 7, 'com.other', false);
    expect(i.filter.followedPid).toBe(4521);
    expect([...i.filter.followedPids]).toEqual([4521, 4600]);
    const shown: number[] = [];
    svc.on('append', (rows: LogEntry[]) => shown.push(...rows.map(r => r.pid)));
    for (const pid of [4521, 4600, 7]) i.onEntry(entry({ pid }));
    i.flushPending();
    expect(shown).toEqual([4521, 4600]);
    svc.dispose();
  });

  it('activer le filtre PID vide la file en attente', () => {
    vi.spyOn(AdbBinary, 'spawnAdb').mockImplementation(() => fakeProc() as any);
    const svc = new LogcatService(noopIndex, noopLog, 100);
    const i = svc as unknown as Internals;
    svc.switchDevice('A');
    svc.setFollowAppPid(false);
    i.filter.followedPids = new Set([1]);
    i.onEntry(entry({ pid: 2 }));
    i.onEntry(entry({ pid: 3 }));
    expect(i.pending.length).toBe(2);
    svc.setFollowAppPid(true);
    expect(i.pending.length).toBe(0);
    svc.dispose();
  });

  it('appareil débranché : arrêt sans relance en boucle, reprise avec -T à son retour', () => {
    vi.useFakeTimers();
    const spawn = vi.spyOn(AdbBinary, 'spawnAdb').mockImplementation(() => fakeProc() as any);
    const svc = new LogcatService(noopIndex, noopLog, 100);
    const i = svc as unknown as Internals;
    svc.switchDevice('A');
    i.onEntry(entry({ ts: Date.parse('2026-01-15T12:34:56.789') }));
    vi.spyOn(i.watcher, 'stateOf').mockReturnValue('absent');
    i.stream.emit('close', 1);
    vi.advanceTimersByTime(2100);
    expect(svc.snapshotState().streaming).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(spawn).toHaveBeenCalledTimes(1);
    i.watcher.emit('change', [{ serial: 'A', state: 'device', transport: 'usb' }]);
    expect(svc.snapshotState().streaming).toBe(true);
    expect(spawn.mock.calls[1]?.[0]).toContain('-T');
    expect(spawn.mock.calls[1]?.[0]).toContain('2026-01-15 12:34:56.789');
    svc.dispose();
  });

  it('l\'export garde l\'heure de l\'appareil', () => {
    const svc = new LogcatService(noopIndex, noopLog, 100);
    const i = svc as unknown as Internals;
    i.onEntry(entry({ ts: Date.parse('2026-01-15T12:34:56.789'), tsDisplay: '12:34:56.789', level: 'W', tag: 'Tag', message: 'x' }));
    expect(svc.exportFiltered()).toBe('2026-01-15 12:34:56.789  W  1/1  Tag: x');
    expect(logcatTimeArg(Date.parse('2026-03-05T07:08:09.010'))).toBe('2026-03-05 07:08:09.010');
    svc.dispose();
  });
});

describe('AdbDeviceWatcher.stateOf', () => {
  it('inconnu avant la première liste, puis présent ou absent', async () => {
    vi.spyOn(AdbBinary, 'listConnectedDevices').mockResolvedValue([{ serial: 'A', state: 'device', transport: 'usb' }, { serial: 'B', state: 'offline', transport: 'usb' }]);
    const w = new AdbDeviceWatcher();
    expect(w.stateOf('A')).toBe('unknown');
    await w.refresh();
    expect(w.stateOf('A')).toBe('device');
    expect(w.stateOf('B')).toBe('absent');
    expect(w.stateOf('C')).toBe('absent');
    w.dispose();
  });
});

// ── Webview ───────────────────────────────────────────────────────────────────

describe('LogMirror.append', () => {
  const filter = { levels: new Set(ALL_LEVELS), hasTag: false, tagLow: '', hasSearch: false, searchLow: '' };
  it('retourne le nombre de lignes affichées évincées', () => {
    const m = new LogMirror(3);
    expect(m.append([entry({}), entry({}), entry({})], filter)).toBe(0);
    expect(m.append([entry({}), entry({})], filter)).toBe(2);
  });
  it('avec un filtre actif, ne compte que les lignes filtrées évincées', () => {
    const m = new LogMirror(3);
    const f = { ...filter, hasTag: true, tagLow: 'keep' };
    m.rebuild(f);
    m.append([entry({ tag: 'keep' }), entry({ tag: 'drop' }), entry({ tag: 'keep' })], f);
    expect(m.displayCount()).toBe(2);
    expect(m.append([entry({ tag: 'drop' })], f)).toBe(1);
    expect(m.append([entry({ tag: 'drop' })], f)).toBe(0);
  });
});

// ── Lancement Android ─────────────────────────────────────────────────────────

describe('parseLauncherActivity', () => {
  const manifest = [
    '<manifest package="com.app"><application>',
    '<activity-alias android:name=".IconDark" android:enabled="false" android:targetActivity=".MainActivity">',
    '<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>',
    '</activity-alias>',
    '<activity android:name=".Settings"><intent-filter><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>',
    '<activity android:name=".MainActivity"',
    '    android:exported="true">',
    '<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>',
    '</activity></application></manifest>',
  ].join('\n');

  it('saute un alias désactivé et une activité sans MAIN', () => {
    expect(parseLauncherActivity(manifest, 'com.app')).toBe('com.app/.MainActivity');
  });

  it('un alias activé est un lanceur valide', () => {
    const enabled = manifest.replace('android:enabled="false"', 'android:enabled="true"');
    expect(parseLauncherActivity(enabled, 'com.app')).toBe('com.app/.IconDark');
  });
});

describe('gradleCommandFor', () => {
  it('préfixe & pour PowerShell sur Windows seulement', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(gradleCommandFor('C:\\p\\gradlew.bat', 'installDebug', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('& "C:\\p\\gradlew.bat" installDebug');
      expect(gradleCommandFor('C:\\p\\gradlew.bat', 'installDebug', 'C:\\Windows\\System32\\cmd.exe')).toBe('"C:\\p\\gradlew.bat" installDebug');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
    expect(gradleCommandFor('/p/gradlew', 'installDebug', '/bin/zsh')).toBe('"/p/gradlew" installDebug');
  });
});
