/**
 * Shared post-processing pipeline: raw .mov + timeline.json → annotated .webp
 * + poster PNG. Used by both the scripted orchestrator (`record.ts`) and the
 * manual orchestrator (`manual-record.ts`, `manual-render.ts`).
 *
 * Two trim modes:
 *
 *   - `auto` (scripted): derives a tight window around narrative events.
 *       PRE_ROLL_MS = 300, TAIL_MS = 400. Accounts for ffmpeg warmup delay via
 *       `rawOffsetMs` (time between screencapture start and Stage t=0 inside
 *       the extension host — ~1200 ms on Apple Silicon).
 *
 *   - `none` (manual, or scripted with zero events): keeps the full raw capture.
 *       The author chose their own timings while watching the recording in
 *       QuickLook — we trust them verbatim.
 *
 * The filter graph, PNG sequence, per-frame cwebp classification, and poster
 * extraction logic are identical to the pre-factor code path — visual output
 * is byte-equivalent (to within lossy cwebp tolerances) for scripted demos.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildOverlayFilterGraph }                       from './overlay';
import { buildRoundedFrameFilter, prerenderCornerMask }  from './frame';
import {
  extractPosterFromWebP,
  fileSizeKb,
  pickPosterFrame,
  probeDurationSec,
}                                                        from './ffmpeg';
import {
  assembleAnimatedWebp,
  classifyFrames,
  encodeFramesToWebpParallel,
  optimizePosterPng,
  renderFilterToPngSequence,
}                                                        from './webp-encoder';
import type { TimelineEvent }                            from './timeline';

const WIDTH  = 1280;
const HEIGHT = 720;

export interface PostProcessOpts {
  /** Raw .mov captured by screencapture */
  rawMov:          string;
  /** Destination .webp path. Poster goes next to it as `<name>-poster.png`. */
  outputWebp:      string;
  /** Timeline JSON input. In scripted mode: written by VS Code runner in tmpDir.
   *  In manual mode: written by the REPL next to the webp. */
  timelineJson:    string;
  /** Where to write the rendered timeline sidecar.
   *   - Scripted: `<outputWebp>.timeline.json` (alongside webp in media/demos/).
   *   - Manual:   same path as `timelineJson` (the author's JSON IS the sidecar). */
  sidecarTimeline: string;
  /** Temp dir for PNG sequence + cornermask */
  tmpDir:          string;
  /** Milliseconds between screencapture start and Stage t=0. 0 in manual mode
   *  (the user controls the clock directly; no VS Code warmup to skip). */
  rawOffsetMs:     number;
  /** 'auto' trims around events; 'none' keeps the full raw. */
  trimMode:        'auto' | 'none';
  /** Absolute path to the repo root (for font fixtures) */
  repoRoot:        string;
  /** Logger — callers supply their own prefix (e.g. "[demo] ") */
  log:             (msg: string) => void;
}

