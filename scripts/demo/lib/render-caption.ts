import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

/**
 * Renders caption strings to transparent PNG pills with inline color emoji.
 *
 * Replaces the `ffmpeg drawtext` caption path, which cannot render color
 * emoji on ffmpeg 8.1 + macOS regardless of font chosen (SBIX → "Monocromatic
 * (1bpp) fonts are not supported", CBDT → "invalid library handle"). Skia
 * through @napi-rs/canvas handles the emoji fallback chain natively and picks
 * up Apple Color Emoji on macOS, Noto Color Emoji on Linux.
 *
 * The caller composites the rendered PNG onto the video via
 * `ffmpeg -i cap_N.png` + `overlay=enable='between(t,t0,t1)'`.
 *
 * Vertical alignment of emoji vs Latin text is handled by a **two-pass
 * renderer**: the input is segmented into text vs emoji runs, each run is
 * rendered at its own y-offset so emoji visual centres align with Latin cap
 * centres. Apple Color Emoji bitmaps fill their em-box fully while Latin
 * caps occupy ~70 %, so a single fillText call would render emoji ~3 px
 * higher than caps at fontSize 22 — noticeable at our pill scale.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE_DIR = path.join(REPO_ROOT, 'scripts', 'demo', '.cache', 'captions');
const INTER_PATH = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf');

// Register Inter once per process. Emoji glyphs are resolved by Skia's system
// font manager automatically (no need to register an emoji font explicitly on
// macOS — Apple Color Emoji is picked up from /System/Library/Fonts/).
let interRegistered = false;
function ensureInterRegistered(): void {
  if (interRegistered) return;
  if (existsSync(INTER_PATH)) {
    GlobalFonts.registerFromPath(INTER_PATH, 'Inter');
  }
  interRegistered = true;
}

export interface CaptionRenderOpts {
  /** Pill width in logical pixels. Default 1200 (matches drawtext bar width). */
  width?:       number;
  /** Pill height in logical pixels. Default 40 (matches CAPTION_BAR_H). */
  height?:      number;
  /** Font size in logical pixels. Default 22 (matches current drawtext). */
  fontSize?:    number;
  /** Dark pill opacity, 0-1. Default 0.72. */
  pillOpacity?: number;
  /** Pill corner radius in logical pixels. Default 20. */
  pillRadius?:  number;
  /**
   * Device pixel ratio for supersampling. Default 2.
   *
   * Apple Color Emoji glyphs ship as PNG bitmaps at fixed sizes (20, 32, 40,
   * 48, 64, 96, 160 px). Rendering at `fontSize` 22 lands between strikes and
   * Skia must downscale, which is where the blur came from. Rendering the
   * whole canvas at 2× then letting the video pipeline downscale produces
   * crisp emoji because the resampling is one continuous high-quality step.
   *
   * The output PNG has physical dimensions `width × pixelRatio` by
   * `height × pixelRatio` — callers composing the result must downscale
   * accordingly (e.g. `scale=<width>:<height>` in the ffmpeg filter chain).
   */
  pixelRatio?:  number;
}

// ── Text segmentation ────────────────────────────────────────────────────

interface Segment {
  text: string;
  isEmoji: boolean;
}

/**
 * Split a string into consecutive runs of text graphemes and emoji graphemes.
 *
 * Uses `Intl.Segmenter` with grapheme granularity so that ZWJ sequences
 * (👨‍👩‍👧), regional-indicator pairs (🇫🇷), and skin-tone modifiers are
 * treated as single atomic graphemes. Each grapheme is then classified as
 * emoji via `\p{Extended_Pictographic}`, which covers every emoji codepoint
 * in Unicode's current table.
 */
function segmentText(text: string): Segment[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const { segment } of segmenter.segment(text)) {
    // A grapheme is emoji if its first codepoint has the Extended_Pictographic
    // property. Regional indicators and ZWJ-joined runs are bundled into one
    // grapheme by Intl.Segmenter, so this classification is grapheme-level.
    const isEmoji = /\p{Extended_Pictographic}/u.test(segment);

    if (current && current.isEmoji === isEmoji) {
      current.text += segment;
    } else {
      current = { text: segment, isEmoji };
      segments.push(current);
    }
  }

  return segments;
}

