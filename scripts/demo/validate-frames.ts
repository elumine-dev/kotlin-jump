/**
 * Visual-regression helper for demo WebP outputs.
 *
 *   npx tsx scripts/demo/validate-frames.ts media/demos/<name>.webp
 *
 * Extracts three PNG frames from the given video — first, middle, last —
 * into `./tmp-demo-frames/<name>/` so you can eyeball whether a recording
 * matches the playbook expectations (palette, fade, font, pulse) without
 * opening the animation frame-by-frame in a browser.
 *
 * Handles both animated WebP (via `webpmux -get frame N` + `dwebp`) and MP4
 * (via `ffprobe` + `ffmpeg -ss`). ffmpeg itself cannot decode our animated
 * WebPs reliably, hence the libwebp detour for that branch.
 *
 * PNGs are written to a dedicated tmp dir that the repo's global gitignore
 * covers (`tmp-*`); nothing is ever committed by this script.
 */

import * as fs   from 'node:fs';
import * as os   from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[validate-frames] ${msg}`);
  process.exit(1);
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[validate-frames] ${msg}`);
}

function kb(file: string): number {
  return Math.round(fs.statSync(file).size / 1024);
}

/* ── WebP branch (animated) ──────────────────────────────────────────────── */

interface WebpInfo { frameCount: number; canvas: string }

function webpInfo(file: string): WebpInfo {
  const out = execSync(`webpmux -info ${JSON.stringify(file)}`, { encoding: 'utf8' });
  const frameMatch = out.match(/Number of frames:\s*(\d+)/);
  const canvasMatch = out.match(/Canvas size:\s*(\S+\s*x\s*\S+)/);
  if (!frameMatch) die(`webpmux -info did not report frame count for ${file}`);
  return {
    frameCount: parseInt(frameMatch[1], 10),
    canvas:     canvasMatch?.[1] ?? 'unknown',
  };
}

function extractWebpFrame(input: string, frameNumber: number, outputPng: string): void {
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  const tmp = path.join(os.tmpdir(), `kj-validate-${process.pid}-${frameNumber}.webp`);
  try {
    execSync(
      `webpmux -get frame ${frameNumber} ${JSON.stringify(input)} -o ${JSON.stringify(tmp)}`,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    execSync(
      `dwebp ${JSON.stringify(tmp)} -o ${JSON.stringify(outputPng)}`,
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ── MP4 branch (duration-based seek) ────────────────────────────────────── */

function probeMp4DurationSec(file: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${JSON.stringify(file)}`,
    { encoding: 'utf8' },
  ).trim();
  const n = parseFloat(out);
  if (!Number.isFinite(n) || n <= 0) die(`ffprobe returned unusable duration: ${JSON.stringify(out)}`);
  return n;
}

function extractMp4Frame(input: string, seekSec: number, outputPng: string): void {
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  const args = [
    '-y',
    '-ss', seekSec.toFixed(3),
    '-i',  input,
    '-frames:v', '1',
    '-q:v',      '2',
    outputPng,
  ];
  execSync(`ffmpeg ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/* ── Entry point ─────────────────────────────────────────────────────────── */

function main(): void {
  const input = process.argv[2];
  if (!input) die('usage: validate-frames.ts <path-to-webp-or-mp4>');
  if (!fs.existsSync(input)) die(`file not found: ${input}`);

  const stem = path.basename(input).replace(/\.(webp|mp4|mov)$/i, '');
  const outDir = path.resolve(process.cwd(), 'tmp-demo-frames', stem);
  fs.mkdirSync(outDir, { recursive: true });

  const isWebp = /\.webp$/i.test(input);

  if (isWebp) {
    const info = webpInfo(input);
    log(`${input} → animated WebP, ${info.frameCount} frames, canvas ${info.canvas}`);

    const frames: Array<{ label: string; frameNumber: number }> = [
      { label: 'first',  frameNumber: 1 },
      { label: 'middle', frameNumber: Math.max(1, Math.floor(info.frameCount / 2)) },
      { label: 'last',   frameNumber: info.frameCount },
    ];

    log(`Writing frames to ${outDir}`);
    for (const f of frames) {
      const outPng = path.join(outDir, `${f.label}.png`);
      extractWebpFrame(input, f.frameNumber, outPng);
      log(`  ✓ ${f.label.padEnd(7)} frame ${f.frameNumber.toString().padStart(3)}  →  ${path.basename(outPng)}  (${kb(outPng)} KB)`);
    }
  } else {
    const duration = probeMp4DurationSec(input);
    log(`${input} → duration ${duration.toFixed(2)}s`);

    const frames: Array<{ label: string; seekSec: number }> = [
      { label: 'first',  seekSec: Math.min(0.5, duration * 0.1) },
      { label: 'middle', seekSec: duration * 0.5 },
      { label: 'last',   seekSec: Math.max(0, duration - 0.6) },
    ];

    log(`Writing frames to ${outDir}`);
    for (const f of frames) {
      const outPng = path.join(outDir, `${f.label}.png`);
      extractMp4Frame(input, f.seekSec, outPng);
      log(`  ✓ ${f.label.padEnd(7)} @ t=${f.seekSec.toFixed(2)}s  →  ${path.basename(outPng)}  (${kb(outPng)} KB)`);
    }
  }

  // Surface the poster PNG if record.ts produced one — useful as a baseline
  // for prefers-reduced-motion fallback.
  const posterPng = input.replace(/\.(webp|mp4|mov)$/i, '-poster.png');
  if (fs.existsSync(posterPng)) {
    log(`  (poster: ${posterPng}, ${kb(posterPng)} KB — use for prefers-reduced-motion)`);
  }

  log('done — open the PNGs and eyeball against the playbook checklist (§13).');
}

main();
