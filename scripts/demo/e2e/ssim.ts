/**
 * SSIM (Structural Similarity Index) wrapper for demo E2E baseline diff.
 *
 * Uses ffmpeg's native `ssim` filter — zero dependency added. The filter
 * prints one summary line per pair of frames to stderr:
 *
 *   [Parsed_ssim_0 @ 0x…] SSIM R:0.98 (…) G:0.98 (…) B:0.97 (…) All:0.98 (…)
 *
 * We parse the `All:` value. Output range is [0, 1]; 1.0 = identical;
 * 0.92 is the project's default "catch meaningful drift, tolerate encoding
 * noise" threshold (calibrated against navigation-history in plan P1).
 */

import { execSync } from 'node:child_process';

/**
 * Extract the scalar SSIM "All" score from ffmpeg's merged stdout/stderr.
 *
 * Defensive parsing rules (in priority order):
 *   1. A line starting with `[Parsed_ssim_…] SSIM … All:<N>` — the canonical
 *      output of the `ssim` filter. Takes precedence over anything else.
 *   2. Any `SSIM … All:<N>` line (legacy / non-bracketed builds).
 *   3. Nothing matches → throw.
 *
 * When multiple candidates exist the LAST wins — the filter runs after the
 * preamble, so its line appears last in the log.
 *
 * Exported for unit testing against crafted output without spawning ffmpeg.
 */
export function parseSsimScore(merged: string): number {
  const parsed = [...merged.matchAll(/\[Parsed_ssim_[^\]]*\][^\n]*All:\s*([\d.]+)/g)];
  const fallback = [...merged.matchAll(/SSIM\s+[^\n]*All:\s*([\d.]+)/g)];
  const hits = parsed.length > 0 ? parsed : fallback;
  if (hits.length === 0) {
    throw new Error(`ffmpeg SSIM filter produced no "All:" line:\n${merged}`);
  }
  const score = parseFloat(hits[hits.length - 1][1]);
  if (!Number.isFinite(score)) {
    throw new Error(`unparseable SSIM score: ${JSON.stringify(hits[hits.length - 1][1])}`);
  }
  return score;
}

/**
 * Compare two images and return the scalar SSIM "All" score in [0, 1].
 * Both inputs must exist; they may differ in lossless/lossy encoding but
 * MUST share the same dimensions (ffmpeg's SSIM errors otherwise — we let
 * that error propagate so a size mismatch is loud, not silent).
 */
export function ssimScore(referencePng: string, currentPng: string): number {
  // ffmpeg writes filter-summary lines to stderr; merge with `2>&1` so we see
  // them via execSync's stdout capture.
  const merged = execSync(
    `ffmpeg -i ${JSON.stringify(referencePng)} -i ${JSON.stringify(currentPng)} ` +
    `-lavfi ssim -f null - 2>&1`,
    { encoding: 'utf8' },
  );
  return parseSsimScore(merged);
}
