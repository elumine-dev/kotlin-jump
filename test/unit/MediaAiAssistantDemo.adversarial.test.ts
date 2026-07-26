/**
 * Adversarial integration tests for `assets/demos/ai-assistant.webp`.
 *
 * The demo is shipped on the Marketplace (walkthrough → `aiAssistant` step) and
 * embedded in the README, so silent regressions on size, format, animation
 * timing or cross-references would degrade the install-page first impression
 * with no compile-time signal. These tests exercise the actual binary on disk
 * and the actual files that reference it. They are integration tests because
 * they read real bytes from real files — no mocks.
 *
 * Constraints come from these durable rules:
 *   - WOW-factor memory: README embeds must stay under 6 MB and 15 seconds.
 *   - The README embed renders at width=720 — so canvas size and aspect ratio
 *     must look good there.
 *   - Walkthrough JSON and README must remain in sync — renaming the asset
 *     without updating both references is the most likely regression.
 *
 * If a test fails after a deliberate change, update the code AND the test in
 * the same PR — never relax the budget without an explicit conversation.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const ASSET_REL  = 'assets/demos/ai-assistant.webp';
const ASSET_PATH = path.join(REPO_ROOT, ASSET_REL);
const README     = path.join(REPO_ROOT, 'README.md');
const PACKAGE    = path.join(REPO_ROOT, 'package.json');

// ── WebP parser (minimal, RIFF chunk walker) ────────────────────────────────
// Reference: https://developers.google.com/speed/webp/docs/riff_container

interface WebpInfo {
  fileSize:    number;       // RIFF declared size (header field)
  realSize:    number;       // bytes actually on disk
  hasVP8X:     boolean;      // extended (animation) container
  isAnimated:  boolean;      // VP8X animation flag bit
  width:       number;       // canvas width (1-based)
  height:      number;       // canvas height (1-based)
  loopCount:   number;       // 0 = infinite
  frameCount:  number;       // number of ANMF chunks
  totalDurationMs: number;   // sum of ANMF durations
}

function parseWebp(buf: Buffer): WebpInfo {
  if (buf.length < 12) throw new Error('file too small to be a WebP');
  if (buf.toString('ascii', 0, 4)  !== 'RIFF') throw new Error('not a RIFF file');
  if (buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('RIFF but not WEBP');

  const info: WebpInfo = {
    fileSize:        buf.readUInt32LE(4) + 8,
    realSize:        buf.length,
    hasVP8X:         false,
    isAnimated:      false,
    width:           0,
    height:          0,
    loopCount:       -1,
    frameCount:      0,
    totalDurationMs: 0,
  };

  // Walk chunks starting at offset 12 (right after "WEBP" tag)
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourCC = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (fourCC === 'VP8X') {
      info.hasVP8X    = true;
      const flags     = buf.readUInt8(dataOffset);
      info.isAnimated = (flags & 0b00000010) !== 0;
      info.width      = read3LE(buf, dataOffset + 4) + 1;
      info.height     = read3LE(buf, dataOffset + 7) + 1;
    } else if (fourCC === 'ANIM') {
      info.loopCount = buf.readUInt16LE(dataOffset + 4);
    } else if (fourCC === 'ANMF') {
      info.frameCount += 1;
      // ANMF: x(3) y(3) w-1(3) h-1(3) duration(3) flags(1) ... — 16 bytes header
      info.totalDurationMs += read3LE(buf, dataOffset + 12);
    }

    // Chunk size is padded to an even byte boundary
    offset = dataOffset + chunkSize + (chunkSize & 1);
  }

  return info;
}

function read3LE(buf: Buffer, off: number): number {
  return buf.readUInt8(off) | (buf.readUInt8(off + 1) << 8) | (buf.readUInt8(off + 2) << 16);
}

// ── Constants — budget + invariants ─────────────────────────────────────────

/** WOW-factor memory: README embeds must stay under 6 MB. */
const MAX_BYTES = 6 * 1024 * 1024;

/** WOW-factor memory: README embeds must stay under 15 s. */
const MAX_DURATION_MS = 15_000;

/** README embeds at width=720; ratio 1.5–2.0 keeps the screencast legible. */
const MIN_ASPECT = 1.4;
const MAX_ASPECT = 2.1;

/** A real demo has at least 30 frames (~3 s at 100 ms/frame). */
const MIN_FRAMES = 30;

/** Cap frame count at a sane maximum to catch runaway recordings. */
const MAX_FRAMES = 500;

// ── Adversarial integration tests ───────────────────────────────────────────

