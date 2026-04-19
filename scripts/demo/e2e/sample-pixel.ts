/**
 * Pixel sampler for demo E2E assertions.
 *
 * Uses ffmpeg to crop a rectangular region out of a PNG, downsample it to a
 * 1×1 pixel (which yields the area-averaged colour), and emit three bytes of
 * raw rgb24 on stdout. That's the sampled colour. No image-decoding
 * dependency in Node — just spawn ffmpeg.
 */

import { execSync } from 'node:child_process';

export interface Region { x: number; y: number; w: number; h: number }
export interface RGB    { r: number; g: number; b: number }

/**
 * Average RGB of a rectangle (in the PNG's native pixel coords). `region` is
 * clipped against the image bounds by ffmpeg's `crop` filter if it goes out.
 */
export function sampleRegion(pngPath: string, region: Region): RGB {
  const buf = execSync(
    `ffmpeg -v error -i ${JSON.stringify(pngPath)} ` +
    `-vf "crop=${region.w}:${region.h}:${region.x}:${region.y},scale=1:1:flags=area" ` +
    `-pix_fmt rgb24 -f rawvideo -`,
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (buf.length < 3) {
    throw new Error(
      `Insufficient pixel data from ${pngPath} @ (${region.x},${region.y}) ${region.w}×${region.h}: ${buf.length} bytes`,
    );
  }
  return { r: buf[0], g: buf[1], b: buf[2] };
}

/** Probe width and height of a PNG, in native pixels. */
export function pngDimensions(pngPath: string): { w: number; h: number } {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of default=nw=1 ${JSON.stringify(pngPath)}`,
    { encoding: 'utf8' },
  );
  const wm = out.match(/width=(\d+)/);
  const hm = out.match(/height=(\d+)/);
  if (!wm || !hm) throw new Error(`ffprobe did not report dimensions: ${JSON.stringify(out)}`);
  return { w: parseInt(wm[1], 10), h: parseInt(hm[1], 10) };
}

/** Euclidean distance between two RGB colours in the [0,255] cube. */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Parse `#RRGGBB`, `RRGGBB`, or `0xRRGGBB` into an RGB triple. */
export function parseHex(hex: string): RGB {
  const h = hex.replace(/^#|^0x/i, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a #RRGGBB hex colour: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Format an RGB as `rgb(r, g, b)` for HTML reports. */
export function rgbCss(c: RGB): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

/** Scale a region from a logical design space to the actual PNG dimensions. */
export function scaleRegion(region: Region, from: { w: number; h: number }, to: { w: number; h: number }): Region {
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  return {
    x: Math.max(0, Math.round(region.x * sx)),
    y: Math.max(0, Math.round(region.y * sy)),
    w: Math.max(1, Math.round(region.w * sx)),
    h: Math.max(1, Math.round(region.h * sy)),
  };
}

/**
 * ITU-R BT.709 luma coefficients on an RGB value in [0, 255]. Used to
 * detect text-stroke presence: text is light (luma ~255), overlay
 * backgrounds are dark (luma < 120), so an average-luma threshold
 * cleanly separates "some text was rendered" from "only background".
 */
export function luma(c: RGB): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
