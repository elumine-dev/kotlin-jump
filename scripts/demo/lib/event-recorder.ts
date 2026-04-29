import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface ClickAttempt {
  name:       string;
  had_label:  boolean;
  role?:      string;
  label?:     string;
  skipped?:   string;
}

export interface ClickElement {
  role?:            string;
  subrole?:         string;
  id?:              string;
  role_desc?:       string;
  title?:           string;
  value?:           string;
  walk_depth?:      number;
  // Orchestrator output: which AX strategy yielded a usable label, and
  // a per-strategy summary for diagnostics in the sidecar JSON.
  winner_strategy?: 'descent_window' | 'focused' | 'hit_test' | 'none';
  attempts?:        ClickAttempt[];
}

export interface ClickText {
  selected?: string;
  word?:     string;
}

export type DetectedEvent =
  | { t: number; type: 'click';     button: 'left' | 'right'; x: number; y: number; element?: ClickElement; text?: ClickText }
  | { t: number; type: 'keystroke'; key: string };

interface RawEvent {
  type:      'ready' | 'click' | 'keystroke' | 'click_meta';
  wall_ms?:  number;
  click_id?: number;
  button?:   'left' | 'right';
  x?:        number;
  y?:        number;
  key?:      string;
  element?:  ClickElement;
  text?:     ClickText;
}

/**
 * Standalone macOS input-event recorder, symmetric to ScreenRecorder. Spawns
 * the compiled Swift binary, parses its NDJSON stdout, and on stop() returns
 * a normalised list of events whose `t` is millisecond offset from the supplied
 * recordingT0 wall-clock time.
 *
 * `repoRoot` is required (not derived from __dirname) because esbuild bundles
 * lib code into multiple output files; __dirname differs between the standalone
 * lib build and an inlined CLI bundle, breaking any path arithmetic.
 */
export class EventRecorder {
  private readonly tapBin:    string;
  private readonly buildSh:   string;
  private proc:               ChildProcessWithoutNullStreams | undefined;
  private rawEvents:          RawEvent[] = [];
  private readyMs:            number | undefined;
  private stderrBuf = '';

  constructor(repoRoot: string) {
    this.tapBin  = path.join(repoRoot, 'dist', 'demo', 'bin', 'event-tap');
    this.buildSh = path.join(repoRoot, 'scripts', 'demo', 'event-capture', 'build.sh');
  }

  async start(): Promise<void> {
    if (!fs.existsSync(this.tapBin)) {
      try {
        execSync(`bash ${JSON.stringify(this.buildSh)}`, { stdio: 'inherit' });
      } catch (e) {
        throw new Error(
          `event-tap build failed: ${(e as Error).message}\n` +
          `  Ensure Xcode Command Line Tools are installed: xcode-select --install`,
        );
      }
    }

    this.proc = spawn(this.tapBin, [], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    this.proc.stderr.on('data', (chunk: Buffer) => { this.stderrBuf += chunk.toString(); });
    // Don't keep the Node event loop alive for the child — its lifecycle is
    // managed via stop(). Same pattern as ScreenRecorder (ffmpeg.ts:60).
    this.proc.unref();

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const ev = JSON.parse(trimmed) as RawEvent;
        if (ev.type === 'ready') {
          this.readyMs = ev.wall_ms;
        } else {
          this.rawEvents.push(ev);
        }
      } catch { /* malformed line — ignore; the binary is trusted, errors go to stderr */ }
    });

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (this.readyMs !== undefined) { clearInterval(tick); resolve(); return; }
        if (this.proc?.exitCode !== null && this.proc?.exitCode !== undefined) {
          clearInterval(tick);
          if (this.stderrBuf.includes('accessibility-denied')) {
            reject(new Error(
              'Accessibility permission required for event capture.\n' +
              '  Fix: System Settings → Privacy & Security → Accessibility → enable Terminal (or iTerm).\n' +
              '  Then re-run. (Recording will continue without event hints if you skip this.)',
            ));
          } else {
            reject(new Error(`event-tap exited early (code ${this.proc?.exitCode}). stderr: ${this.stderrBuf.trim() || '(empty)'}`));
          }
          return;
        }
        if (Date.now() - start > 3000) {
          clearInterval(tick);
          reject(new Error('event-tap did not signal ready within 3s'));
        }
      }, 50);
    });
  }

  /**
   * Stop the tap and return events normalised to ms-from-recordingT0, sorted,
   * with negative-t entries dropped. Idempotent.
   */
  async stop(recordingT0Ms: number): Promise<DetectedEvent[]> {
    if (!this.proc) return [];
    const proc = this.proc;
    const pid  = proc.pid;
    if (pid === undefined) { this.proc = undefined; return this.normalise(recordingT0Ms); }
    const pgid = -pid;

    const done = new Promise<void>(resolve => proc.on('exit', () => resolve()));

    try { process.kill(pgid, 'SIGINT'); } catch { /* already dead */ }
    await Promise.race([done, new Promise<void>(r => setTimeout(r, 2000))]);

    if (proc.exitCode === null && proc.signalCode === null) {
      try { process.kill(pgid, 'SIGKILL'); } catch { /* already dead */ }
      await Promise.race([done, new Promise<void>(r => setTimeout(r, 1000))]);
    }
    this.proc = undefined;
    return this.normalise(recordingT0Ms);
  }

  private normalise(recordingT0Ms: number): DetectedEvent[] {
    // First pass: index click_meta follow-ups by click_id.
    const metaByClickId = new Map<number, { element?: ClickElement; text?: ClickText }>();
    for (const ev of this.rawEvents) {
      if (ev.type === 'click_meta' && ev.click_id !== undefined) {
        metaByClickId.set(ev.click_id, { element: ev.element, text: ev.text });
      }
    }

    // Second pass: emit clicks (merged with their meta follow-up) and keystrokes.
    const out: DetectedEvent[] = [];
    for (const ev of this.rawEvents) {
      if (ev.wall_ms === undefined) continue;            // click_meta lines don't carry wall_ms
      const t = ev.wall_ms - recordingT0Ms;
      if (t < 0) continue;
      if (ev.type === 'click' && ev.button && ev.x !== undefined && ev.y !== undefined) {
        const meta = ev.click_id !== undefined ? metaByClickId.get(ev.click_id) : undefined;
        out.push({
          t, type: 'click', button: ev.button, x: ev.x, y: ev.y,
          ...(meta?.element ? { element: meta.element } : {}),
          ...(meta?.text    ? { text:    meta.text    } : {}),
        });
      } else if (ev.type === 'keystroke' && ev.key) {
        out.push({ t, type: 'keystroke', key: ev.key });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  lastStderr(): string { return this.stderrBuf.slice(-2000); }
}
