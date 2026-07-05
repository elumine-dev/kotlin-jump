import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as readline from 'readline';
import { listConnectedDevices, type AdbDevice } from '../android/AdbBinary';
import { AdbDeviceWatcher } from '../android/AdbDeviceWatcher';
import { listPackages, resolvePids } from '../android/PackageList';
import { LogcatStream } from './LogcatStream';
import { LogcatLineParser } from './LogcatLineParser';
import { LogcatRingBuffer } from './LogcatRingBuffer';
import { LogcatStackResolver } from './LogcatStackResolver';
import type { LogEntry, LogLevel, ResolvedFrame } from './messages';
import type { SymbolIndex } from '../indexer/SymbolIndex';
import type { Logger } from '../util/logger';

export interface DemoFrameMatcher {
  tag?:             string;
  messageContains?: string;
}

const DEMO_SERIAL = '__demo__';

const DEFAULT_BUFFER_SIZE = 100_000;

interface FilterState {
  levels:        Set<LogLevel>;
  search:        string;
  tagFilter:     string;
  followAppPid:  boolean;
  followedPid:   number | undefined;
  followedPackage: string | undefined;
}

/**
 * Singleton orchestrator for the Logcat feature on the extension host side.
 *
 * Owns: the device watcher, the active stream (one device at a time in v1), the
 * shared ring buffer, the stack resolver, and the filter state. Coalesces
 * outbound `entry` events so the webview/listeners see batched updates instead
 * of one postMessage per row.
 */
export class LogcatService extends EventEmitter implements vscode.Disposable {
  private readonly buffer:   LogcatRingBuffer;
  private readonly resolver: LogcatStackResolver;
  private readonly watcher:  AdbDeviceWatcher;

  private stream?:        LogcatStream;
  private currentSerial?: string;
  // Initialised with a single zero so `onEntry` can increment it before the
  // first 1s tick fires. Without this, the first second of throughput data
  // is silently dropped (no-op write to index -1 on an empty array).
  private throughputSamples: number[] = [0];
  private throughputTimer?: NodeJS.Timeout;

  private pending: LogEntry[] = [];
  private flushTimer?: NodeJS.Timeout;

  // Monotonic counter so out-of-order resolvePids responses can be discarded.
  // Without this, two rapid setFollowedPackage('a'), setFollowedPackage('b')
  // calls can commit a's PID after b's if a's promise resolves second.
  private followedPackageEpoch = 0;

  private paused = false;
  private _disposed = false;
  private filter: FilterState = {
    levels:          new Set<LogLevel>(['V', 'D', 'I', 'W', 'E', 'F']),
    search:          '',
    tagFilter:       '',
    followAppPid:    true,
    followedPid:     undefined,
    followedPackage: undefined,
  };

