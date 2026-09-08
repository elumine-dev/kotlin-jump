import { EventEmitter } from 'events';
import { spawnAdb, listConnectedDevices, type AdbDevice, type AdbProcess } from './AdbBinary';
import type { Logger } from '../util/logger';

const RETRY_DELAY_MS  = 3_000;       // After a track-devices process closes
const POLL_INTERVAL_MS = 5_000;      // Fallback poll cadence
const POLL_RECOVERY_MS = 30_000;     // While polling, retry track-devices this often

/**
 * Long-poll wrapper around `adb track-devices`. Emits `'change'` whenever the
 * device list changes (connect/disconnect, state transition).
 *
 * Resilience model:
 *   - Primary: spawn `adb track-devices` and react to its stdout. If it closes,
 *     retry after {@link RETRY_DELAY_MS} (typical for transient adb restarts).
 *   - Fallback: if spawn THROWS (no adb on PATH at startup), drop to a 5s
 *     polling loop. While polling, attempt to upgrade back to track-devices
 *     every {@link POLL_RECOVERY_MS} so users who install adb mid-session
 *     return to push-style updates without a window reload.
 */
export class AdbDeviceWatcher extends EventEmitter {
  private process?:    AdbProcess;
  private retryTimer?: NodeJS.Timeout;
  private pollTimer?:  NodeJS.Timeout;
  private recoveryTimer?: NodeJS.Timeout;
  private disposed     = false;
  private lastSerials  = new Set<string>();
  private adbMissing   = false;

  constructor(private readonly log?: Logger) { super(); }

  start(): void {
    if (this.disposed || this.process) return;

    let proc: AdbProcess;
    try {
      proc = spawnAdb(['track-devices']);
    } catch (err) {
      this.log?.warn(`[adb:watcher] track-devices spawn failed (${err}) — falling back to poll`);
      // The Logcat panel shows its "adb binary not found" banner off this.
      if (!this.adbMissing) {
        this.adbMissing = true;
        this.emit('adb-missing');
      }
      this.startPolling();
      return;
    }

    this.process = proc;
    // Node does not throw for a missing binary: spawn() returns a process
    // that emits 'error' (ENOENT) a tick later. The catch above only covers
    // a resolver that throws; without this the banner never showed and the
    // watcher retried every 3 s forever instead of polling.
    let spawnFailed = false;
    proc.on('spawn', () => {
      this.stopPolling(); // Upgrade succeeded — drop the poll machinery.
      if (this.adbMissing) {
        this.adbMissing = false;
        this.emit('adb-found');
      }
    });
    proc.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT' && err.code !== 'EACCES') return;
      spawnFailed = true;
      this.process = undefined;
      this.log?.warn(`[adb:watcher] adb not runnable (${err.code}) — falling back to poll`);
      if (!this.adbMissing) {
        this.adbMissing = true;
        this.emit('adb-missing');
      }
      this.startPolling();
    });

    proc.stdout.on('data', () => { void this.refresh(); });
    proc.stderr.on('data', d => this.log?.debug(`[adb:watcher] stderr: ${d.toString().trim()}`));

    proc.on('close', () => {
      this.process = undefined;
      if (this.disposed || spawnFailed) return;
      this.log?.debug(`[adb:watcher] track-devices closed — retrying in ${RETRY_DELAY_MS} ms`);
      this.retryTimer = setTimeout(() => this.start(), RETRY_DELAY_MS);
    });
    proc.on('error', err => {
      this.log?.debug(`[adb:watcher] track-devices error: ${err.message}`);
      this.process = undefined;
    });

    // Initial snapshot — track-devices fires on changes only.
    void this.refresh();
  }

  /** Forces a one-shot device-list refresh. Useful right after `start()`. */
  async refresh(): Promise<AdbDevice[]> {
    const devices = await listConnectedDevices();
    const next = new Set(devices.map(d => `${d.serial}:${d.state}`));
    let changed = next.size !== this.lastSerials.size;
    if (!changed) {
      for (const k of next) if (!this.lastSerials.has(k)) { changed = true; break; }
    }
    if (changed) {
      this.lastSerials = next;
      this.emit('change', devices);
    }
    return devices;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.stopPolling();
    this.process?.kill();
    this.process = undefined;
    this.removeAllListeners();
  }

  private startPolling(): void {
    if (this.disposed) return;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => { void this.refresh(); }, POLL_INTERVAL_MS);
      void this.refresh();
    }
    // Periodically attempt to upgrade back to track-devices.
    if (!this.recoveryTimer) {
      this.recoveryTimer = setInterval(() => {
        if (this.disposed || this.process) return;
        this.log?.debug('[adb:watcher] retrying track-devices from poll fallback');
        this.start();
      }, POLL_RECOVERY_MS);
    }
  }

  private stopPolling(): void {
    if (this.pollTimer)     { clearInterval(this.pollTimer);     this.pollTimer     = undefined; }
    if (this.recoveryTimer) { clearInterval(this.recoveryTimer); this.recoveryTimer = undefined; }
  }
}
