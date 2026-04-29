/**
 * Integration tests for the event-tap binary's multi-strategy AX element
 * detection. Spawns the real binaries (`event-tap` + `ax-debug`) and asserts
 * that synthetic clicks against a running VS Code instance produce JSON
 * events with usable element labels — not the bare `[AXScrollArea]` window
 * title that the prior implementation returned.
 *
 * Slow + environment-dependent: needs a real VS Code instance running with a
 * regular workspace open (anything will do — we click the title bar / status
 * bar which exist regardless of workspace content). Skipped by default; run:
 *
 *     KJ_RUN_AX_INTEGRATION=1 npm test -- event-tap-ax
 *
 * Prereqs:
 *   - Accessibility permission granted to Terminal (or the shell host)
 *   - `bash scripts/demo/event-capture/build.sh` produces both binaries
 *   - VS Code (Code.app) running and reachable via `osascript -e 'tell ... to activate'`
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EVENT_TAP = path.join(REPO_ROOT, 'dist', 'demo', 'bin', 'event-tap');
const AX_DEBUG  = path.join(REPO_ROOT, 'dist', 'demo', 'bin', 'ax-debug');
const BUILD_SH  = path.join(REPO_ROOT, 'scripts', 'demo', 'event-capture', 'build.sh');

const ENABLED = process.env.KJ_RUN_AX_INTEGRATION === '1';

interface ClickEvent     { type: 'click'; click_id: number; x: number; y: number; button: string; wall_ms: number; }
interface ClickMeta      {
  type: 'click_meta';
  click_id: number;
  element?: {
    winner_strategy?: string;
    role?:            string;
    subrole?:         string;
    title?:           string;
    value?:           string;
    attempts?:        Array<{ name: string; had_label?: boolean; role?: string; label?: string; skipped?: string }>;
  };
}
interface ReadyEvent     { type: 'ready'; }
interface KeystrokeEvent { type: 'keystroke'; key: string; }
type AnyEvent = ClickEvent | ClickMeta | ReadyEvent | KeystrokeEvent;

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function runEventTapWith(action: () => Promise<void>): Promise<AnyEvent[]> {
  const events: AnyEvent[] = [];
  const proc = spawn(EVENT_TAP, [], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });

  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try { events.push(JSON.parse(trimmed) as AnyEvent); } catch { /* malformed line */ }
  });

  // Wait for the ready marker
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = setInterval(() => {
      if (events.some(e => e.type === 'ready')) { clearInterval(tick); resolve(); return; }
      if (Date.now() - start > 5000) { clearInterval(tick); reject(new Error('event-tap not ready in 5s')); }
    }, 50);
  });

  await action();

  // Drain pending click_meta — they're emitted ~200ms after the click + the
  // AX queries take up to ~1.5s. Two seconds is a safe upper bound.
  await sleep(2000);

  // SIGINT and wait for exit (Swift binary drains its background queue).
  try { process.kill(-proc.pid!, 'SIGINT'); } catch { /* already dead */ }
  await Promise.race([
    new Promise<void>(r => proc.on('exit', () => r())),
    sleep(3000),
  ]);

  return events;
}

function activateVSCode(): void {
  execSync(`osascript -e 'tell application "Code" to activate'`);
}

function dismissAnyModalSheet(): void {
  // Press Escape — closes any "save changes?" dialog that would intercept clicks.
  try { execSync(`osascript -e 'tell application "System Events" to key code 53'`); } catch { /* ok */ }
}

// Each test spawns event-tap, runs synthetic clicks, waits 1.5-2s for
// click_meta deferred queries, then SIGINT-drains. 20s per-test budget.
// Sequential — concurrent runs would interfere with each other's clicks.
describe.runIf(ENABLED)('event-tap AX detection (integration; needs VS Code running)', { timeout: 20_000 }, () => {
  beforeAll(() => {
    execSync(`bash ${JSON.stringify(BUILD_SH)}`, { stdio: 'inherit' });
    if (!fs.existsSync(EVENT_TAP)) throw new Error(`Missing ${EVENT_TAP}`);
    if (!fs.existsSync(AX_DEBUG))  throw new Error(`Missing ${AX_DEBUG}`);
  });

  test('captures click with role + non-empty title for VS Code title bar', async () => {
    activateVSCode();
    await sleep(800);
    dismissAnyModalSheet();
    await sleep(400);

    const events = await runEventTapWith(async () => {
      // (700, 36) — Quick Access search bar in the title bar. AXButton with
      // description "Open Quick Access" — reachable via hit_test.
      execSync(`${AX_DEBUG} click 700 36`);
      await sleep(1500);
    });

    const click = events.find(e => e.type === 'click') as ClickEvent | undefined;
    const meta  = events.find(e => e.type === 'click_meta') as ClickMeta | undefined;

    expect(click,                         'click event captured').toBeDefined();
    expect(meta,                          'click_meta follow-up captured').toBeDefined();
    expect(meta!.element,                 'element field populated').toBeDefined();
    expect(meta!.element!.winner_strategy, 'a strategy succeeded').not.toBe('none');

    // Either title or value should carry a non-empty descriptive label
    const label = meta!.element!.title ?? meta!.element!.value;
    expect(label, 'descriptive label present').toBeTruthy();
    expect(label!.length, 'label is not just whitespace').toBeGreaterThan(0);
  });

  test('captures click on status bar with descriptive label', async () => {
    activateVSCode();
    await sleep(800);
    dismissAnyModalSheet();
    await sleep(400);

    const events = await runEventTapWith(async () => {
      // (100, 1010) — left side of the status bar. With kotlin-jump installed
      // this is typically the Git sync indicator (AXButton with description
      // like "kotlin-nav (Git) - Synchronize Changes"). For other workspaces
      // it'll be a different status bar item but still labelled.
      execSync(`${AX_DEBUG} click 100 1010`);
      await sleep(1500);
    });

    const meta = events.find(e => e.type === 'click_meta') as ClickMeta | undefined;
    expect(meta?.element?.winner_strategy).not.toBe('none');
    expect(meta?.element?.title ?? meta?.element?.value).toBeTruthy();
  });

  test('emits diagnostic attempts array enumerating all 3 strategies', async () => {
    activateVSCode();
    await sleep(800);
    dismissAnyModalSheet();
    await sleep(400);

    const events = await runEventTapWith(async () => {
      execSync(`${AX_DEBUG} click 700 36`);
      await sleep(1500);
    });

    const meta = events.find(e => e.type === 'click_meta') as ClickMeta | undefined;
    expect(meta?.element?.attempts).toBeInstanceOf(Array);
    expect(meta?.element?.attempts!.length).toBeGreaterThanOrEqual(3);

    const names = meta!.element!.attempts!.map(a => a.name);
    expect(names).toContain('hit_test');
    expect(names).toContain('descent_window');
    expect(names).toContain('focused');
  });

  test('captures keystroke synthesised via ax-debug type', async () => {
    activateVSCode();
    await sleep(800);
    dismissAnyModalSheet();
    await sleep(400);

    const events = await runEventTapWith(async () => {
      execSync(`${AX_DEBUG} type 'a'`);
      await sleep(500);
    });

    const keystroke = events.find(e => e.type === 'keystroke') as KeystrokeEvent | undefined;
    expect(keystroke).toBeDefined();
    expect(keystroke!.key).toBeTruthy();
  });

});
