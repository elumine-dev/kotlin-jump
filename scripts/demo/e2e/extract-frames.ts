/**
 * Animated-WebP frame extractor for demo E2E.
 *
 * ffmpeg 8.x can't reliably decode the animated WebPs produced by our
 * pipeline (`image data not found`), so we take the libwebp detour:
 *   webpmux -info                        → frame count
 *   webpmux -get frame N <webp> -o tmp   → single-frame WebP
 *   dwebp tmp.webp -o frame.png          → PNG ready for sampling
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface WebpInfo {
  frameCount:  number;
  canvasW:     number;
  canvasH:     number;
  /** Sum of per-frame durations, in seconds. */
  durationSec: number;
  /** Animated-WebP loop count. `0` = loop forever. */
  loopCount:   number;
}

export function probeWebp(webp: string): WebpInfo {
  const out = execSync(`webpmux -info ${JSON.stringify(webp)}`, { encoding: 'utf8' });

  const frameM  = out.match(/Number of frames:\s*(\d+)/);
  const canvasM = out.match(/Canvas size:\s*(\d+)\s*x\s*(\d+)/);
  const loopM   = out.match(/Loop Count\s*:\s*(\d+)/);
  if (!frameM)  throw new Error(`webpmux -info: no frame count in output`);
  if (!canvasM) throw new Error(`webpmux -info: no canvas size in output`);

  // Each frame line looks like:  "  N:   960   540    no    ...    duration   ..."
  // We sum the per-frame `duration` values (milliseconds) for an accurate total.
  let totalMs = 0;
  for (const line of out.split('\n')) {
    // Match numeric columns: idx W H alpha x y duration …
    const m = line.match(/^\s*\d+:\s+\d+\s+\d+\s+\S+\s+\d+\s+\d+\s+(\d+)/);
    if (m) totalMs += parseInt(m[1], 10);
  }

  return {
    frameCount:  parseInt(frameM[1], 10),
    canvasW:     parseInt(canvasM[1], 10),
    canvasH:     parseInt(canvasM[2], 10),
    durationSec: totalMs / 1000,
    // Non-animated WebPs won't report a loop count; default to 0 (loop-forever)
    // so downstream range checks stay meaningful.
    loopCount:   loopM ? parseInt(loopM[1], 10) : 0,
  };
}

/** Extract a single 1-based frame from an animated WebP to a PNG. */
export function extractFrameAsPng(webp: string, frameNumber: number, outPng: string): void {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const tmpWebp = outPng.replace(/\.png$/i, '.tmp.webp');
  try {
    execSync(
      `webpmux -get frame ${frameNumber} ${JSON.stringify(webp)} -o ${JSON.stringify(tmpWebp)}`,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    execSync(
      `dwebp ${JSON.stringify(tmpWebp)} -o ${JSON.stringify(outPng)}`,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } finally {
    fs.rmSync(tmpWebp, { force: true });
  }
}
