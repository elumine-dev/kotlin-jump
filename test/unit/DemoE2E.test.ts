/**
 * Unit tests for the pure functions behind `demo:e2e`.
 *
 * The ffmpeg/webpmux-backed code paths (sampleRegion, extractFrameAsPng)
 * are exercised by the full end-to-end run — unit-testing them here would
 * require spawning ffmpeg, which belongs in the E2E flow itself.
 */

import { describe, it, expect } from 'vitest';
import {
  colorDistance, parseHex, scaleRegion,
} from '../../scripts/demo/e2e/sample-pixel';
import { computeKeyframes } from '../../scripts/demo/e2e/keyframes';
import { buildAssertions, buildSsimAssertions }  from '../../scripts/demo/e2e/assertions';
import type { TimelineEvent } from '../../scripts/demo/lib/timeline';
import type { Keyframe }      from '../../scripts/demo/e2e/keyframes';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';

describe('DemoE2E — colour utilities', () => {
  it('parseHex handles #RRGGBB, 0xRRGGBB, and bare RRGGBB', () => {
    expect(parseHex('#007ACC')).toEqual({ r: 0, g: 122, b: 204 });
    expect(parseHex('0x007ACC')).toEqual({ r: 0, g: 122, b: 204 });
    expect(parseHex('007acc')).toEqual({ r: 0, g: 122, b: 204 });
  });

  it('parseHex rejects non-6-digit input', () => {
    expect(() => parseHex('#fff')).toThrow();
    expect(() => parseHex('#gggggg')).toThrow();
  });

  it('colorDistance is 0 for identical colours and √3·255 for black↔white', () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(0);
    const bw = colorDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(bw).toBeCloseTo(Math.sqrt(3) * 255, 1);
  });

  it('colorDistance is symmetric', () => {
    const a = { r: 12, g: 240, b: 17 };
    const b = { r: 199, g: 3,  b: 88 };
    expect(colorDistance(a, b)).toBeCloseTo(colorDistance(b, a), 6);
  });

  it('scaleRegion maps logical 1280×720 onto 960×540 with 0.75×', () => {
    const r = scaleRegion({ x: 400, y: 560, w: 480, h: 96 }, { w: 1280, h: 720 }, { w: 960, h: 540 });
    expect(r).toEqual({ x: 300, y: 420, w: 360, h: 72 });
  });

  it('scaleRegion clamps width/height to at least 1 (no zero-area crop)', () => {
    const r = scaleRegion({ x: 0, y: 0, w: 1, h: 1 }, { w: 1280, h: 720 }, { w: 64, h: 36 });
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});

describe('DemoE2E — keyframe computation', () => {
  const events: TimelineEvent[] = [
    { type: 'caption',   t: 500,  label: 'setup',   duration: 2500 },
    { type: 'click',     t: 3000, label: 'click',   sublabel: 'fetchUser', duration: 2500 },
    { type: 'keystroke', t: 5800, label: '⌘+⌥+←',   sublabel: 'Navigate Back', duration: 2500 },
  ];

  it('produces exactly 5 keyframes per event plus setup + 2 fade-to-dark bookends', () => {
    const kfs = computeKeyframes(events, { fps: 12, totalSec: 9.0 });
    // 3 events × 5 phases = 15 + 1 setup + 2 fade-to-dark = 18
    // We never de-duplicate by frame number — two semantic keyframes can
    // legitimately share the same WebP frame, and assertions reference them
    // by label, not by frame number.
    expect(kfs).toHaveLength(18);
    expect(kfs[0].label).toBe('setup');
    expect(kfs.find(k => k.label === 'fade-to-dark-end')).toBeDefined();
  });

  it('every event emits phases fade-in-mid, peak-start, peak-mid, peak-end, fade-out-mid', () => {
    const kfs = computeKeyframes(events, { fps: 24, totalSec: 9.0 });  // high fps so no collision
    for (let i = 0; i < events.length; i++) {
      const t = events[i].type;
      expect(kfs.some(k => k.label === `${t}-${i}-fade-in-mid`)).toBe(true);
      expect(kfs.some(k => k.label === `${t}-${i}-peak-start`)).toBe(true);
      expect(kfs.some(k => k.label === `${t}-${i}-peak-mid`)).toBe(true);
      expect(kfs.some(k => k.label === `${t}-${i}-peak-end`)).toBe(true);
      expect(kfs.some(k => k.label === `${t}-${i}-fade-out-mid`)).toBe(true);
    }
  });

  it('frame numbers are 1-based and capped at floor(totalSec·fps)', () => {
    const kfs = computeKeyframes(events, { fps: 12, totalSec: 9.0 });
    for (const k of kfs) {
      expect(k.frameNumber).toBeGreaterThanOrEqual(1);
      expect(k.frameNumber).toBeLessThanOrEqual(Math.round(9.0 * 12));
    }
  });

  it('peak-mid frame is at roughly the middle of the event duration', () => {
    const kfs = computeKeyframes(events, { fps: 24, totalSec: 9.0 });
    // click[1]: t=3.0s to 5.5s → peak-mid at 4.25s → frame ≈ 24*4.25+1 = 103
    const peakMid = kfs.find(k => k.label === 'click-1-peak-mid')!;
    expect(peakMid.t).toBeCloseTo(4.25, 2);
    expect(peakMid.frameNumber).toBeCloseTo(103, 0);
  });
});

describe('DemoE2E — assertion list (10/10 coverage)', () => {
  const sampleEvents: TimelineEvent[] = [
    { type: 'caption',   t: 0,    label: 'a', duration: 2000 },
    { type: 'click',     t: 2500, label: 'b', sublabel: 'sym', duration: 2000 },
    { type: 'keystroke', t: 5000, label: '⌘', sublabel: 'x',   duration: 2000 },
  ];

  it('includes six range checks (frames, duration, size KB, loop, canvas W+H)', () => {
    const as = buildAssertions(sampleEvents);
    const ranges = as.filter(a => a.kind === 'range');
    expect(ranges).toHaveLength(6);
    const sources = ranges.map(r => r.kind === 'range' ? r.source : '');
    expect(sources).toEqual(expect.arrayContaining([
      'frameCount', 'durationSec', 'webpSizeKb', 'loopCount', 'canvasW', 'canvasH',
    ]));
  });

  it('emits color-match + color-differs pair per click event (peak + fade verification)', () => {
    const as = buildAssertions([{ type: 'click', t: 1000, label: 'x', sublabel: 'y', duration: 2000 }]);
    const click = as.filter(a => a.kind !== 'range' && a.keyframeLbl.startsWith('click-0'));
    const colorMatch   = click.filter(a => a.kind === 'color-match');
    const colorDiffers = click.filter(a => a.kind === 'color-differs');
    expect(colorMatch).toHaveLength(1);
    // fade-in + fade-out => 2 color-differs per click
    expect(colorDiffers).toHaveLength(2);
  });

  it('emits luma-above for BOTH title and sublabel on click (text rendering proxy)', () => {
    const as = buildAssertions([{ type: 'click', t: 0, label: 'x', sublabel: 'y', duration: 2000 }]);
    const luma = as.filter(a => a.kind === 'luma-above' && a.keyframeLbl === 'click-0-peak-mid');
    expect(luma).toHaveLength(2);
  });

  it('setup-frame assertion guards against card drawing too early', () => {
    const as = buildAssertions(sampleEvents);
    const setup = as.find(a => a.kind === 'color-differs' && a.keyframeLbl === 'setup');
    expect(setup).toBeDefined();
    // The card reference is VS-Code-blue
    expect((setup as { kind: 'color-differs'; reference: { r: number; g: number; b: number } }).reference)
      .toEqual({ r: 0x00, g: 0x7A, b: 0xCC });
  });

  it('buildSsimAssertions emits ONE SSIM per keyframe whose baseline PNG exists', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ssim-'));
    try {
      // Touch two baseline PNGs; leave a third keyframe without one.
      fs.writeFileSync(path.join(tmp, 'alpha.png'), 'x');
      fs.writeFileSync(path.join(tmp, 'gamma.png'), 'x');
      const kfs: Keyframe[] = [
        { label: 'alpha',  frameNumber: 1, t: 0 },
        { label: 'beta',   frameNumber: 2, t: 0.1 },
        { label: 'gamma',  frameNumber: 3, t: 0.2 },
      ];
      const ssim = buildSsimAssertions(kfs, tmp);
      expect(ssim).toHaveLength(2);
      expect(ssim.map(s => s.keyframeLbl).sort()).toEqual(['alpha', 'gamma']);
      expect(ssim[0].minScore).toBe(0.92);   // default threshold
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('buildSsimAssertions respects a custom minScore', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ssim-'));
    try {
      fs.writeFileSync(path.join(tmp, 'x.png'), 'x');
      const ssim = buildSsimAssertions([{ label: 'x', frameNumber: 1, t: 0 }], tmp, 0.85);
      expect(ssim[0].minScore).toBe(0.85);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fade-to-dark assertion targets near-black', () => {
    const as = buildAssertions(sampleEvents);
    const end = as.find(a => a.kind === 'color-match' && a.keyframeLbl === 'fade-to-dark-end');
    expect(end).toBeDefined();
    if (end && end.kind === 'color-match') {
      expect(end.expected).toEqual({ r: 0, g: 0, b: 0 });
      expect(end.tolerance).toBeGreaterThan(20);
    }
  });

  it('total assertion count hits 27 for a 5-event demo (2 cap, 1 click, 2 ks)', () => {
    // Mirror the real navigation-history timeline shape.
    const events: TimelineEvent[] = [
      { type: 'caption',   t: 0,    label: 'a', duration: 2500 },
      { type: 'click',     t: 3000, label: 'b', sublabel: 'c', duration: 2500 },
      { type: 'keystroke', t: 5800, label: '⌘', sublabel: 'd', duration: 2500 },
      { type: 'caption',   t: 5900, label: 'e', duration: 2500 },
      { type: 'keystroke', t: 8500, label: '→', sublabel: 'f', duration: 2500 },
    ];
    const as = buildAssertions(events);
    // Global:
    //   6 range (frameCount, durationSec, webpSizeKb, loopCount, canvasW, canvasH)
    //   1 setup color-differs (no card drawn yet)
    //   1 fade-to-dark color-match                                                    =  8
    // Per event (non-SSIM):
    //   caption × 2: 1 color-match + 1 color-differs + 1 luma-above = 3 each          =  6
    //   click × 1:   1 color-match + 2 color-differs + 2 luma-above = 5                =  5
    //   keystroke × 2: 1 color-match + 1 color-differs + 2 luma-above = 4 each         =  8
    // Total: 8 + 6 + 5 + 8 = 27. (SSIM assertions are built separately by
    //   buildSsimAssertions against a baseline dir.)
    expect(as).toHaveLength(27);
  });
});
