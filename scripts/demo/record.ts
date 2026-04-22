/**
 * Demo recording orchestrator.
 *
 *   npx tsx scripts/demo/record.ts scripts/demo/demos/<name>.demo.ts
 *
 * Spawns a clean-profile VS Code with the demo runner, captures the screen
 * with ffmpeg, then post-processes the raw video into an annotated WebP at
 * `media/demos/<name>.webp`.
 *
 * Supervision model — "supervised child process with watchdog + transactional
 * cleanup" (cf. Erlang supervision tree / Go defer+RAII). Every abnormal path
 * (SIGINT, uncaughtException, unhandledRejection, watchdog timeout) converges
 * on a single idempotent `cleanup()` that:
 *   - stops the screen recorder (kills its process group, not just the PID)
 *   - pkills any screencapture matching our tmp-dir (belt-and-suspenders)
 *   - removes the lockfile
 * This guarantees no orphan `screencapture` can survive an orchestrator crash
 * — which would otherwise leave macOS' screen-recording indicator and
 * region-dimming visible on screen indefinitely.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { runTests } from '@vscode/test-electron';

import { ScreenRecorder, extractPosterFromWebP, pickPosterFrame, fileSizeKb, probeDurationSec } from './lib/ffmpeg';
import { buildOverlayFilterGraph }                                                              from './lib/overlay';
import { buildRoundedFrameFilter, prerenderCornerMask }                                         from './lib/frame';
import {
  buildWindowFailureMessage,
  decideWindowResolution,
}                                                                                               from './lib/windowing';
import {
  renderFilterToPngSequence,
  classifyFrames,
  encodeFramesToWebpParallel,
  assembleAnimatedWebp,
  optimizePosterPng,
  checkRequiredBinaries,
}                                                                                               from './lib/webp-encoder';
import type { TimelineEvent }                                                                   from './lib/timeline';
import type { WindowProbeResult, WindowProbeSource, WindowResolutionDecision }                  from './lib/windowing';

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

// Opt-in escape hatch for debugging only. Default behavior is fail-fast if the
// demo window cannot be enumerated and positioned correctly.
const ALLOW_WINDOW_FALLBACK = process.env.KJ_DEMO_ALLOW_WINDOW_FALLBACK === '1';
const ACCESSIBILITY_GRACE_MS = Math.max(0, parseInt(process.env.KJ_DEMO_ACCESSIBILITY_GRACE_MS ?? '4000', 10));

/** Entire orchestrator must finish within this budget; else watchdog fires. */
const GLOBAL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Demos disabled at the orchestrator level (independent of compile).
 * Empty after Phase 6 of the JAR-navigation refactor — all `lib-jar-*`
 * demos are now reproducible via the bundled Compose Multiplatform
 * dependencies in `test/kotlin-jump-demo/build.gradle.kts` + the
 * `scripts/demo/setup-fixture.sh` warm-up.
 *
 * Add a name here only if a demo is structurally broken and
 * temporarily skipped; remove once fixed.
 */
const DISABLED_DEMOS = new Set<string>([]);

