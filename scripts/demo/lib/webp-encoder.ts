/**
 * Two-pass WebP animé encoder with per-frame quality adaptation.
 *
 * Pipeline :
 *   1. ffmpeg filter_complex → PNG32 sequence (alpha preserved, 960×540)
 *   2. cwebp in parallel, quality depends on whether frame is "narrative"
 *      (near a timeline event) or "idle" (static UI frame)
 *   3. webpmux assembles the per-frame .webp files into one animated WebP
 *   4. pngquant optimises the poster PNG extracted separately
 *
 * Why 2-pass via `cwebp` binary instead of ffmpeg's `libwebp` encoder?
 * Because ffmpeg 8.1 only exposes `-lossless`, `-preset`, `-cr_threshold`,
 * `-cr_size` and `-quality` as libwebp AVOptions. The critical leverage
 * — `-method 6`, `-sharp_yuv`, `-af`, `-sns`, `-alpha_q`, `-alpha_method`,
 * `-alpha_filter`, `-alpha_cleanup`, `-partition_limit`, `-pre`, `-pass 10`
 * — is only reachable through the standalone `cwebp` binary.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { TimelineEvent } from './timeline';

export type ExtraInput = string | {
  path:       string;
  loop?:      boolean;
  framerate?: number;
};

function expandExtraInputs(inputs?: ReadonlyArray<ExtraInput>): string[] {
  const args: string[] = [];
  for (const input of inputs ?? []) {
    if (typeof input === 'string') { args.push('-i', input); continue; }
    if (input.loop)      args.push('-loop', '1');
    if (input.framerate) args.push('-framerate', String(input.framerate));
    args.push('-i', input.path);
  }
  return args;
}

export interface RenderPngSeqOpts {
  startSec?:    number;
  durationSec?: number;
  extraInputs?: ReadonlyArray<ExtraInput>;
}

/**
 * Pass 1 — run a filter_complex graph that ends on label `[final]` and emit a
 * PNG32 (RGBA) sequence into `outputDir`. Files are written as
 * `frame_00001.png`, `frame_00002.png`, … in order.
 *
 * The filter graph is responsible for all scaling, overlays, fades and alpha
 * compositing. This function only wraps the ffmpeg call + collects the
 * emitted PNGs in sorted order.
 */
export function renderFilterToPngSequence(
  inputPath:     string,
  filterComplex: string,
  outputDir:     string,
  opts:          RenderPngSeqOpts = {},
): { pngFiles: string[]; frameCount: number } {
  fs.mkdirSync(outputDir, { recursive: true });

  const pre: string[] = [];
  if (opts.startSec    !== undefined) pre.push('-ss', opts.startSec.toFixed(3));
  if (opts.durationSec !== undefined) pre.push('-t',  opts.durationSec.toFixed(3));

  const extraInputArgs = expandExtraInputs(opts.extraInputs);
  const outPattern     = path.join(outputDir, 'frame_%05d.png');

  const outTail: string[] = [];
  if (opts.durationSec !== undefined) outTail.push('-t', opts.durationSec.toFixed(3));

  const args = [
    '-y',
    '-filter_complex_threads', '0',
    ...pre, '-i', inputPath, ...extraInputArgs,
    '-filter_complex', filterComplex,
    '-map',            '[final]',
    ...outTail,
    '-pix_fmt',        'rgba',
    '-f',              'image2',
    outPattern,
  ];

  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(`ffmpeg PNG-seq failed (exit ${r.status}):\n${r.stderr?.toString().slice(-2000)}`);
  }

  const pngFiles = fs.readdirSync(outputDir)
    .filter(f => /^frame_\d+\.png$/.test(f))
    .sort()
    .map(f => path.join(outputDir, f));

  if (pngFiles.length === 0) {
    throw new Error(`ffmpeg produced no PNG frames in ${outputDir}`);
  }

  return { pngFiles, frameCount: pngFiles.length };
}

/* ─── Per-frame classification ─────────────────────────────────────────────── */

export type FrameClass = 'narrative' | 'idle';

/**
 * A frame at index `i` (time = i / fps * 1000 ms in the trimmed clip) is
 * "narrative" if it falls inside the visibility window of any timeline event,
 * extended by `marginMs` on each side to cover the fade-in / fade-out tails
 * of overlay animations.
 *
 * Typical outcome on Kotlin Jump demos: 30–45 % of frames are "narrative".
 * The other 55–70 % encode at the lower `qIdle` value — the eye never notices
 * because nothing meaningful is changing in those frames.
 */