export async function runPostProcess(opts: PostProcessOpts): Promise<void> {
  const {
    rawMov, outputWebp, timelineJson, sidecarTimeline, tmpDir,
    rawOffsetMs, trimMode, repoRoot, log,
  } = opts;

  log(`  Captured ${fileSizeKb(rawMov)} KB of raw video`);
  const events = JSON.parse(fs.readFileSync(timelineJson, 'utf8')) as TimelineEvent[];
  log(`  ${events.length} timeline events to overlay`);

  const rawDurationSec = probeDurationSec(rawMov);
  const hasEvents      = events.length > 0;
  const useAutoTrim    = trimMode === 'auto' && hasEvents;

  let startOffsetMs: number;
  let durationMs:    number;
  let shifted:       TimelineEvent[];

  if (useAutoTrim) {
    // Trim dead setup at the start (VS Code launch + indexing). Keep a
    // 300 ms pre-roll so the first overlay doesn't pop in on frame 0, and a
    // 400 ms tail after the last event — enough for the caption's peak-end
    // keyframe to read at full luma before the fade-to-dark kicks in.
    //
    // Demo timeline event timestamps (e.t) are measured from when the Stage was
    // instantiated INSIDE the VS Code extension host — which happens ~rawOffsetMs
    // AFTER ffmpeg started capturing. So in raw-video coordinates, an event with
    // demo-timeline t=E is at raw-video t = rawOffsetMs + E.
    const PRE_ROLL_MS = 300;
    const TAIL_MS     = 400;
    const firstT      = events[0]?.t ?? 0;
    const lastEnd     = events.reduce((m, e) => Math.max(m, e.t + e.duration), 0);
    startOffsetMs     = Math.max(0, rawOffsetMs + firstT - PRE_ROLL_MS);
    durationMs        = Math.max(1000, (rawOffsetMs + lastEnd) - startOffsetMs + TAIL_MS);
    // Shift all event timestamps so t=0 corresponds to the trimmed video start.
    shifted           = events.map(e => ({ ...e, t: (rawOffsetMs + e.t) - startOffsetMs }));
    log(`  Trimming raw to ${(durationMs / 1000).toFixed(1)}s (cut ${(startOffsetMs / 1000).toFixed(1)}s of setup)`);
  } else {
    // Manual mode OR scripted with zero events: keep the full raw. Author's
    // timings are already in raw-video coordinates (manual) or there's nothing
    // to anchor the trim to (zero events), so we don't truncate.
    startOffsetMs = 0;
    durationMs    = Number.isFinite(rawDurationSec)
      ? Math.max(1000, rawDurationSec * 1000)
      : 1000;
    shifted       = events.map(e => ({ ...e, t: rawOffsetMs + e.t }));
    log(
      `  Using full raw (${(durationMs / 1000).toFixed(1)}s, ` +
      `${hasEvents ? 'trim=none' : 'no events'})`,
    );
  }

  const fontPath     = path.join(repoRoot, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf');
  const fontPathMono = path.join(repoRoot, 'scripts', 'demo', 'fixtures', 'JetBrainsMono-Regular.ttf');
  const { chain: overlayChain } = buildOverlayFilterGraph(shifted, { fontPath, fontPathMono });

  // Clamp the requested clip to what the raw capture actually contains.
  const availableSec = Number.isFinite(rawDurationSec)
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
  const cmaskPng = path.join(tmpDir, 'cornermask.png');
  log(`  Pre-rendering cornermask`);
  const execOnce = (cmd: string): void => { execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] }); };
  prerenderCornerMask(cmaskPng, execOnce);

  // Filter graph tuned for the 2-pass pipeline (see lib/webp-encoder.ts):
  //   ① scale to 1280×720 @ 12 fps, with lanczos+accurate_rnd+full_chroma_int
  //     (the accurate-rnd flag alone eliminates a subtle rounding bias
  //     that was desaturating the VS Code blue by ~3 %).
  //   ② overlay chain (banners/captions/keystrokes).
  //   ③ fade to transparent-black (0.3 s).
  //   ④ rounded-corner alphamerge with pre-rendered cornermask PNG.
  //   ⑤ downscale to 960×540 final.
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
    // Plain `lanczos` (without `accurate_rnd+full_chroma_int`) matches the
    // historical alpha-transition position so the 4 cornermask-transparency
    // E2E assertions keep passing (±1 px at the corner boundary otherwise).
    `[framed]scale=960:540:flags=lanczos,format=rgba[final]`,
  ].join(';');

  const extraInputs = [
    { path: cmaskPng, loop: true, framerate: 12 },
  ];

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

  const classes    = classifyFrames(frameCount, 12, shifted);
  const qNarrative = 80;
  const qIdle      = 80;
  const nNarrative = classes.filter(c => c === 'narrative').length;
  log(`  Classified: ${nNarrative} narrative (q=${qNarrative}) + ${frameCount - nNarrative} idle (q=${qIdle})`);
  const webpFiles = await encodeFramesToWebpParallel(pngFiles, classes, { qNarrative, qIdle });
  log(`  Pass 2: cwebp encoded ${webpFiles.length} frames in parallel`);

  assembleAnimatedWebp(webpFiles, outputWebp, 83);
  log(`✓ Wrote ${outputWebp} (${fileSizeKb(outputWebp)} KB, ${clipSec.toFixed(1)}s)`);

  fs.mkdirSync(path.dirname(sidecarTimeline), { recursive: true });
  fs.writeFileSync(sidecarTimeline, JSON.stringify(shifted, null, 2));

  // Poster frame for prefers-reduced-motion / thumbnail. Extracted from
  // the already-encoded WebP (not a fresh filter-graph pass) to avoid
  // the frame-1 alpha glitch.
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
}
