import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CaptureRegion {
  /** Global desktop X (can be negative or > main-display width on multi-monitor setups) */
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

/**
 * Screen recorder built on macOS' native `screencapture -v -R x,y,w,h`.
 *
 * Unlike `ffmpeg -f avfoundation`, which captures one physical display at a
 * time in display-LOCAL coordinates, `screencapture -R` accepts a rectangle
 * in GLOBAL desktop coordinates and spans multiple displays transparently.
 * That removes all the "which avfoundation index maps to which display"
 * pain on multi-monitor setups.
 *
 * We start the recorder with no duration limit and stop it with SIGINT when
 * the demo completes.
 */
export class ScreenRecorder {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stderrBuf = '';

  constructor(private readonly rawPath: string, private readonly region: CaptureRegion) {}

  start(): void {
    const { x, y, width, height } = this.region;
    const args = [
      '-v',                              // video mode
      '-R', `${x},${y},${width},${height}`,
      '-k',                              // show clicks in the video
      '-C',                              // capture cursor too
      '-x',                              // silent (no shutter sound)
      this.rawPath,
    ];
    this.proc = spawn('screencapture', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (chunk: Buffer) => { this.stderrBuf += chunk.toString(); });
  }

  lastStderr(): string { return this.stderrBuf.slice(-2000); }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    const done = new Promise<void>(resolve => proc.on('exit', () => resolve()));
    proc.kill('SIGINT');
    // Give screencapture up to 5 s to finalise the MOV file; fall back to SIGKILL.
    await Promise.race([
      done,
      new Promise<void>(resolve => setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5000)),
    ]);
    this.proc = undefined;
  }
}

/**
 * 2nd pass: apply a filter_complex graph to the raw capture and write an
 * annotated mp4. The graph must consume `[0:v]` (the raw input) and produce a
 * labeled output `[final]` — that label is what we `-map`.
 *
 * Optionally trims the input: `startSec` seeks into the raw video, `durationSec`
 * caps the output length. All timestamps inside `filterComplex` must already
 * be relative to `startSec` (i.e., `t=0` is when the demo begins).
 */
export function applyOverlays(
  inputMp4:       string,
  filterComplex:  string,
  outputMp4:      string,
  opts: { startSec?: number; durationSec?: number } = {},
): void {
  const pre: string[] = [];
  if (opts.startSec    !== undefined) pre.push('-ss', opts.startSec.toFixed(3));
  if (opts.durationSec !== undefined) pre.push('-t',  opts.durationSec.toFixed(3));

  const args = filterComplex
    ? [
        '-y', ...pre, '-i', inputMp4,
        '-filter_complex', filterComplex,
        '-map', '[final]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
        outputMp4,
      ]
    : ['-y', ...pre, '-i', inputMp4, '-c:v', 'copy', outputMp4];
  execSync(`ffmpeg ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Extract a single frame as PNG, offset from the end of the video. Used to
 * produce a "poster" frame for `prefers-reduced-motion` accessibility
 * fallback (playbook §14). `offsetFromEndSec` defaults to 0.6 s so the poster
 * sits just before the fade-to-dark tail (which would otherwise be black).
 */
export function extractPosterFrame(
  inputMp4:          string,
  outputPng:         string,
  offsetFromEndSec:  number = 0.6,
): void {
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  const args = [
    '-y',
    '-sseof', `-${offsetFromEndSec.toFixed(3)}`,
    '-i',     inputMp4,
    '-frames:v', '1',
    '-q:v',      '2',
    outputPng,
  ];
  execSync(`ffmpeg ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * 3rd pass: convert annotated mp4 to animated WebP.
 *
 * Tuned for README/Marketplace display: 960×540 @ 12 fps, q=55.
 * A 10-second demo at 1280×720 @ 15 fps produced a ~6 MB WebP — way too heavy
 * for a README. Scaling to 540p and dropping to 12 fps brings that under 800 KB
 * while staying perfectly readable.
 */
export function convertToWebP(inputMp4: string, outputWebp: string): void {
  fs.mkdirSync(path.dirname(outputWebp), { recursive: true });
  const args = [
    '-y',
    '-i',           inputMp4,
    '-vcodec',      'libwebp',
    '-filter:v',    'fps=12,scale=960:540:flags=lanczos',
    '-lossless',    '0',
    '-compression_level', '6',
    '-q:v',         '55',
    '-loop',        '0',
    '-preset',      'picture',
    '-an',
    '-vsync',       '0',
    outputWebp,
  ];
  execSync(`ffmpeg ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

export function fileSizeKb(file: string): number {
  return Math.round(fs.statSync(file).size / 1024);
}

/** Probe a container-level duration in seconds. Returns NaN on failure. */
export function probeDurationSec(file: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${JSON.stringify(file)}`,
      { encoding: 'utf8' },
    ).trim();
    const n = parseFloat(out);
    return Number.isFinite(n) ? n : NaN;
  } catch {
    return NaN;
  }
}
