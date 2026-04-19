/**
 * Byte-level integrity checks for the bundled TTFs.
 *
 * If `Inter-Regular.ttf` or `JetBrainsMono-Regular.ttf` is missing or
 * corrupted, ffmpeg's `drawtext` silently falls back to a serif default.
 * The E2E luma-above assertions still pass (text is still light on dark),
 * but the rendering is wrong — the demo ships with wrong fonts.
 *
 * This test catches that regression at build time, before any recording.
 */

import { describe, it, expect } from 'vitest';
import * as fs   from 'node:fs';
import * as path from 'node:path';

const FIXTURES = path.resolve(__dirname, '..', '..', 'scripts', 'demo', 'fixtures');

const FONTS = [
  { name: 'Inter-Regular.ttf',        minSizeKb: 100 },
  { name: 'JetBrainsMono-Regular.ttf', minSizeKb: 100 },
];

/**
 * TTF/OTF magic header (first 4 bytes):
 *   0x00010000  TrueType
 *   'OTTO'      OpenType with CFF outlines
 *   'true'      legacy Apple TrueType
 *   'typ1'      legacy Apple Type 1
 *   'ttcf'      TrueType Collection
 */
function isValidTtfMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const b0 = buf.readUInt32BE(0);
  if (b0 === 0x00010000) return true;
  const tag = buf.toString('latin1', 0, 4);
  return tag === 'OTTO' || tag === 'true' || tag === 'typ1' || tag === 'ttcf';
}

describe('DemoFonts — bundled TTF integrity', () => {
  for (const f of FONTS) {
    const file = path.join(FIXTURES, f.name);

    it(`${f.name} exists on disk`, () => {
      expect(fs.existsSync(file), `missing font: ${file}`).toBe(true);
    });

    it(`${f.name} is larger than ${f.minSizeKb} KB (catches stub/truncation)`, () => {
      const kb = fs.statSync(file).size / 1024;
      expect(kb, `${f.name} is only ${kb.toFixed(0)} KB — looks truncated`).toBeGreaterThan(f.minSizeKb);
    });

    it(`${f.name} starts with a valid TTF/OTF magic header`, () => {
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(4);
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      expect(isValidTtfMagic(head),
        `${f.name} magic = 0x${head.toString('hex')} — not a TTF/OTF`).toBe(true);
    });
  }
});