/** Single place holding everything the cleanup handler must release. */
interface Resources {
  tmpDir?:   string;
  recorder?: ScreenRecorder;
  lockFd?:   number;
  lockFile?: string;
  watchdog?: NodeJS.Timeout;
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

async function main(): Promise<void> {
  // Fail-fast if the 2-pass pipeline's binary dependencies are missing.
  // pngquant is checked separately (optional — poster stays unoptimised
  // without it, but the pipeline still runs).
  const binCheck = checkRequiredBinaries();
  if (!binCheck.ok) {
    die(
      `missing required binaries: ${binCheck.missing.join(', ')}\n` +
      `install with: brew install ffmpeg webp`,
    );
  }

  const demoFile = process.argv[2];
  if (!demoFile) die('usage: record.ts <path-to-*.demo.ts>');
  if (!demoFile.endsWith('.demo.ts')) die(`demo file must end with .demo.ts: ${demoFile}`);

  const name        = path.basename(demoFile, '.demo.ts');

  if (DISABLED_DEMOS.has(name)) {
    log(`✗ skipping disabled demo: ${name}`);
    log(`  Reason: pending JAR-navigation refactor (Phase 1-6 of plan).`);
    log(`  See: ~/.claude/plans/je-veux-que-tu-wild-boot.md (Phase 0).`);
    process.exit(0);
  }

  const compiledDemo = path.join(REPO_ROOT, 'dist', 'demo', 'demos', `${name}.demo.js`);
  if (!fs.existsSync(compiledDemo)) {
    die(`compiled demo not found: ${compiledDemo}\nrun: npm run compile:demo`);
  }

  // ------------------------------------------------------------------ resources
  const resources: Resources = {};
  let cleaned = false;
  const cleanup = async (reason: string): Promise<void> => {
    if (cleaned) return;                       // idempotent
    cleaned = true;
    log(`cleanup: ${reason}`);
    if (resources.watchdog) clearTimeout(resources.watchdog);
    if (resources.recorder) {
      try { await resources.recorder.stop(); } catch (e) { log(`  recorder.stop swallowed: ${(e as Error).message}`); }
    }
    // Belt-and-suspenders — scoped to THIS run's tmpDir so we never kill
    // another concurrent project's screencapture.
    if (resources.tmpDir) {
      const key = path.basename(resources.tmpDir);
      try { execSync(`pkill -f "screencapture.*${key}"`, { stdio: 'ignore' }); } catch { /* none */ }
    }
    if (resources.lockFd !== undefined) {
      try { fs.closeSync(resources.lockFd); } catch { /* already closed */ }
    }
    if (resources.lockFile) {
      try { fs.unlinkSync(resources.lockFile); } catch { /* already gone */ }
    }
    for (const probeFile of _probeScriptFiles.values()) {
      try { fs.unlinkSync(probeFile); } catch { /* already gone */ }
    }
    _probeScriptFiles.clear();
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

  // ------------------------------------------------------------------ preflight
  await phase('preflight', async () => {
    // Screen Recording permission probe — fails fast with actionable message.
    // If the permission is missing, `screencapture` silently writes an empty
    // file and our pipeline continues for another 40 s before failing obscurely.
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

    // Reap any screencapture left behind by a prior crashed run before we
    // start — otherwise macOS can merge the recording indicators and the
    // shadow/dim never clears.
    try { execSync(`pkill -f "screencapture.*kj-demo-"`, { stdio: 'ignore' }); } catch { /* none */ }

    // Lockfile via O_EXCL — prevents two kjdemo runs from stealing windows
    // from each other via AppleScript.
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
          // Stale lock — take over.
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

  // ------------------------------------------------------------------ setup tmp
  const tmpDir       = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-demo-'));
  resources.tmpDir   = tmpDir;
  const userDataDir  = path.join(tmpDir, 'user-data');
  const rawMov       = path.join(tmpDir, 'raw.mov');
  const cmaskPng     = path.join(tmpDir, 'cornermask.png');
  const timelineJson = path.join(tmpDir, 'timeline.json');
  const readyMarker  = path.join(tmpDir, 'ready');
  const startMarker  = path.join(tmpDir, 'start');
  const doneMarker   = path.join(tmpDir, 'done');
  const outputWebp   = path.join(REPO_ROOT, 'media', 'demos', `${name}.webp`);

  seedUserDataDir(userDataDir);

  const runnerPath = path.join(REPO_ROOT, 'dist', 'demo', 'lib', 'vscode-runner.js');
  if (!fs.existsSync(runnerPath)) die(`vscode runner not built: ${runnerPath}`);

  log(`▶ Recording demo "${name}"`);

  // ---------------------------------------------------------------- spawn vscode
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
      KJ_DEMO_DONE:      doneMarker,
    },
  }).catch(err => { log(`✗ VS Code exited with error: ${err?.message ?? err}`); throw err; });

  // ---------------------------------------------------------------- wait ready
  await phase('wait-ready', () => waitForFile(readyMarker, 60_000));
  log(`  VS Code ready — positioning window and starting capture`);

  // The runner writes its Electron main-process PID to the ready marker
  // (`vscode-runner.ts:37`). That's our ground truth for window lookup —
  // no reliance on the `window.title` setting being parsed correctly by
  // whatever VS Code version we're running against.
  const electronPid = readReadyMarkerPid(readyMarker);
  if (electronPid !== undefined) {
    log(`  Target Electron pid: ${electronPid} (from ready marker)`);
  } else {
    log(`  ⚠ could not read PID from ready marker — falling back to title-based window lookup`);
  }

  // Poll for the recording window. Default behavior is fail-fast: if the
  // window cannot be enumerated/positioned correctly, the recording should
  // stop before capture starts. Full-screen fallback remains available only
  // as an explicit debug override (`KJ_DEMO_ALLOW_WINDOW_FALLBACK=1`).
  const WAIT_WINDOW_TIMEOUT_MS = 30_000;
  const fallbackRect = { x: 0, y: 0, w: WIDTH, h: HEIGHT, scale: 1 };
  let windowDecision: WindowResolutionDecision | undefined;
  let windowAvailable = false;
  try {
    windowDecision = await phase('wait-window', () =>
      waitForRecordingWindow(electronPid, {
        timeoutMs:            WAIT_WINDOW_TIMEOUT_MS,
        intervalMs:           200,
        accessibilityGraceMs: ACCESSIBILITY_GRACE_MS,
      }),
    );
    windowAvailable = true;
    log(`  ${windowDecision.summary}`);
    logVSCodeLikeProcesses();
  } catch (err) {
    logVSCodeLikeProcesses();
    if (!ALLOW_WINDOW_FALLBACK) {
      throw err;
    }
    log(`  ⚠ wait-window failed but KJ_DEMO_ALLOW_WINDOW_FALLBACK=1 — continuing with full-capture fallback.`);
    log(`     ${(err as Error).message}`);
  }

  // ----------------------------------------------------------- position window
  let rect = fallbackRect;
  if (windowAvailable) {
    try {
      rect = await phase('position-window', () =>
        positionVSCodeWindow(electronPid, windowDecision?.positionMode),
      );
    } catch (err) {
      if (!ALLOW_WINDOW_FALLBACK) {
        throw err;
      }
      log(`  ⚠ position-window failed but KJ_DEMO_ALLOW_WINDOW_FALLBACK=1 — continuing with full-capture fallback.`);
      log(`     ${(err as Error).message}`);
    }
  }
  if (!windowAvailable || rect === fallbackRect) {
    log(`  Using fallback capture region (0,0) ${WIDTH}×${HEIGHT}`);
  }

  // Capture region: default to the detected rect, but allow override via env
  // vars in case the user prefers to manually arrange their display and
  // doesn't care about window positioning.
  const captureX = parseInt(process.env.KJ_DEMO_CAPTURE_X ?? String(rect.x), 10);
  const captureY = parseInt(process.env.KJ_DEMO_CAPTURE_Y ?? String(rect.y), 10);
  const captureW = parseInt(process.env.KJ_DEMO_CAPTURE_W ?? String(rect.w), 10);
  const captureH = parseInt(process.env.KJ_DEMO_CAPTURE_H ?? String(rect.h), 10);
  log(`  Capture region: (${captureX},${captureY}) ${captureW}×${captureH} [global coords]`);

  // ----------------------------------------------------------- start recorder
  const recorder = new ScreenRecorder(rawMov, { x: captureX, y: captureY, width: captureW, height: captureH });
  resources.recorder = recorder;
  const ffmpegStartedAt = Date.now();
  await phase('start-capture', async () => {
    recorder.start();
    // macOS `screencapture -v` buffers frames in memory and only flushes the
    // .mov to disk when it receives SIGINT — so we can NOT wait for the file
    // to grow to confirm the recording is live. Instead we sleep long enough
    // for ScreenCaptureKit to negotiate with WindowServer (~800-1500 ms on
    // Apple Silicon), then verify the child process is still alive. If
    // screencapture died (e.g. perms revoked mid-run), abort fast.
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
        '  Remediation: System Settings → Privacy & Security → Screen Recording.'
      );
    }
  });

  // Test hook — lets the regression suite simulate a crash that would
  // otherwise leave an orphan screencapture.
  if (process.env.KJ_DEMO_FORCE_CRASH === 'after-capture-start') {
    throw new Error('KJ_DEMO_FORCE_CRASH=after-capture-start (test hook)');
  }
  if (process.env.KJ_DEMO_FORCE_HANG === '1') {
    log(`  KJ_DEMO_FORCE_HANG=1 — hanging forever (watchdog should kill us)`);
    await new Promise(() => { /* never resolves */ });
  }

  // ----------------------------------------------------------- green-light demo
  const demoStartedAt = Date.now();
  fs.writeFileSync(startMarker, '');
  const rawOffsetMs = demoStartedAt - ffmpegStartedAt;
  log(`  Demo timeline t=0 is at raw video t=${rawOffsetMs}ms (ffmpeg warmup + demo launch)`);

  // ----------------------------------------------------------- run demo
  await phase('run-demo', async () => {
    await Promise.race([
      waitForFile(doneMarker, 120_000),
      vscodeDone.then(() => { throw new Error('VS Code exited before writing done marker'); }),
    ]);
  });

  // ----------------------------------------------------------- stop capture
  await phase('stop-capture', async () => {
    await recorder.stop();
    await vscodeDone.catch(err => log(`  (VS Code shutdown: ${err?.message ?? err})`));
  });

  if (!fs.existsSync(timelineJson)) {
    log(`✗ No timeline written — demo probably crashed. Raw video kept at ${rawMov}`);
    await cleanup('no-timeline');
    process.exit(2);
  }

  if (!fs.existsSync(rawMov)) {
    log(`✗ Raw capture missing at ${rawMov}`);
    const stderr = recorder.lastStderr().trim();
    if (stderr) log(`  screencapture stderr:\n${stderr.split('\n').map(l => '    ' + l).join('\n')}`);
    log(`  Hint: grant Screen Recording permission to the Terminal/iTerm in System Settings → Privacy & Security.`);
    await cleanup('raw-missing');
    process.exit(3);
  }

  // ----------------------------------------------------------- post-process
  await phase('post-process', async () => {
    log(`  Captured ${fileSizeKb(rawMov)} KB of raw video`);
    const events = JSON.parse(fs.readFileSync(timelineJson, 'utf8')) as TimelineEvent[];
    log(`  ${events.length} timeline events to overlay`);

    // Trim dead setup time at the start (VS Code launch + indexing). Keep a
    // 500 ms pre-roll so the first overlay doesn't pop in on frame 0, and a
    // 500 ms tail after the last event.
    //
    // Demo timeline event timestamps (e.t) are measured from when the Stage was
    // instantiated INSIDE the VS Code extension host — which happens ~rawOffsetMs
    // AFTER ffmpeg started capturing. So in raw-video coordinates, an event with
    // demo-timeline t=E is at raw-video t = rawOffsetMs + E.
    // Trim tuned for WebP-size optimisation: fewer idle frames at the
    // boundaries cuts ~200 KB from the final animated WebP. TAIL_MS=400
    // (was 200) leaves enough room after the last narrative event for the
    // caption's peak-end keyframe to read at full luma before the
    // fade-to-dark kicks in.
    const PRE_ROLL_MS   = 300;
    const TAIL_MS       = 400;
    const firstT        = events[0]?.t ?? 0;
    const lastEnd       = events.reduce((m, e) => Math.max(m, e.t + e.duration), 0);
    const startOffsetMs = Math.max(0, rawOffsetMs + firstT - PRE_ROLL_MS);
    const durationMs    = Math.max(1000, (rawOffsetMs + lastEnd) - startOffsetMs + TAIL_MS);

    // Shift all event timestamps so t=0 corresponds to the trimmed video start.
    // In trimmed-video time, event E appears at: (rawOffsetMs + E.t) - startOffsetMs
    const shifted = events.map(e => ({ ...e, t: (rawOffsetMs + e.t) - startOffsetMs }));
    log(`  Trimming raw to ${(durationMs / 1000).toFixed(1)}s (cut ${(startOffsetMs / 1000).toFixed(1)}s of setup)`);

    const fontPath     = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf');
    const fontPathMono = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'JetBrainsMono-Regular.ttf');
    const { chain: overlayChain } = buildOverlayFilterGraph(shifted, { fontPath, fontPathMono });

    // Clamp the requested clip to what the raw capture actually contains.
    const rawDurationSec = probeDurationSec(rawMov);
    const availableSec   = Number.isFinite(rawDurationSec)
      ? Math.max(0.1, rawDurationSec - startOffsetMs / 1000)
      : durationMs / 1000;
    const clipSec = Math.min(durationMs / 1000, availableSec);
    if (clipSec < durationMs / 1000 - 0.1) {
      log(`  ⚠ raw capture shorter than demo timeline (${rawDurationSec.toFixed(2)}s) — clipping to ${clipSec.toFixed(2)}s`);
    }

    // Shorter fade tail: the dithered (noise=alls=2) downscale keeps the
    // gradient clean even at 0.3 s, and shaving 200 ms cuts ~4 frames × 3 KB.
    const fadeOutSec = 0.3;
    const fadeStart  = Math.max(0, clipSec - fadeOutSec);

    // Pre-render the rounded-corner alpha mask as a grayscale PNG.
    // Loading it as a file input (vs. inline `color,geq,loop` chain)
    // sidesteps a filter-graph hang that made the earlier pipeline
    // unusable — see lib/frame.ts header.
    log(`  Pre-rendering cornermask`);
    const execOnce = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
    prerenderCornerMask(cmaskPng, execOnce);

    // Filter graph tuned for the 2-pass pipeline (see lib/webp-encoder.ts):
    //   ① scale to 1280×720 @ 12 fps, with lanczos+accurate_rnd+full_chroma_int
    //     (the accurate-rnd flag alone eliminates a subtle rounding bias
    //     that was desaturating the VS Code blue by ~3 %).
    //   ② overlay chain (banners/captions/keystrokes).
    //   ③ fade to transparent-black (0.3 s).
    //   ④ rounded-corner alphamerge with pre-rendered cornermask PNG.
    //   ⑤ downscale to 960×540 final + dither `noise=alls=2:allf=t` to kill
    //     the banding that lossy WebP otherwise exposes on our gradient
    //     fades. The dither is invisible per frame but breaks the pattern
    //     that would compress into visible bands.
    const filterComplex = [
      `[0:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos+accurate_rnd+full_chroma_int,` +
        `fps=12,setpts=PTS-STARTPTS[base]`,
      overlayChain,
      `[annot]fade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutSec.toFixed(3)}:color=black:alpha=0[annot_faded]`,
      buildRoundedFrameFilter({
        inLabel:            'annot_faded',
        outLabel:           'framed',
        cornermaskInputIdx: 1,
      }),
      // Plain `lanczos` (without the `accurate_rnd+full_chroma_int` pair)
      // matches the historical alpha-transition position, so the four
      // cornermask-transparency E2E assertions (which sample at pixel
      // (2,2) with a 3×3 tolerance) keep passing. The advanced rounding
      // flags shift the alpha ramp by ~1 px at the corner boundary —
      // enough to break the assertion even though it looks identical.
      `[framed]scale=960:540:flags=lanczos,format=rgba[final]`,
    ].join(';');

    // WebP output keeps the native 1280×720 aspect ratio, scaled to the
    // 960×540 README-friendly preset.
    const extraInputs = [
      { path: cmaskPng, loop: true, framerate: 12 },
    ];

    // ─── Pipeline 2-pass : PNG sequence → per-frame cwebp → webpmux ─────
    //
    // Why 2-pass? ffmpeg's libwebp encoder exposes only 5 AVOptions. The
    // binary `cwebp` exposes 20+ (method, af, sns, sharp_yuv, alpha_q,
    // alpha_method, alpha_filter, partition_limit, pre, pass, …) and that
    // knob spread is where the 5× size reduction (3.9 MB → ~700 KB) lives.
    // Per-frame quality adaptation on top: narrative frames (within
    // ±150 ms of a timeline event) encode at q=55, idle frames at q=42.
    // The eye never notices — but 55–70 % of frames are idle.
    const pngSeqDir = path.join(tmpDir, 'frames');
    log(`  Rendering PNG sequence → ${pngSeqDir}`);
    const { pngFiles, frameCount } = renderFilterToPngSequence(
      rawMov, filterComplex, pngSeqDir,
      {
        startSec:    startOffsetMs / 1000,
        durationSec: clipSec,
        extraInputs,
      },
    );
    log(`  Pass 1: ${frameCount} PNG frames`);

    const classes = classifyFrames(frameCount, 12, shifted);
    // q=80 lossy — "ultra clean" but viable: ~95 % of lossless visual
    // quality for ~25 % of the file size (measured: lossless=21 MB,
    // q=80=~5 MB). Lossless was rejected because the text antialiasing
    // and cornermask alpha transitions defeat LZ77/predictor compression.
    const qNarrative = 80;
    const qIdle      = 80;
    const nNarrative = classes.filter(c => c === 'narrative').length;
    log(`  Classified: ${nNarrative} narrative (q=${qNarrative}) + ${frameCount - nNarrative} idle (q=${qIdle})`);
    const webpFiles = await encodeFramesToWebpParallel(pngFiles, classes,
      { qNarrative, qIdle });
    log(`  Pass 2: cwebp encoded ${webpFiles.length} frames in parallel`);

    assembleAnimatedWebp(webpFiles, outputWebp, 83);
    log(`✓ Wrote ${outputWebp} (${fileSizeKb(outputWebp)} KB, ${clipSec.toFixed(1)}s)`);

    // Persist the shifted timeline next to the WebP so `demo:e2e --skip-record`
    // can validate the shipped artefact without rerunning the whole pipeline.
    const sidecarTimeline = outputWebp.replace(/\.webp$/, '.timeline.json');
    fs.writeFileSync(sidecarTimeline, JSON.stringify(shifted, null, 2));

    // Poster frame for prefers-reduced-motion / thumbnail. Extracted from
    // the already-encoded WebP (not a fresh filter-graph pass) to avoid
    // the frame-1 alpha glitch. The frame number is chosen by anchoring
    // to the LAST narrative event at 65 % visibility — captures the demo's
    // final "aha moment" with its overlay at peak readability, safely
    // before the video-level fade-to-dark tail.
    const posterPng = outputWebp.replace(/\.webp$/, '-poster.png');
    try {
      const posterFrame = pickPosterFrame(shifted, clipSec, { fps: 12, fadeOutSec });
      extractPosterFromWebP(outputWebp, posterPng, posterFrame);
      const rawKb = fileSizeKb(posterPng);
      optimizePosterPng(posterPng);
      const optKb = fileSizeKb(posterPng);
      log(`  Poster frame: ${posterPng} (${rawKb} KB → ${optKb} KB, frame ${posterFrame})`);
    } catch (err) {
      log(`  ⚠ poster frame extraction failed: ${(err as Error).message}`);
    }
  });

  // Keep the tmpdir only if the user sets KJ_DEMO_KEEP_TMP=1 (debugging).
  if (!process.env.KJ_DEMO_KEEP_TMP) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resources.tmpDir = undefined;
  } else {
    log(`  (kept tmp dir: ${tmpDir})`);
  }

  await cleanup('done');
}