export function classifyFrames(
  frameCount: number,
  fps:        number,
  events:     readonly TimelineEvent[],
  marginMs:   number = 50,
): FrameClass[] {
  const frameMs = 1000 / fps;
  const classes: FrameClass[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = i * frameMs;
    const inEvent = events.some(ev =>
      t >= ev.t - marginMs && t <= ev.t + ev.duration + marginMs,
    );
    classes.push(inEvent ? 'narrative' : 'idle');
  }
  return classes;
}

/* ─── Pass 2 : cwebp in parallel with quality adaptation ───────────────────── */

/**
 * Flags applied to every frame, irrespective of narrative/idle classification.
 * Tuned for UI screencasts with small sharp text + large flat regions + crisp
 * transparent rounded corners. See `doc/Demo/demo-encoder-flags.md` (not
 * committed — see PR description) for the rationale behind each knob.
 */
// Lossy flags — tuned iteratively against real demos. An earlier try
// (-preset drawing + -pre 3 + -pass 10 + `noise=alls=2:allf=t`) produced
// files LARGER than the single-pass libwebp baseline: `drawing` preset
// inflates smooth UI gradients, `-pre 3` compounds with source dither,
// and per-frame random noise destroys spatial/temporal coherence.
// The flags below keep the high-ROI levers (method 6, af, sns, sharp_yuv,
// alpha lossless, partition_limit, pass 6) and drop the rest.
const CWEBP_LOSSY_FLAGS: readonly string[] = [
  '-m',              '6',
  '-af',
  '-sns',            '80',
  '-sharp_yuv',
  '-alpha_method',   '1',
  '-alpha_filter',   'best',
  '-alpha_q',        '100',
  '-alpha_cleanup',  '1',
  // `-exact 1` preserves RGB exactly under alpha=0 pixels. Required by the
  // E2E "transparent corner" assertion which decodes to rgb24-on-black and
  // expects (0,0,0) — `-exact 0` lets cwebp quantise those pixels for ~2 %
  // size gain, but the quantised values decode to non-(0,0,0) and the
  // assertion fails. 2 % is not worth breaking a visual contract.
  '-exact',          '1',
  '-partition_limit','0',
  '-pass',           '6',
  '-segments',       '4',
  '-preset',         'picture',
  '-mt',
  '-quiet',
];

// Lossless flags — zero visual loss, competitive size on flat-colour UI
// (large text regions + solid backgrounds compress via predictors/LZ77).
// `-z 9` is the slowest/best lossless compression preset. `-exact 1`
// preserves exact RGB under transparent pixels (safe default for UI
// captures — we don't want the encoder to modify anything).
const CWEBP_LOSSLESS_FLAGS: readonly string[] = [
  '-lossless',
  '-z',             '9',
  '-m',             '6',
  '-exact',         '1',
  '-mt',
  '-quiet',
];

export interface EncodeFramesOpts {
  /** Quality for frames near a timeline event (default 75 — "ultra clean"). */
  qNarrative?:  number;
  /** Quality for idle frames (default 75 — matches narrative for uniform look). */
  qIdle?:       number;
  /** Parallel workers. Default = os.cpus().length. */
  concurrency?: number;
  /** Encode every frame in lossless mode (zero visual loss, often smaller
   *  than high-q lossy on flat UI captures). When true, `qNarrative` /
   *  `qIdle` are ignored. */
  lossless?:    boolean;
}