  constructor(
    private readonly index: SymbolIndex,
    private readonly log:   Logger,
    bufferCap = DEFAULT_BUFFER_SIZE,
  ) {
    super();
    this.buffer   = new LogcatRingBuffer(bufferCap);
    this.resolver = new LogcatStackResolver(index);
    this.watcher  = new AdbDeviceWatcher(log);
    this.watcher.on('change', devs => this.emit('devices', devs));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  startWatching(): void { if (this._disposed) return; this.watcher.start(); }

  /** Active device serial, or undefined when no session is in flight. */
  getCurrentSerial(): string | undefined { return this.currentSerial; }

  /** Active device's display info — used by the status-bar pill tooltip. */
  getCurrentDevice(): { serial: string; model?: string } | undefined {
    if (!this.currentSerial) return undefined;
    return { serial: this.currentSerial };
  }

  /** Package name the user (or auto-start) asked us to follow. */
  getFollowedPackage(): string | undefined { return this.filter.followedPackage; }

  async listDevices(): Promise<AdbDevice[]> {
    if (this._disposed) return [];
    return this.watcher.refresh();
  }

  async listPackagesFor(serial: string): Promise<string[]> {
    if (this._disposed) return [];
    return listPackages(serial);
  }

  /** Switches to a device. Stops any in-flight stream, clears buffer, restarts. */
  switchDevice(serial: string): void {
    if (this._disposed) return;
    if (this.stream && this.currentSerial === serial) return;
    this.stopStream();
    this.currentSerial = serial;
    this.buffer.clear();
    this.emit('reset');
    this.startStream();
    // Emit immediately rather than waiting for the next 1s throughput tick —
    // without this, the status bar pill can flash "Stopped" for up to a
    // second after switching devices (stale `streaming` from a prior stop).
    this.emit('state', this.snapshotState());
  }

  setFollowedPackage(packageName: string | undefined): void {
    if (this._disposed) return;
    this.filter.followedPackage = packageName;
    this.filter.followedPid     = undefined;
    const epoch = ++this.followedPackageEpoch;
    if (packageName && this.currentSerial) {
      void resolvePids(this.currentSerial, packageName).then(pids => {
        // Discard if a newer setFollowedPackage call superseded this one — and
        // also if the service has been disposed in the meantime.
        if (this._disposed) return;
        if (epoch !== this.followedPackageEpoch) return;
        this.filter.followedPid = pids[0];
      });
    }
  }

  setFollowAppPid(enabled: boolean): void { if (this._disposed) return; this.filter.followAppPid = enabled; }
  setLevels(levels: LogLevel[]): void {
    if (this._disposed) return;
    this.filter.levels = new Set(levels.length > 0 ? levels : (['V', 'D', 'I', 'W', 'E', 'F'] as LogLevel[]));
  }
  setSearch(query: string): void { if (this._disposed) return; this.filter.search = query; }
  setTagFilter(tag: string): void { if (this._disposed) return; this.filter.tagFilter = tag; }

  /** Live-resizes the underlying ring buffer. Wired to kotlinJump.logcat.bufferSize. */
  setBufferCap(n: number): void {
    if (this._disposed) return;
    if (n <= 0) return;
    this.buffer.resize(n);
    this.emit('state', this.snapshotState());
  }

  /** Mutes forwarding to the webview without touching the underlying stream —
   *  the adb process, parsing, resolving and buffering keep running. Use this
   *  for a brief interruption; use stop() to actually tear the stream down. */
  pause(): void { if (this._disposed) return; this.paused = true; this.emit('state', this.snapshotState()); }

  /**
   * Un-mutes AND reconnects if the stream was fully torn down by stop() — the
   * webview only exposes a single pause/resume toggle button (no separate Stop
   * button in its own UI), so this must recover from either state.
   */
  resume(): void {
    if (this._disposed) return;
    this.paused = false;
    if (this.currentSerial && !this.stream) this.startStream();
    this.emit('state', this.snapshotState());
  }

  /**
   * Real stop: tears down the adb process and the flush/throughput timers.
   * Unlike pause(), nothing keeps running in the background afterwards.
   * Leaves currentSerial and the ring buffer untouched — start()/resume()
   * reconnect to the same device; clear() is the only thing that wipes history.
   */
  stop(): void {
    if (this._disposed) return;
    this.stopStream();
    this.emit('state', this.snapshotState());
  }

  /** (Re)opens a stream to the last selected device if none is active. No-op
   *  if a device was never selected. Semantic alias of resume(). */
  start(): void { this.resume(); }

  clear(): void {
    if (this._disposed) return;
    this.buffer.clear();
    this.pending = [];
    this.emit('reset');
  }

  /**
   * Returns the buffered entries that survive the **transport** filter — the
   * subset of the filter state that determines which rows reach the webview at
   * all. Level/tag/search are NOT applied here: those are duplicated in the
   * webview client filter so the user can toggle them without the host having
   * to replay the buffer.
   */
  refilter(): LogEntry[] {
    return this.buffer.all().filter(e => this.passesTransportFilter(e));
  }

  exportFiltered(): string {
    const lines: string[] = [];
    for (const e of this.buffer.range(0, this.buffer.size())) {
      if (!this.passesFilter(e)) continue;
      const ts = new Date(e.ts).toISOString();
      const indented = e.message.replace(/\n/g, '\n    ');
      lines.push(`${ts}  ${e.level}  ${e.pid}/${e.tid}  ${e.tag}: ${indented}`);
    }
    return lines.join('\n');
  }

  snapshotState(): { paused: boolean; bufferUsed: number; bufferCap: number; throughputPerSec: number; streaming: boolean } {
    return {
      paused:           this.paused,
      bufferUsed:       this.buffer.size(),
      bufferCap:        this.buffer.cap(),
      throughputPerSec: this.computeThroughput(),
      streaming:        !!this.stream,
    };
  }

  dispose(): void {
    this._disposed = true;
    this.stopStream();
    this.watcher.dispose();
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.throughputTimer) clearInterval(this.throughputTimer);
    if (this._demoTimer) clearTimeout(this._demoTimer);
    this.removeAllListeners();
  }

