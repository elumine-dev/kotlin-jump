/**
 * Semantic keyframe selection for demo E2E.
 *
 * Given a timeline (the array we shift onto the trimmed video's t=0 in
 * record.ts) and the WebP's frame rate, pick a handful of timestamps per
 * event that cover the interesting transitions:
 *
 *   0        fade-in  peak-start  peak-mid  peak-end  fade-out  (end)
 *   |----------|----------|----------|----------|----------|----------|
 *              ^-----^                                   ^-----^
 *              mid-fade-in                               mid-fade-out
 *
 * Plus global bookends:
 *   - `setup` (frame 1 — no overlay yet)
 *   - `fade-to-dark-mid` and `fade-to-dark-end` (tail)
 */

import type { TimelineEvent } from '../lib/timeline';

export interface Keyframe {
  /** Stable label used as the file stem and the assertion keyframe reference. */
  label:       string;
  /** 1-based frame number in the WebP. */
  frameNumber: number;
  /** Source timestamp in seconds (for the report). */
  t:           number;
  /** Event index this keyframe belongs to (undefined for bookends). */
  eventIdx?:   number;
  /** Event type, for prettier reporting. */
  eventType?:  TimelineEvent['type'];
  /** Which phase of the event this keyframe samples. */
  phase?:      'setup' | 'fade-in' | 'peak' | 'fade-out' | 'fade-to-dark';
}

export interface KeyframeOptions {
  fps:     number;
  totalSec: number;
  /** Must match overlay.FADE_MS so we hit the actual transitions. */
  fadeMs?: number;
  /** Must match record.ts fade-to-dark duration. */
  fadeToDarkMs?: number;
}

/** Compute the list of keyframes to extract + assert against. */
export function computeKeyframes(
  events: readonly TimelineEvent[],
  opts:   KeyframeOptions,
): Keyframe[] {
  const fps          = opts.fps;
  const totalSec     = opts.totalSec;
  const fade         = (opts.fadeMs ?? 150) / 1000;
  const fadeToDarkMs = opts.fadeToDarkMs ?? 500;

  const toFrame = (sec: number): number => {
    // WebP uses 1-based frame numbers; the first frame covers t ∈ [0, 1/fps).
    const f = Math.round(sec * fps) + 1;
    return Math.max(1, Math.min(f, Math.max(1, Math.round(totalSec * fps))));
  };

  const out: Keyframe[] = [];

  // Global setup: always useful to eyeball the initial frame.
  out.push({ label: 'setup', frameNumber: 1, t: 0, phase: 'setup' });

  events.forEach((ev, i) => {
    const t0Sec = ev.t / 1000;
    const t1Sec = (ev.t + ev.duration) / 1000;

    const fadeInMid  = t0Sec + fade / 2;
    const peakStart  = t0Sec + fade;
    const peakMid    = (t0Sec + t1Sec) / 2;
    const peakEnd    = t1Sec - fade;
    const fadeOutMid = t1Sec - fade / 2;

    const tag = (phase: string) => `${ev.type}-${i}-${phase}`;

    out.push(
      { label: tag('fade-in-mid'),  frameNumber: toFrame(fadeInMid),  t: fadeInMid,  eventIdx: i, eventType: ev.type, phase: 'fade-in' },
      { label: tag('peak-start'),   frameNumber: toFrame(peakStart),  t: peakStart,  eventIdx: i, eventType: ev.type, phase: 'peak' },
      { label: tag('peak-mid'),     frameNumber: toFrame(peakMid),    t: peakMid,    eventIdx: i, eventType: ev.type, phase: 'peak' },
      { label: tag('peak-end'),     frameNumber: toFrame(peakEnd),    t: peakEnd,    eventIdx: i, eventType: ev.type, phase: 'peak' },
      { label: tag('fade-out-mid'), frameNumber: toFrame(fadeOutMid), t: fadeOutMid, eventIdx: i, eventType: ev.type, phase: 'fade-out' },
    );
  });

  // Global fade-to-dark tail.
  const fadeToDarkSec = fadeToDarkMs / 1000;
  out.push(
    { label: 'fade-to-dark-mid', frameNumber: toFrame(totalSec - fadeToDarkSec / 2), t: totalSec - fadeToDarkSec / 2, phase: 'fade-to-dark' },
    { label: 'fade-to-dark-end', frameNumber: toFrame(totalSec - 1 / fps),           t: totalSec - 1 / fps,           phase: 'fade-to-dark' },
  );

  // We intentionally do NOT de-duplicate by frame number: two semantic
  // keyframes can legitimately map to the same underlying WebP frame (e.g.,
  // when events overlap at low fps), and assertions reference them by
  // label, not by frame number. Extracting the same frame twice costs <10 ms
  // per keyframe and keeps the assertion ↔ keyframe graph sound.
  return out;
}
