/**
 * Adversarial / edge-case tests for the demo E2E pure functions.
 *
 * Philosophy (per project memory — "adversarial testing logic"):
 *   1. Read the code as an attacker — what inputs did the author NOT think
 *      through?
 *   2. Find scanner/parser blind spots — what survives the regex?
 *   3. Escalate complexity — pathological inputs that match production
 *      shapes but break them (overlapping events, fadeMs=0, negative t).
 *   4. Trace by hand — does the output actually survive ffmpeg's filter
 *      parser given special characters in user-supplied labels?
 *   5. Follow bugs through layers — a nonsense value from `parseHex` lands
 *      in a filter string that goes to shell → what breaks downstream?
 *
 * These tests are DESIGNED to fail if someone relaxes input validation,
 * strips escape handling, or tweaks timing math without thinking about
 * degenerate inputs. They encode the invariants the happy-path suite
 * silently relies on.
 */

import { describe, it, expect } from 'vitest';
import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';

import {
  parseHex, colorDistance, luma, scaleRegion,
  type RGB,
} from '../../scripts/demo/e2e/sample-pixel';
import {
  alphaExpr, enableExpr, buildOverlayFilterGraph,
} from '../../scripts/demo/lib/overlay';
import { computeKeyframes }                    from '../../scripts/demo/e2e/keyframes';
import { buildAssertions, buildSsimAssertions } from '../../scripts/demo/e2e/assertions';
import type { TimelineEvent } from '../../scripts/demo/lib/timeline';

const OPTS = { fontPath: '/fake/Inter.ttf', fontPathMono: '/fake/JBM.ttf' };

// ── parseHex — attacker-controlled strings ──────────────────────────────────

describe('ADV-parseHex — rejects every pathological input', () => {
  const shouldThrow = [
    '',                // empty
    '#',               // just the prefix
    '0x',              // just the prefix
    '#FFF',            // 3-digit short form (not supported)
    '#FFFF',           // 4-digit (RGBA short, not ours)
    '#FFFFFFF',        // 7 digits
    '#FFFFFF00',       // 8 digits (RGBA long — NOT supported; we're RGB-only)
    '#GGGGGG',         // non-hex G
    '#ff ffff',        // embedded space
    '#FFFFFF ',        // trailing space
    ' #FFFFFF',        // leading space
    '#FFFF\nFF',       // newline
    'rgb(255,255,255)',// CSS form
    '255',             // numeric only
    '#FFFFFFG',        // 7th char non-hex
    'NaN',             // JS literal leak
    '\x00\x00\x00\x00\x00\x00', // embedded nulls (should reject — not hex)
  ];
  for (const bad of shouldThrow) {
    it(`throws on ${JSON.stringify(bad)}`, () => {
      expect(() => parseHex(bad)).toThrow();
    });
  }

  const shouldAccept: Array<[string, RGB]> = [
    ['#000000', { r: 0,   g: 0,   b: 0   }],
    ['#FFFFFF', { r: 255, g: 255, b: 255 }],
    ['ffffff',  { r: 255, g: 255, b: 255 }],  // bare
    ['0x007ACC', { r: 0, g: 122, b: 204 }],
    ['0x007acc', { r: 0, g: 122, b: 204 }],   // lowercase OK
    ['0X007ACC', { r: 0, g: 122, b: 204 }],   // uppercase X OK
  ];
  for (const [s, expected] of shouldAccept) {
    it(`parses ${JSON.stringify(s)} → ${JSON.stringify(expected)}`, () => {
      expect(parseHex(s)).toEqual(expected);
    });
  }
});

// ── colorDistance — metric invariants ──────────────────────────────────────

