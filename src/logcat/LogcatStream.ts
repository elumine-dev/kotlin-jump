import { EventEmitter } from 'events';
import { spawnAdb, type AdbProcess } from '../android/AdbBinary';
import { LogcatLineParser } from './LogcatLineParser';
import type { LogEntry } from './messages';
import type { Logger } from '../util/logger';

interface StreamOpts {
  serial: string;
  logger?: Logger;
  /**
   * Buffers passed to `adb logcat -b`. Defaults to `main,system,crash` so we
   * catch native SIGSEGV traces and ActivityManager process events.
   */
  buffers?: string[];
}

/**
 * Wraps `adb -s <serial> logcat -v threadtime,year -b <buffers>` in a typed
 * EventEmitter that pushes parsed `LogEntry` values.
 *
 * Events:
 *   - 'entry'        (entry: LogEntry)        — emitted for every completed log line
 *   - 'process-start'(pid: number, package: string) — sniffed from ActivityManager
 *   - 'error'        (err: Error)             — non-fatal warnings + ENOENT
 *   - 'close'                                 — adb child closed; consumer may decide to restart
 */
export class LogcatStream extends EventEmitter {
  private process?: AdbProcess;
  private parser   = new LogcatLineParser();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private allocSeq:    () => number;
  private disposed = false;

  constructor(private readonly opts: StreamOpts, allocSeq: () => number) {
    super();
    this.allocSeq = allocSeq;
  }

  start(): void {
    if (this.disposed || this.process) return;

    const buffers = (this.opts.buffers ?? ['main', 'system', 'crash']).join(',');
    const args = ['-s', this.opts.serial, 'logcat', '-v', 'threadtime,year', '-b', buffers];

    let proc: AdbProcess;
    try {
      proc = spawnAdb(args);
    } catch (err) {
      this.emit('error', err);
      return;
    }
    this.process = proc;

    proc.stdout.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    proc.stderr.on('data', (chunk: Buffer) => this.consumeStderr(chunk));
    proc.on('close', code => {
      this.flushPendingEntry();
      this.opts.logger?.debug(`[logcat:stream] adb logcat closed (code=${code ?? '?'})`);
      this.process = undefined;
      if (!this.disposed) this.emit('close');
    });
    proc.on('error', err => {
      this.opts.logger?.warn(`[logcat:stream] adb logcat error: ${err.message}`);
      this.emit('error', err);
    });
  }

  stop(): void {
    if (!this.process) return;
    try { this.process.kill('SIGTERM'); } catch { /* best-effort */ }
    this.process = undefined;
    this.flushPendingEntry();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.removeAllListeners();
  }

  // ── Stream consumers ───────────────────────────────────────────────────────

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');
    let nl = this.stdoutBuffer.indexOf('\n');
    while (nl >= 0) {
      const line = this.stdoutBuffer.slice(0, nl);
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      this.handleLine(line.replace(/\r$/, ''));
      nl = this.stdoutBuffer.indexOf('\n');
    }
  }

  private consumeStderr(chunk: Buffer): void {
    // adb prints a few non-fatal warnings ("- waiting for device -", buffer-cleared
    // notices) — keep them in a side buffer for diagnostics, don't propagate.
    this.stderrBuffer += chunk.toString('utf8');
    if (this.stderrBuffer.length > 4096) this.stderrBuffer = this.stderrBuffer.slice(-2048);
    this.opts.logger?.debug(`[logcat:stream] stderr: ${chunk.toString('utf8').trim()}`);
  }

  private handleLine(line: string): void {
    const completed = this.parser.feed(line, this.allocSeq);
    if (completed) {
      this.sniffActivityManager(completed);
      this.emit('entry', completed);
    }
  }

  private flushPendingEntry(): void {
    const last = this.parser.flush();
    if (last) {
      this.sniffActivityManager(last);
      this.emit('entry', last);
    }
  }

  /**
   * Watches for ActivityManager messages so we can keep the "Follow app PID"
   * filter stable across crashes/restarts:
   *   "Start proc 12345:com.example.app/u0a99 for activity {...}"
   */
  private sniffActivityManager(entry: LogEntry): void {
    if (entry.tag !== 'ActivityManager' && entry.tag !== 'ActivityTaskManager') return;
    const m = /Start proc (\d+):([\w.]+)/.exec(entry.message);
    if (m) {
      const pid = parseInt(m[1]!, 10);
      const pkg = m[2]!;
      this.emit('process-start', pid, pkg);
    }
  }
}
