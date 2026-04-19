/**
 * Pixel-level invariants for demo E2E — full 10/10 coverage.
 *
 * Four assertion kinds; each closes a specific gap a regression could slip
 * through:
 *   - `color-match`   a region averages to an expected colour (palette OK).
 *   - `color-differs` a region is NOT close to a reference colour (fade-in
 *                     proves it actually ramps; no pop).
 *   - `luma-above`    a region's average luma clears a threshold (some
 *                     bright text strokes landed; title/sublabel rendered).
 *   - `range`         a scalar (frame count, duration) lies in [min, max]
 *                     (demo not truncated, not absurdly long).
 *
 * All `region` coordinates are in the overlay.ts logical 1280×720 space;
 * they are scaled at sample time to match the PNG's native dimensions.
 */

import * as fs from 'node:fs';

import type { TimelineEvent } from '../lib/timeline';
import type { Keyframe }      from './keyframes';
import {
  sampleRegion, pngDimensions, scaleRegion, colorDistance, parseHex, luma,
  type Region, type RGB,
} from './sample-pixel';
import { ssimScore } from './ssim';
import {
  BANNER_X, BANNER_Y, BANNER_W, BANNER_H,
  CARD_W, CARD_H, CARD_Y,
  CAPTION_Y, CAPTION_BAR_H, CAPTION_BAR_PAD,
  VIDEO_W, VIDEO_H,
  PRIMARY_BLUE, BANNER_BG_HEX, CAPTION_BG_HEX,
} from '../lib/overlay';

/* ── Assertion model ─────────────────────────────────────────────────────── */

export interface ColorMatch {
  kind:        'color-match';
  name:        string;
  keyframeLbl: string;
  region:      Region;
  expected:    RGB;
  /** Max Euclidean RGB distance. */
  tolerance:   number;
  note?:       string;
}

export interface ColorDiffers {
  kind:        'color-differs';
  name:        string;
  keyframeLbl: string;
  region:      Region;
  /** Sampled region must be AT LEAST this Euclidean-RGB distance from `reference`. */
  reference:   RGB;
  minDistance: number;
  note?:       string;
}

export interface LumaAbove {
  kind:        'luma-above';
  name:        string;
  keyframeLbl: string;
  region:      Region;
  /** Average luma of the sampled region must exceed this threshold [0..255]. */
  minLuma:     number;
  note?:       string;
}

export interface RangeCheck {
  kind:  'range';
  name:  string;
  /** Identifier of the value we're asserting (for the report). */
  source: string;
  /** The actual numeric value to check. Populated by the orchestrator. */
  value: number;
  min:   number;
  max:   number;
  note?: string;
}

export interface SsimAbove {
  kind:        'ssim-above';
  name:        string;
  keyframeLbl: string;
  /** Absolute path to the committed baseline PNG. */
  baselinePng: string;
  /** Minimum SSIM score in [0, 1]. 1.0 = identical. 0.92 = default. */
  minScore:    number;
  note?:       string;
}

export type Assertion = ColorMatch | ColorDiffers | LumaAbove | RangeCheck | SsimAbove;

export interface AssertionResult {
  assertion:     Assertion;
  /** 1-based WebP frame (for pixel-kind assertions only; 0 for range). */
  frameNumber:   number;
  /** Scaled region (pixel-kind only). */
  scaledRegion?: Region;
  /** Sampled colour (color-*, luma-above). */
  sampled?:      RGB;
  /** Derived metric shown in the report (distance / luma / value). */
  metric:        number;
  /** Threshold the metric was compared against. */
  threshold:     number;
  /** Short human-readable comparison, e.g. "dist 3.5 ≤ 55". */
  verdict:       string;
  pass:          boolean;
}

/* ── Text-region layout helpers ──────────────────────────────────────────── */

/**
 * Narrow horizontal band through the baseline of a text rendered at given
 * `top-y` + `fontsize`. Catching text strokes with an average-luma check
 * is much more reliable through a tight band than a full overlay-sized
 * crop (which dilutes the stroke contribution with background).
 */
function textBand(yTop: number, fontSize: number, xSpan: { x: number; w: number }): Region {
  // Center the band around ~70% of the glyph height (the x-height baseline).
  const midY = Math.round(yTop + fontSize * 0.55);
  return { x: xSpan.x, y: midY - 4, w: xSpan.w, h: 8 };
}

/* ── Builder ─────────────────────────────────────────────────────────────── */

