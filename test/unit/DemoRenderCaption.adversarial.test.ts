/**
 * Adversarial tests for render-caption.ts.
 *
 * Guards the class of bugs that produced the "text invisible, emoji visible"
 * regression: the Inter font was hard-coded to `path.resolve(__dirname, ...)`
 * with a fixed depth that happened to be right for the unbundled lib but wrong
 * for the bundled record.js, causing Skia to fall back to zero-glyph rendering.
 *
 * The production bug was SILENT — the canvas was written as pill-only, ffmpeg
 * composited a blank bar onto the video, and the final webp had no visible
 * text. These tests turn every silent failure mode into a loud one.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { renderCaptionPng } from '../../scripts/demo/lib/render-caption';

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const CACHE_DIR  = path.join(REPO_ROOT, 'scripts', 'demo', '.cache', 'captions');
const RENDER_JS  = path.join(REPO_ROOT, 'dist', 'demo', 'lib', 'render-caption.js');
const RECORD_JS  = path.join(REPO_ROOT, 'dist', 'demo', 'record.js');
const INTER_PATH = path.join(REPO_ROOT, 'scripts', 'demo', 'fixtures', 'Inter-Regular.ttf');

/** Compute the cache path for a given text + opts the same way the renderer
 *  does. Lets tests surgically clear ONE cache entry without wiping the
 *  directory (which would race with other tests running in parallel). */
function cachePathFor(text: string, opts: {
  width?: number; height?: number; fontSize?: number;
  pillOpacity?: number; pillRadius?: number; pixelRatio?: number;
} = {}): string {
  const o = {
    width:       opts.width       ?? 1200,
    height:      opts.height      ?? 40,
    fontSize:    opts.fontSize    ?? 22,
    pillOpacity: opts.pillOpacity ?? 0.72,
    pillRadius:  opts.pillRadius  ?? 20,
    pixelRatio:  opts.pixelRatio  ?? 1,
  };
  const hash = createHash('sha1')
    .update(JSON.stringify({ text, ...o }))
    .digest('hex')
    .slice(0, 16);
  return path.join(CACHE_DIR, `${hash}.png`);
}

/** Count near-white pixels in a PNG using @napi-rs/canvas. */
async function countWhitePixels(pngPath: string): Promise<{ whitePx: number; peak: number }> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(pngPath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let whitePx = 0, peak = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (l > peak) peak = l;
    if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) whitePx++;
  }
  return { whitePx, peak };
}

/** Render the same caption text + opts via a child `node -e …` invocation
 *  launched from an arbitrary CWD. Proves the module's path resolution
 *  doesn't silently depend on where you called it from. */
