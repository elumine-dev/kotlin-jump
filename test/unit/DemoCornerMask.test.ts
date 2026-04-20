/**
 * Unit coverage for `buildCornerMaskFilter` in `scripts/demo/lib/overlay.ts`.
 *
 * The filter generates a grayscale mask that, when used with `alphamerge`,
 * makes the four macOS rounded-corner "triangles" fully transparent in the
 * final WebP. We can't run ffmpeg inside vitest, but we CAN assert the
 * emitted filter string is well-formed and carries the four corner terms
 * in its `geq` expression — a regression where one term was accidentally
 * dropped (leaving one corner opaque) would fail these tests.
 *
 * Inverse logic vs. earlier versions: the old filter painted lum=255
 * (opaque black overlay) in corners and 0 elsewhere. The new filter
 * paints lum=0 (→ alpha=0 after alphamerge, transparent) in corners and
 * lum=255 (→ alpha=255, fully opaque) in the interior.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCornerMaskFilter,
  CORNER_RADIUS,
  VIDEO_W,
  VIDEO_H,
} from '../../scripts/demo/lib/overlay';

describe('buildCornerMaskFilter — structure', () => {
  it('emits a color source, format=gray, a geq lum expression, and a loop — in order', () => {
    const s = buildCornerMaskFilter();
    const idxColor  = s.indexOf('color=');
    const idxFormat = s.indexOf('format=gray');
    const idxGeq    = s.indexOf('geq=');
    const idxLoop   = s.indexOf('loop=');
    expect(idxColor).toBeGreaterThanOrEqual(0);
    expect(idxFormat).toBeGreaterThan(idxColor);
    expect(idxGeq).toBeGreaterThan(idxFormat);
    expect(idxLoop).toBeGreaterThan(idxGeq);
  });

  it('produces the default [cornermask] label', () => {
    expect(buildCornerMaskFilter()).toMatch(/\[cornermask\]$/);
  });

  it('honours a custom outLabel', () => {
    expect(buildCornerMaskFilter({ outLabel: 'xyz' })).toMatch(/\[xyz\]$/);
  });

  it('uses the shared VIDEO_W × VIDEO_H canvas by default (lines up with overlay coords)', () => {
    expect(buildCornerMaskFilter()).toContain(`s=${VIDEO_W}x${VIDEO_H}`);
  });

  it('honours custom width/height', () => {
    expect(buildCornerMaskFilter({ width: 640, height: 360 })).toContain('s=640x360');
  });

  it('emits grayscale (for alphamerge), NOT rgba (legacy overlay path)', () => {
    const s = buildCornerMaskFilter();
    expect(s).toContain('format=gray');
    expect(s).not.toContain('format=rgba');
  });
});

describe('buildCornerMaskFilter — geq expression carries all four corners', () => {
  // Disjunction of four terms, one per corner. If a refactor ever drops one,
  // that corner stays opaque and its pixels end up opaque-black.
  it('contains top-left condition: lt(X,R) * lt(Y,R)', () => {
    expect(buildCornerMaskFilter({ radius: 12 })).toMatch(/lt\(X\\,12\)\*lt\(Y\\,12\)/);
  });

  it('contains top-right condition: gt(X,W-R) * lt(Y,R)', () => {
    expect(buildCornerMaskFilter({ radius: 12 })).toMatch(/gt\(X\\,W-12\)\*lt\(Y\\,12\)/);
  });

  it('contains bottom-left condition: lt(X,R) * gt(Y,H-R)', () => {
    expect(buildCornerMaskFilter({ radius: 12 })).toMatch(/lt\(X\\,12\)\*gt\(Y\\,H-12\)/);
  });

  it('contains bottom-right condition: gt(X,W-R) * gt(Y,H-R)', () => {
    expect(buildCornerMaskFilter({ radius: 12 })).toMatch(/gt\(X\\,W-12\)\*gt\(Y\\,H-12\)/);
  });

  it('encodes the arc radius² literal for each corner (R²=144 when R=12)', () => {
    const s = buildCornerMaskFilter({ radius: 12 });
    const r2Tests = s.match(/\\,144\)/g) ?? [];
    expect(r2Tests.length).toBe(4);
  });

  it('maps lum to 0 inside corner regions (→ transparent after alphamerge), 255 otherwise', () => {
    // The final `if(disjunction, 0, 255)` — 0 → alpha=0 (corner transparent),
    // 255 → alpha=255 (interior opaque). This is INVERTED from the old
    // overlay-based mask which used 255 on corners for black paint.
    expect(buildCornerMaskFilter()).toMatch(/\\,0\\,255\)/);
  });
});

describe('buildCornerMaskFilter — radius knob', () => {
  it('shipping default is CORNER_RADIUS (24 px at 1280×720, ~18 px at 960×540)', () => {
    expect(CORNER_RADIUS).toBe(24);
    expect(buildCornerMaskFilter()).toContain('lt(X\\,24)');
  });

  it('passes a custom radius through unchanged', () => {
    const s = buildCornerMaskFilter({ radius: 16 });
    expect(s).toContain('lt(X\\,16)');
    expect(s).toContain('W-16');
    expect(s).toContain('\\,256)');  // 16*16
  });
});

describe('buildCornerMaskFilter — syntactic invariants', () => {
  it('emits exactly one top-level filter chain (no stray semicolons)', () => {
    // The builder returns ONE chain component; callers splice it into
    // filter_complex via `;`-join. A rogue `;` inside would double-terminate.
    expect(buildCornerMaskFilter().includes(';')).toBe(false);
  });

  it('wraps the geq lum expression in single quotes (protects , and : from arg parsing)', () => {
    expect(buildCornerMaskFilter()).toMatch(/geq=lum='[^']+'/);
  });

  it('the 1-frame + loop=-1:1:0 combo keeps per-frame cost flat (no geq recomputation per video frame)', () => {
    const s = buildCornerMaskFilter();
    // Canonical "one frame, one second" form (d=1:r=1) — loop caches the
    // single geq evaluation; the `fps=…` tail re-times to the output rate.
    expect(s).toContain('d=1:r=1');
    expect(s).toContain('loop=-1:1:0');
  });

  it('the loop tail normalises fps to the output rate (avoids alphamerge time-base reconciliation hang)', () => {
    // Without this, the static mask stream ran at 25 fps while the main
    // video ran at 12 fps; alphamerge had to reconcile per pull and the
    // filter graph ground to 2+ minutes per 1 s of source. Defaulting
    // fps=12 matches the shipping WebP rate.
    expect(buildCornerMaskFilter()).toContain(',loop=-1:1:0,fps=12');
  });

  it('custom fps threads through the loop tail', () => {
    expect(buildCornerMaskFilter({ fps: 24 })).toContain(',loop=-1:1:0,fps=24');
  });
});