/**
 * Build the canonical 10/10 assertion set for a given timeline. The list is
 * deterministic — same events in, same assertions out. Global assertions
 * come first, then per-event blocks in timeline order.
 */
export function buildAssertions(events: readonly TimelineEvent[]): Assertion[] {
  const out: Assertion[] = [];

  // ── Global invariants (kind='range' + global kind='color-*') ─────────────

  // Frame count: catches the "raw capture cut short" bug we saw — a WebP
  // that dropped under 120 frames means something broke the pipeline.
  // Demo-shape invariants — bounds calibrated across the current demo set
  // (navigation-history ~11 s, find-usages ~10 s). When a new demo falls
  // outside these ranges, loosen them globally OR carve out a per-demo
  // override rather than tightening to fit just one.
  out.push({
    kind:   'range', name: 'WebP frame count is in the expected range for a 6-12 s demo',
    source: 'frameCount', value: NaN, min: 100, max: 160,
    note:   'demo-length × 12 fps; 100-160 frames covers the current 6-12 s target range',
  });
  out.push({
    kind:   'range', name: 'WebP duration is in the expected range (9-12 s)',
    source: 'durationSec', value: NaN, min: 9, max: 12.5,
    note:   'catches "VS Code exited early" (tail cut) and "demo is too long" at the same time',
  });
  // Structural scalars (playbook §5 ship-blockers): the WebP must stay
  // within README-friendly size + loop + canvas invariants. The expected
  // values rarely drift, but a config toggle in convertToWebP would break
  // one instantly.
  out.push({
    kind:   'range', name: 'WebP file size is in the README-friendly range (300 KB–4 MB)',
    source: 'webpSizeKb', value: NaN, min: 300, max: 4000,
    note:   'GitHub inlines WebPs up to ~10 MB; the 4 MB ceiling is generous for panel-heavy demos',
  });
  out.push({
    kind:   'range', name: 'WebP loop count is 0 (continuous loop + fade-to-dark coupure)',
    source: 'loopCount', value: NaN, min: 0, max: 0,
    note:   'playbook §5 option 2: loop=0 + fade-to-dark is the "graceful loop" choice',
  });
  out.push({
    kind:   'range', name: 'WebP canvas width = 960 px (shipping preset)',
    source: 'canvasW', value: NaN, min: 960, max: 960,
    note:   'convertToWebP scales to 960×540; any drift means someone retuned the preset',
  });
  out.push({
    kind:   'range', name: 'WebP canvas height = 540 px (shipping preset)',
    source: 'canvasH', value: NaN, min: 540, max: 540,
    note:   'paired with canvasW; locks the 16∶9 540p preset',
  });

  // The setup frame (no overlay painted yet) — the card area should NOT
  // already be VS-Code-blue. If it were, overlay[0] fired too early.
  out.push({
    kind:        'color-differs',
    name:        'setup frame has no card overlay yet (card centre is NOT VS-Code-blue)',
    keyframeLbl: 'setup',
    region:      { x: (VIDEO_W - CARD_W) / 2 + CARD_W / 2 - 30, y: CARD_Y + 40, w: 60, h: 20 },
    reference:   parseHex(PRIMARY_BLUE),
    minDistance: 70,
    note:        'if the card were drawn too early, sampled colour would be near #007ACC',
  });

  // Fade-to-dark: last frame near-black.
  out.push({
    kind:        'color-match',
    name:        'fade-to-dark ends on a near-black frame',
    keyframeLbl: 'fade-to-dark-end',
    region:      { x: 400, y: 300, w: 480, h: 120 },
    expected:    { r: 0, g: 0, b: 0 },
    tolerance:   40,
    note:        'proves VS Code stayed on camera and the 500 ms fade-out actually ran',
  });

  // ── Per-event invariants ─────────────────────────────────────────────────

  events.forEach((ev, i) => {
    switch (ev.type) {
      case 'keystroke': pushKeystroke(out, ev, i); break;
      case 'click':     pushClick(out, ev, i);     break;
      case 'caption':   pushCaption(out, ev, i);   break;
    }
  });

  return out;
}

