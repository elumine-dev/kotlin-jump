/**
 * Unit coverage for `pickPosterFrame` — the timeline-aware choice of which
 * WebP frame should become the static `<name>-poster.png`.
 *
 * The heuristic is:
 *
 *   1. Default target = last narrative event (caption / keystroke / click)
 *      at 65 % through its visibility window (past the 150 ms fade-in,
 *      before the 150 ms fade-out → peak readability of the overlay text).
 *   2. Empty timeline → 75 % through the clip.
 *   3. Clamp strictly BEFORE the video-level fade-to-dark (`fadeStart - 50 ms`
 *      safety margin).
 *   4. Clamp strictly AFTER the first frame (≥ frame 2) to dodge the
 *      historical frame-1 alpha edge case.
 *
 * The tests pin the math explicitly — if the ratios ever drift a future
 * dev will see it in the diff.
 */

import { describe, it, expect } from 'vitest';
import { pickPosterFrame } from '../../scripts/demo/lib/ffmpeg';
import type { TimelineEvent } from '../../scripts/demo/lib/timeline';

const caption = (t: number, duration: number): TimelineEvent =>
  ({ type: 'caption', t, duration, label: 'c' });
const keystroke = (t: number, duration: number): TimelineEvent =>
  ({ type: 'keystroke', t, duration, label: 'k', sublabel: 's' });
const click = (t: number, duration: number): TimelineEvent =>
  ({ type: 'click', t, duration, label: 'c', sublabel: 's' });

describe('pickPosterFrame — anchored to the last narrative overlay', () => {
  it('picks 65 % through the LAST narrative event (find-usages-like: caption 2000 ms ending near the clip end)', () => {
    // Simulates find-usages: last caption starts ~11.58 s, 2 s long.
    // Clip 13.58 s, fade from 13.08 s.
    const events = [
      caption( 500, 1500),
      keystroke(2000, 1400),
      caption(11583, 2000),
    ];
    // target = 11583 + 2000 * 0.65 = 12883 ms
    // fadeStart = 13083 ms, clamp = 13033 ms → target unchanged
    // frame = round(12883/1000*12) + 1 = round(154.6)+1 = 155+1 = 156
    expect(pickPosterFrame(events, 13.583)).toBe(156);
  });

  it('peak ratio is exactly 65 % (no drift)', () => {
    // Single event starting at t=0 with duration=10000 and a huge clip
    // (so fade-clamp doesn't kick in). Target = 6500 ms = frame 79 (1-idx).
    const events = [caption(0, 10000)];
    // t=6500ms → frame index 0-based = floor(6500/1000*12) = 78,
    // 1-indexed = round(6500/1000*12)+1 = 78+1 = 79
    expect(pickPosterFrame(events, 30)).toBe(79);
  });

  it('uses the LAST narrative event even when earlier events are much later in the timeline', () => {
    const events = [
      caption(1000, 1000),
      caption(5000, 1000),   // last caption; we anchor here
      // (no events after)
    ];
    // target = 5000 + 1000 * 0.65 = 5650 ms → frame = round(5.65*12)+1 = 68+1 = 69
    expect(pickPosterFrame(events, 10)).toBe(69);
  });

  it('any narrative type counts (caption, keystroke, click) — the last one wins', () => {
    const e1 = [caption(5000, 1000), keystroke(7000, 1000)];
    const e2 = [caption(5000, 1000), click(7000, 1000)];
    // Both should anchor at the (t=7000,d=1000) event → same frame.
    expect(pickPosterFrame(e1, 10)).toBe(pickPosterFrame(e2, 10));
  });
});

