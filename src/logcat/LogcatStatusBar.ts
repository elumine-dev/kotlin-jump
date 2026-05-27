import * as vscode from 'vscode';

/**
 * State machine projection of the Logcat service onto a status-bar item.
 *
 * The pill lives on the LEFT cluster at priority 8, immediately to the right
 * of the Run button (priority 10) and Switch button (priority 9). It is hidden
 * when there is no live Logcat session, and surfaces five user-facing states
 * once a session exists:
 *
 *   Idle      — picked a device, throughput is zero
 *   Stream    — picked a device, throughput > 0
 *   PausedRn  — picked a device, paused
 *   Pressure  — Stream/PausedRn AND buffer used > 80% of cap
 *   Error     — last 'stream-error' arrived less than 30 s ago
 *
 * The pill respects three settings:
 *   - kotlinJump.statusBarEnabled
 *   - kotlinJump.logcat.enabled
 *   - kotlinJump.logcat.statusBarPill
 *
 * If any is false, the pill stays hidden.
 */

const ERROR_DECAY_MS    = 30_000;
const PRESSURE_RATIO    = 0.80;

export interface LogcatStatusState {
  hasSession:       boolean;
  paused:           boolean;
  bufferUsed:       number;
  bufferCap:        number;
  throughputPerSec: number;
  device?:          { serial: string; model?: string };
  pkg?:             string;
  error?:           { message: string; at: number };
}

export class LogcatStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: LogcatStatusState = {
    hasSession: false, paused: false, bufferUsed: 0, bufferCap: 0, throughputPerSec: 0,
  };
  private errorTimer?: NodeJS.Timeout;
  private cfg: () => vscode.WorkspaceConfiguration;

  constructor(cfg: () => vscode.WorkspaceConfiguration = () => vscode.workspace.getConfiguration('kotlinJump')) {
    this.cfg = cfg;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 8);
    this.item.name    = 'Kotlin Jump: Logcat Throughput';
    this.item.command = 'kotlinJump.logcat.show';
    this.refresh();
    this.applyVisibility();
  }

  setState(next: Partial<LogcatStatusState>): void {
    this.state = { ...this.state, ...next };
    if (next.error) {
      if (this.errorTimer) clearTimeout(this.errorTimer);
      const epoch = next.error.at;
      this.errorTimer = setTimeout(() => {
        // Only clear if no newer error has arrived in the meantime.
        if (this.state.error && this.state.error.at === epoch) {
          this.state = { ...this.state, error: undefined };
          this.refresh();
          this.applyVisibility();
        }
      }, ERROR_DECAY_MS);
    }
    this.refresh();
    this.applyVisibility();
  }

  /** Read-only snapshot — useful for tests and tooltip hovers. */
  getState(): Readonly<LogcatStatusState> { return this.state; }

  /** Force a settings re-read, e.g. after onDidChangeConfiguration. */
  refreshVisibility(): void { this.applyVisibility(); }

  dispose(): void {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.item.dispose();
  }

  // ── State machine ─────────────────────────────────────────────────────────

  private refresh(): void {
    const s = this.state;
    const tput = formatThroughput(s.throughputPerSec);

    // Error wins over everything (red backplate, 30 s decay).
    if (s.error) {
      this.item.text       = '$(error) Logcat: stream error';
      this.item.tooltip    = this.buildTooltip();
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.item.color      = undefined;
      return;
    }

    // Buffer pressure overlays Stream/PausedRn.
    const pressure = s.bufferCap > 0 && s.bufferUsed / s.bufferCap > PRESSURE_RATIO;
    if (pressure && s.hasSession) {
      const pct = Math.round((s.bufferUsed / s.bufferCap) * 100);
      this.item.text       = s.paused
        ? `$(warning) Logcat: paused · ${pct}% buf`
        : `$(warning) Logcat: ${tput} · ${pct}% buf`;
      this.item.tooltip    = this.buildTooltip();
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.item.color      = undefined;
      return;
    }

    if (s.paused) {
      this.item.text       = '$(debug-pause) Logcat: paused';
      this.item.tooltip    = this.buildTooltip();
      this.item.backgroundColor = undefined;
      this.item.color      = undefined;
      return;
    }

    if (s.throughputPerSec > 0) {
      this.item.text       = `$(circle-filled) Logcat: ${tput}`;
      this.item.tooltip    = this.buildTooltip();
      this.item.backgroundColor = undefined;
      this.item.color      = new vscode.ThemeColor('terminal.ansiGreen');
      return;
    }

    // Idle state — picked a device but no traffic.
    this.item.text       = '$(circle-outline) Logcat: ready';
    this.item.tooltip    = this.buildTooltip();
    this.item.backgroundColor = undefined;
    this.item.color      = undefined;
  }

  private buildTooltip(): vscode.MarkdownString {
    const s = this.state;
    const md = new vscode.MarkdownString(undefined, false);
    md.isTrusted = false;
    md.appendMarkdown('**Kotlin Jump — Logcat**\n\n');

    const deviceLabel = s.device?.model ?? s.device?.serial ?? '—';
    const pkgLabel    = s.pkg ?? '—';
    const usagePct    = s.bufferCap > 0 ? Math.round((s.bufferUsed / s.bufferCap) * 100) : 0;

    md.appendMarkdown(`Device:&nbsp;&nbsp;&nbsp;&nbsp;${deviceLabel}\n\n`);
    md.appendMarkdown(`Followed:&nbsp;&nbsp;${pkgLabel}\n\n`);
    md.appendMarkdown(`Buffer:&nbsp;&nbsp;&nbsp;&nbsp;${formatNum(s.bufferUsed)} / ${formatNum(s.bufferCap)} (${usagePct}%)\n\n`);
    md.appendMarkdown(`Throughput: ${formatThroughput(s.throughputPerSec)}\n\n`);

    if (s.error) {
      md.appendMarkdown(`---\n\n⚠ ${s.error.message}\n\n`);
    }

    md.appendMarkdown('Click to focus the Logcat panel.');
    return md;
  }

  private applyVisibility(): void {
    const cfg = this.cfg();
    const enabled =
      cfg.get<boolean>('logcat.enabled', true) &&
      cfg.get<boolean>('statusBarEnabled', true) &&
      cfg.get<boolean>('logcat.statusBarPill', true);

    if (!enabled) {
      this.item.hide();
      return;
    }

    if (!this.state.hasSession && !this.state.error) {
      this.item.hide();
      return;
    }

    this.item.show();
  }
}

/**
 * Formats throughput per second:
 *   0       → "0/s"
 *   142     → "142/s"
 *   1_200   → "1.2k/s"
 *   12_000  → "12k/s"
 *   1M+     → "1.0M/s"
 *
 * Exported for tests.
 */
export function formatThroughput(perSec: number): string {
  if (!Number.isFinite(perSec) || perSec <= 0) return '0/s';
  if (perSec < 1_000) return `${perSec}/s`;
  if (perSec < 10_000) return `${(perSec / 1_000).toFixed(1)}k/s`;
  if (perSec < 1_000_000) return `${Math.round(perSec / 1_000)}k/s`;
  return `${(perSec / 1_000_000).toFixed(1)}M/s`;
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}
