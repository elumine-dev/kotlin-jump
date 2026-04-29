/**
 * Manual demo recorder — captures the user's live VS Code window for demos
 * that can't be scripted (android-run, ai-assistant) because they depend on
 * external state (Android emulator + adb, Copilot auth + non-deterministic
 * AI responses).
 *
 *   node dist/demo/manual-record.js <name> [seconds]
 *
 * Flow:
 *   1. Pre-flight: Screen Recording permission, lockfile, orphan cleanup
 *   2. Pick the user's VS Code window (prompt if >1)
 *   3. Confirm resize (backup of original rect for restore on any exit path)
 *   4. Position → settle → countdown → record for <seconds>
 *   5. Stop recorder, restore original window rect
 *   6. Open raw.mov in QuickLook (optional) → REPL for annotations
 *   7. Write timeline.json, run shared post-process pipeline → .webp + poster
 *
 * Supervision model mirrors record.ts: single idempotent cleanup() catches
 * SIGINT/SIGTERM/unhandledRejection/watchdog and always restores the window.
 */

import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ScreenRecorder, probeDurationSec, fileSizeKb } from './lib/ffmpeg';
import { checkRequiredBinaries }                         from './lib/webp-encoder';
import { runPostProcess }                                from './lib/post-process';
import {
  confirmResize,
  pickUserVSCodeWindow,
  positionUserVSCodeWindow,
  restoreWindowRect,
}                                                        from './lib/manual-window';
import type { WindowRect }                               from './lib/manual-window';
import { promptTimelineEvents }                          from './lib/timeline-repl';
import { publishWalkthroughToDemos }                     from './lib/publish-to-demos';
import { EventRecorder }                                 from './lib/event-recorder';
import type { DetectedEvent }                            from './lib/event-recorder';
import { enableAccessibilitySupport }                    from './lib/vscode-settings';
import type { AccessibilityToggleHandle }                from './lib/vscode-settings';

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const WIDTH      = 1280;
const HEIGHT     = 720;

const WINDOW_X         = parseInt(process.env.KJ_DEMO_WINDOW_X ?? '0', 10);
const WINDOW_Y         = parseInt(process.env.KJ_DEMO_WINDOW_Y ?? '0', 10);
const RESIZE_SETTLE_MS = Math.max(0, parseInt(process.env.KJ_DEMO_MANUAL_RESIZE_SETTLE_MS ?? '1000', 10));
const SKIP_QUICKLOOK   = process.env.KJ_DEMO_MANUAL_SKIP_QUICKLOOK === '1';

// 10 min is generous — manual mode legitimately sits in the REPL for a while
// while the author reviews the raw in QuickLook and composes labels.
const GLOBAL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DURATION_SEC = 15;