describe('pickPosterFrame — clamps', () => {
  it('clamps strictly before the fade-to-dark tail (50 ms safety margin)', () => {
    // One overlay positioned deliberately INSIDE the fade window.
    const events = [caption(12500, 2000)];  // 0.65 × 2000 = 1300 → target = 13800 ms
    // clipSec = 13.583 s → fadeStart = 13083 ms → clamp = 13033 ms
    // frame = round(13.033*12)+1 = round(156.4)+1 = 156+1 = 157
    expect(pickPosterFrame(events, 13.583)).toBe(157);
  });

  it('clamps to at least frame 2 (dodges the historic frame-1 alpha glitch)', () => {
    const events = [caption(0, 10)];  // target ≈ 6.5 ms → frame 1.08 → clamp to 2
    expect(pickPosterFrame(events, 10)).toBe(2);
  });

  it('empty timeline falls back to 75 % through the clip', () => {
    // clip = 10 s → target = 7500 ms → frame = round(90)+1 = 91
    expect(pickPosterFrame([], 10)).toBe(91);
  });

  it('empty timeline with short clip also respects the fade clamp', () => {
    // clip = 1 s, fade = 0.5 s → fadeStart = 500 ms, clamp = 450 ms
    // 75 % target = 750 ms → clamped to 450 ms → frame = round(5.4)+1 = 6
    expect(pickPosterFrame([], 1)).toBe(6);
  });
});

describe('pickPosterFrame — config knobs', () => {
  it('honours a custom fps (30 fps doubles the frame index for the same time)', () => {
    const events = [caption(5000, 1000)];
    const at12 = pickPosterFrame(events, 10, { fps: 12 });
    const at30 = pickPosterFrame(events, 10, { fps: 30 });
    // Same time target; frame numbers scale by fps ratio.
    // t = 5650 ms → at12 = round(5.65*12)+1 = round(67.8)+1 = 69
    //              at30 = round(5.65*30)+1 = round(169.5)+1 = 171
    //              (Math.round in JS rounds half up for +values)
    expect(at12).toBe(69);
    expect(at30).toBe(171);
  });

  it('honours a custom fadeOutSec — larger fade pulls the clamp earlier', () => {
    const events = [caption(8000, 2000)];  // target = 9300 ms
    // clipSec = 10 s. fade=0.5 → clamp=9450 → target(9300) OK, frame = round(9.3*12)+1 = 113
    // fade=2.0 → fadeStart=8000 → clamp=7950 → target clamped, frame = round(7.95*12)+1 = 96
    expect(pickPosterFrame(events, 10, { fadeOutSec: 0.5 })).toBe(113);
    expect(pickPosterFrame(events, 10, { fadeOutSec: 2.0 })).toBe(96);
  });
});

describe('pickPosterFrame — robustness vs. the old `totalFrames - 5` heuristic', () => {
  // This is the killer: at 30 fps, `totalFrames - 5` means 5/30 = 167 ms
  // before the end → deep inside a 500 ms fade-to-dark. The timeline-aware
  // function does not degrade like that.
  it('at 30 fps on a "find-usages"-shaped clip, poster is safely outside the fade', () => {
    const events = [caption(11583, 2000)];
    const clipSec = 13.583;
    const fps = 30;
    const fadeOutSec = 0.5;

    const frame = pickPosterFrame(events, clipSec, { fps, fadeOutSec });
    const frameTimeMs = (frame - 1) / fps * 1000;  // midpoint approx
    const fadeStartMs = (clipSec - fadeOutSec) * 1000;

    expect(frameTimeMs).toBeLessThan(fadeStartMs);
  });

  it('on a 30-event, long-duration demo, the poster still anchors on the last narrative beat', () => {
    // 30 events, 500 ms apart, ending around 15 s.
    const events: TimelineEvent[] = Array.from({ length: 30 }, (_, i) =>
      caption(i * 500, 400),
    );
    const frame = pickPosterFrame(events, 16);
    // last event t=14500, duration=400, target=14500 + 400*0.65 = 14760 ms
    // fadeStart = 15500, clamp = 15450 → target unchanged
    // frame = round(14.76*12)+1 = 178
    expect(frame).toBe(178);
  });
});
