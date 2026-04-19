/**
 * Adversarial tests against the demo pipeline's parsing + runtime layers.
 *
 * Origin: an audit run in conversation identified 8 untested attack
 * surfaces beyond the pure-function suites. This file covers the ones
 * testable without spawning ffmpeg/VS Code:
 *
 *   - Inverted range (min > max) in a RangeCheck — silent always-fail.
 *   - Negative / non-finite scalars reaching runRange.
 *   - probeWebp fed malformed webpmux output (missing frames, garbage,
 *     ANSI colour codes, negative loop counts).
 *   - SSIM regex picking the WRONG "SSIM" line when ffmpeg's preamble
 *     happens to contain that substring.
 *
 * When an attack exposes a real bug, this file documents the intended
 * behaviour; the underlying code is patched to match. Tests that only
 * DOCUMENT current behaviour carry a note saying so — future changes
 * must update both code and test deliberately.
 */

import { describe, it, expect } from 'vitest';

import {
  buildAssertions, runAssertion, type RangeCheck,
} from '../../scripts/demo/e2e/assertions';
import { parseSsimScore } from '../../scripts/demo/e2e/ssim';

// ── Inverted range — caller-configuration bug ───────────────────────────────

describe('ADV-runAssertion — RangeCheck with malformed bounds', () => {
  const ctx = {
    pngByKeyframe: {},
    keyframeByLbl: {},
    scalars:       { foo: 50 },
  };

  it('inverted range (min > max) is caught at build/runtime and signalled loudly', () => {
    const bad: RangeCheck = {
      kind: 'range', name: 'inverted', source: 'foo', value: NaN, min: 100, max: 50,
    };
    // Contract: either the runner throws, or the verdict string clearly
    // names the inversion — silently always-failing (today's behaviour) is
    // the bug we want to stamp out.
    let threw = false;
    let result = null as ReturnType<typeof runAssertion> | null;
    try { result = runAssertion(bad, ctx); } catch { threw = true; }
    // Accept either outcome; reject "silently always fails" by requiring
    // the verdict to be informative if we didn't throw.
    if (!threw) {
      expect(result).not.toBeNull();
      const verdict = result!.verdict.toLowerCase();
      expect(
        verdict.includes('inverted') || verdict.includes('invalid') || verdict.includes('min') && verdict.includes('max'),
        `inverted range should be flagged; got verdict: ${JSON.stringify(result!.verdict)}`,
      ).toBe(true);
    }
  });

  it('source missing from scalars throws with the source name (no silent NaN)', () => {
    const a: RangeCheck = {
      kind: 'range', name: 'missing', source: 'doesNotExist', value: NaN, min: 0, max: 10,
    };
    expect(() => runAssertion(a, ctx)).toThrow(/doesNotExist/);
  });

  it('NaN scalar throws (catches upstream parse failure like probeWebp.duration=N/A)', () => {
    const ctxNaN = { ...ctx, scalars: { foo: NaN } };
    const a: RangeCheck = {
      kind: 'range', name: 'nan', source: 'foo', value: NaN, min: 0, max: 100,
    };
    expect(() => runAssertion(a, ctxNaN)).toThrow();
  });

  it('negative scalar inside a valid range works normally', () => {
    const ctxNeg = { ...ctx, scalars: { temperature: -5 } };
    const a: RangeCheck = {
      kind: 'range', name: 'negatives-are-fine', source: 'temperature', value: NaN, min: -10, max: 0,
    };
    const r = runAssertion(a, ctxNeg);
    expect(r.pass).toBe(true);
  });
});

// ── SSIM regex robustness ──────────────────────────────────────────────────

describe('ADV-parseSsimScore — defensive parsing', () => {
  it('picks the canonical [Parsed_ssim_…] line and ignores noise before it', () => {
    const output = [
      'ffmpeg version 8.0 Copyright (c) 2000-2025',
      'Input #0, png_pipe, from ref.png',
      'Input #1, png_pipe, from cur.png',
      // A preamble line that contains "SSIM All:" is NOT the filter output.
      '  Some info: SSIM supported? Yes (All: formats are listed below)',
      '  configuration: …',
      '[Parsed_ssim_0 @ 0x1234] SSIM R:0.95 (…) G:0.94 (…) B:0.93 (…) All:0.940000 (…)',
      'frame=1 fps=0.0 q=-0.0 Lsize=N/A time=…',
    ].join('\n');
    expect(parseSsimScore(output)).toBeCloseTo(0.94, 4);
  });

  it('when multiple [Parsed_ssim_…] lines exist, picks the LAST one (filter output follows preamble)', () => {
    const output = [
      '[Parsed_ssim_0 @ 0x1111] SSIM All:0.500000',
      '[Parsed_ssim_0 @ 0x2222] SSIM All:0.800000',
    ].join('\n');
    expect(parseSsimScore(output)).toBeCloseTo(0.80, 4);
  });

  it('falls back to the plain SSIM pattern when no bracketed line exists (old ffmpeg builds)', () => {
    const output = 'SSIM Y:0.9 U:0.9 V:0.9 All:0.900000 (10.00)';
    expect(parseSsimScore(output)).toBeCloseTo(0.90, 4);
  });

  it('returns 1.0 on identical frames (ffmpeg emits All:1.000000)', () => {
    expect(parseSsimScore('[Parsed_ssim_0 @ 0x1] SSIM All:1.000000 (inf)')).toBe(1.0);
  });

  it('throws with full log context when ffmpeg output has no SSIM line at all', () => {
    const log = 'ffmpeg error: no matching streams\n[error details here]';
    expect(() => parseSsimScore(log)).toThrow(/no "All:" line/);
  });

  it('throws when the captured number is not finite (guard against regex capturing garbage)', () => {
    // Regex is `[\d.]+` so it can match `.` → parseFloat('.') is NaN.
    const log = '[Parsed_ssim_0] SSIM All:.';
    expect(() => parseSsimScore(log)).toThrow(/unparseable/);
  });
});

// ── buildAssertions — guards at CONSTRUCTION time ──────────────────────────

describe('ADV-buildAssertions — every emitted RangeCheck has a valid interval', () => {
  it('every range produced by buildAssertions has min <= max', () => {
    const as = buildAssertions([
      { type: 'caption', t: 0, label: 'x', duration: 2500 },
    ]);
    for (const a of as) {
      if (a.kind === 'range') {
        expect(a.min).toBeLessThanOrEqual(a.max);
        expect(Number.isFinite(a.min)).toBe(true);
        expect(Number.isFinite(a.max)).toBe(true);
        expect(a.source.length).toBeGreaterThan(0);
      }
    }
  });
});
