import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CaptureRegion {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

/**
 * Auto-detect the avfoundation video index for "Capture screen 0" on macOS.
 * ffmpeg's `-list_devices true` prints the list on stderr; we parse it.
 */
export function detectScreenCaptureIndex(): number {
  const out = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { encoding: 'utf8' });
  const match = out.match(/\[(\d+)\]\s+Capture screen 0/);
  if (!match) {
    throw new Error(
      'Could not find "Capture screen 0" in ffmpeg avfoundation devices.\n' +
      'Make sure ffmpeg is installed and Terminal/iTerm has Screen Recording permission\n' +
      '(System Settings → Privacy & Security → Screen Recording).',
    );
  }
  return parseInt(match[1], 10);
}

export class FfmpegRecorder {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stderrBuf = '';

  constructor(
    private readonly rawPath: string,
    private readonly region: CaptureRegion,
    private readonly screenIndex: number,
  ) {}

  start(): void {
    const { x, y, width, height } = this.region;
    const args = [
      '-y',
      '-f',            'avfoundation',
      '-framerate',    '30',
      '-capture_cursor','1',
      '-i',            `${this.screenIndex}:none`,
      '-vf',           `crop=${width}:${height}:${x}:${y}`,
      '-pix_fmt',      'yuv420p',
      '-c:v',          'libx264',
      '-preset',       'ultrafast',
      '-crf',          '18',
      this.rawPath,
    ];
    this.proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (chunk: Buffer) => { this.stderrBuf += chunk.toString(); });
  }

  /** Tail of stderr — useful on failure to understand why. */
  lastStderr(): string {
    return this.stderrBuf.slice(-2000);
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    // Send 'q' on stdin for graceful stop, then wait for exit.
    this.proc.stdin.write('q');
    await new Promise<void>(resolve => {
      this.proc!.on('exit', () => resolve());
    });
    this.proc = undefined;
  }
}

/**
 * 2nd pass: apply overlay filter, write annotated mp4.
 * Optionally trims the input: `startSec` seeks into the raw video, `durationSec`
 * caps the output length. Overlay timestamps in `filter` must already be
 * relative to `startSec`.
 */
export function applyOverlays(
  inputMp4:     string,
  filter:       string,
  outputMp4:    string,
  opts: { startSec?: number; durationSec?: number } = {},
): void {
  const pre: string[] = [];
  if (opts.startSec    !== undefined) pre.push('-ss', opts.startSec.toFixed(3));
  if (opts.durationSec !== undefined) pre.push('-t',  opts.durationSec.toFixed(3));

  const args = filter
    ? ['-y', ...pre, '-i', inputMp4, '-vf', filter, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', outputMp4]
    : ['-y', ...pre, '-i', inputMp4, '-c:v', 'copy', outputMp4];
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