function pushKeystroke(out: Assertion[], _ev: TimelineEvent, i: number): void {
  // Background swatch (clear of text).
  const bgStrip: Region = { x: BANNER_X + 20, y: BANNER_Y + BANNER_H - 12, w: 20, h: 6 };

  out.push({
    kind:        'color-match',
    name:        `keystroke[${i}] banner background at peak-mid (dark grey #1E1E1E@0.85)`,
    keyframeLbl: `keystroke-${i}-peak-mid`,
    region:      bgStrip,
    expected:    parseHex(BANNER_BG_HEX),
    tolerance:   55,
    note:        'banner fill across editor chrome; tolerance absorbs small compositing drift',
  });

  // Fade-in actually ramps — at fade-in-mid, banner region should NOT yet
  // match its peak colour (alpha ≈ 0.5 → colour is ~halfway to peak).
  out.push({
    kind:        'color-differs',
    name:        `keystroke[${i}] banner fades in (fade-in-mid differs from peak colour)`,
    keyframeLbl: `keystroke-${i}-fade-in-mid`,
    region:      bgStrip,
    reference:   parseHex(BANNER_BG_HEX),
    minDistance: 8,
    note:        'if the banner "popped" instead of fading, fade-in-mid would already match peak',
  });

  // Title text rendered — the title band must carry light strokes.
  // Threshold calibration across the demo set:
  //   nav-history  "⌘ + ⌥ + ←"  → luma 44-45 (dense Unicode glyphs)
  //   find-usages  "⌥ + F7"     → luma 35    (sparse glyphs + Latin)
  // Empty banner bg lumas ~30, so 32 cleanly separates "some text rendered"
  // from "nothing". Tighten per-demo if false positives appear.
  const titleBand = textBand(BANNER_Y + 12, 28, { x: BANNER_X + 16, w: BANNER_W - 32 });
  out.push({
    kind:        'luma-above',
    name:        `keystroke[${i}] title text renders (luma-above on the title band)`,
    keyframeLbl: `keystroke-${i}-peak-mid`,
    region:      titleBand,
    minLuma:     32,
    note:        'sparse-title shortcut banners (⌥+F7) measure ~35; empty banner would be ~30',
  });

  // Sublabel text rendered (secondary #CCCCCC over #1E1E1E — still bright).
  // Calibration across the demo set:
  //   nav-history  "Navigate Back"  → luma 56-59
  //   find-usages  "Find Usages"    → luma 47.7
  // Shorter labels pack less stroke coverage into the sampled band; 42
  // protects against "nothing rendered" while tolerating natural variance.
  const subBand = textBand(BANNER_Y + 44, 20, { x: BANNER_X + 16, w: BANNER_W - 32 });
  out.push({
    kind:        'luma-above',
    name:        `keystroke[${i}] sublabel text renders (luma-above on the sublabel band)`,
    keyframeLbl: `keystroke-${i}-peak-mid`,
    region:      subBand,
    minLuma:     42,
    note:        'short sublabels (Find Usages) measure ~47; tighter threshold would flap across demos',
  });
}

function pushClick(out: Assertion[], _ev: TimelineEvent, i: number): void {
  const cardX = Math.round((VIDEO_W - CARD_W) / 2);
  const bgStrip: Region = { x: cardX + 40, y: CARD_Y + CARD_H - 8, w: 20, h: 4 };

  out.push({
    kind:        'color-match',
    name:        `click[${i}] card background at peak-mid (VS Code blue #007ACC@0.92)`,
    keyframeLbl: `click-${i}-peak-mid`,
    region:      bgStrip,
    expected:    parseHex(PRIMARY_BLUE),
    tolerance:   70,
    note:        'card fill over the editor code; tolerance accommodates 8% alpha bleed-through',
  });

  out.push({
    kind:        'color-differs',
    name:        `click[${i}] card fades in (fade-in-mid differs from peak colour)`,
    keyframeLbl: `click-${i}-fade-in-mid`,
    region:      bgStrip,
    reference:   parseHex(PRIMARY_BLUE),
    minDistance: 20,
    note:        'confirms the 150 ms fade in ramps; a pop-in would fail this',
  });

  out.push({
    kind:        'color-differs',
    name:        `click[${i}] card fades out (fade-out-mid differs from peak colour)`,
    keyframeLbl: `click-${i}-fade-out-mid`,
    region:      bgStrip,
    reference:   parseHex(PRIMARY_BLUE),
    minDistance: 20,
    note:        'symmetric to the fade-in check — catches "stays opaque then snaps off"',
  });

  // Title — centered across the full frame. Use a generous horizontal span
  // around the frame centre; that's where "Cmd+Click → Go to Definition" sits.
  const titleBand = textBand(CARD_Y + 22, 28, { x: cardX + 40, w: CARD_W - 80 });
  out.push({
    kind:        'luma-above',
    name:        `click[${i}] title text renders (luma-above on the title band)`,
    keyframeLbl: `click-${i}-peak-mid`,
    region:      titleBand,
    minLuma:     120,
    note:        'white Inter strokes over #007ACC@0.92 — bg luma ≈ 102, stroke coverage lifts avg > 120',
  });

  // Sublabel (the symbol name) — rendered in JetBrains Mono at 20 pt. Used
  // as a proxy for "mono font was actually used" since the filter unit
  // tests prove it RECEIVES the mono font path; luma-above proves something
  // was painted there.
  const subBand = textBand(CARD_Y + 62, 20, { x: cardX + 40, w: CARD_W - 80 });
  out.push({
    kind:        'luma-above',
    name:        `click[${i}] sublabel text renders (proxy for mono-font rendering)`,
    keyframeLbl: `click-${i}-peak-mid`,
    region:      subBand,
    minLuma:     108,
    note:        'if no sublabel, luma stays at card background (~102); strokes lift avg above 108',
  });
}

