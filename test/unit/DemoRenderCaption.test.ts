/**
 * Unit tests for render-caption.ts — the Skia-based caption PNG renderer.
 *
 * Verifies that color emoji actually render (not tofu), which was the
 * original motivation: ffmpeg drawtext on this system (8.1) rejects both
 * Apple Color Emoji (SBIX) and Noto Color Emoji (CBDT), so we moved
 * caption rendering out of ffmpeg and into @napi-rs/canvas / Skia.
 *
 * The emoji-color assertion uses ffmpeg `signalstats` to measure UAVG/VAVG
 * — a pure-monochrome PNG has U=V=128 (neutral gray point). Color emoji
 * push those values away from 128.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { renderCaptionPng } from '../../scripts/demo/lib/render-caption';

/** Parse `ffmpeg signalstats` output to (UAVG, VAVG). */
function measureChroma(pngPath: string): { u: number; v: number } {
  const out = execSync(
    `ffmpeg -i "${pngPath}" -vf signalstats,metadata=print:file=- -f null - 2>&1`,
    { encoding: 'utf8' },
  );
  const u = parseFloat(out.match(/UAVG=([\d.]+)/)?.[1] ?? 'NaN');
  const v = parseFloat(out.match(/VAVG=([\d.]+)/)?.[1] ?? 'NaN');
  return { u, v };
}

describe('renderCaptionPng', () => {
  it('renders plain Latin to a non-empty PNG', () => {
    const p = renderCaptionPng('Hello world');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(500);
  });

  it('renders emoji in color (UAVG/VAVG deviate from neutral 128)', () => {
    // Reference: plain Latin caption — must be pure monochrome.
    const monochrome = measureChroma(renderCaptionPng('Plain text only'));
    expect(Math.abs(monochrome.u - 128)).toBeLessThan(0.1);
    expect(Math.abs(monochrome.v - 128)).toBeLessThan(0.1);

    // With emoji — chroma MUST deviate meaningfully. Verified empirically
    // on darwin-arm64 with Apple Color Emoji: deviation ~0.8 total.
    const withEmoji = measureChroma(renderCaptionPng('Every answer. 🧠 💰 🎯'));
    const deviation = Math.abs(withEmoji.u - 128) + Math.abs(withEmoji.v - 128);
    expect(deviation).toBeGreaterThan(0.3);
  });

  it('caches identical (text, opts) to the same output path', () => {
    const p1 = renderCaptionPng('Cache check');
    const p2 = renderCaptionPng('Cache check');
    expect(p1).toBe(p2);

    // Different opts → different path
    const p3 = renderCaptionPng('Cache check', { fontSize: 32 });
    expect(p3).not.toBe(p1);
  });

  it('handles ZWJ / regional-indicator sequences (flags, family)', () => {
    // 🇫🇷 is two regional indicator codepoints composed as a flag glyph.
    // 👨‍👩‍👧 is a ZWJ sequence (family emoji). Both rely on the font
    // manager composing multi-codepoint sequences correctly.
    const p = renderCaptionPng('Hello 🇫🇷 👨‍👩‍👧');
    expect(existsSync(p)).toBe(true);
    // File should be notably larger than a pure-text caption because the
    // emoji glyphs add color information.
    expect(statSync(p).size).toBeGreaterThan(700);
  });

  it('respects width/height options', () => {
    const small = renderCaptionPng('Tiny', { width: 400, height: 30 });
    const big   = renderCaptionPng('Tiny', { width: 1600, height: 60 });
    // Different canvas sizes → different hashes → different files.
    expect(small).not.toBe(big);
    // The larger canvas should produce a larger PNG (more pixels to encode).
    expect(statSync(big).size).toBeGreaterThan(statSync(small).size);
  });
});