function renderViaChild(cwd: string, text: string): string {
  const script = `
    const p = require('${RENDER_JS}').renderCaptionPng(
      ${JSON.stringify(text)},
      { width: 1200, height: 40, fontSize: 22, pillOpacity: 0.72, pillRadius: 20 },
    );
    process.stdout.write(p);
  `;
  const result = spawnSync('node', ['-e', script], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`child render failed from cwd=${cwd}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

// ── Font resolution robustness — the exact bug we just fixed ────────────────

describe('ADV render-caption — font resolution across CWDs + bundle depths', () => {
  // The production bug: dist/demo/record.js bundled render-caption at a
  // shallower __dirname than lib/, and the old `path.resolve(__dirname,
  // '..', '..', '..')` overshot the repo root to a sibling directory.
  // resolveRepoRoot() must now find the right root from any load context.

  // Each test uses a unique text so hashes never collide with other test
  // files running in parallel. We surgically clear only our own cache
  // entry (if it exists) to keep the test deterministic without racing
  // the dir cleanup with other concurrent writers.
  function clearOwn(text: string): void {
    try { rmSync(cachePathFor(text), { force: true }); } catch { /* ignore */ }
  }

  it('renders correctly when loaded from a deep CWD unrelated to the repo', () => {
    const text = 'ADV-font-cwd: deep-cwd variant.';
    clearOwn(text);
    const pngPath = renderViaChild(os.tmpdir(), text);
    expect(existsSync(pngPath)).toBe(true);
    expect(statSync(pngPath).size).toBeGreaterThan(2048);
    expect(pngPath.startsWith(REPO_ROOT)).toBe(true);
  });

  it('renders correctly when loaded from filesystem root (/)', () => {
    const text = 'ADV-font-cwd: root-cwd variant.';
    clearOwn(text);
    const pngPath = renderViaChild('/', text);
    expect(statSync(pngPath).size).toBeGreaterThan(2048);
  });

  it('renders correctly from nested sibling directory', () => {
    const text = 'ADV-font-cwd: nested-sibling variant.';
    clearOwn(text);
    const pngPath = renderViaChild(path.dirname(REPO_ROOT), text);
    expect(statSync(pngPath).size).toBeGreaterThan(2048);
  });

  it('bundled dist/demo/record.js includes the multi-candidate resolver inline', () => {
    // If someone removes resolveRepoRoot() or adds a new entry point that
    // bundles render-caption at yet another depth, this test fires early.
    expect(existsSync(RECORD_JS)).toBe(true);
    const bundled = readFileSync(RECORD_JS, 'utf8');
    expect(bundled).toContain('resolveRepoRoot');
    expect(bundled).toMatch(/candidates\s*=\s*\[/);
  });

  it('ALL bundled CLI entry points have the resolver inlined', () => {
    // The resolver depends on __dirname; each separately-bundled CLI in
    // dist/demo/ has its own __dirname and must carry resolveRepoRoot.
    const cliFiles = ['record.js', 'manual-record.js', 'manual-render.js', 'validate-frames.js', 'e2e.js']
      .map(n => path.join(REPO_ROOT, 'dist', 'demo', n))
      .filter(existsSync);
    expect(cliFiles.length).toBeGreaterThan(0);
    for (const f of cliFiles) {
      const src = readFileSync(f, 'utf8');
      // Only CLIs that actually render captions will have this — check
      // each one that transitively imports render-caption.
      if (src.includes('renderCaptionPng')) {
        expect(src, `${path.basename(f)} missing resolveRepoRoot`).toContain('resolveRepoRoot');
      }
    }
  });
});

// ── Silent-failure detection — canvas validation ────────────────────────────

describe('ADV render-caption — silent failure detection', () => {
  // If Skia ever silently emits a pill-only canvas (missing font, bad
  // fallback, etc.), the validation inside renderCaptionPng must throw
  // instead of writing a broken PNG to cache.

  it('validated canvas has >20 near-white pixels for plain Latin', () => {
    const p = renderCaptionPng('ADV-silent: plain latin check.');
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(2048);
  });

  it('renders emoji-only text without throwing from the lightPx check', () => {
    // Apple Color Emoji bitmaps are COLORED — not "near-white". The
    // validation threshold must not false-positive on emoji-only captions.
    // The 🎯 bullseye has a bright central ring that pushes lightPx above
    // the threshold; other emoji may differ.
    expect(() => renderCaptionPng('🎯')).not.toThrow();
  });

  it('empty text string does not silently produce empty PNG', () => {
    // An empty caption is a caller bug. Skia would render pill only. The
    // validation should throw.
    expect(() => renderCaptionPng('')).toThrow(/no visible text glyphs/);
  });
});

// ── Cache integrity — truncated and atomic writes ───────────────────────────

describe('ADV render-caption — cache integrity', () => {
  it('rejects an under-sized cache file and re-renders', () => {
    // Plant a 500-byte "broken" PNG at the exact hash path. renderCaptionPng
    // should detect it's too small (< MIN_VALID_PNG_BYTES) and re-render.
    const text = 'ADV-cache: truncated re-render test.';
    const good = renderCaptionPng(text);
    expect(statSync(good).size).toBeGreaterThan(2048);

    // Corrupt the cache file to a truncated version.
    writeFileSync(good, Buffer.alloc(500, 0));
    expect(statSync(good).size).toBe(500);

    // Next call must re-render (not return the truncated file).
    const p = renderCaptionPng(text);
    expect(statSync(p).size).toBeGreaterThan(2048);
  });

  it('atomic write leaves no .tmp file for THIS test\'s hash after success', () => {
    const text = 'ADV-cache: atomic-write leftover test.';
    const own = cachePathFor(text);
    // Purge own entry + any stale tmps for this specific hash.
    try { rmSync(own, { force: true }); } catch { /* ignore */ }
    const dir = path.dirname(own);
    if (existsSync(dir)) {
      for (const f of require('node:fs').readdirSync(dir)) {
        if (f.startsWith(path.basename(own) + '.tmp.')) {
          try { rmSync(path.join(dir, f)); } catch { /* ignore */ }
        }
      }
    }
    renderCaptionPng(text);
    const leftoverTmps = existsSync(dir)
      ? require('node:fs').readdirSync(dir)
          .filter((f: string) => f.startsWith(path.basename(own) + '.tmp.'))
      : [];
    expect(leftoverTmps).toEqual([]);
  });

  it('concurrent processes rendering the same caption do not corrupt cache', () => {
    // The atomic-write (write-to-tmp-then-rename) pattern guarantees that
    // concurrent writers never produce a torn file. Each process writes to
    // its own `.tmp.PID` path, then renames. Last writer wins; the winning
    // file is always complete.
    const text = `ADV-cache: concurrent-${process.pid}-${Date.now()}.`;
    const own = cachePathFor(text);
    try { rmSync(own, { force: true }); } catch { /* ignore */ }

    const script = `require('${RENDER_JS}').renderCaptionPng(${JSON.stringify(text)}, { width: 1200, height: 40 });`;
    const children = Array.from({ length: 6 }, () =>
      new Promise<void>((resolve, reject) => {
        const { spawn } = require('node:child_process');
        const p = spawn('node', ['-e', script]);
        p.on('exit', (code: number) => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
      }),
    );
    return Promise.all(children).then(() => {
      // The final winning file at our hash must be complete.
      expect(existsSync(own)).toBe(true);
      expect(statSync(own).size).toBeGreaterThan(2048);
      // No stray .tmp files for our hash.
      const dir = path.dirname(own);
      const tmps = require('node:fs').readdirSync(dir)
        .filter((f: string) => f.startsWith(path.basename(own) + '.tmp.'));
      expect(tmps).toEqual([]);
    });
  }, 15_000);
});

// ── End-to-end pixel sanity — locks the regression to the filter chain ─────

describe('ADV render-caption — pixel-level regression lock', () => {
  it('source caption PNG has text pixels at full luminance', async () => {
    // This is the FIRST pipeline stage. Anything after depends on it.
    // If this regresses, the entire pipeline breaks silently.
    const p = renderCaptionPng('ADV-pixels: plain latin.');
    const { whitePx, peak } = await countWhitePixels(p);
    // Comfortable margins above the 20-pixel lightPx threshold.
    expect(whitePx).toBeGreaterThan(300);
    expect(peak).toBe(255);
  });

  it('source caption PNG with emoji has BOTH white text AND colored pixels', async () => {
    const p = renderCaptionPng('ADV-pixels: latin + emoji. 🎯');
    const { whitePx, peak } = await countWhitePixels(p);
    expect(whitePx).toBeGreaterThan(300);
    expect(peak).toBe(255);

    // Also check emoji rendered (non-neutral chroma somewhere).
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const img = await loadImage(p);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let colorPx = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30) colorPx++;
    }
    expect(colorPx).toBeGreaterThan(20);
  });

  it('Inter-Regular.ttf fixture exists at the expected repo path', () => {
    // If this ever moves or gets cleaned up, every caption breaks. Catch
    // it at test time, not at kjdemo-record time.
    expect(existsSync(INTER_PATH)).toBe(true);
    expect(statSync(INTER_PATH).size).toBeGreaterThan(100_000);
  });
});