interface Resources {
  tmpDir?:               string;
  recorder?:             ScreenRecorder;
  eventRecorder?:        EventRecorder;
  accessibilityToggle?:  AccessibilityToggleHandle;
  lockFd?:               number;
  lockFile?:             string;
  watchdog?:             NodeJS.Timeout;
  userWindowPid?:        number;
  originalRect?:         WindowRect;
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

async function main(): Promise<void> {
  const binCheck = checkRequiredBinaries();
  if (!binCheck.ok) {
    die(
      `missing required binaries: ${binCheck.missing.join(', ')}\n` +
      `install with: brew install ffmpeg webp`,
    );
  }

  const name = process.argv[2];
  if (!name) {
    die(
      `usage: manual-record.js <name> [seconds]\n` +
      `  Records the user's live VS Code window and writes media/walkthrough/<name>/\n` +
      `  Example: manual-record.js android-run 20`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    die(`invalid name: ${JSON.stringify(name)}. Use only letters, digits, and hyphens.`);
  }

  const durationArg = process.argv[3];
  const durationSec = durationArg
    ? parseInt(durationArg, 10)
    : parseInt(process.env.KJ_DEMO_MANUAL_DURATION_SEC ?? String(DEFAULT_DURATION_SEC), 10);
  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > 120) {
    die(`invalid duration: ${durationArg ?? '(default)'}. Must be between 1 and 120 seconds.`);
  }

  const outputDir    = path.join(REPO_ROOT, 'media', 'walkthrough', name);
  const rawMov       = path.join(outputDir, 'raw.mov');
  const timelineJson = path.join(outputDir, 'timeline.json');
  const outputWebp   = path.join(outputDir, `${name}.webp`);

  fs.mkdirSync(outputDir, { recursive: true });

  // ───────────────────────────────────────────────── resources + cleanup
  const resources: Resources = {};
  let cleaned = false;
  const cleanup = async (reason: string): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    log(`cleanup: ${reason}`);
    if (resources.watchdog) clearTimeout(resources.watchdog);

    // ORDER: stop recorder BEFORE restoring window, else the restore
    // animation gets baked into the tail of raw.mov.
    if (resources.recorder) {
      try { await resources.recorder.stop(); } catch (e) { log(`  recorder.stop swallowed: ${(e as Error).message}`); }
    }

    if (resources.eventRecorder) {
      try { await resources.eventRecorder.stop(Date.now()); }
      catch (e) { log(`  eventRecorder.stop swallowed: ${(e as Error).message}`); }
    }

    if (resources.accessibilityToggle) {
      try { resources.accessibilityToggle.restore(); }
      catch (e) { log(`  accessibility restore swallowed: ${(e as Error).message}`); }
    }

    if (resources.tmpDir) {
      const key = path.basename(resources.tmpDir);
      try { execSync(`pkill -f "screencapture.*${key}"`, { stdio: 'ignore' }); } catch { /* none */ }
    }

    // Restore user's window — critical on any exit path.
    if (resources.userWindowPid !== undefined && resources.originalRect) {
      restoreWindowRect(resources.userWindowPid, resources.originalRect);
      log(`  Window restored to (${resources.originalRect.x},${resources.originalRect.y}) ${resources.originalRect.w}×${resources.originalRect.h}`);
    }

    if (resources.lockFd !== undefined) {
      try { fs.closeSync(resources.lockFd); } catch { /* already closed */ }
    }
    if (resources.lockFile) {
      try { fs.unlinkSync(resources.lockFile); } catch { /* already gone */ }
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.on(sig, () => { cleanup(`signal ${sig}`).finally(() => process.exit(130)); });
  }
  process.on('uncaughtException',  e => { log(`uncaught: ${(e as Error).message}`); cleanup('uncaughtException').finally(() => process.exit(1)); });
  process.on('unhandledRejection', e => { log(`unhandled: ${String(e)}`);           cleanup('unhandledRejection').finally(() => process.exit(1)); });

  resources.watchdog = setTimeout(() => {
    log(`✗ watchdog fired after ${GLOBAL_TIMEOUT_MS / 1000}s — force cleanup`);
    cleanup('watchdog').finally(() => process.exit(124));
  }, GLOBAL_TIMEOUT_MS);
  resources.watchdog.unref();

  // ───────────────────────────────────────────────── preflight
  await phase('preflight', async () => {
    screenRecordingProbe();
    try { execSync(`pkill -f "screencapture.*kj-demo-"`, { stdio: 'ignore' }); } catch { /* none */ }

    const lockFile = path.join(os.tmpdir(), 'kj-demo.lock');
    resources.lockFile = lockFile;
    try {
      resources.lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(resources.lockFd, `${process.pid}\n`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        const holder = fs.readFileSync(lockFile, 'utf8').trim();
        let alive = true;
        try { process.kill(Number(holder), 0); } catch { alive = false; }
        if (!alive) {
          fs.unlinkSync(lockFile);
          resources.lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
          fs.writeSync(resources.lockFd, `${process.pid}\n`);
        } else {
          die(`Another kjdemo is running (pid ${holder}). Wait for it, or run \`kjdemo clean\`.`);
        }
      } else {
        throw e;
      }
    }
  });

  log(`▶ Recording demo "${name}" for ${durationSec}s`);

  // ───────────────────────────────────────────────── pick user window
  const userWindow = await phase('pick-window', () => pickUserVSCodeWindow(log));
  resources.userWindowPid = userWindow.pid;
  resources.originalRect  = userWindow.originalRect;

  // Toggle editor.accessibilitySupport: "on" early so VS Code has time to
  // pick it up before recording starts. Without it, Monaco's AX text APIs
  // (selection range, string-for-range) return nothing — needed by the
  // event-tap binary to detect the *word* clicked in the editor.
  // Restored byte-for-byte at cleanup.
  const accToggle = enableAccessibilitySupport(userWindow.pid, log);
  if (accToggle) {
    resources.accessibilityToggle = accToggle;
  }

  // ───────────────────────────────────────────────── confirm + position
  const target: WindowRect = { x: WINDOW_X, y: WINDOW_Y, w: WIDTH, h: HEIGHT };
  const confirmed = await confirmResize(userWindow.originalRect, target, log);
  if (!confirmed) {
    log(`  Aborted by user`);
    await cleanup('user-abort');
    process.exit(0);
  }

  const realisedRect = await phase('position-window', () => positionUserVSCodeWindow(userWindow.pid, target));
  log(`  Window positioned at (${realisedRect.x},${realisedRect.y}) ${realisedRect.w}×${realisedRect.h}`);

  // ───────────────────────────────────────────────── settle + countdown
  if (RESIZE_SETTLE_MS > 0) {
    await sleep(RESIZE_SETTLE_MS);
  }
  for (let i = 3; i >= 1; i--) {
    log(`  Recording starts in ${i}...`);
    await sleep(1000);
  }

  // ───────────────────────────────────────────────── tmp dir for post-process
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-demo-manual-'));
  resources.tmpDir = tmpDir;

  // ───────────────────────────────────────────────── arm event tap (soft-fail)
  // Spin up the input-event capture before screencapture so it's hot by the
  // time the warmup completes. If accessibility is denied or build fails, log
  // the issue and continue without event hints — the REPL will just be the
  // legacy free-form input.
  let eventRecorder: EventRecorder | undefined;
  try {
    eventRecorder = new EventRecorder(REPO_ROOT);
    // Register BEFORE start(). start() awaits the binary's "ready" marker
    // (~3s timeout); a SIGINT during that wait would otherwise leave the
    // Swift process orphaned because cleanup() couldn't see it yet.
    resources.eventRecorder = eventRecorder;
    await eventRecorder.start();
    log(`  ✓ Event tap armed`);
  } catch (e) {
    log(`  ⚠ Event hints unavailable: ${(e as Error).message}`);
    resources.eventRecorder = undefined;
    eventRecorder = undefined;
  }

  // ───────────────────────────────────────────────── record
  const recorder = new ScreenRecorder(rawMov, {
    x: realisedRect.x, y: realisedRect.y, width: realisedRect.w, height: realisedRect.h,
  });
  resources.recorder = recorder;

  await phase('start-capture', async () => {
    recorder.start();
    // screencapture needs ~1.2 s to negotiate with ScreenCaptureKit. If it
    // dies during warmup (e.g. perms revoked), abort fast.
    await sleep(1200);
    const pid = recorder.pid();
    let alive = false;
    if (pid !== undefined) {
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
    }
    if (!alive) {
      throw new Error(
        'screencapture exited during warmup.\n' +
        `  stderr: ${recorder.lastStderr().trim() || '(empty)'}\n` +
        '  Remediation: System Settings → Privacy & Security → Screen Recording.',
      );
    }
  });

  // Anchor t=0 of the raw.mov video. screencapture has finished its
  // ScreenCaptureKit warmup and is now writing frames — this wall clock is
  // the closest proxy available for the first-frame timestamp.
  const recordingT0Ms = Date.now();

  log(`  ▶ Recording ${durationSec}s... (Ctrl+C to abort)`);
  await recordWithProgress(durationSec);

  await phase('stop-capture', async () => { await recorder.stop(); });

  let detectedEvents: DetectedEvent[] = [];
  if (eventRecorder) {
    try {
      detectedEvents = await eventRecorder.stop(recordingT0Ms);
      resources.eventRecorder = undefined;
      log(`  ✓ Detected ${detectedEvents.length} input event(s) during capture`);
    } catch (e) {
      log(`  ⚠ Event tap stop failed: ${(e as Error).message}`);
    }
  }

  if (!fs.existsSync(rawMov)) {
    log(`✗ Raw capture missing at ${rawMov}`);
    const stderr = recorder.lastStderr().trim();
    if (stderr) log(`  screencapture stderr:\n${stderr.split('\n').map(l => '    ' + l).join('\n')}`);
    await cleanup('raw-missing');
    process.exit(3);
  }

  const rawDurationSec = probeDurationSec(rawMov);
  const rawMb          = (fs.statSync(rawMov).size / 1024 / 1024).toFixed(1);
  log(`  ✓ Raw captured: ${rawMov} (${rawMb} MB, ${rawDurationSec.toFixed(1)}s)`);

  // ───────────────────────────────────────────────── restore window NOW
  // Give the user their window back before the REPL phase. They'll want to
  // flip to VS Code to reference things, and the recording is done.
  restoreWindowRect(userWindow.pid, userWindow.originalRect);
  log(`  Window restored to (${userWindow.originalRect.x},${userWindow.originalRect.y}) ${userWindow.originalRect.w}×${userWindow.originalRect.h}`);
  // Don't restore twice in cleanup().
  resources.originalRect = undefined;

  // ───────────────────────────────────────────────── QuickLook preview
  if (!SKIP_QUICKLOOK) {
    log(`  Opening raw.mov in QuickLook (click back on this terminal to enter events)`);
    try {
      spawn('qlmanage', ['-p', rawMov], { stdio: 'ignore', detached: true }).unref();
    } catch { /* QuickLook optional */ }
  }

  // Sidecar — useful for debugging and re-rendering with manual-render.
  if (detectedEvents.length > 0) {
    const detectedJson = path.join(outputDir, 'events-detected.json');
    fs.writeFileSync(detectedJson, JSON.stringify(detectedEvents, null, 2));
    log(`  ✓ Wrote ${detectedJson}`);
  }

  // ───────────────────────────────────────────────── REPL for annotations
  const events = await promptTimelineEvents(rawDurationSec, log, detectedEvents);
  log(`  ✓ ${events.length} event${events.length === 1 ? '' : 's'}. Writing timeline.json`);
  fs.writeFileSync(timelineJson, JSON.stringify(events, null, 2));

  // ───────────────────────────────────────────────── post-process
  await phase('post-process', () => runPostProcess({
    rawMov,
    outputWebp,
    timelineJson,
    sidecarTimeline: timelineJson,  // idempotent overwrite — same path in manual mode
    tmpDir,
    rawOffsetMs:     0,              // manual mode: events are already in raw-video time
    trimMode:        'none',
    repoRoot:        REPO_ROOT,
    log,
  }));

  log(``);
  log(`Artefacts saved:`);
  log(`  ${rawMov}  (gitignored, ${rawMb} MB)`);
  log(`  ${timelineJson}  (edit + re-render with: kjdemo manual-render ${name})`);
  log(`  ${outputWebp}  (${fileSizeKb(outputWebp)} KB)`);
  log(`  ${outputWebp.replace(/\.webp$/, '-poster.png')}`);

  // Publish the rendered artefacts to media/demos/ — that's where
  // `./.publish` and media/whats-new.json look for them. raw.mov stays
  // behind in walkthrough/ for re-renders.
  log(``);
  log(`Published to media/demos/:`);
  publishWalkthroughToDemos({ name, walkthroughDir: outputDir, repoRoot: REPO_ROOT, log });

  if (!process.env.KJ_DEMO_KEEP_TMP) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resources.tmpDir = undefined;
  } else {
    log(`  (kept tmp dir: ${tmpDir})`);
  }