  // ── Demo fixture replay ────────────────────────────────────────────────────
  // The methods below power the marketplace demo recording. They are gated at
  // the command-registration level (see /src/logcat/index.ts) so end users
  // cannot replay synthetic streams over a real device.

  private _demoTimer?: NodeJS.Timeout;

  /**
   * Pumps a captured `adb logcat -v threadtime,year` file through the parser
   * with realistic pacing. Used by the demo recording — never by end users.
   *
   * Pacing: respects the deltas between consecutive timestamps in the fixture,
   * with a floor of 50 ms (so bursts spread out enough for the viewer) and a
   * cap of 1000 ms (so idle gaps in the recording do not stall the demo).
   *
   * The active serial is set to the synthetic `'__demo__'` value so the
   * status-bar pill enters Stream state and the devices tree shows a fake
   * "Demo Device" entry.
   */
  async streamFixture(fixturePath: string, opts: { speed?: number } = {}): Promise<void> {
    if (this._disposed) return;
    this.stopStream();
    if (this._demoTimer) clearTimeout(this._demoTimer);

    this.currentSerial = DEMO_SERIAL;
    this.buffer.clear();
    this.emit('reset');
    this.emit('devices', [{ serial: DEMO_SERIAL, state: 'device', transport: 'usb', model: 'Demo Device' } as AdbDevice]);

    const speed = Math.max(0.1, Math.min(opts.speed ?? 1, 10));
    const parser = new LogcatLineParser();
    const lines: string[] = [];

    await new Promise<void>(resolve => {
      const stream = fs.createReadStream(fixturePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream });
      rl.on('line', l => lines.push(l));
      rl.on('close', () => resolve());
      rl.on('error', () => resolve());
    });

    // First pass: parse with a transient seq generator so we have ts deltas.
    const entries: LogEntry[] = [];
    let n = 0;
    for (const l of lines) {
      const completed = parser.feed(l, () => n++);
      if (completed) entries.push(completed);
    }
    const tail = parser.flush();
    if (tail) entries.push(tail);
    if (entries.length === 0) return;

