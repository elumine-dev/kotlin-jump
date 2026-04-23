import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { writeFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
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

// Resolve the repo root robustly. This module is consumed at multiple depths:
//  - `dist/demo/lib/render-caption.js` when loaded standalone by tests or
//    smoke scripts (unbundled; __dirname is ../lib, so `../../..` is root).
//  - `dist/demo/record.js` when bundled into the record CLI by esbuild
//    (__dirname is dist/demo, so `../..` is root). The record-CLI bundle
//    inlines this file's code, flattening the directory layout it was
//    written against.
//  - `scripts/demo/.../something.ts` during ad-hoc `ts-node` runs.
//
// A single hard-coded relative walk can't satisfy all three. We probe a
// list of candidates and pick the first one where a known-present fixture
// (package.json plus the Inter font file) exists.
function resolveRepoRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..'),  // dist/demo/lib/ standalone
    path.resolve(__dirname, '..', '..'),        // dist/demo/ bundled record.js
    path.resolve(__dirname, '..'),              // dist/ rare
    process.cwd(),                               // CWD fallback
  ];
  for (const root of candidates) {
    if (existsSync(path.join(root, 'package.json')) &&
        existsSync(path.join(root, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf'))) {
      return root;
    }
  }
  // Last resort: return the first candidate and let the caller deal with
  // the missing-font diagnostic downstream.
  return candidates[0];
}

const REPO_ROOT = resolveRepoRoot();
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
   * Device pixel ratio for supersampling. Default 1.
   *
   * Setting this above 1 renders a supersampled canvas (crisper emoji bitmaps
   * since Apple Color Emoji ships strikes at 20/32/48/64/96/160 px), but the
   * caller must then downscale the output before overlay — adding a lanczos
   * pass that washes out antialiased Latin strokes. At pixelRatio 1 the PNG
   * goes to ffmpeg overlay at native size, survives only the final
   * 1280→960 video downscale, and text keeps the same contrast the old
   * `drawtext` pipeline had.
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
    pixelRatio:  opts.pixelRatio  ?? 1,
  };

  // Hash(text + opts) → stable filename. sha1 is fine here: we only need
  // uniqueness per input, not cryptographic properties.
  const hash = createHash('sha1')
    .update(JSON.stringify({ text, ...o }))
    .digest('hex')
    .slice(0, 16);
  const outPath = path.join(CACHE_DIR, `${hash}.png`);

  // Cache hit only if the file is plausibly complete. A pill-only PNG
  // (all pixels at pill alpha, no text glyphs) compresses to ~1 KB —
  // healthy captions are 5–10 KB. Re-rendering on undersized caches
  // avoids pinning a previously-broken run's output across sessions.
  const MIN_VALID_PNG_BYTES = 2048;
  if (existsSync(outPath) && statSync(outPath).size >= MIN_VALID_PNG_BYTES) return outPath;

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
  const segments = segmentText(text);
  drawSegmentedText(ctx, segments, o.width / 2, textY, o.fontSize);

  // Sanity check: confirm the text actually rendered into the canvas.
  // There is a real-world regression where Skia silently produces a
  // pill-only PNG (alpha=pillOpacity everywhere, no white text pixels) in
  // some invocation contexts — the text passes segmentText correctly but
  // fillText emits no glyph output. The cache would then serve this
  // pill-only PNG for the rest of the session, making every caption in
  // the final webp invisible to the viewer.
  //
  // We read the canvas pixels before writing and require at least a
  // handful of near-white pixels to confirm text glyphs were drawn. If
  // not, we throw with detailed diagnostics so the caller sees the root
  // cause instead of hunting a silent downstream failure.
  const phys   = ctx.getImageData(0, 0, o.width * o.pixelRatio, o.height * o.pixelRatio).data;
  let   lightPx = 0;
  for (let i = 0; i < phys.length; i += 4) {
    if (phys[i] > 180 && phys[i + 1] > 180 && phys[i + 2] > 180 && phys[i + 3] > 200) lightPx++;
  }
  if (lightPx < 20) {
    const fontFamilies = GlobalFonts.families.map(f => f.family);
    const hasInter     = fontFamilies.includes('Inter');
    throw new Error(
      `renderCaptionPng: canvas has no visible text glyphs (lightPx=${lightPx}). ` +
      `text=${JSON.stringify(text)}, segments=${segments.length}, ` +
      `font="${ctx.font}", interRegistered=${hasInter}, interPathExists=${existsSync(INTER_PATH)}`,
    );
  }

  // Atomic write: `rename` is atomic on POSIX. A crash or concurrent
  // `rm -rf` between `writeFileSync` and completion could otherwise leave a
  // truncated PNG on disk that later reads (via the `existsSync` cache
  // guard above) would silently accept and feed to ffmpeg.
  const tmpPath = `${outPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, canvas.toBuffer('image/png'));
  renameSync(tmpPath, outPath);
  return outPath;
}
