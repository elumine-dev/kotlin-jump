/**
 * Unit coverage for the rounded-corner frame filter in
 * `scripts/demo/lib/frame.ts`.
 *
 * The pipeline is deliberately minimalist: the only transformation applied
 * to the video stream is an `alphamerge` with a pre-rendered grayscale
 * cornermask PNG — transparent rounded corners, nothing else (no margin,
 * no drop shadow, no border, no inner highlight). The earlier "Stripe-
 * premium" variant added a frame-1 alpha glitch and a visible ring on
 * light-mode READMEs, which we rejected.
 */

import { describe, it, expect } from 'vitest';
import { buildRoundedFrameFilter } from '../../scripts/demo/lib/frame';

describe('buildRoundedFrameFilter — rounded corners, no framing', () => {
  it('consumes the declared inLabel and emits the outLabel', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    expect(s).toContain('[src]');
    expect(s).toMatch(/\[out\]$/);
  });

  it('references the cornermask PNG by ffmpeg input index (caller supplies it via -loop 1 -framerate 12 -i cornermask.png)', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    expect(s).toContain('[1:v]');
  });

  it('converts the cornermask to grayscale (alphamerge pins input 2 to AV_PIX_FMT_GRAY8)', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    expect(s).toContain('format=gray');
  });

  it('gives the video an alpha channel via format=yuva420p before alphamerge', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    expect(s).toContain('format=yuva420p');
  });

  it('applies alphamerge exactly once — no chained filtering after the mask', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    const merges = (s.match(/alphamerge/g) ?? []).length;
    expect(merges).toBe(1);
  });

  it('does NOT emit any of the removed framing primitives (shadow, border, highlight, margin)', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    // Option B: minimalist. If any of these sneak back in, the test is the
    // load-bearing guard.
    expect(s).not.toContain('gblur');
    expect(s).not.toContain('boxblur');
    expect(s).not.toContain('alphaextract');
    expect(s).not.toMatch(/overlay=x=\d+:y=\d+/);  // no margin offsets
  });

  it('ffmpeg syntax hygiene: balanced brackets, balanced quotes, no trailing semicolon', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 1,
    });
    expect((s.match(/\[/g) ?? []).length).toBe((s.match(/\]/g) ?? []).length);
    expect((s.match(/'/g) ?? []).length % 2).toBe(0);
    expect(s.endsWith(';')).toBe(false);
  });

  it('honours custom input indices', () => {
    const s = buildRoundedFrameFilter({
      inLabel: 'src', outLabel: 'out', cornermaskInputIdx: 7,
    });
    expect(s).toContain('[7:v]');
    expect(s).not.toContain('[1:v]');
  });
});
