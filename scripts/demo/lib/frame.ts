/**
 * Rounded-corner frame for demo WebP assets.
 *
 * Minimalist design — chosen over "Stripe / Linear / Vercel premium"
 * (shadow + border + highlight + margin) because the latter showed a
 * visible white ring on light-mode previews and a frame-1 alpha glitch
 * that read as "shadow passing" on loop. This module now exposes just
 * one primitive: apply a rounded-corner alpha mask to a video stream,
 * nothing else.
 *
 * Pipeline shape:
 *   scale 1280×720 video  →  alphamerge(rounded-rect mask)  →  WebP
 *
 * The WebP's four corners are fully transparent so the asset blends
 * with any README background (light / dark / marketplace / …).
 */

import { VIDEO_W, VIDEO_H, buildCornerMaskFilter } from './overlay';
import { FFMPEG_BIN } from './ffmpeg';

export interface RoundedFrameOpts {
  /** Label of the video input (1280×720 RGB-ish, produced upstream). */
  inLabel:  string;
  /** Label of the framed output (1280×720 RGBA, rounded corners transparent). */
  outLabel: string;
  /** ffmpeg input index (0..N) for the pre-rendered grayscale cornermask PNG. */
  cornermaskInputIdx: number;
}

/**
 * Build the filter chain that rounds the video's corners via alphamerge
 * with a pre-rendered grayscale mask (supplied as an extra ffmpeg input
 * at `cornermaskInputIdx`). Loading the mask as a PNG rather than
 * generating it inline via `color+geq+loop` is intentional — it
 * sidesteps a filter-graph hang that otherwise made the pipeline
 * unusable (see commit history for details).
 */
export function buildRoundedFrameFilter(opts: RoundedFrameOpts): string {
  return [
    // Mask is already grayscale (produced by `prerenderCornerMask`) but
    // `format=gray` is required because `alphamerge` pins input 2 to
    // AV_PIX_FMT_GRAY8 in its query_formats negotiation.
    `[${opts.cornermaskInputIdx}:v]format=gray[cm]`,
    // Give the video an alpha channel so alphamerge can write into it.
    `[${opts.inLabel}]format=yuva420p[vrgba]`,
    `[vrgba][cm]alphamerge[${opts.outLabel}]`,
  ].join(';');
}

/**
 * Render the rounded-corner alpha mask as a single grayscale PNG. Loading
 * the mask as a file input to the main pipeline (with `-loop 1
 * -framerate 12`) sidesteps a persistent ffmpeg issue where an inline
 * `color,geq,loop,fps` chain was re-evaluated per output frame — even
 * with `loop=-1:1:0` supposedly caching — producing 2 min+ runtime on
 * 1 s of source.
 */
export function prerenderCornerMask(
  outputPng: string,
  execSyncFn: (cmd: string) => void,
): void {
  // Emit the 1-frame variant (no loop tail) so the `-frames:v 1` sink
  // produces exactly one PNG.
  const filter = buildCornerMaskFilter({ loop: false, outLabel: 'cmout' });
  const args = [
    '-y',
    '-filter_complex', filter,
    '-map', '[cmout]',
    '-frames:v', '1',
    outputPng,
  ];
  execSyncFn(`${FFMPEG_BIN} ${args.map(a => JSON.stringify(a)).join(' ')}`);
}

/* ── Re-exports kept for callers that still import from here ──────────── */
export { VIDEO_W, VIDEO_H };