function pushCaption(out: Assertion[], _ev: TimelineEvent, i: number): void {
  const barX = CAPTION_BAR_PAD;
  const bgStrip: Region = { x: barX + 12, y: CAPTION_Y - 4, w: 20, h: 10 };

  out.push({
    kind:        'color-match',
    name:        `caption[${i}] bar background at peak-mid (near-black, #000@0.72 over editor)`,
    keyframeLbl: `caption-${i}-peak-mid`,
    region:      bgStrip,
    expected:    parseHex(CAPTION_BG_HEX),
    tolerance:   55,
    note:        'bar is mostly opaque but some editor bg bleeds — very dark, not pure black',
  });

  out.push({
    kind:        'color-differs',
    name:        `caption[${i}] bar fades in (fade-in-mid differs from peak colour)`,
    keyframeLbl: `caption-${i}-fade-in-mid`,
    region:      bgStrip,
    reference:   parseHex(CAPTION_BG_HEX),
    minDistance: 6,
    note:        'subtle — the bar-to-editor contrast is small, so this is a sanity ramp check',
  });

  // Caption text band — centered under the bar.
  const textBandRegion = textBand(CAPTION_Y, 22, { x: CAPTION_BAR_PAD + 40, w: VIDEO_W - 2 * CAPTION_BAR_PAD - 80 });
  out.push({
    kind:        'luma-above',
    name:        `caption[${i}] text renders (luma-above on the caption band)`,
    keyframeLbl: `caption-${i}-peak-mid`,
    region:      textBandRegion,
    minLuma:     25,
    note:        'white 22 pt Inter over a near-black bar; any stroke at all lifts avg over ~20',
  });
}

/**
 * For each keyframe whose baseline PNG exists on disk, emit one SSIM
 * assertion that pixel-diffs the freshly-extracted PNG against the committed
 * baseline. Missing baselines silently skip (the orchestrator surfaces a
 * warning and an "accept-baseline" hint separately).
 */
export function buildSsimAssertions(
  keyframes:  readonly Keyframe[],
  baselineDir: string,
  minScore:   number = 0.92,
): SsimAbove[] {
  const out: SsimAbove[] = [];
  for (const k of keyframes) {
    const baselinePng = `${baselineDir}/${k.label}.png`;
    if (!fs.existsSync(baselinePng)) continue;
    out.push({
      kind:        'ssim-above',
      name:        `pixel diff vs baseline: ${k.label}`,
      keyframeLbl: k.label,
      baselinePng,
      minScore,
      note:        'SSIM 1.0 = identical; <threshold means meaningful visual drift vs the committed golden',
    });
  }
  return out;
}

/* ── Runner ──────────────────────────────────────────────────────────────── */

export interface RunContext {
  /** Lookup a keyframe by label → its PNG path on disk. */
  pngByKeyframe:  Record<string, string>;
  /** Lookup a keyframe by label → its metadata (for frameNumber logging). */
  keyframeByLbl:  Record<string, Keyframe>;
  /** Actual WebP scalars, for `range` assertions. */
  scalars:        Record<string, number>;
}

export function runAssertion(a: Assertion, ctx: RunContext): AssertionResult {
  switch (a.kind) {
    case 'color-match':   return runColorMatch(a, ctx);
    case 'color-differs': return runColorDiffers(a, ctx);
    case 'luma-above':    return runLumaAbove(a, ctx);
    case 'range':         return runRange(a, ctx);
    case 'ssim-above':    return runSsim(a, ctx);
  }
}