describe('ADV-colorDistance — metric law invariants', () => {
  const pairs: Array<[RGB, RGB, number]> = [
    [{ r: 0,   g: 0,   b: 0   }, { r: 0,   g: 0,   b: 0   }, 0],
    [{ r: 0,   g: 0,   b: 0   }, { r: 255, g: 255, b: 255 }, Math.sqrt(3) * 255],
    [{ r: 255, g: 0,   b: 0   }, { r: 0,   g: 0,   b: 0   }, 255],
    [{ r: 0,   g: 255, b: 0   }, { r: 0,   g: 0,   b: 0   }, 255],
    [{ r: 0,   g: 0,   b: 255 }, { r: 0,   g: 0,   b: 0   }, 255],
  ];
  for (const [a, b, expected] of pairs) {
    it(`|${JSON.stringify(a)} - ${JSON.stringify(b)}| = ${expected.toFixed(2)}`, () => {
      expect(colorDistance(a, b)).toBeCloseTo(expected, 6);
    });
  }

  it('triangle inequality for arbitrary triples', () => {
    const a = { r: 10,  g: 200, b: 50  };
    const b = { r: 120, g: 30,  b: 210 };
    const c = { r: 80,  g: 180, b: 100 };
    const ab = colorDistance(a, b);
    const bc = colorDistance(b, c);
    const ac = colorDistance(a, c);
    expect(ac).toBeLessThanOrEqual(ab + bc + 1e-9);
  });
});

// ── luma — ITU-R BT.709 known values ──────────────────────────────────────

describe('ADV-luma — BT.709 weighted formula', () => {
  const cases: Array<[RGB, number]> = [
    [{ r: 0,   g: 0,   b: 0   }, 0],
    [{ r: 255, g: 255, b: 255 }, 255],
    [{ r: 255, g: 0,   b: 0   }, 0.2126 * 255],
    [{ r: 0,   g: 255, b: 0   }, 0.7152 * 255],  // green dominates
    [{ r: 0,   g: 0,   b: 255 }, 0.0722 * 255],  // blue contributes least
    [{ r: 128, g: 128, b: 128 }, 128],            // neutral grey
  ];
  for (const [c, expected] of cases) {
    it(`luma(${JSON.stringify(c)}) ≈ ${expected.toFixed(2)}`, () => {
      expect(luma(c)).toBeCloseTo(expected, 4);
    });
  }

  it('green has higher luma than blue for the same RGB magnitude (green coeff > blue coeff)', () => {
    expect(luma({ r: 0, g: 200, b: 0 })).toBeGreaterThan(luma({ r: 0, g: 0, b: 200 }));
  });
});

// ── scaleRegion — extremes and clamping ─────────────────────────────────────