  await cleanup('done');
}

// ───────────────────────────────────────────────── helpers

function screenRecordingProbe(): void {
  const probePng = path.join(os.tmpdir(), `kj-demo-perm-check-${process.pid}.png`);
  try {
    execSync(`screencapture -x ${JSON.stringify(probePng)}`, { stdio: 'ignore' });
    if (!fs.existsSync(probePng) || fs.statSync(probePng).size < 100) {
      throw new Error('probe produced empty file');
    }
  } catch (e) {
    die(
      `Screen Recording permission missing or screencapture unavailable.\n` +
      `  Fix: System Settings → Privacy & Security → Screen Recording → grant Terminal (or iTerm).\n` +
      `  Detail: ${(e as Error).message}`,
    );
  } finally {
    try { fs.unlinkSync(probePng); } catch { /* already gone */ }
  }
}

/** Sleep with a live progress bar on the same line. */
async function recordWithProgress(durationSec: number): Promise<void> {
  const totalMs    = durationSec * 1000;
  const tickMs     = 250;
  const barWidth   = 30;
  const startMs    = Date.now();
  // Only draw a progress bar if stdout is a TTY — CI logs get one line per second instead.
  const isTty      = process.stdout.isTTY === true;

  const interval = setInterval(() => {
    const elapsedMs = Math.min(totalMs, Date.now() - startMs);
    const filled    = Math.round((elapsedMs / totalMs) * barWidth);
    const bar       = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const line      = `  [${bar}] ${(elapsedMs / 1000).toFixed(1)}s/${durationSec}s`;
    if (isTty) {
      process.stdout.write(`\r${line}`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }, tickMs);

  await sleep(totalMs);
  clearInterval(interval);
  if (isTty) process.stdout.write(`\n`);
}

async function phase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const start = Date.now();
  log(`[phase=${name}] start`);
  try {
    const r = await fn();
    log(`[phase=${name}] ok (${Date.now() - start}ms)`);
    return r;
  } catch (e) {
    log(`[phase=${name}] FAIL (${Date.now() - start}ms): ${(e as Error).message}`);
    throw e;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[demo] ${msg}`);
}

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[demo] ${msg}`);
  process.exit(1);
}