// ── Rendering ────────────────────────────────────────────────────────────

/**
 * Draw caption text with per-segment baseline adjustment so emoji align
 * visually with Latin caps. Emoji are shifted DOWN by `fontSize * 0.12`
 * relative to the text baseline — empirically the offset between Apple
 * Color Emoji's geometric centre and Inter's cap centre at pill scale.
 */
function drawSegmentedText(
  ctx:       SKRSContext2D,
  segments:  Segment[],
  centerX:   number,
  textY:     number,
  fontSize:  number,
): void {
  const emojiY = textY + fontSize * 0.12;

  // Pass 1: measure total width so we can centre the whole line.
  let totalWidth = 0;
  for (const seg of segments) {
    totalWidth += ctx.measureText(seg.text).width;
  }

  // Pass 2: draw each segment at its own (x, y). textAlign must be 'left'
  // for width-accumulating layout — 'center' would center each segment on
  // its anchor instead of laying them out sequentially.
  ctx.textAlign = 'left';
  let x = centerX - totalWidth / 2;
  for (const seg of segments) {
    const y = seg.isEmoji ? emojiY : textY;
    ctx.fillText(seg.text, x, y);
    x += ctx.measureText(seg.text).width;
  }
}

/**
 * Render a caption to a transparent PNG with a dark pill + white text.
 *
 * Idempotent: identical (text + opts) returns the cached file. Safe to call
 * multiple times with the same args during a single demo run.
 *
 * @returns absolute path to the output PNG
 */
export function renderCaptionPng(text: string, opts: CaptionRenderOpts = {}): string {
  ensureInterRegistered();

  const o = {
    width:       opts.width       ?? 1200,
    height:      opts.height      ?? 40,
    fontSize:    opts.fontSize    ?? 22,
    pillOpacity: opts.pillOpacity ?? 0.72,
    pillRadius:  opts.pillRadius  ?? 20,
    pixelRatio:  opts.pixelRatio  ?? 2,
  };

  // Hash(text + opts) → stable filename. sha1 is fine here: we only need
  // uniqueness per input, not cryptographic properties.
  const hash = createHash('sha1')
    .update(JSON.stringify({ text, ...o }))
    .digest('hex')
    .slice(0, 16);
  const outPath = path.join(CACHE_DIR, `${hash}.png`);

  if (existsSync(outPath)) return outPath;

  mkdirSync(CACHE_DIR, { recursive: true });

  // Physical canvas is pixelRatio× logical. ctx.scale(pr,pr) lets us draw
  // using logical coordinates below; the extra resolution goes into
  // sharper emoji bitmaps because Skia has more sample density.
  const canvas = createCanvas(o.width * o.pixelRatio, o.height * o.pixelRatio);
  const ctx    = canvas.getContext('2d');
  ctx.scale(o.pixelRatio, o.pixelRatio);

  // Prefer high-quality bitmap resampling on every stroke.
  ctx.imageSmoothingEnabled = true;
  (ctx as unknown as { imageSmoothingQuality: 'high' }).imageSmoothingQuality = 'high';

  // Rounded pill background
  ctx.fillStyle = `rgba(0, 0, 0, ${o.pillOpacity})`;
  ctx.beginPath();
  ctx.roundRect(0, 0, o.width, o.height, o.pillRadius);
  ctx.fill();

  // White text with Inter + emoji fallback. Browser-style alphabetic
  // baseline. Emoji and text are drawn separately so each can use its own
  // y offset for visual alignment — see drawSegmentedText.
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `${o.fontSize}px "Inter", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textBaseline = 'alphabetic';

  // Latin baseline at 72 % of pill height: caps sit visually centred in the
  // remaining space above. Emoji baseline is pushed further down inside
  // drawSegmentedText so Apple Color Emoji's geometric centre lands at the
  // same vertical spot as Latin cap centres.
  const textY = o.height * 0.72;
  drawSegmentedText(ctx, segmentText(text), o.width / 2, textY, o.fontSize);

  writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}