// ---------------------------------------------------------------- helpers

function seedUserDataDir(userDataDir: string): void {
  const settingsSrc = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'demo-settings.json');
  const userDir     = path.join(userDataDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });
  fs.copyFileSync(settingsSrc, path.join(userDir, 'settings.json'));
}

interface WindowRect {
  x:     number;
  y:     number;
  w:     number;
  h:     number;
  scale: number;
}

const VERBOSE = process.env.KJ_DEMO_VERBOSE === '1';

/**
 * Read the parent-PID that vscode-runner.ts wrote to the ready marker.
 * That's the Electron main process hosting the demo's extension host —
 * our ground truth for window lookup (no reliance on title matching).
 */
function readReadyMarkerPid(file: string): number | undefined {
  try {
    const n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch { return undefined; }
}

/**
 * Probe for the demo's VS Code window via AppleScript. When `pid` is
 * supplied the lookup goes through `System Events`' `unix id` predicate
 * on the exact Electron main process — no title match required. When
 * `pid` is absent we fall back to the legacy title-contains probe so
 * non-runTests callers (none currently) still work.
 *
 * Returns a structured probe so callers can distinguish:
 *   - window found by PID
 *   - title fallback needed
 *   - likely Accessibility denial
 *   - no visible window / osascript failure
 *
 * Every osascript invocation writes to a per-PID script file for re-use
 * (osascript re-parses the script on every invocation but file I/O is
 * cached by the OS).
 */
const _probeScriptFiles = new Map<string, string>();
function runRecordingWindowProbe(source: WindowProbeSource, cacheKey: string, pid?: number): WindowProbeResult {
  let scriptFile = _probeScriptFiles.get(cacheKey);
  if (scriptFile === undefined) {
    const script = pid === undefined
      ? // Legacy title-based probe (fallback for callers without a PID).
        `on run\n` +
        `  tell application "System Events"\n` +
        `    set codeProcs to (every application process whose (name contains "Code") or (name contains "Electron"))\n` +
        `    set titles to ""\n` +
        `    set nWin to 0\n` +
        `    repeat with p in codeProcs\n` +
        `      try\n` +
        `        repeat with w in (every window of p)\n` +
        `          set nWin to nWin + 1\n` +
        `          try\n` +
        `            set wName to (name of w) as string\n` +
        `            set titles to titles & "[" & wName & "] "\n` +
        `            if wName contains "KJ_DEMO_RECORDING_WINDOW" or wName contains "Extension Development Host" then return "OK|" & nWin & "|" & titles\n` +
        `          end try\n` +
        `        end repeat\n` +
        `      end try\n` +
        `    end repeat\n` +
        `    return "MISS|" & nWin & "|" & titles\n` +
        `  end tell\n` +
        `end run\n`
      : // PID-scoped probe: the Electron main process is the SOURCE OF TRUTH.
        // `unix id` pins us to exactly one process; window count = 0 is a
        // clear signal that either the window hasn't surfaced yet OR the
        // caller lacks macOS Accessibility permission.
        `on run\n` +
        `  tell application "System Events"\n` +
        `    try\n` +
        `      set p to first application process whose unix id is ${pid}\n` +
        `    on error\n` +
        `      return "NOPROC|0|"\n` +
        `    end try\n` +
        `    set titles to ""\n` +
        `    set nWin to 0\n` +
        `    try\n` +
        `      repeat with w in (every window of p)\n` +
        `        set nWin to nWin + 1\n` +
        `        try\n` +
        `          set wName to (name of w) as string\n` +
        `          set titles to titles & "[" & wName & "] "\n` +
        `        end try\n` +
        `      end repeat\n` +
        `    end try\n` +
        `    if nWin > 0 then return "OK|" & nWin & "|" & titles\n` +
        `    return "EMPTY|0|"\n` +
        `  end tell\n` +
        `end run\n`;
    scriptFile = path.join(os.tmpdir(), `kj-demo-probe-${cacheKey.replace(':', '-')}-${process.pid}.applescript`);
    fs.writeFileSync(scriptFile, script);
    _probeScriptFiles.set(cacheKey, scriptFile);
  }

  try {
    const out = execSync(
      `osascript ${JSON.stringify(scriptFile)}`,
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    // Output format: "STATUS|nWindows|titles"
    const [status, nStr, titles = ''] = out.split('|');
    const n = parseInt(nStr, 10);
    const windowCount = Number.isFinite(n) ? n : 0;
    const seen = `source=${source} pid=${pid ?? 'any'} status=${status} windows=${windowCount} titles=${titles}`;
    if (VERBOSE) log(`  [probe] ${seen}`);
    return {
      ok:     status === 'OK',
      source,
      status: status as WindowProbeResult['status'],
      windowCount,
      seen,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return {
      ok:          false,
      source,
      status:      'OSASCRIPT_ERROR',
      windowCount: 0,
      seen:        `source=${source} pid=${pid ?? 'any'} osascript-error="${msg}"`,
    };
  }
}

function probeRecordingWindowResolution(pid?: number): WindowResolutionDecision {
  if (process.platform !== 'darwin') {
    return {
      ok:                         true,
      resolution:                 'pid',
      likelyAccessibilityBlocked: false,
      positionMode:               'pid',
      summary:                    'resolution=pid (non-darwin: assumed ok)',
    };
  }

  const pidProbe = pid === undefined
    ? undefined
    : runRecordingWindowProbe('pid', `pid:${pid}`, pid);
  const titleProbe = pidProbe?.ok
    ? undefined
    : runRecordingWindowProbe('title', 'title');

  return decideWindowResolution({ pidProbe, titleProbe });
}

async function waitForRecordingWindow(
  pid: number | undefined,
  opts: {
    timeoutMs:            number;
    intervalMs:           number;
    accessibilityGraceMs: number;
  },
): Promise<WindowResolutionDecision> {
  const deadline = Date.now() + opts.timeoutMs;
  let blockedSince: number | undefined;
  let lastDecision: WindowResolutionDecision | undefined;

  while (Date.now() < deadline) {
    const decision = probeRecordingWindowResolution(pid);
    lastDecision = decision;
    if (decision.ok) return decision;

    if (decision.likelyAccessibilityBlocked) {
      blockedSince ??= Date.now();
      if (Date.now() - blockedSince >= opts.accessibilityGraceMs) {
        throw new Error(buildWindowFailureMessage(decision));
      }
    } else {
      blockedSince = undefined;
    }

    await sleep(opts.intervalMs);
  }

  throw new Error(buildWindowFailureMessage(
    lastDecision ?? {
      ok:                         false,
      resolution:                 'no_window',
      likelyAccessibilityBlocked: false,
      summary:                    'resolution=no_window no probe result available',
    },
  ));
}

function logVSCodeLikeProcesses(): void {
  try {
    const procs = execSync(
      `ps -eo pid,command | grep -iE "visual studio code|vscode-test|Code\\.app" | grep -v grep | head -15`,
      { encoding: 'utf8' },
    ).trim();
    if (!procs) return;
    log(`  VS Code-like processes:\n${procs.split('\n').map(l => '    ' + l).join('\n')}`);
  } catch { /* ignore */ }
}

/**
 * Position the demo's VS Code window at (WINDOW_X, WINDOW_Y) with our
 * target size, then read back its actual rect + the display's Retina
 * scale.
 *
 * When `pid` is provided (canonical path), AppleScript looks the window
 * up via `unix id` — no title-match dependency. When absent, falls back
 * to the legacy name-contains probe for robustness.
 */
function positionVSCodeWindow(pid?: number, preferredMode: WindowProbeSource = 'pid'): WindowRect {
  if (process.platform !== 'darwin') {
    log(`  (window positioning only implemented on macOS — using default)`);
    return { x: 0, y: 0, w: WIDTH, h: HEIGHT, scale: 1 };
  }

  const buildResolveTarget = (mode: 'pid' | 'title'): string => mode === 'pid'
    ? `    try\n` +
      `      set targetProc to first application process whose unix id is ${pid}\n` +
      `    on error\n` +
      `      return "ERROR:no-process-with-pid-${pid}"\n` +
      `    end try\n` +
      `    set allTitles to "(pid=${pid})"\n` +
      `    try\n` +
      `      set allWins to (every window of targetProc)\n` +
      `    on error errMsg\n` +
      `      return "ERROR:window-list-failed; " & errMsg\n` +
      `    end try\n` +
      `    if (count of allWins) = 0 then\n` +
      `      return "ERROR:no-windows-for-pid; " & allTitles\n` +
      `    end if\n` +
      `    set targetWindow to item 1 of allWins\n` +
      `    try\n` +
      `      set allTitles to allTitles & "[" & (name of targetWindow as string) & "]"\n` +
      `    end try\n`
    : `    set codeProcs to (every application process whose (name contains "Code") or (name contains "Electron"))\n` +
      `    if (count of codeProcs) = 0 then return "ERROR:no-code-process"\n` +
      `    set allTitles to ""\n` +
      `    set targetWindow to missing value\n` +
      `    set targetProc   to missing value\n` +
      `    repeat with p in codeProcs\n` +
      `      try\n` +
      `        repeat with w in (every window of p)\n` +
      `          try\n` +
      `            set wName to (name of w) as string\n` +
      `            set allTitles to allTitles & "[" & wName & "] "\n` +
      `            if wName contains "KJ_DEMO_RECORDING_WINDOW" or wName contains "Extension Development Host" then\n` +
      `              set targetWindow to w\n` +
      `              set targetProc   to p\n` +
      `              exit repeat\n` +
      `            end if\n` +
      `          end try\n` +
      `        end repeat\n` +
      `      end try\n` +
      `      if targetWindow is not missing value then exit repeat\n` +
      `    end repeat\n` +
      `    if targetWindow is missing value then\n` +
      `      set targetProc to item (count of codeProcs) of codeProcs\n` +
      `      try\n` +
      `        set targetWindow to window 1 of targetProc\n` +
      `      end try\n` +
      `    end if\n` +
      `    if targetWindow is missing value then return "ERROR:no-demo-recording-window; seen: " & allTitles\n`;

  const attemptPosition = (mode: 'pid' | 'title'): { x: number; y: number; w: number; h: number; } => {
    const script =
      `on run\n` +
      `  tell application "System Events"\n` +
      buildResolveTarget(mode) +
      `    set frontmost of targetProc to true\n` +
      `    set position of targetWindow to {${WINDOW_X}, ${WINDOW_Y}}\n` +
      `    set size of targetWindow to {${WIDTH}, ${HEIGHT}}\n` +
      `    try\n` +
      `      perform action "AXRaise" of targetWindow\n` +
      `    end try\n` +
      `    delay 0.3\n` +
      `    set pos to position of targetWindow\n` +
      `    set sz  to size of targetWindow\n` +
      `    return ((item 1 of pos) as string) & "," & ((item 2 of pos) as string) & "," & ((item 1 of sz) as string) & "," & ((item 2 of sz) as string)\n` +
      `  end tell\n` +
      `end run\n`;

    const scriptFile = path.join(os.tmpdir(), `kj-demo-position-${mode}-${process.pid}.applescript`);
    fs.writeFileSync(scriptFile, script);
    try {
      const out = execSync(`osascript ${JSON.stringify(scriptFile)}`, { encoding: 'utf8' }).trim();
      if (!out || out.startsWith('ERROR:')) throw new Error(out || 'empty osascript output');
      const parts = out.split(',').map(s => parseInt(s.trim(), 10));
      if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
        throw new Error(`unexpected osascript output: ${JSON.stringify(out)}`);
      }
      const [x, y, w, h] = parts;
      return { x, y, w, h };
    } finally {
      fs.rmSync(scriptFile, { force: true });
    }
  };

  const formatExecError = (err: unknown): string => {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    return stderr || (err as Error).message;
  };

  let logicalRect = { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  const attempts = pid === undefined
    ? (['title'] as const)
    : preferredMode === 'title'
      ? (['title', 'pid'] as const)
      : (['pid', 'title'] as const);
  let positionedBy: WindowProbeSource | undefined;
  let lastError = '';
  for (const mode of attempts) {
    try {
      logicalRect = attemptPosition(mode);
      positionedBy = mode;
      log(`  Window positioned at (${logicalRect.x},${logicalRect.y}) size ${logicalRect.w}×${logicalRect.h} (logical)`);
      break;
    } catch (err) {
      lastError = formatExecError(err);
    }
  }
  if (!positionedBy) {
    throw new Error(
      `VS Code recording window could not be positioned.\n` +
      `  preferred=${preferredMode}\n` +
      `  last-error=${lastError}`,
    );
  }
  if (positionedBy === 'title' && pid !== undefined) {
    log(`  Window resolution: title_fallback`);
  } else {
    log(`  Window resolution: pid`);
  }

  const scale = detectRetinaScale();
  log(`  Display scale: ${scale}x`);
  return { ...logicalRect, scale };
}

/** Detect main display Retina scale factor. Usually 1 or 2 on macOS. */
function detectRetinaScale(): number {
  try {
    const out = execSync(
      `osascript -e 'tell application "Finder" to return bounds of window of desktop'`,
      { encoding: 'utf8' },
    ).trim();
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

/**
 * Wrap a named step with start / ok / FAIL logging and timing. When a demo
 * flakes at 3 AM you want to see exactly which phase slowed down, not a wall
 * of interleaved log lines with no structure.
 */
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
