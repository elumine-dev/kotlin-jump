import { spawn, ChildProcessWithoutNullStreams, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TimelineEvent } from './timeline';

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
    // `screencapture -v` does NOT consistently overwrite an existing
    // file across macOS versions — some refuse the recording with a
    // silent stderr while the old `.mov` stays on disk. The driver's
    // `if (!fs.existsSync(rawPath))` post-check then passes (the file
    // is the OLD one) and post-process runs on stale content. Remove
    // the file up-front so a fresh capture is the only outcome.
    try { fs.unlinkSync(this.rawPath); } catch { /* did not exist */ }
    const args = [
      '-v',                              // video mode
      '-R', `${x},${y},${width},${height}`,
      '-k',                              // show clicks in the video
      '-C',                              // capture cursor too
      '-x',                              // silent (no shutter sound)
      this.rawPath,
    ];
    // detached:true puts screencapture in its own process group, which lets us
    // kill it AND any helper children with `process.kill(-pgid, sig)`. Without
    // this, a crash that skips our stop() can leave orphans that macOS adopts
    // via launchd — the "shadow on screen" bug. unref() tells Node not to keep
    // the event loop alive for this child; we manage its lifecycle.
    this.proc = spawn('screencapture', args, {
      stdio:    ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    this.proc.stderr.on('data', (chunk: Buffer) => { this.stderrBuf += chunk.toString(); });
    this.proc.unref();
  }

  lastStderr(): string { return this.stderrBuf.slice(-2000); }

  /** Raw PID of the screencapture process (for scoped pkill cleanup). */
  pid(): number | undefined { return this.proc?.pid; }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    const pid  = proc.pid;
    if (pid === undefined) { this.proc = undefined; return; }
    const pgid = -pid;                                                 // negative => process group

    const done = new Promise<void>(resolve => proc.on('exit', () => resolve()));

    // Phase 1: polite SIGINT to the whole group — lets screencapture finalise
    // the .mov cleanly.
    try { process.kill(pgid, 'SIGINT'); } catch { /* already dead */ }
    await Promise.race([done, new Promise<void>(r => setTimeout(r, 5000))]);

    // Phase 2: if still alive, SIGKILL the group AND wait for the OS to deliver
    // it. The previous code resolved as soon as SIGKILL was *sent*, not when
    // the child actually died — which is why orphans survived process exit.
    if (proc.exitCode === null && proc.signalCode === null) {
      try { process.kill(pgid, 'SIGKILL'); } catch { /* already dead */ }
      await Promise.race([done, new Promise<void>(r => setTimeout(r, 2000))]);
    }
    this.proc = undefined;
  }
}

/**
 * 2nd pass: apply a filter_complex graph to the raw capture and write an
 * annotated intermediate file. The graph must consume `[0:v]` (the raw
 * input) and produce a labeled output `[final]` — that label is what we
 * `-map`.
 *
 * Optionally trims the input: `startSec` seeks into the raw video, `durationSec`
 * caps the output length. All timestamps inside `filterComplex` must already
 * be relative to `startSec` (i.e., `t=0` is when the demo begins).
 *
 * `preserveAlpha` switches the output to a MOV container with qtrle (QuickTime
 * Animation, lossless + alpha-native). The MP4+libx264 yuv420p path strips
 * the alpha channel, so any transparent regions produced by the filter graph
 * would get flattened onto black. Pass `true` when the pipeline relies on
 * alpha (e.g., rounded-corner transparency + baked drop shadow).
 */
