/**
 * Demo recording orchestrator.
 *
 *   npx tsx scripts/demo/record.ts scripts/demo/demos/<name>.demo.ts
 *
 * Spawns a clean-profile VS Code with the demo runner, captures the screen
 * with ffmpeg, then post-processes the raw video into an annotated WebP at
 * `media/demos/<name>.webp`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { runTests } from '@vscode/test-electron';

import { ScreenRecorder, applyOverlays, convertToWebP, fileSizeKb } from './lib/ffmpeg';
import { buildOverlayFilter }                                       from './lib/overlay';
import type { TimelineEvent }                                       from './lib/timeline';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WIDTH     = 1280;
const HEIGHT    = 720;

/**
 * Coordinates where VS Code will be positioned on the desktop (logical
 * AppleScript coords — the origin is the main display top-left, other
 * displays extend into negative or positive territory depending on
 * System Settings → Displays → Arrangement).
 *
 * Override with `KJ_DEMO_WINDOW_X` / `KJ_DEMO_WINDOW_Y`. Use this if the
 * default placement lands on a display covered by a fullscreen app (e.g.,
 * a game) so the capture records the wrong content.
 */
const WINDOW_X = parseInt(process.env.KJ_DEMO_WINDOW_X ?? '0', 10);
const WINDOW_Y = parseInt(process.env.KJ_DEMO_WINDOW_Y ?? '0', 10);


// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

async function main(): Promise<void> {
  const demoFile = process.argv[2];
  if (!demoFile) die('usage: record.ts <path-to-*.demo.ts>');
  if (!demoFile.endsWith('.demo.ts')) die(`demo file must end with .demo.ts: ${demoFile}`);

  const name        = path.basename(demoFile, '.demo.ts');
  const compiledDemo = path.join(REPO_ROOT, 'dist', 'demo', 'demos', `${name}.demo.js`);
  if (!fs.existsSync(compiledDemo)) {
    die(`compiled demo not found: ${compiledDemo}\nrun: npm run compile:demo`);
  }

  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-demo-'));
  const userDataDir  = path.join(tmpDir, 'user-data');
  const rawMov       = path.join(tmpDir, 'raw.mov');
  const annotatedMp4 = path.join(tmpDir, 'annotated.mp4');
  const timelineJson = path.join(tmpDir, 'timeline.json');
  const readyMarker  = path.join(tmpDir, 'ready');
  const startMarker  = path.join(tmpDir, 'start');
  const outputWebp   = path.join(REPO_ROOT, 'media', 'demos', `${name}.webp`);

  seedUserDataDir(userDataDir);

  const runnerPath = path.join(REPO_ROOT, 'dist', 'demo', 'lib', 'vscode-runner.js');
  if (!fs.existsSync(runnerPath)) die(`vscode runner not built: ${runnerPath}`);

  log(`▶ Recording demo "${name}"`);

  // Spawn VS Code + demo runner in the background.
  const vscodeDone = runTests({
    extensionDevelopmentPath: REPO_ROOT,
    extensionTestsPath:        runnerPath,
    launchArgs: [
      path.join(REPO_ROOT, 'test', 'kotlin-jump-demo'),
      '--user-data-dir',     userDataDir,
      '--disable-workspace-trust',
    ],
    extensionTestsEnv: {
      KJ_DEMO_FILE:      compiledDemo,
      KJ_DEMO_TIMELINE:  timelineJson,
      KJ_DEMO_WORKSPACE: path.join(REPO_ROOT, 'test', 'kotlin-jump-demo'),
      KJ_DEMO_READY:     readyMarker,
      KJ_DEMO_START:     startMarker,
    },
  }).catch(err => { log(`✗ VS Code exited with error: ${err?.message ?? err}`); throw err; });

  // Wait for the runner to signal "VS Code is ready".
  await waitForFile(readyMarker, 60_000);
  log(`  VS Code ready — positioning window and starting capture`);

  // Pin VS Code to a known position. The returned rect is in LOGICAL
  // (AppleScript) coords — same coord system that `screencapture -R` uses.
  const rect = positionVSCodeWindow();
  await sleep(500);
  log(`  Capture region: (${rect.x},${rect.y}) ${rect.w}×${rect.h} [global coords]`);

  // Start screen capture. `screencapture -R` takes global desktop coordinates
  // and spans displays transparently, so multi-monitor setups just work.
  // Note: coords are in LOGICAL units, not pixels — Retina scaling is
  // handled natively by screencapture.
  const recorder = new ScreenRecorder(rawMov, {
    x:      rect.x,
    y:      rect.y,
    width:  rect.w,
    height: rect.h,
  });
  recorder.start();
  await sleep(1000);   // let screencapture initialise

  // Green-light the demo.
  fs.writeFileSync(startMarker, '');

  // Wait for VS Code / demo runner to exit.
  try {
    await vscodeDone;
  } finally {
    await recorder.stop();
  }

  if (!fs.existsSync(timelineJson)) {
    log(`✗ No timeline written — demo probably crashed. Raw video kept at ${rawMov}`);
    process.exit(2);
  }

  // Post-process.
  log(`  Captured ${fileSizeKb(rawMov)} KB of raw video`);
  const events = JSON.parse(fs.readFileSync(timelineJson, 'utf8')) as TimelineEvent[];
  log(`  ${events.length} timeline events to overlay`);

  // Trim dead setup time at the start (VS Code launch + indexing). Keep a
  // 500 ms pre-roll so the first overlay doesn't pop in on frame 0, and a
  // 500 ms tail after the last event.
  const PRE_ROLL_MS  = 500;
  const TAIL_MS      = 500;
  const firstT       = events[0]?.t ?? 0;
  const lastEnd      = events.reduce((m, e) => Math.max(m, e.t + e.duration), 0);
  const startOffsetMs = Math.max(0, firstT - PRE_ROLL_MS);
  const durationMs    = Math.max(1000, lastEnd - startOffsetMs + TAIL_MS);

  // Shift all event timestamps so t=0 corresponds to the trimmed video start.
  const shifted = events.map(e => ({ ...e, t: e.t - startOffsetMs }));
  log(`  Trimming raw to ${(durationMs / 1000).toFixed(1)}s (cut ${(startOffsetMs / 1000).toFixed(1)}s of setup)`);

  const fontPath = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf');
  const overlayFilter = buildOverlayFilter(shifted, { fontPath });
  // Scale the raw capture (Retina-sized) down to a fixed 1280×720 BEFORE the
  // overlay pass so overlay pixel coords always align the same way.
  const fullFilter = `scale=${WIDTH}:${HEIGHT}:flags=lanczos${overlayFilter ? ',' + overlayFilter : ''}`;
  applyOverlays(rawMov, fullFilter, annotatedMp4, {
    startSec:    startOffsetMs / 1000,
    durationSec: durationMs    / 1000,
  });

  convertToWebP(annotatedMp4, outputWebp);
  log(`✓ Wrote ${outputWebp} (${fileSizeKb(outputWebp)} KB, ${(durationMs / 1000).toFixed(1)}s)`);

  // Keep the tmpdir only if the user sets KJ_DEMO_KEEP_TMP=1 (debugging).
  if (!process.env.KJ_DEMO_KEEP_TMP) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else {
    log(`  (kept tmp dir: ${tmpDir})`);
  }
}