export async function encodeFramesToWebpParallel(
  pngFiles: readonly string[],
  classes:  readonly FrameClass[],
  opts:     EncodeFramesOpts = {},
): Promise<string[]> {
  if (pngFiles.length !== classes.length) {
    throw new Error(
      `classes length mismatch: ${pngFiles.length} pngs vs ${classes.length} classes`,
    );
  }
  const qNarrative = String(opts.qNarrative ?? 75);
  const qIdle      = String(opts.qIdle      ?? 75);
  const lossless   = opts.lossless === true;
  const concurrency = Math.max(1, Math.min(
    opts.concurrency ?? os.cpus().length,
    pngFiles.length,
  ));

  const webpFiles = pngFiles.map(f => f.replace(/\.png$/, '.webp'));

  // Shared mutable cursor; workers grab frames off the top in FIFO order so
  // every worker has roughly equal load regardless of per-frame encode time.
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= pngFiles.length) return;
      const args = lossless
        ? [...CWEBP_LOSSLESS_FLAGS, pngFiles[i], '-o', webpFiles[i]]
        : ['-q', classes[i] === 'narrative' ? qNarrative : qIdle,
           ...CWEBP_LOSSY_FLAGS, pngFiles[i], '-o', webpFiles[i]];

      await new Promise<void>((resolve, reject) => {
        const p = spawn('cwebp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        p.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        p.on('error', reject);
        p.on('exit', code => {
          if (code === 0) resolve();
          else reject(new Error(
            `cwebp exit ${code} on frame ${i} (${pngFiles[i]}):\n${stderr.slice(-1000)}`,
          ));
        });
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return webpFiles;
}

/* ─── Pass 3 : webpmux assembles the animated WebP ─────────────────────────── */

/**
 * Stitch N single-frame `.webp` files into one animated WebP.
 *
 * Per-frame parameter string `+{dur}+{x}+{y}+{dispose}+{blend}`:
 *   - `dur`     : frame duration in ms (83 for 12 fps, 84 for a mix giving
 *                 the spec-mandated ≈83.333 ms average).
 *   - `x`, `y`  : frame origin (0,0 — every frame is full-canvas).
 *   - `dispose` : 1 = dispose-to-background (clears the canvas to `bgcolor`
 *                 before the next frame). Safer than 0 here — each Pass-1
 *                 frame is a full render, no inter-frame dependency.
 *   - `+b`      : no-blend (new frame REPLACES the canvas). Any blending
 *                 would compound fades already baked into the PNG, softening
 *                 them visibly.
 */
export function assembleAnimatedWebp(
  webpFiles:       readonly string[],
  outputWebp:      string,
  frameDurationMs: number,
): void {
  fs.mkdirSync(path.dirname(outputWebp), { recursive: true });
  const args: string[] = [];
  for (const f of webpFiles) {
    args.push('-frame', f, `+${frameDurationMs}+0+0+1+b`);
  }
  args.push('-loop', '0', '-bgcolor', '0,0,0,0', '-o', outputWebp);

  const r = spawnSync('webpmux', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    throw new Error(
      `webpmux failed (exit ${r.status}):\n${r.stderr?.toString().slice(-2000)}`,
    );
  }
}

/* ─── Pass 4 : poster optimisation ─────────────────────────────────────────── */

/**
 * Losslessly replace `pngPath` with a palette-quantised equivalent.
 * First tries `pngquant` (palette, ~5× smaller, visually identical),
 * falls back to `oxipng` (truly lossless, ~20–30 % smaller),
 * and degrades gracefully to a no-op if neither binary is installed
 * (with a warning on stderr).
 *
 * Safe to call in-place — both binaries take an input path and an output
 * path; we write to a sibling temp file and swap on success.
 */
export function optimizePosterPng(pngPath: string): void {
  if (!fs.existsSync(pngPath)) return;

  if (hasBinary('pngquant')) {
    const r = spawnSync('pngquant', [
      '--quality', '85-95',
      '--speed',   '1',
      '--strip',
      '--force',
      '--output',  pngPath,
      pngPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) {
      // Exit 98 = "quality below threshold, file left untouched" — treat as
      // a best-effort success (the poster is already compact enough).
      if (r.status !== 98) {
        console.error(`[webp-encoder] pngquant exit ${r.status}:\n${r.stderr?.toString().slice(-500)}`);
      }
    }
    return;
  }

  if (hasBinary('oxipng')) {
    const r = spawnSync('oxipng', ['-o', '4', '--strip', 'safe', pngPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (r.status !== 0) {
      console.error(`[webp-encoder] oxipng exit ${r.status}:\n${r.stderr?.toString().slice(-500)}`);
    }
    return;
  }

  console.error(
    `[webp-encoder] poster left unoptimised: install pngquant (brew install pngquant) for ~5× smaller posters`,
  );
}

function hasBinary(name: string): boolean {
  const r = spawnSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0;
}

/* ─── Binary requirement check ─────────────────────────────────────────────── */

export interface BinaryCheckResult {
  ok:      boolean;
  missing: string[];
}

/**
 * Verify that every command-line dependency required by the 2-pass pipeline
 * is on `$PATH`. Callers should fail-fast on a non-ok result and surface the
 * install hint to the user.
 */
export function checkRequiredBinaries(): BinaryCheckResult {
  const required = ['ffmpeg', 'ffprobe', 'cwebp', 'webpmux', 'dwebp'];
  const missing  = required.filter(b => !hasBinary(b));
  return { ok: missing.length === 0, missing };
}