export function applyOverlays(
  inputMp4:       string,
  filterComplex:  string,
  outputPath:     string,
  opts: {
    startSec?:      number;
    durationSec?:   number;
    preserveAlpha?: boolean;
    /** Additional input files, available in the filter_complex as [1:v], [2:v], …
     *  (in the order supplied). Pass objects (with `loop` / `framerate`) to
     *  normalise still-image inputs' time-base at the demuxer level. */
    extraInputs?:   ReadonlyArray<ExtraInput>;
  } = {},
): void {
  const pre: string[] = [];
  if (opts.startSec    !== undefined) pre.push('-ss', opts.startSec.toFixed(3));
  if (opts.durationSec !== undefined) pre.push('-t',  opts.durationSec.toFixed(3));

  const codecArgs = opts.preserveAlpha
    ? ['-c:v', 'qtrle', '-pix_fmt', 'rgba']
    : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p'];

  const extraInputArgs = expandExtraInputs(opts.extraInputs);

  const args = filterComplex
    ? [
        '-y', ...pre, '-i', inputMp4, ...extraInputArgs,
        '-filter_complex', filterComplex,
        '-map', '[final]',
        ...codecArgs,
        outputPath,
      ]
    : ['-y', ...pre, '-i', inputMp4, '-c:v', 'copy', outputPath];
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
/**
 * Declarative spec for an additional ffmpeg input. Strings remain supported
 * for the trivial "single existing video file" case; objects let callers
 * force `-loop 1` (infinite still frame) and a matching `-framerate N`
 * (time-base alignment with the main video). That fps alignment is what
 * unblocks alphamerge/overlay with static sources — a mismatch between
 * the main video rate, the default PNG demuxer rate, and the filter-graph
 * rate caused the filter to grind for minutes.
 */
export type ExtraInput = string | {
  path:       string;
  loop?:      boolean;
  framerate?: number;
};

function expandExtraInputs(inputs?: ReadonlyArray<ExtraInput>): string[] {
  const args: string[] = [];
  for (const input of inputs ?? []) {
    if (typeof input === 'string') {
      args.push('-i', input);
      continue;
    }
    if (input.loop)      args.push('-loop', '1');
    if (input.framerate) args.push('-framerate', String(input.framerate));
    args.push('-i', input.path);
  }
  return args;
}

/**
 * Single-pass renderer: raw input + filter_complex → animated WebP. Bypasses
 * the alpha-losing MP4 intermediate and the pathologically-large qtrle MOV
 * intermediate. Use when the filter graph produces alpha you want preserved
 * all the way through to the final WebP.
 *
 * ⚠ DEPRECATED — new code should use the 2-pass pipeline in `webp-encoder.ts`
 * (PNG sequence → cwebp per frame → webpmux remux). ffmpeg's libwebp encoder
 * only exposes 5 AVOptions and produces files ~5× larger than `cwebp -m 6`
 * at visually indistinguishable quality. Kept for backwards compatibility
 * and for the `convertToWebP` one-shot path used outside the demo pipeline.
 */
export function renderFilterToWebP(
  inputPath:     string,
  filterComplex: string,
  outputWebp:    string,
  opts: {
    startSec?:    number;
    durationSec?: number;
    extraInputs?: ReadonlyArray<ExtraInput>;
    /** Target WebP dimensions (defaults 960×540). */
    width?:       number;
    height?:      number;
    /** Output frame rate. Default 12 fps (README-friendly size). */
    fps?:         number;
  } = {},
): void {
  fs.mkdirSync(path.dirname(outputWebp), { recursive: true });
  const pre: string[] = [];
  if (opts.startSec    !== undefined) pre.push('-ss', opts.startSec.toFixed(3));
  if (opts.durationSec !== undefined) pre.push('-t',  opts.durationSec.toFixed(3));

  const W = opts.width  ?? 960;
  const H = opts.height ?? 540;
  const fps = opts.fps ?? 12;

  const extraInputArgs = expandExtraInputs(opts.extraInputs);

  // The caller's output is labelled `[final]`. We append an `fps`-first
  // tail: dropping frames BEFORE scale/format means the expensive lanczos
  // scaling only runs on frames we actually keep.
  const fullFilter = `${filterComplex};[final]fps=${fps},scale=${W}:${H}:flags=lanczos,format=yuva420p[webpready]`;

  // Output-duration cap: when any input arrives with `-loop 1` (infinite
  // still), `-shortest` does NOT reliably terminate the encode — ffmpeg
  // pulls forever and the pipeline hangs for minutes. `-t` at the OUTPUT
  // level is enforced correctly (tested: 0.08 s vs. 2 min for a 1 s clip).
  const outTail: string[] = [];
  if (opts.durationSec !== undefined) outTail.push('-t', opts.durationSec.toFixed(3));

  const args = [
    '-y',
    // Thread the complex filter graph. Default is single-threaded even on
    // multi-core hosts; `0` = auto-detect core count. Lifts scale + overlay
    // + alphamerge onto the available cores.
    '-filter_complex_threads', '0',
    ...pre, '-i', inputPath, ...extraInputArgs,
    '-filter_complex', fullFilter,
    '-map', '[webpready]',
    ...outTail,
    // `-vcodec libwebp` — ffmpeg auto-picks `libwebp_anim` internally when
    // multiple frames are muxed. Specifying `libwebp_anim` explicitly +
    // `-t` at output surprisingly yields a single-frame WebP (muxer quirk,
    // reproducible on ffmpeg 8.0), so we stick with the auto-select path.
    '-vcodec', 'libwebp',
    // Lossy RGB. `-compression_level` is NOT exposed by ffmpeg 8.1's libwebp
    // encoder (see `ffmpeg -h encoder=libwebp` — only -lossless, -preset,
    // -cr_threshold, -cr_size, -quality are available). The new canonical
    // pipeline uses the standalone `cwebp` binary via `webp-encoder.ts`,
    // which DOES expose every libwebp knob that matters. This function is
    // kept for legacy single-pass use only.
    '-lossless', '0',
    '-q:v', '55',
    // `-preset picture` tunes libwebp's internal content analysis for
    // photographic / UI captures. Dropping it (as cosmetic noise) was a
    // BAD idea: measured ~22× slowdown on this pipeline (576 ms → 12 800 ms
    // for a 1 s clip). The preset short-circuits entropy/segmentation
    // choices that would otherwise run per frame.
    '-preset', 'picture',
    '-loop', '0',
    '-an',
    // `-fps_mode passthrough` replaces deprecated `-vsync 0`. Our filter
    // tail normalises to `fps`, so passthrough is correct (no dup/drop).
    '-fps_mode', 'passthrough',
    outputWebp,
  ];
  execSync(`ffmpeg ${args.map(a => JSON.stringify(a)).join(' ')}`, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Extract a single frame of an animated WebP as a PNG (with alpha). Used
 * to produce the `<name>-poster.png` accessibility companion for
 * `prefers-reduced-motion`.
 *
 * Why not re-run the filter pipeline for one frame? Because a fresh
 * filter-graph run is susceptible to a first-frame alpha glitch — the
 * cornermask PNG loop and the main video's variable-rate frames don't
 * align at t=0, producing a ~19 % alpha blend on the very first output
 * frame. Pulling from the already-encoded WebP uses a frame that the
 * filter graph emitted AFTER warm-up, so the alpha is clean.
 *
 * Depends on `webpmux` + `dwebp` (ships with libwebp / Homebrew's
 * `webp` formula).
 */
export function extractPosterFromWebP(
  webpPath:   string,
  outputPng:  string,
  frameIndex: number,
): void {
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  const tmpFrame = `${outputPng}.tmp.webp`;
  execSync(
    `webpmux -get frame ${frameIndex} ${JSON.stringify(webpPath)} -o ${JSON.stringify(tmpFrame)}`,
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  execSync(
    `dwebp ${JSON.stringify(tmpFrame)} -o ${JSON.stringify(outputPng)}`,
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  try { fs.unlinkSync(tmpFrame); } catch { /* best-effort cleanup */ }
}

/**
 * Pick the 1-indexed WebP frame to use as the `-poster.png` thumbnail.
 *
 * The heuristic is anchored to the demo's **last narrative event** (the
 * last caption / keystroke / click), captured at 65 % through its
 * visibility window — past the overlay's fade-in (~150 ms), still well
 * before its fade-out (~150 ms), so the overlay text is at peak
 * readability. Then clamped strictly before the video-level fade-to-dark
 * (`fadeOutSec`) so the poster is never in the darkening tail.
 *
 * Why not the simpler "last frame - N" rule?
 *   - Magic numbers (`N = 5`) don't scale with fps or fade duration:
 *     30 fps + 0.5 s fade → frame N-5 is 83 % into the fade.
 *   - The last frame is typically "VS Code in its post-demo state, all
 *     overlays gone" — a visually DEAD thumbnail. We want the last
 *     meaningful narrative beat as the poster.
 *
 * @param events       All timeline events from the recorded demo
 * @param clipSec      Final clip duration in seconds (matches the WebP)
 * @param opts.fps     Output fps (default 12, must match encoder fps)
 * @param opts.fadeOutSec  Duration of the video-level fade-to-dark tail
 * @returns 1-indexed frame number, suitable for `webpmux -get frame N`
 */
export function pickPosterFrame(
  events:   readonly TimelineEvent[],
  clipSec:  number,
  opts: { fps?: number; fadeOutSec?: number } = {},
): number {
  const fps         = opts.fps ?? 12;
  const fadeOutSec  = opts.fadeOutSec ?? 0.5;
  const SAFETY_MS   = 50;  // keep the poster clear of the fade boundary
  const PEAK_RATIO  = 0.65;  // 65 % through an overlay = past fade-in, before fade-out

  // The last narrative event (caption / keystroke / click) is the
  // "aha moment" a README reader should see first. `.pop()` on an empty
  // filtered list returns `undefined`, hence the fallback.
  const lastOverlay = events
    .filter(e => e.type === 'caption' || e.type === 'keystroke' || e.type === 'click')
    .at(-1);

  const fadeStartMs = (clipSec - fadeOutSec) * 1000;
  const maxTimeMs   = Math.max(0, fadeStartMs - SAFETY_MS);
  const minTimeMs   = 1000 / fps;  // frame 2 (avoid the first-frame edge case)

  const targetMs = lastOverlay !== undefined
    ? lastOverlay.t + lastOverlay.duration * PEAK_RATIO
    : clipSec * 1000 * 0.75;  // no narrative events: 75 % through the clip

  const clampedMs = Math.min(Math.max(targetMs, minTimeMs), maxTimeMs);
  return Math.max(2, Math.round(clampedMs / 1000 * fps) + 1);
}

/** Report the number of frames in an animated WebP via `webpmux -info`. */
export function countWebPFrames(webpPath: string): number {
  const out = execSync(
    `webpmux -info ${JSON.stringify(webpPath)}`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const m = out.match(/Number of frames:\s*(\d+)/);
  if (!m) throw new Error(`webpmux -info did not report a frame count for ${webpPath}`);
  return parseInt(m[1], 10);
}

export function convertToWebP(
  inputPath: string,
  outputWebp: string,
  opts: { preserveAlpha?: boolean; width?: number; height?: number } = {},
): void {
  fs.mkdirSync(path.dirname(outputWebp), { recursive: true });
  const W = opts.width  ?? 960;
  const H = opts.height ?? 540;
  // `yuva420p` preserves alpha through libwebp; without it, libwebp silently
  // falls back to yuv420p and our transparent corners become opaque black.
  const pixFmt = opts.preserveAlpha ? 'yuva420p' : 'yuv420p';
  const args = [
    '-y',
    '-i',           inputPath,
    '-vcodec',      'libwebp',
    '-filter:v',    `fps=12,scale=${W}:${H}:flags=lanczos,format=${pixFmt}`,
    '-lossless',    '0',
    // `-compression_level` is a ghost AVOption on ffmpeg 8.1's libwebp —
    // silently ignored. Use `cwebp -m 6` via `webp-encoder.ts` for real
    // compression-level control.
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