function seedUserDataDir(userDataDir: string): void {
  const settingsSrc = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'demo-settings.json');
  const userDir     = path.join(userDataDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });
  fs.copyFileSync(settingsSrc, path.join(userDir, 'settings.json'));
}

interface WindowRect {
  /** logical (AppleScript / screencapture-compatible) x */
  x:     number;
  y:     number;
  w:     number;
  h:     number;
  /** display pixel-density scale — kept for diagnostic logging only */
  scale: number;
}

/**
 * Position the VS Code window at (0, 0) with our target size, then read back
 * its actual rect + the display's Retina scale so we know where in PIXEL
 * coordinates the window sits (ffmpeg avfoundation captures in pixels).
 */
function positionVSCodeWindow(): WindowRect {
  const fallback: WindowRect = { x: 0, y: 0, w: WIDTH, h: HEIGHT, scale: 1 };
  if (process.platform !== 'darwin') {
    log(`  (window positioning only implemented on macOS — using default)`);
    return fallback;
  }

  const script =
    `on run\n` +
    `  tell application "Code" to activate\n` +
    `  delay 0.2\n` +
    `  tell application "System Events"\n` +
    `    set procs to every process whose name is "Code"\n` +
    `    if (count of procs) = 0 then return "ERROR:no-code-process"\n` +
    `    set targetWindow to window 1 of item 1 of procs\n` +
    `    set position of targetWindow to {${WINDOW_X}, ${WINDOW_Y}}\n` +
    `    set size of targetWindow to {${WIDTH}, ${HEIGHT}}\n` +
    `    delay 0.3\n` +
    `    set pos to position of targetWindow\n` +
    `    set sz  to size of targetWindow\n` +
    `    return ((item 1 of pos) as string) & "," & ((item 2 of pos) as string) & "," & ((item 1 of sz) as string) & "," & ((item 2 of sz) as string)\n` +
    `  end tell\n` +
    `end run\n`;

  const scriptFile = path.join(os.tmpdir(), `kj-demo-position-${process.pid}.applescript`);
  fs.writeFileSync(scriptFile, script);
  let logicalRect = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  try {
    const out = execSync(`osascript ${JSON.stringify(scriptFile)}`, { encoding: 'utf8' }).trim();
    if (!out || out.startsWith('ERROR:')) throw new Error(out || 'empty osascript output');
    const parts = out.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
      throw new Error(`unexpected osascript output: ${JSON.stringify(out)}`);
    }
    const [x, y, w, h] = parts;
    logicalRect = { x, y, w, h };
    log(`  Window positioned at (${x},${y}) size ${w}×${h} (logical)`);
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    log(`  ⚠ window positioning failed — falling back to (0,0) ${WIDTH}×${HEIGHT}`);
    log(`     ${stderr.trim() || (err as Error).message}`);
  } finally {
    fs.rmSync(scriptFile, { force: true });
  }

  const scale = detectRetinaScale();
  log(`  Display scale: ${scale}x`);
  // Return LOGICAL coordinates — screencapture takes logical coords directly.
  return { ...logicalRect, scale };
}

/** Detect main display Retina scale factor. Usually 1 or 2 on macOS. */
function detectRetinaScale(): number {
  try {
    const out = execSync(
      `osascript -e 'tell application "Finder" to return bounds of window of desktop'`,
      { encoding: 'utf8' },
    ).trim();
    // bounds returns logical points. Compare with pixel resolution from system_profiler.
    const logicalW = parseInt(out.split(',')[2].trim(), 10);
    const pixelOut = execSync(`system_profiler SPDisplaysDataType 2>/dev/null || true`, { encoding: 'utf8' });
    const match = pixelOut.match(/Resolution:\s+(\d+)\s*x\s*\d+\s*Retina/);
    if (match && logicalW > 0) {
      const pixelW = parseInt(match[1], 10);
      return Math.round(pixelW / logicalW);
    }
  } catch { /* fall through */ }
  return 1;
}

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ${file}`);
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