function runPixel<T extends ColorMatch | ColorDiffers | LumaAbove>(
  a: T, ctx: RunContext,
): { sampled: RGB; scaledRegion: Region; frameNumber: number } {
  const png = ctx.pngByKeyframe[a.keyframeLbl];
  const kf  = ctx.keyframeByLbl[a.keyframeLbl];
  if (!png || !kf) throw new Error(`assertion "${a.name}" references unknown keyframe "${a.keyframeLbl}"`);
  const dims    = pngDimensions(png);
  const scaled  = scaleRegion(a.region, { w: VIDEO_W, h: VIDEO_H }, dims);
  const sampled = sampleRegion(png, scaled);
  return { sampled, scaledRegion: scaled, frameNumber: kf.frameNumber };
}

function runColorMatch(a: ColorMatch, ctx: RunContext): AssertionResult {
  const { sampled, scaledRegion, frameNumber } = runPixel(a, ctx);
  const dist = colorDistance(sampled, a.expected);
  return {
    assertion: a, frameNumber, scaledRegion, sampled,
    metric: dist, threshold: a.tolerance,
    verdict: `dist ${dist.toFixed(1)} ${dist <= a.tolerance ? '≤' : '>'} ${a.tolerance}`,
    pass: dist <= a.tolerance,
  };
}

function runColorDiffers(a: ColorDiffers, ctx: RunContext): AssertionResult {
  const { sampled, scaledRegion, frameNumber } = runPixel(a, ctx);
  const dist = colorDistance(sampled, a.reference);
  return {
    assertion: a, frameNumber, scaledRegion, sampled,
    metric: dist, threshold: a.minDistance,
    verdict: `dist ${dist.toFixed(1)} ${dist >= a.minDistance ? '≥' : '<'} ${a.minDistance}`,
    pass: dist >= a.minDistance,
  };
}

function runLumaAbove(a: LumaAbove, ctx: RunContext): AssertionResult {
  const { sampled, scaledRegion, frameNumber } = runPixel(a, ctx);
  const y = luma(sampled);
  return {
    assertion: a, frameNumber, scaledRegion, sampled,
    metric: y, threshold: a.minLuma,
    verdict: `luma ${y.toFixed(1)} ${y >= a.minLuma ? '≥' : '<'} ${a.minLuma}`,
    pass: y >= a.minLuma,
  };
}

function runRange(a: RangeCheck, ctx: RunContext): AssertionResult {
  const v = ctx.scalars[a.source];
  if (v === undefined || Number.isNaN(v)) {
    throw new Error(`range assertion "${a.name}" has no scalar value for "${a.source}"`);
  }
  // Construction-time validation: inverted bounds mean every call fails
  // silently with a "v ∈ [100, 50]" verdict that hides the real bug. Throw
  // loudly so the configuration error is corrected at the source.
  if (!Number.isFinite(a.min) || !Number.isFinite(a.max)) {
    throw new Error(`range assertion "${a.name}" has non-finite bounds [${a.min}, ${a.max}]`);
  }
  if (a.min > a.max) {
    throw new Error(`range assertion "${a.name}" has inverted bounds: min=${a.min} > max=${a.max}`);
  }
  const hydrated: RangeCheck = { ...a, value: v };
  const pass = v >= a.min && v <= a.max;
  return {
    assertion: hydrated, frameNumber: 0,
    metric: v, threshold: NaN,
    verdict: `${v.toFixed(2)} ∈ [${a.min}, ${a.max}]${pass ? '' : ' ✗'}`,
    pass,
  };
}

function runSsim(a: SsimAbove, ctx: RunContext): AssertionResult {
  const png = ctx.pngByKeyframe[a.keyframeLbl];
  const kf  = ctx.keyframeByLbl[a.keyframeLbl];
  if (!png || !kf) throw new Error(`SSIM assertion "${a.name}" references unknown keyframe "${a.keyframeLbl}"`);
  const score = ssimScore(a.baselinePng, png);
  return {
    assertion: a, frameNumber: kf.frameNumber,
    metric: score, threshold: a.minScore,
    verdict: `SSIM ${score.toFixed(3)} ${score >= a.minScore ? '≥' : '<'} ${a.minScore.toFixed(3)}`,
    pass: score >= a.minScore,
  };
}
