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

  // Diagnostic: dump raw.mov color metadata. Screencapture on some macOS
  // versions produces color-space tags that can drift through the filter
  // chain and dim Skia-rendered caption text. Logging these up-front makes
  // regressions diagnosable post-mortem from the run log alone.
  try {
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,pix_fmt,color_space,color_transfer,color_primaries,color_range -of default=noprint_wrappers=1 "${rawMov}"`,
      { encoding: 'utf8' },
    );
    log('  raw.mov metadata:');
    for (const line of probe.trim().split('\n')) log('    ' + line);
  } catch {
    // Non-fatal: diagnostics only.
  }

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
  // Captions render via pre-rasterised PNGs (Skia) because ffmpeg drawtext
  // cannot render color emoji. Those PNGs are attached to ffmpeg as extra
  // inputs starting at index 1 (just after the main video); the cornermask
  // input follows them at `1 + captionPngs.length`.
  const { chain: overlayChain, extraInputs: captionPngs } = buildOverlayFilterGraph(
    shifted, { fontPath, fontPathMono, firstCaptionInputIdx: 1 },
  );
  const cornermaskInputIdx = 1 + captionPngs.length;

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
    // Scale AND normalise the color space in one shot. Screencapture can
    // produce raw.mov with ambiguous or wide-gamut tags (P3 smpte432,
    // bt2020, untagged); downstream filters handled them inconsistently
    // and the caption's YUV round-trip came back dimmed. Forcing an
    // explicit BT.709/tv conversion here, then `setparams` to stamp the
    // stream tags, makes everything deterministic.
    `[0:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos+accurate_rnd+full_chroma_int:in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,` +
      `format=yuv420p,` +
      `setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,` +
      `fps=12,setpts=PTS-STARTPTS[base]`,
    overlayChain,
    `[annot]fade=t=out:st=${fadeStart.toFixed(3)}:d=${fadeOutSec.toFixed(3)}:color=black:alpha=0[annot_faded]`,
    buildRoundedFrameFilter({
      inLabel:            'annot_faded',
      outLabel:           'framed',
      cornermaskInputIdx,
    }),
    // Plain `lanczos` (without `accurate_rnd+full_chroma_int`) matches the
    // historical alpha-transition position so the 4 cornermask-transparency
    // E2E assertions keep passing (±1 px at the corner boundary otherwise).
    //
    // `in_range=tv:out_range=pc` is the symmetric half of the BT.709/tv
    // normalisation above: we ensure Y=235 (limited white) maps back to
    // RGB=255 (full white) in the final RGBA output. Without this, the
    // caption text peaked at ~233 in some captures — just below the
    // threshold where it reads as solid white against the pill.
    `[framed]scale=960:540:flags=lanczos:in_range=tv:out_range=pc,format=rgba[framed_small]`,

    // Synthetic drop shadow around the rounded window. Macos `screencapture
    // -o` produces native window shadows for stills, but we capture via
    // `screencapture -v` (animated) which does not. We replicate the effect
    // here so every demo ships with the same depth-cue the README hero
    // shot gets.
    //
    // Pipeline:
    //   ① pad the 960×540 rounded frame into a 1040×620 canvas with a
    //     40 px transparent margin on every side — the margin is the
    //     real-estate the blurred shadow paints into
    //   ② split the padded stream so we can feed the same pixels to the
    //     shadow render AND to the final overlay composite
    //   ③ build the shadow: replace RGB with black, scale alpha to 0.55
    //     (shadow opacity), then gaussian-blur with sigma 18 so the
    //     silhouette diffuses softly outward
    //   ④ overlay the original padded frame on top of the shadow, 4 px
    //     lower — the small downward offset mimics a top-left light
    //     source and reads as "drop shadow" rather than "glow"
    `[framed_small]pad=iw+80:ih+80:40:40:color=black@0[padded]`,
    `[padded]split=2[shadow_src][top]`,
    `[shadow_src]format=rgba,geq=r=0:g=0:b=0:a='alpha(X,Y)*0.55',gblur=sigma=18:steps=3[shadow]`,
    `[shadow][top]overlay=0:4:format=auto[final]`,
  ].join(';');

  // Order MUST match the input indices used in the filter graph:
  //   input 0     = raw video (added by renderFilterToPngSequence)
  //   inputs 1..N = caption PNGs (N = captionPngs.length)
  //   input N+1   = cornermask PNG
  // Each caption PNG is attached with `-loop 1 -framerate 12` so it is an
  // infinite stream that the overlay filter can read at any `t`, matching
  // the same treatment as the cornermask.
  const extraInputs = [
    ...captionPngs.map(p => ({ path: p, loop: true, framerate: 12 })),
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

  // Diagnostic: under KJ_DEMO_KEEP_TMP=1, save a mid-caption PNG frame
  // BEFORE cwebp. If this frame has healthy text pixels but the final webp
  // doesn't, the regression is in the cwebp encoding step; if this frame is
  // already broken, it's the ffmpeg filter chain that's lossy.
  if (process.env.KJ_DEMO_KEEP_TMP) {
    const firstCap = shifted.find(e => e.type === 'caption');
    if (firstCap && pngFiles.length > 0) {
      const midSec     = (firstCap.t + firstCap.duration / 2) / 1000;
      const frameIdx   = Math.min(pngFiles.length - 1, Math.max(0, Math.floor(midSec * 12)));
      const diagFrame  = outputWebp.replace(/\.webp$/, `-diag-frame${frameIdx}.png`);
      try {
        fs.mkdirSync(path.dirname(diagFrame), { recursive: true });
        fs.copyFileSync(pngFiles[frameIdx], diagFrame);
        log(`  Diagnostic: caption mid-frame PNG (pre-cwebp) → ${diagFrame}`);
      } catch (err) {
        log(`  ⚠ diagnostic frame copy failed: ${(err as Error).message}`);
      }
    }
  }

  const classes    = classifyFrames(frameCount, 12, shifted);
  const qNarrative = 80;
  const qIdle      = 80;
  const nNarrative = classes.filter(c => c === 'narrative').length;
  log(`  Classified: ${nNarrative} narrative (q=${qNarrative}) + ${frameCount - nNarrative} idle (q=${qIdle})`);
  const webpFiles = await encodeFramesToWebpParallel(pngFiles, classes, { qNarrative, qIdle });
  log(`  Pass 2: cwebp encoded ${webpFiles.length} frames in parallel`);

  assembleAnimatedWebp(webpFiles, outputWebp, 83);
  log(`✓ Wrote ${outputWebp} (${fileSizeKb(outputWebp)} KB, ${clipSec.toFixed(1)}s)`);

  // Diagnostic: under KJ_DEMO_KEEP_TMP=1, stash the first caption PNG next
  // to the webp so visual drift between the Skia-rendered source and the
  // final webp can be compared at a glance. Gated so normal runs don't
  // pollute media/demos/ with debug artifacts.
  if (process.env.KJ_DEMO_KEEP_TMP) {
    const firstCaption = captionPngs[0];
    if (firstCaption) {
      const diagCopy = outputWebp.replace(/\.webp$/, '-cap0.png');
      fs.copyFileSync(firstCaption, diagCopy);
      log(`  Diagnostic: first caption PNG → ${diagCopy}`);
    }
  }

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