    const baseTs = entries[0]!.ts;
    let scheduledDelay = 0;
    const emitOne = (idx: number) => {
      if (this._disposed) return;
      const entry = entries[idx];
      if (!entry) return;
      // Re-issue with a real seq from the buffer's monotonic counter so the UI
      // identifies the rows uniquely after replay.
      entry.seq = this.buffer.allocSeq();
      this.onEntry(entry);
      const next = entries[idx + 1];
      if (!next) return;
      let delta = next.ts - entry.ts;
      if (!Number.isFinite(delta) || delta < 0) delta = 0;
      delta = Math.min(1_000, Math.max(50, delta));
      delta = Math.round(delta / speed);
      scheduledDelay += delta;
      this._demoTimer = setTimeout(() => emitOne(idx + 1), delta);
    };
    void baseTs; // referenced for clarity in the design; pacing keys off deltas
    emitOne(0);
    void scheduledDelay;
  }

  /**
   * Looks up the most recent entry matching `matcher` and resolves the frame
   * at `frameIndex` to a navigation event. Mirrors the `'navigate'` code path
   * the webview triggers on a real click — without requiring a webview click.
   */
  async demoClickFrame(matcher: DemoFrameMatcher, frameIndex: number): Promise<void> {
    const frame = this.findFrame(matcher, frameIndex);
    if (!frame || !frame.uri) return;
    try {
      const uri = vscode.Uri.parse(frame.uri);
      const line = Math.max(0, frame.line - 1);
      await vscode.window.showTextDocument(uri, {
        preview:   false,
        selection: new vscode.Range(line, 0, line, 0),
      });
    } catch { /* swallow */ }
  }

  /**
   * Adds a transient highlight to the matched frame's row in the webview, so
   * the demo recording shows a visible flash before navigation. Implementation
   * lives in `LogcatViewProvider` which owns the webview reference.
   */
  demoFlashFrame(matcher: DemoFrameMatcher, frameIndex: number): void {
    const found = this.findEntry(matcher);
    if (!found) return;
    this.emit('demo-flash', { seq: found.seq, frameIndex });
  }

  private findEntry(matcher: DemoFrameMatcher): LogEntry | undefined {
    const all = this.buffer.all();
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i]!;
      if (matcher.tag && e.tag !== matcher.tag) continue;
      if (matcher.messageContains && !e.message.includes(matcher.messageContains)) continue;
      return e;
    }
    return undefined;
  }

  private findFrame(matcher: DemoFrameMatcher, frameIndex: number): ResolvedFrame | undefined {
    const e = this.findEntry(matcher);
    return e?.frames?.[frameIndex];
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private startStream(): void {
    if (this._disposed) return;
    if (!this.currentSerial || this.stream) return;
    const stream = new LogcatStream({ serial: this.currentSerial, logger: this.log }, this.buffer.allocSeq);
    this.stream = stream;
    stream.on('entry',         e => this.onEntry(e));
    stream.on('process-start', (pid, pkg) => {
      if (this.filter.followedPackage && pkg === this.filter.followedPackage) {
        this.filter.followedPid = pid;
      }
    });
    stream.on('error', err => this.emit('stream-error', err));
    stream.on('close', () => {
      // adb died (device unplugged, server killed, etc.) — try a soft restart in 2s.
      // Capture the stream identity so a switchDevice() during the 2s window
      // does not let this timer kill and respawn the new stream.
      setTimeout(() => {
        if (this._disposed) return;
        if (this.stream !== stream) return;
        if (!this.currentSerial) return;
        stream.dispose();
        this.stream = undefined;
        this.startStream();
      }, 2000);
    });
    stream.start();

    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => this.flushPending(), 16); // ~60Hz coalescing
    }
    if (!this.throughputTimer) {
      this.throughputTimer = setInterval(() => this.tickThroughput(), 1000);
    }
  }

  private stopStream(): void {
    this.stream?.dispose();
    this.stream = undefined;
    this.flushPending(); // don't lose <16ms of already-parsed entries in flight
    if (this.flushTimer)      { clearInterval(this.flushTimer);      this.flushTimer      = undefined; }
    if (this.throughputTimer) { clearInterval(this.throughputTimer); this.throughputTimer = undefined; }
  }

  private onEntry(entry: LogEntry): void {
    this.resolver.resolve(entry);
    this.buffer.push(entry);
    if (!this.paused && this.passesTransportFilter(entry)) {
      this.pending.push(entry);
    }
    // Throughput counter — guard against a freshly-constructed empty array.
    const last = this.throughputSamples.length - 1;
    if (last >= 0) this.throughputSamples[last]!++;
  }

  private flushPending(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.emit('append', batch);
  }

  private tickThroughput(): void {
    this.throughputSamples.push(0);
    if (this.throughputSamples.length > 5) this.throughputSamples.shift();
    this.emit('state', this.snapshotState());
  }

  private computeThroughput(): number {
    if (this.throughputSamples.length === 0) return 0;
    const recent = this.throughputSamples.slice(0, -1); // last sample is in-progress
    if (recent.length === 0) return 0;
    return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  }

  /**
   * Transport-only filter — the subset that makes sense to apply on the host
   * side (controls what the webview can ever see). Level/tag/search are
   * applied client-side so toggling them is instant and lossless.
   */
  private passesTransportFilter(entry: LogEntry): boolean {
    if (this.filter.followAppPid && this.filter.followedPid !== undefined && entry.pid !== this.filter.followedPid) return false;
    return true;
  }

  /**
   * Full filter (level/tag/search/PID) — used by exportFiltered() where the
   * caller wants exactly the rows the user is currently seeing.
   */
  private passesFilter(entry: LogEntry): boolean {
    if (!this.filter.levels.has(entry.level)) return false;
    if (this.filter.tagFilter && !entry.tag.toLowerCase().includes(this.filter.tagFilter.toLowerCase())) return false;
    if (this.filter.search && !entry.message.toLowerCase().includes(this.filter.search.toLowerCase())) return false;
    return this.passesTransportFilter(entry);
  }
}

// Backwards-compat for tests / future imports.
export { listConnectedDevices };
