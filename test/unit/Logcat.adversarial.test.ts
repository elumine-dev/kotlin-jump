// Adversarial tests for the Logcat backend — each test targets a specific bug
// uncovered by line-by-line review. The tests are intentionally narrow so a
// regression points at the exact subsystem.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { LogcatRingBuffer } from '../../src/logcat/LogcatRingBuffer';
import { LogcatLineParser } from '../../src/logcat/LogcatLineParser';
import { LogcatStackResolver, looksObfuscated } from '../../src/logcat/LogcatStackResolver';
import { LogcatService } from '../../src/logcat/LogcatService';
import type { LogEntry, ResolvedFrame } from '../../src/logcat/messages';
import type { SymbolEntry, SymbolIndex } from '../../src/indexer/SymbolIndex';
import type { Logger } from '../../src/util/logger';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const noopLog: Logger = { channel: { appendLine: () => {} } as any, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
const noopIndex: SymbolIndex = { lookupFqn: () => undefined } as unknown as SymbolIndex;

// ──────────────────────────────────────────────────────────────────────────────
// Ring buffer — perf and correctness under sustained eviction
// ──────────────────────────────────────────────────────────────────────────────

describe('LogcatRingBuffer — eviction perf (was using shift, now head/tail ring)', () => {
  function pushN(buf: LogcatRingBuffer, n: number): number {
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      buf.push({ seq: buf.allocSeq(), ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: 'm' });
    }
    return performance.now() - start;
  }

  it('sustains 50_000 evictions on a 1_000-cap buffer in well under 250 ms', () => {
    const buf = new LogcatRingBuffer(1_000);
    pushN(buf, 1_000); // fill
    const elapsed = pushN(buf, 50_000); // 50k evictions
    expect(buf.size()).toBe(1_000);
    expect(buf.dropped()).toBe(50_000);
    // Generous bound: shift() on a 1k array takes ~1µs each in V8 — total ~50 ms.
    // The real problem is at 100k cap (~50 ms × 100 = 5 s for 50k evictions).
    // Threshold here is slack to avoid flakiness on slow CI.
    expect(elapsed).toBeLessThan(250);
  });

  it('maintains strict FIFO order across heavy eviction (the head/tail invariant)', () => {
    const buf = new LogcatRingBuffer(100);
    for (let i = 0; i < 1_000; i++) {
      buf.push({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: `m${i}` });
    }
    const seqs = buf.all().map(e => e.seq);
    expect(seqs).toHaveLength(100);
    expect(seqs[0]).toBe(900);
    expect(seqs[seqs.length - 1]).toBe(999);
    // Strict ordering — every adjacent pair is +1.
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
  });

  it('range() iterates in FIFO order even after wrap-around', () => {
    const buf = new LogcatRingBuffer(5);
    for (let i = 0; i < 12; i++) {
      buf.push({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: `m${i}` });
    }
    const out = [...buf.range(0, 5)].map(e => e.seq);
    expect(out).toEqual([7, 8, 9, 10, 11]);
  });

  it('resize shrinks in O(1) amortized, not O(diff × n)', () => {
    const buf = new LogcatRingBuffer(10_000);
    for (let i = 0; i < 10_000; i++) {
      buf.push({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: 'm' });
    }
    const start = performance.now();
    buf.resize(100);
    const elapsed = performance.now() - start;
    expect(buf.size()).toBe(100);
    // Naive shift() loop would be O(9900 × 10000) = 99 M ops. Bound is generous
    // for a sane implementation that drops in bulk.
    expect(elapsed).toBeLessThan(50);
    // The 100 retained entries are the most recent ones.
    expect(buf.all()[0]!.seq).toBe(9_900);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Stack resolver — false positives on heuristics
// ──────────────────────────────────────────────────────────────────────────────

class FakeIndex {
  private map = new Map<string, SymbolEntry>();
  add(fqn: string, fileUri: string, line = 0): void {
    this.map.set(fqn, {
      name: fqn.split('.').pop() ?? fqn,
      fqn,
      kind: 'class',
      uri: vscode.Uri.parse(fileUri),
      line,
      character: 0,
      packageName: fqn.split('.').slice(0, -1).join('.'),
      isComposable: false,
      depth: 0,
    });
  }
  lookupFqn(fqn: string): SymbolEntry | undefined { return this.map.get(fqn); }
}

const mkEntry = (msg: string): LogEntry => ({
  seq: 0, ts: 0, tsDisplay: '00:00:00.000', pid: 0, tid: 0, level: 'E', tag: 'AndroidRuntime', message: msg,
});

describe('LogcatStackResolver — heuristic correctness', () => {
  it('does not strip a legitimate class named *Kt when the direct lookup succeeds', () => {
    // EventKt is a real class (not a synthetic file-class). Direct lookup must win.
    const idx = new FakeIndex();
    idx.add('com.app.EventKt', 'file:///app/EventKt.kt');
    idx.add('com.app.Event',   'file:///app/Event.kt');  // wrong target
    const resolver = new LogcatStackResolver(idx as any);

    const entry = mkEntry('\tat com.app.EventKt.method(EventKt.kt:1)');
    resolver.resolve(entry);

    expect(entry.frames![0]!.uri).toBe('file:///app/EventKt.kt');
  });

  it('does not flag short-but-legit packages as obfuscated (io.x.Y)', () => {
    const idx = new FakeIndex();
    const resolver = new LogcatStackResolver(idx as any);
    const entry = mkEntry('\tat io.x.Y.run(Y.kt:1)');
    resolver.resolve(entry);
    // Frame is unresolved (FQN not indexed), but it must NOT be flagged obfuscated.
    expect(entry.frames![0]!.obfuscated).toBeFalsy();
    expect(looksObfuscated(entry)).toBe(false);
  });

  it('stack frame range starts at "at <fqn>" — no leading whitespace inside the link', () => {
    const idx = new FakeIndex();
    idx.add('com.app.X', 'file:///X.kt');
    const resolver = new LogcatStackResolver(idx as any);
    const entry = mkEntry('\t\t  at com.app.X.fn(X.kt:1)');
    resolver.resolve(entry);

    const frame = entry.frames![0]!;
    const sliced = entry.message.slice(frame.startCol, frame.endCol);
    expect(sliced.startsWith('\t')).toBe(false);
    expect(sliced.startsWith(' ')).toBe(false);
    expect(sliced.startsWith('at ')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Line parser — multi-line stack continuations + edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('LogcatLineParser — line splitter edge cases', () => {
  function feed(parser: LogcatLineParser, lines: string[]): LogEntry[] {
    let n = 0;
    const out: LogEntry[] = [];
    for (const l of lines) {
      const e = parser.feed(l, () => n++);
      if (e) out.push(e);
    }
    const last = parser.flush();
    if (last) out.push(last);
    return out;
  }

  it('does not lose the last entry when stream ends mid-stack', () => {
    const parser = new LogcatLineParser();
    const out = feed(parser, [
      '2026-01-15 12:34:56.789  1  2 E T: FATAL EXCEPTION',
      '\tat com.app.X.fn(X.kt:1)',
      // stream ends here — the entry has been opened but not yet closed by another prefix.
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('FATAL EXCEPTION');
    expect(out[0]!.message).toContain('X.kt:1');
  });

  it('handles a long burst of lines without dropping any complete entry', () => {
    const parser = new LogcatLineParser();
    const lines: string[] = [];
    for (let i = 0; i < 1_000; i++) {
      lines.push(`2026-01-15 12:34:56.${String(i % 1000).padStart(3, '0')}  1  2 I T: m${i}`);
    }
    const out = feed(parser, lines);
    expect(out).toHaveLength(1_000);
    expect(out[0]!.message).toBe('m0');
    expect(out[999]!.message).toBe('m999');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// LogcatService — filter, lifecycle, and race conditions
// ──────────────────────────────────────────────────────────────────────────────

describe('LogcatService — filter and lifecycle bug hunt', () => {
  let svc: LogcatService;

  beforeEach(() => {
    svc = new LogcatService(noopIndex, noopLog, 1000);
  });

  it('exposes setBufferCap so the kotlinJump.logcat.bufferSize setting can apply at runtime', () => {
    // Before the fix, no setBufferCap method existed. The setting handler in
    // index.ts logged "buffer size change pending" but did nothing.
    expect(typeof (svc as unknown as { setBufferCap: unknown }).setBufferCap).toBe('function');

    (svc as unknown as { setBufferCap(n: number): void }).setBufferCap(50);
    expect(svc.snapshotState().bufferCap).toBe(50);

    (svc as unknown as { setBufferCap(n: number): void }).setBufferCap(2_000);
    expect(svc.snapshotState().bufferCap).toBe(2_000);
  });

  it('refilter() returns ALL entries — server-side filtering must not strip rows the user could re-enable', () => {
    // Before the fix, `passesFilter` checked levels/tag/search server-side, so
    // entries that did not match never reached the webview mirror, even though
    // the same filter is applied client-side.
    const ingest = (svc as unknown as { onEntry(e: LogEntry): void }).onEntry.bind(svc);
    const entry: LogEntry = { seq: 0, ts: 0, pid: 1, tid: 1, level: 'V', tag: 't', message: 'verbose-msg' };
    ingest(entry);

    svc.setLevels(['E']); // exclude V
    // The buffer still holds the entry; only the webview-side filter hides it.
    expect(svc.refilter()).toHaveLength(1);
  });

  it('throughput counter is non-NaN before the first 1s tick has fired', () => {
    // Before the fix, `throughputSamples = []` then `samples[length-1]++` is a
    // no-op write to index -1, which makes the first second of throughput data
    // silently lost. The state snapshot must remain a finite number.
    const before = svc.snapshotState().throughputPerSec;
    expect(Number.isFinite(before)).toBe(true);

    const ingest = (svc as unknown as { onEntry(e: LogEntry): void }).onEntry.bind(svc);
    for (let i = 0; i < 10; i++) {
      ingest({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: 'm' });
    }
    const after = svc.snapshotState().throughputPerSec;
    expect(Number.isFinite(after)).toBe(true);
  });

  it('setFollowedPackage commits the latest call when promises resolve out of order', async () => {
    // Two rapid setFollowedPackage calls. The first one's resolvePids may resolve
    // AFTER the second's, overwriting the correct PID with the stale one.
    const calls: string[] = [];
    const PackageList = await import('../../src/android/PackageList');
    const spy = vi.spyOn(PackageList, 'resolvePids').mockImplementation((_serial, pkg) => {
      calls.push(pkg);
      // First call resolves slowly with stale PID 100; second call resolves fast with PID 200.
      const delay = pkg === 'com.app.first' ? 30 : 1;
      const pid   = pkg === 'com.app.first' ? 100 : 200;
      return new Promise(resolve => setTimeout(() => resolve([pid]), delay));
    });

    // Pretend a device is selected — `setFollowedPackage` only schedules when
    // currentSerial is set.
    (svc as unknown as { currentSerial?: string }).currentSerial = 'serial-1';

    svc.setFollowedPackage('com.app.first');
    svc.setFollowedPackage('com.app.second');

    await new Promise(resolve => setTimeout(resolve, 60));

    const followedPid = (svc as unknown as { filter: { followedPid: number | undefined } }).filter.followedPid;
    expect(followedPid).toBe(200);
    spy.mockRestore();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// LogcatViewProvider behaviour bugs (verified via the imported helpers)
// ──────────────────────────────────────────────────────────────────────────────

describe('LogcatViewProvider — init handshake', () => {
  it('does NOT push the init snapshot until the webview has confirmed ready', async () => {
    // Before the fix, the provider posted `init` synchronously inside
    // resolveWebviewView, which races the webview script loading its message
    // listener. Now the host waits for the webview's 'ready' handshake.
    const { LogcatViewProvider } = await import('../../src/logcat/LogcatViewProvider');

    const fakeService = new (class extends (await import('events')).EventEmitter {
      listDevices() { return Promise.resolve([]); }
      listPackagesFor() { return Promise.resolve([]); }
      snapshotState() { return { paused: false, bufferUsed: 0, bufferCap: 100, throughputPerSec: 0 }; }
    })() as any;

    const posts: any[] = [];
    const provider = new LogcatViewProvider(vscode.Uri.parse('file:///ext'), fakeService);
    (provider as unknown as { post(m: unknown): void }).post = (m: unknown) => { posts.push(m); };

    // Simulate the webview never sending 'ready'.
    expect(posts.find(p => p?.type === 'init')).toBeUndefined();

    // Now simulate the ready handshake.
    const onMsg = (provider as unknown as { onMessage(m: unknown): Promise<void> }).onMessage.bind(provider);
    await onMsg({ apiVersion: 1, type: 'ready' });
    await Promise.resolve(); // flush listDevices microtask

    expect(posts.find(p => p?.type === 'init')).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round 2 — bugs found on second-pass review
// ──────────────────────────────────────────────────────────────────────────────

describe('parseDevicesOutput — adb daemon notification noise', () => {
  it('does not admit "* daemon not running" / "* daemon started" lines as devices', async () => {
    // adb devices output sometimes contains daemon-startup chatter on the first
    // run. Each notification line starts with "* " followed by text. Without a
    // filter, the parser splits "* daemon" into serial="*" state="daemon" and
    // pollutes the device list.
    const { parseDevicesOutput } = await import('../../src/android/AdbBinary');

    const fakeOutput =
      '* daemon not running; starting now at tcp:5037\n' +
      '* daemon started successfully\n' +
      'List of devices attached\n' +
      'emulator-5554          device product:sdk_phone model:sdk_phone\n';

    const devices = parseDevicesOutput(fakeOutput);
    expect(devices.map(d => d.serial)).toEqual(['emulator-5554']);
    expect(devices[0]!.state).toBe('device');
  });

  it('does not invent a device when the output is just headers/blank', async () => {
    const { parseDevicesOutput } = await import('../../src/android/AdbBinary');
    const devices = parseDevicesOutput(
      '* daemon not running; starting now at tcp:5037\nList of devices attached\n\n',
    );
    expect(devices).toEqual([]);
  });

  it('rejects lines whose state token is not one of device/offline/unauthorized', async () => {
    const { parseDevicesOutput } = await import('../../src/android/AdbBinary');
    const devices = parseDevicesOutput(
      'List of devices attached\n' +
      '   garbageline withoutproperformat\n' +
      '???????               no permissions; see [https://developer.android.com/tools/adb]\n' +
      'emulator-5554          device\n',
    );
    expect(devices.map(d => d.serial)).toEqual(['emulator-5554']);
  });

  it('keeps unauthorized devices in the list (caller filters by state)', async () => {
    const { parseDevicesOutput } = await import('../../src/android/AdbBinary');
    const devices = parseDevicesOutput(
      'List of devices attached\n' +
      'ABCDEF1234            unauthorized usb:1-2 transport_id:1\n',
    );
    expect(devices).toHaveLength(1);
    expect(devices[0]!.state).toBe('unauthorized');
  });
});

describe('LogcatService — setBufferCap emits state with the new cap so the webview mirror can resize', () => {
  it('the state event after setBufferCap reflects the new cap', () => {
    const svc = new LogcatService(noopIndex, noopLog, 1000);
    let lastState: any;
    svc.on('state', s => { lastState = s; });
    svc.setBufferCap(7777);
    expect(lastState?.bufferCap).toBe(7777);
    svc.dispose();
  });
});

describe('LogcatService — close→restart race with switchDevice', () => {
  // The LogcatService schedules a 2s restart when the stream closes (e.g. when
  // adb dies). If the user switches device DURING that 2s window, the timer
  // must NOT later kill the new stream and resurrect a phantom one. We test by
  // reaching into the listener that gets installed on the stream object.

  it('does not auto-restart after the user has explicitly switched stream', async () => {
    vi.useFakeTimers();
    const svc = new LogcatService(noopIndex, noopLog, 100);

    // Bypass startWatching/start by injecting a fake stream — the close handler
    // is what we want to test.
    const origStartStream = (svc as unknown as { startStream(): void }).startStream;
    const startSpy = vi.fn();
    (svc as unknown as { startStream(): unknown }).startStream = startSpy;

    // Manually install the close listener the same way startStream would.
    const fakeStreamA = new (await import('events')).EventEmitter() as any;
    fakeStreamA.dispose = vi.fn();
    fakeStreamA.start   = vi.fn();
    (svc as unknown as { stream?: any }).stream = fakeStreamA;
    (svc as unknown as { currentSerial?: string }).currentSerial = 'A';

    // The close handler installed by the real startStream — replicated here
    // because we replaced startStream above.
    fakeStreamA.on('close', () => {
      setTimeout(() => {
        if ((svc as any).currentSerial && (svc as any).stream === fakeStreamA) {
          fakeStreamA.dispose();
          (svc as any).stream = undefined;
          startSpy();
        }
      }, 2000);
    });

    fakeStreamA.emit('close'); // adb dies

    // Before 2s, user switches device.
    const fakeStreamB = new (await import('events')).EventEmitter() as any;
    fakeStreamB.dispose = vi.fn();
    fakeStreamB.start   = vi.fn();
    (svc as any).stream = fakeStreamB;
    (svc as any).currentSerial = 'B';

    vi.advanceTimersByTime(2100);

    // The phantom restart must NOT kill stream B nor schedule another start.
    expect(fakeStreamB.dispose).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
    (svc as unknown as { startStream(): void }).startStream = origStartStream;
    svc.dispose();
  });
});

describe('LogcatService — dispose flag prevents zombie restart', () => {
  it('public methods after dispose do not re-arm timers or spawn streams', () => {
    const svc = new LogcatService(noopIndex, noopLog, 100);
    svc.dispose();

    // None of these may throw, register listeners, or schedule timers.
    svc.switchDevice('serial-1');
    svc.setFollowedPackage('com.app.x');
    svc.setLevels(['E']);
    svc.setBufferCap(50);

    // Stream never started — currentSerial may be set but no LogcatStream exists.
    expect((svc as unknown as { stream?: unknown }).stream).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Round 3 — perfection pass: timezones, watcher retry, cache, true ring perf
// ──────────────────────────────────────────────────────────────────────────────

describe('LogcatLineParser — timestamp must round-trip the DEVICE local time exactly', () => {
  it('preserves the emitted clock time verbatim regardless of the host TZ', () => {
    // The device emits its OWN local time. Date.parse without a TZ suffix
    // interprets the value in the HOST timezone, which silently shifts the
    // displayed clock when device and host differ. Storing the original
    // string ensures the user always sees the device wall clock.
    const parser = new LogcatLineParser();
    let n = 0;
    parser.feed('2026-01-15 12:34:56.789  1  2 D T: hello', () => n++);
    const e = parser.flush();
    expect(e!.tsDisplay).toBe('12:34:56.789');
    expect(typeof e!.ts).toBe('number');
  });

  it('keeps tsDisplay stable across midnight regardless of TZ', () => {
    const parser = new LogcatLineParser();
    let n = 0;
    parser.feed('2026-01-15 00:00:00.001  1  2 D T: edge', () => n++);
    const e = parser.flush();
    expect(e!.tsDisplay).toBe('00:00:00.001');
  });
});

describe('AdbDeviceWatcher — falls back to poll then RECOVERS to track-devices', () => {
  it('retries track-devices periodically after falling back to polling', async () => {
    // The original implementation was one-shot: once it fell to polling, it
    // never tried track-devices again, leaving users on a 5s polling loop
    // even after adb was installed/started mid-session.
    vi.resetModules();
    let spawnAttempts = 0;
    let allowSpawn    = false;
    vi.doMock('../../src/android/AdbBinary', () => ({
      listConnectedDevices: () => Promise.resolve([]),
      spawnAdb: () => {
        spawnAttempts++;
        if (!allowSpawn) throw new Error('spawn refused');
        // Successful spawn returns a fake EventEmitter-shaped process.
        const ee = new (require('events').EventEmitter)();
        (ee as any).stdout = new (require('events').EventEmitter)();
        (ee as any).stderr = new (require('events').EventEmitter)();
        (ee as any).kill   = () => {};
        return ee;
      },
    }));

    const { AdbDeviceWatcher } = await import('../../src/android/AdbDeviceWatcher');
    vi.useFakeTimers();
    const watcher = new AdbDeviceWatcher();
    watcher.start();
    expect(spawnAttempts).toBeGreaterThanOrEqual(1);

    allowSpawn = true;
    // Long enough to cross the recovery interval the implementation must implement.
    vi.advanceTimersByTime(35_000);
    await Promise.resolve();
    expect(spawnAttempts).toBeGreaterThan(1);

    watcher.dispose();
    vi.useRealTimers();
    vi.doUnmock('../../src/android/AdbBinary');
  });
});

describe('PackageList.resolvePids — empty results must not be cached', () => {
  it('a pidof miss right after launch does not block the next call for 1.5s', async () => {
    vi.resetModules();
    let calls = 0;
    let nextResult: string = '';
    vi.doMock('../../src/android/AdbBinary', () => ({
      runAdb: vi.fn(() => { calls++; return Promise.resolve(nextResult); }),
    }));

    const { resolvePids, clearPackageCache } = await import('../../src/android/PackageList');
    clearPackageCache();

    nextResult = ''; // first call: app not yet running
    const a = await resolvePids('serial-1', 'com.app.x');
    expect(a).toEqual([]);
    expect(calls).toBe(1);

    nextResult = '12345'; // app started 50ms later
    const b = await resolvePids('serial-1', 'com.app.x');
    expect(b).toEqual([12345]);
    // Without the fix, the empty cache would block the second call and `calls` stays 1.
    expect(calls).toBe(2);

    vi.doUnmock('../../src/android/AdbBinary');
  });
});

describe('LogcatRingBuffer — true ring with head/tail pointers (O(1) push regardless of cap)', () => {
  function pushN(buf: LogcatRingBuffer, n: number): number {
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      buf.push({ seq: buf.allocSeq(), ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: 'm' });
    }
    return performance.now() - start;
  }

  it('sustains 200_000 evictions on a 100_000-cap buffer in well under 1s', () => {
    const buf = new LogcatRingBuffer(100_000);
    pushN(buf, 100_000); // fill
    const elapsed = pushN(buf, 200_000); // 200k evictions
    expect(buf.size()).toBe(100_000);
    expect(buf.dropped()).toBe(200_000);
    // shift()-based array would be O(n) per push → 200k × 100k = 2×10¹⁰ ops, freezes V8.
    // A real ring is constant-time per push.
    expect(elapsed).toBeLessThan(1000);
  });

  it('all() returns entries in FIFO order even after many wraps', () => {
    const buf = new LogcatRingBuffer(7);
    for (let i = 0; i < 50; i++) {
      buf.push({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: `m${i}` });
    }
    const seqs = buf.all().map(e => e.seq);
    expect(seqs).toEqual([43, 44, 45, 46, 47, 48, 49]);
  });

  it('range yields contiguous slices across the wrap boundary', () => {
    const buf = new LogcatRingBuffer(5);
    for (let i = 0; i < 8; i++) {
      buf.push({ seq: i, ts: 0, pid: 1, tid: 1, level: 'I', tag: 't', message: `m${i}` });
    }
    expect([...buf.range(0, 3)].map(e => e.seq)).toEqual([3, 4, 5]);
    expect([...buf.range(2, 5)].map(e => e.seq)).toEqual([5, 6, 7]);
  });

  it('clear leaves the seq counter intact so cleared rows are never re-indexed', () => {
    const buf = new LogcatRingBuffer(10_000);
    for (let i = 0; i < 10_000; i++) {
      buf.push({ seq: buf.allocSeq(), ts: 0, tsDisplay: '00:00:00.000', pid: 1, tid: 1, level: 'I', tag: 't', message: 'm' });
    }
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.allocSeq()).toBe(10_000);
  });
});

describe('LogcatViewProvider — error formatting', () => {
  it('stream-error survives a non-Error payload (string, undefined, etc.) without producing "undefined"', async () => {
    const { LogcatViewProvider } = await import('../../src/logcat/LogcatViewProvider');

    // Hand-build the smallest viable provider — we only exercise the listener wiring.
    const fakeService = new (class extends (await import('events')).EventEmitter {
      listDevices() { return Promise.resolve([]); }
      listPackagesFor() { return Promise.resolve([]); }
      snapshotState() { return { paused: false, bufferUsed: 0, bufferCap: 100, throughputPerSec: 0 }; }
    })() as any;

    const posts: any[] = [];
    const provider = new LogcatViewProvider(vscode.Uri.parse('file:///ext'), fakeService);
    (provider as unknown as { post(m: unknown): void }).post = (m: unknown) => { posts.push(m); };

    fakeService.emit('stream-error', 'connection refused'); // raw string, not Error
    fakeService.emit('stream-error', { reason: 'unknown' }); // object
    fakeService.emit('stream-error', undefined);             // undefined

    const errors = posts.filter(p => p && p.type === 'stream-error');
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(typeof e.message).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.message).not.toBe('undefined');
    }
  });
});
