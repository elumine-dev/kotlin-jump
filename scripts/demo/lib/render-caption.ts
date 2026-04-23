import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
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
  /** Pill width in pixels. Default 1200 (matches current drawtext bar width). */
  width?:       number;
  /** Pill height in pixels. Default 40 (matches CAPTION_BAR_H in overlay.ts). */
  height?:      number;
  /** Font size in pixels. Default 22 (matches current drawtext). */
  fontSize?:    number;
  /** Dark pill opacity, 0-1. Default 0.72. */
  pillOpacity?: number;
  /** Pill corner radius. Default 20 (half of height for round ends). */
  pillRadius?:  number;
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

  const canvas = createCanvas(o.width, o.height);
  const ctx    = canvas.getContext('2d');

  // Rounded pill background
  ctx.fillStyle = `rgba(0, 0, 0, ${o.pillOpacity})`;
  ctx.beginPath();
  ctx.roundRect(0, 0, o.width, o.height, o.pillRadius);
  ctx.fill();

  // Centered white text. The font stack triggers Skia's emoji fallback:
  // Inter provides Latin/symbols, then Skia falls back to the platform's
  // color emoji font for codepoints Inter lacks (brain, flags, etc.).
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `${o.fontSize}px "Inter", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';
  ctx.fillText(text, o.width / 2, o.height / 2);

  writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}