describe('ADV-scaleRegion — pathological inputs', () => {
  it('1:1 scale is the identity (no rounding drift on exact-fit inputs)', () => {
    const r = scaleRegion({ x: 100, y: 200, w: 50, h: 40 }, { w: 1280, h: 720 }, { w: 1280, h: 720 });
    expect(r).toEqual({ x: 100, y: 200, w: 50, h: 40 });
  });

  it('upscales (from < to) produce larger integer regions', () => {
    const r = scaleRegion({ x: 10, y: 10, w: 10, h: 10 }, { w: 100, h: 100 }, { w: 200, h: 200 });
    expect(r).toEqual({ x: 20, y: 20, w: 20, h: 20 });
  });

  it('region rounded down to zero-pixel → clamped to 1×1 (never 0×0)', () => {
    const r = scaleRegion({ x: 0, y: 0, w: 1, h: 1 }, { w: 10000, h: 10000 }, { w: 10, h: 10 });
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });

  it('negative origin floored to 0', () => {
    const r = scaleRegion({ x: -5, y: -3, w: 10, h: 10 }, { w: 1280, h: 720 }, { w: 960, h: 540 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it('huge region > source dimensions still scales proportionally (no mysterious clamp)', () => {
    const r = scaleRegion({ x: 0, y: 0, w: 10000, h: 10000 }, { w: 1280, h: 720 }, { w: 960, h: 540 });
    // 10000 × (960/1280) = 7500
    expect(r.w).toBe(7500);
  });
});

// ── alphaExpr — degenerate timing math ─────────────────────────────────────

describe('ADV-alphaExpr — degenerate timings', () => {
  it('embeds t0 and t1 with millisecond precision (3-digit toFixed)', () => {
    const s = alphaExpr(1234, 5678);
    expect(s).toContain('1.234');
    expect(s).toContain('6.912');  // 1.234 + 5.678
  });

  it('commas are escaped with \\\\, so ffmpeg can parse inside filter_complex', () => {
    const s = alphaExpr(0, 1000);
    // The TS string literally contains `\,` (2 chars: backslash, comma).
    expect(s).toContain('\\,');
    // And zero unescaped commas outside the escape pattern.
    const unescaped = s.replace(/\\,/g, '').includes(',');
    expect(unescaped).toBe(false);
  });

  it('fadeMs=0 embeds "0.000" denominator — ffmpeg will yield NaN but the filter string itself stays valid', () => {
    // This test documents current behaviour, not desired. If someone hardens
    // alphaExpr to throw on fadeMs <= 0, update this test to match.
    const s = alphaExpr(1000, 2000, 0);
    expect(s).toContain('/0.000');
  });

  it('duration < 2*fade produces an overlapping ramp (peak never hits 1.0) — fine, clip covers it', () => {
    // duration 100 ms, fadeMs 150 → ramps overlap; expression stays clip()-bounded.
    const s = alphaExpr(0, 100, 150);
    expect(s).toContain('clip(');
    expect(s).toContain('0.100');  // t1
  });

  it('HUGE timestamps round-trip via toFixed without scientific notation', () => {
    const s = alphaExpr(3_600_000, 1_000);  // 1 hour in
    expect(s).toContain('3600.000');
    expect(s).not.toMatch(/e\+/i);
  });

  it('negative start yields a negative t0 — documented as caller responsibility', () => {
    const s = alphaExpr(-500, 1000);
    expect(s).toContain('-0.500');
  });
});

describe('ADV-enableExpr — same escaping contract', () => {
  it('matches the canonical between() shape, comma-escaped', () => {
    expect(enableExpr(500, 1500)).toBe('between(t\\,0.500\\,2.000)');
  });
});

// ── computeKeyframes — degenerate timelines ────────────────────────────────

describe('ADV-computeKeyframes — pathological timelines', () => {
  it('empty timeline → only bookends (setup + 2 fade-to-dark)', () => {
    const kfs = computeKeyframes([], { fps: 12, totalSec: 5 });
    expect(kfs.map(k => k.label)).toEqual(['setup', 'fade-to-dark-mid', 'fade-to-dark-end']);
  });

  it('overlapping events → ALL keyframes emitted (dedup by label, not by frame number)', () => {
    // At 12 fps, each frame spans ~83 ms. 20 ms offset puts both
    // fade-in-mids inside the same quantised frame so the collision is
    // authentic, not cosmetic.
    const overlapping: TimelineEvent[] = [
      { type: 'caption', t: 1000, label: 'a', duration: 2000 },
      { type: 'click',   t: 1020, label: 'b', sublabel: 'c', duration: 2000 },
    ];
    const kfs = computeKeyframes(overlapping, { fps: 12, totalSec: 5 });
    const a = kfs.find(k => k.label === 'caption-0-fade-in-mid')!;
    const b = kfs.find(k => k.label === 'click-1-fade-in-mid')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.frameNumber).toBe(b.frameNumber);

    // Pre-2025 behaviour would have de-duped the second label away (set of
    // frame numbers). That regression would shrink the returned array by
    // the number of colliding labels — check both labels survive.
    const labels = kfs.map(k => k.label);
    expect(labels.filter(l => l === 'caption-0-fade-in-mid')).toHaveLength(1);
    expect(labels.filter(l => l === 'click-1-fade-in-mid')).toHaveLength(1);
  });

  it('event past totalSec → frame numbers clamped to max, not out-of-bounds', () => {
    const past: TimelineEvent[] = [
      { type: 'caption', t: 9000, label: 'tail', duration: 2000 },
    ];
    const kfs = computeKeyframes(past, { fps: 12, totalSec: 8 });
    const maxFrame = Math.round(8 * 12);
    for (const k of kfs) {
      expect(k.frameNumber).toBeGreaterThanOrEqual(1);
      expect(k.frameNumber).toBeLessThanOrEqual(maxFrame);
    }
  });

  it('fps=1 still produces valid frame numbers (no division-by-near-zero artefact)', () => {
    const evts: TimelineEvent[] = [
      { type: 'caption', t: 500, label: 'x', duration: 1000 },
    ];
    const kfs = computeKeyframes(evts, { fps: 1, totalSec: 3 });
    for (const k of kfs) expect(k.frameNumber).toBeGreaterThanOrEqual(1);
  });

  it('event with duration=0 → peak-start, peak-mid, peak-end all collapse to t0 (no crash)', () => {
    const degenerate: TimelineEvent[] = [
      { type: 'caption', t: 1000, label: 'instant', duration: 0 },
    ];
    const kfs = computeKeyframes(degenerate, { fps: 12, totalSec: 3 });
    const phases = kfs.filter(k => k.eventIdx === 0).map(k => k.phase);
    expect(phases).toContain('peak');
    expect(phases).toContain('fade-in');
    expect(phases).toContain('fade-out');
  });

  it('event with NEGATIVE t (past) → fade-in-mid frame clamps to 1', () => {
    const neg: TimelineEvent[] = [
      { type: 'caption', t: -500, label: 'ancient', duration: 1000 },
    ];
    const kfs = computeKeyframes(neg, { fps: 12, totalSec: 5 });
    const fim = kfs.find(k => k.label === 'caption-0-fade-in-mid');
    expect(fim).toBeDefined();
    expect(fim!.frameNumber).toBeGreaterThanOrEqual(1);
  });
});

// ── buildAssertions — weird timelines ──────────────────────────────────────

describe('ADV-buildAssertions — timeline corner cases', () => {
  it('empty timeline → 12 assertions (6 range + 1 setup + 4 corner-transparent + 1 fade-to-dark)', () => {
    const as = buildAssertions([]);
    expect(as).toHaveLength(12);
    expect(as.filter(a => a.kind === 'range')).toHaveLength(6);
  });

  it('timeline of ONLY captions → no click/keystroke-specific assertions leak', () => {
    const captionsOnly: TimelineEvent[] = [
      { type: 'caption', t: 0,    label: 'a', duration: 2000 },
      { type: 'caption', t: 2500, label: 'b', duration: 2000 },
    ];
    const as = buildAssertions(captionsOnly);
    const hasCardAssertion = as.some(a => a.kind !== 'range' && 'keyframeLbl' in a && a.keyframeLbl.startsWith('click-'));
    const hasBannerAssertion = as.some(a => a.kind !== 'range' && 'keyframeLbl' in a && a.keyframeLbl.startsWith('keystroke-'));
    expect(hasCardAssertion).toBe(false);
    expect(hasBannerAssertion).toBe(false);
  });
});

// ── buildSsimAssertions — baseline coverage edge cases ─────────────────────

describe('ADV-buildSsimAssertions — baseline gap handling', () => {
  it('baseline dir that DOES NOT EXIST → zero SSIM assertions, no throw', () => {
    const kfs = [{ label: 'x', frameNumber: 1, t: 0 }];
    const ssim = buildSsimAssertions(kfs, '/definitely/does/not/exist');
    expect(ssim).toHaveLength(0);
  });

  it('empty baseline dir → zero SSIM assertions', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-ssim-'));
    try {
      const kfs = [{ label: 'x', frameNumber: 1, t: 0 }];
      expect(buildSsimAssertions(kfs, tmp)).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('baseline has STRAY PNGs not matching any keyframe → ignored (no phantom assertions)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-ssim-'));
    try {
      fs.writeFileSync(path.join(tmp, 'stray.png'),       'x');
      fs.writeFileSync(path.join(tmp, 'also-stray.png'),  'x');
      const kfs = [{ label: 'real', frameNumber: 1, t: 0 }];
      expect(buildSsimAssertions(kfs, tmp)).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('custom minScore of 0.99 propagates to every emitted assertion', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-ssim-'));
    try {
      fs.writeFileSync(path.join(tmp, 'a.png'), 'x');
      fs.writeFileSync(path.join(tmp, 'b.png'), 'x');
      const kfs = [
        { label: 'a', frameNumber: 1, t: 0 },
        { label: 'b', frameNumber: 2, t: 1 },
      ];
      const ssim = buildSsimAssertions(kfs, tmp, 0.99);
      expect(ssim.every(s => s.minScore === 0.99)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