describe('assets/demos/ai-assistant.webp — adversarial integration', () => {

  // ── ADV-1. File size budget ─────────────────────────────────────────────────

  it('ADV-1. stays under the 6 MB README embed budget', () => {
    const stat = fs.statSync(ASSET_PATH);
    expect.soft(stat.size).toBeLessThanOrEqual(MAX_BYTES);
    // Hard guard: anything > 8 MB definitely broke the budget and needs reduction
    expect(stat.size).toBeLessThan(8 * 1024 * 1024);
    // Lower bound: a near-empty file means the asset was wiped or replaced by accident
    expect(stat.size).toBeGreaterThan(100_000);
  });

  // ── ADV-2. RIFF/WEBP signature integrity (catches renamed-from-MP4 etc.) ────

  it('ADV-2. has a valid RIFF/WEBP signature and the declared size matches the file', () => {
    const buf = fs.readFileSync(ASSET_PATH);
    const info = parseWebp(buf);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
    // The RIFF header declares the file size; allow a 1-byte slack for odd-padded chunks
    expect(Math.abs(info.fileSize - info.realSize)).toBeLessThanOrEqual(1);
    // It MUST be the extended container (VP8X) — animation requires it
    expect(info.hasVP8X).toBe(true);
  });

  // ── ADV-3. Animation properties (loops infinitely, sane frame count + duration) ─

  it('ADV-3. animates with infinite loop, sane frame count, total duration under budget', () => {
    const buf  = fs.readFileSync(ASSET_PATH);
    const info = parseWebp(buf);

    expect(info.isAnimated).toBe(true);                              // VP8X animation flag set
    expect(info.loopCount).toBe(0);                                  // 0 = loop forever (Marketplace needs this)
    expect(info.frameCount).toBeGreaterThanOrEqual(MIN_FRAMES);
    expect(info.frameCount).toBeLessThanOrEqual(MAX_FRAMES);
    expect(info.totalDurationMs).toBeGreaterThan(2_000);             // a 2 s demo is too short to read
    expect(info.totalDurationMs).toBeLessThanOrEqual(MAX_DURATION_MS); // strict 15 s budget

    // Per-frame duration sanity: avoid 1 ms ultra-fast frames that read as a flicker.
    const avgFrameMs = info.totalDurationMs / info.frameCount;
    expect(avgFrameMs).toBeGreaterThan(20);                          // ≥ 50 fps cap
    expect(avgFrameMs).toBeLessThan(500);                            // ≤ 2 fps floor (anything slower = jerky)
  });

  // ── ADV-4. Canvas dimensions look right at 720px embed width ────────────────

  it('ADV-4. canvas size is rectangular landscape with a 1.4–2.1 aspect ratio', () => {
    const buf  = fs.readFileSync(ASSET_PATH);
    const info = parseWebp(buf);

    expect(info.width).toBeGreaterThanOrEqual(640);                  // ≥ 640 px wide
    expect(info.width).toBeLessThanOrEqual(2560);                    // < 4K (file size would balloon)
    expect(info.height).toBeGreaterThan(0);
    expect(info.height).toBeLessThanOrEqual(1600);

    const aspect = info.width / info.height;
    expect(aspect).toBeGreaterThanOrEqual(MIN_ASPECT);
    expect(aspect).toBeLessThanOrEqual(MAX_ASPECT);

    // 720 px embed: avoid wild upscales — the recorded width must be ≥ 720.
    expect(info.width).toBeGreaterThanOrEqual(720);
  });

  // ── ADV-5. Cross-reference integrity (README + walkthrough stay in sync) ───

  it('ADV-5. is referenced from README.md and package.json walkthrough, both pointing at an existing file', () => {
    const readme = fs.readFileSync(README, 'utf8');
    const pkg    = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));

    // README — exactly one <img> embedding the asset on the main branch
    const readmeMatches = readme.match(
      /raw\.githubusercontent\.com\/[^"]+\/main\/assets\/demos\/ai-assistant\.webp/g,
    );
    expect(readmeMatches?.length ?? 0).toBeGreaterThanOrEqual(1);

    // package.json — walkthrough step `aiAssistant` must reference the same asset
    const steps = pkg?.contributes?.walkthroughs?.flatMap((w: any) => w.steps ?? []) ?? [];
    const aiStep = steps.find((s: any) => s.id === 'aiAssistant');
    expect(aiStep, 'walkthrough step `aiAssistant` must exist in package.json').toBeDefined();
    expect(aiStep.media?.image).toBe(ASSET_REL);
    expect(typeof aiStep.media?.altText).toBe('string');
    expect(aiStep.media.altText.length).toBeGreaterThan(5);

    // The referenced file must actually exist (catches renames / accidental deletes)
    expect(fs.existsSync(ASSET_PATH)).toBe(true);

    // .vscodeignore must NOT exclude the asset (it ships in the VSIX)
    const ignorePath = path.join(REPO_ROOT, '.vscodeignore');
    if (fs.existsSync(ignorePath)) {
      const ignore = fs.readFileSync(ignorePath, 'utf8');
      const lines = ignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      // vsce applies patterns in order with gitignore semantics: a `!`
      // negation AFTER a broad exclusion re-includes the file. Since
      // 25/07, assets/demos/** is excluded wholesale and only the
      // runtime-consumed webps are negated back in.
      let excluded = false;
      for (const pat of lines) {
        if (pat === `!${ASSET_REL}` || pat === '!**/ai-assistant.webp') excluded = false;
        else if (
          pat === ASSET_REL ||
          pat === 'assets/**' ||
          pat === 'assets/demos/**' ||
          pat === 'assets/demos/*.webp' ||
          pat === '**/ai-assistant.webp'
        ) excluded = true;
      }
      expect(excluded, '.vscodeignore must not exclude the demo asset').toBe(false);
    }
  });
});
