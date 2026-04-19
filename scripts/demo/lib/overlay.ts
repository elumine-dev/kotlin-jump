import { TimelineEvent } from './timeline';

/**
 * ffmpeg filter_complex builder for demo overlays.
 *
 * Design system (see doc/Demo/demo-design-playbook.md §5):
 *   - Palette: VS Code primary blue #007ACC, dark banner #1E1E1E@0.85,
 *     neutral greys for secondary text, monospace grey for code-like text.
 *   - Typography: Inter Regular for prose, JetBrains Mono for symbol names.
 *   - Spacing: 8-px grid, strict.
 *   - Fade: 150 ms in/out on every overlay.
 *
 * Approach — two complementary mechanisms, both fade over 150 ms:
 *   - Background box  : a `color=` source is faded via `tpad + fade:alpha=1`
 *     BEFORE being composed via `overlay`. The ffmpeg `overlay` filter has
 *     no dynamic-alpha input, so the fade must be baked into the source.
 *   - Foreground text : `drawtext` supports a dynamic `alpha=` expression
 *     natively, so we drive it with `alphaExpr(…)` which produces the same
 *     ramp envelope as the source fade.
 *
 * Output contract (used by record.ts):
 *  - Expects input label:  [base]   (produced by `scale=...` upstream)
 *  - Produces output label: [annot] (consumed by a fade-to-dark tail
 *                                    downstream, which then emits [final])
 */

/* ── Design-system constants ─────────────────────────────────────────────── */

export const PRIMARY_BLUE     = '0x007ACC';
export const BANNER_BG_HEX    = '0x1E1E1E';
export const BANNER_BG_ALPHA  = '0.85';
export const CARD_BG_ALPHA    = '0.92';
export const CAPTION_BG_HEX   = '0x000000';
export const CAPTION_BG_ALPHA = '0.72';
export const TEXT_PRIMARY     = '0xFFFFFF';
export const TEXT_SECONDARY   = '0xCCCCCC';
export const TEXT_CODE_LIKE   = '0xD4D4D4';

/* ── Layout (1280×720 frame, 8-px grid) ──────────────────────────────────── */

export const VIDEO_W  = 1280;
export const VIDEO_H  = 720;

export const BANNER_X = 24;
export const BANNER_Y = 24;
export const BANNER_W = 424;   // 8×53 — was 420, snapped to grid
export const BANNER_H = 72;    // 8×9

export const CARD_W   = 480;   // 8×60
export const CARD_H   = 96;    // 8×12
export const CARD_Y   = 560;   // 8×70

export const CAPTION_Y = 664;  // 8×83 — was 660, snapped to grid
export const CAPTION_BAR_H = 40;
export const CAPTION_BAR_PAD = 40;

/* ── Timing ──────────────────────────────────────────────────────────────── */

export const FADE_MS = 150;

export interface OverlayOptions {
  /** Absolute path to Inter-Regular.ttf (overlay prose). */
  fontPath:     string;
  /** Absolute path to JetBrainsMono-Regular.ttf (code-like text: symbol names). */
  fontPathMono: string;
}

export interface OverlayFilterGraph {
  /**
   * A `;`-separated filter_complex chain.
   *   - Consumes input label `[base]`
   *   - Produces output label `[annot]` (the fade-to-dark tail is added by
   *     the caller to produce the final `[final]` output).
   */
  chain: string;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Build the filter_complex graph that renders all timeline overlays on top of
 * the already-scaled base video. Each event contributes:
 *   1. A faded `color=…` source (tpad-delayed, fade in/out baked in).
 *   2. An `overlay=…` that composes it onto the running frame.
 *   3. One or more `drawtext=…:alpha='…'` with a matching fade envelope.
 */
export function buildOverlayFilterGraph(
  events: readonly TimelineEvent[],
  opts: OverlayOptions,
): OverlayFilterGraph {
  const segments: string[] = [];
  let inputLabel = 'base';

  events.forEach((ev, idx) => {
    switch (ev.type) {
      case 'keystroke':
        inputLabel = appendKeystroke(segments, ev, inputLabel, idx, opts);
        break;
      case 'click':
        inputLabel = appendClick(segments, ev, inputLabel, idx, opts);
        break;
      case 'caption':
        inputLabel = appendCaption(segments, ev, inputLabel, idx, opts);
        break;
    }
  });

  // The `null` filter is an identity pass-through; it exists solely to
  // normalise the output label regardless of how many events were rendered.
  segments.push(`[${inputLabel}]null[annot]`);
  return { chain: segments.join(';') };
}

/**
 * Legacy entry point kept for tooling that expected a plain `-vf`-style
 * chain. New code should use `buildOverlayFilterGraph`.
 */
export function buildOverlayFilter(events: readonly TimelineEvent[], opts: OverlayOptions): string {
  return buildOverlayFilterGraph(events, opts).chain;
}

/* ── Expression builders ─────────────────────────────────────────────────── */

/**
 * ffmpeg expression that ramps alpha 0→1 over `fadeMs`, holds at 1, then
 * ramps 1→0 over `fadeMs` before the overlay leaves. Outside the active
 * window the value is 0. Used as the `drawtext.alpha=` expression.
 *
 * Commas are escaped with `\,` so the expression survives every layer of
 * filtergraph parsing, even when nested inside single-quoted option values.
 */
export function alphaExpr(startMs: number, durationMs: number, fadeMs: number = FADE_MS): string {
  const t0   = (startMs / 1000).toFixed(3);
  const t1   = ((startMs + durationMs) / 1000).toFixed(3);
  const fade = (fadeMs / 1000).toFixed(3);
  return `if(between(t\\,${t0}\\,${t1})\\,clip(min(min((t-${t0})/${fade}\\,(${t1}-t)/${fade})\\,1)\\,0\\,1)\\,0)`;
}

/** `between(t, t0, t1)` as an ffmpeg `enable` expression, comma-escaped. */
export function enableExpr(startMs: number, durationMs: number): string {
  const t0 = (startMs / 1000).toFixed(3);
  const t1 = ((startMs + durationMs) / 1000).toFixed(3);
  return `between(t\\,${t0}\\,${t1})`;
}

/**
 * Build the `color=…,format=…,tpad=…,fade=in,fade=out[lbl]` chain that
 * produces a time-delayed, fade-in/out background source ready for `overlay`.
 *
 * The source's internal timeline is aligned with the main video's timeline
 * thanks to `tpad=start_duration=t0`, so the overlay composition needs no
 * further timing logic — just `eof_action=pass` to keep base running after
 * the source ends.
 */
function fadedColorSource(
  hex:        string,
  alphaFrac:  string,
  width:      number,
  height:     number,
  startMs:    number,
  durationMs: number,
  outLabel:   string,
  fadeMs:     number = FADE_MS,
): string {
  const t0       = (startMs / 1000).toFixed(3);
  const durSec   = (durationMs / 1000).toFixed(3);
  const fadeSec  = (fadeMs / 1000).toFixed(3);
  const fadeOutSt = ((startMs + durationMs - fadeMs) / 1000).toFixed(3);
  return (
    `color=c=${hex}@${alphaFrac}:s=${width}x${height}:d=${durSec},` +
    `format=yuva420p,` +
    `tpad=start_duration=${t0}:color=black@0,` +
    `fade=t=in:st=${t0}:d=${fadeSec}:alpha=1,` +
    `fade=t=out:st=${fadeOutSt}:d=${fadeSec}:alpha=1` +
    `[${outLabel}]`
  );
}

/* ── Per-event renderers ─────────────────────────────────────────────────── */

function appendKeystroke(
  segments: string[],
  ev: TimelineEvent,
  inputLabel: string,
  idx: number,
  opts: OverlayOptions,
): string {
  const main   = escapeForDrawtext(ev.label);
  const sub    = ev.sublabel ? escapeForDrawtext(ev.sublabel) : '';
  const alpha  = alphaExpr(ev.t, ev.duration);
  const enable = enableExpr(ev.t, ev.duration);

  const srcLbl = `ks${idx}_bg_src`;
  const postBg = `ks${idx}_bg`;
  const postT1 = `ks${idx}_t1`;
  const postT2 = `ks${idx}_t2`;

  segments.push(fadedColorSource(
    BANNER_BG_HEX, BANNER_BG_ALPHA, BANNER_W, BANNER_H, ev.t, ev.duration, srcLbl,
  ));
  segments.push(
    `[${inputLabel}][${srcLbl}]overlay=x=${BANNER_X}:y=${BANNER_Y}:eof_action=pass[${postBg}]`,
  );
  segments.push(
    `[${postBg}]drawtext=fontfile='${opts.fontPath}':text='${main}'` +
      `:x=${BANNER_X + 16}:y=${BANNER_Y + 12}:fontsize=28` +
      `:fontcolor=${TEXT_PRIMARY}:enable='${enable}':alpha='${alpha}'[${postT1}]`,
  );
  if (!sub) return postT1;
  segments.push(
    `[${postT1}]drawtext=fontfile='${opts.fontPath}':text='${sub}'` +
      `:x=${BANNER_X + 16}:y=${BANNER_Y + 44}:fontsize=20` +
      `:fontcolor=${TEXT_SECONDARY}:enable='${enable}':alpha='${alpha}'[${postT2}]`,
  );
  return postT2;
}

function appendClick(
  segments: string[],
  ev: TimelineEvent,
  inputLabel: string,
  idx: number,
  opts: OverlayOptions,
): string {
  const main   = escapeForDrawtext(ev.label);
  const sub    = ev.sublabel ? escapeForDrawtext(ev.sublabel) : '';
  const alpha  = alphaExpr(ev.t, ev.duration);
  const enable = enableExpr(ev.t, ev.duration);

  const srcLbl = `cl${idx}_bg_src`;
  const postBg = `cl${idx}_bg`;
  const postT1 = `cl${idx}_t1`;
  const postT2 = `cl${idx}_t2`;

  // Use overlay's own variables: W = main width, w = overlay (source) width.
  // `(iw-480)/2` would be conceptually equivalent, but overlay's expression
  // parser fails on a leading `(` in filter_complex context (stripped as a
  // sub-graph delimiter); `(W-w)/2` avoids the problem and is more portable.
  const cardX = `(W-w)/2`;

  segments.push(fadedColorSource(
    PRIMARY_BLUE, CARD_BG_ALPHA, CARD_W, CARD_H, ev.t, ev.duration, srcLbl,
  ));
  segments.push(
    `[${inputLabel}][${srcLbl}]overlay=x=${cardX}:y=${CARD_Y}:eof_action=pass[${postBg}]`,
  );
  // Title — Inter Regular, centered across the full frame (aligns with card).
  segments.push(
    `[${postBg}]drawtext=fontfile='${opts.fontPath}':text='${main}'` +
      `:x=(w-text_w)/2:y=${CARD_Y + 22}:fontsize=28` +
      `:fontcolor=${TEXT_PRIMARY}:enable='${enable}':alpha='${alpha}'[${postT1}]`,
  );
  if (!sub) return postT1;
  // Sublabel = symbol name → JetBrains Mono so it reads as code.
  segments.push(
    `[${postT1}]drawtext=fontfile='${opts.fontPathMono}':text='${sub}'` +
      `:x=(w-text_w)/2:y=${CARD_Y + 62}:fontsize=20` +
      `:fontcolor=${TEXT_CODE_LIKE}:enable='${enable}':alpha='${alpha}'[${postT2}]`,
  );
  return postT2;
}

function appendCaption(
  segments: string[],
  ev: TimelineEvent,
  inputLabel: string,
  idx: number,
  opts: OverlayOptions,
): string {
  const main   = escapeForDrawtext(ev.label);
  const alpha  = alphaExpr(ev.t, ev.duration);
  const enable = enableExpr(ev.t, ev.duration);

  const srcLbl = `cap${idx}_bg_src`;
  const postBg = `cap${idx}_bg`;
  const postT1 = `cap${idx}_t1`;

  const barW = VIDEO_W - 2 * CAPTION_BAR_PAD;
  const barY = CAPTION_Y - 8;

  segments.push(fadedColorSource(
    CAPTION_BG_HEX, CAPTION_BG_ALPHA, barW, CAPTION_BAR_H, ev.t, ev.duration, srcLbl,
  ));
  segments.push(
    `[${inputLabel}][${srcLbl}]overlay=x=${CAPTION_BAR_PAD}:y=${barY}:eof_action=pass[${postBg}]`,
  );
  segments.push(
    `[${postBg}]drawtext=fontfile='${opts.fontPath}':text='${main}'` +
      `:x=(w-text_w)/2:y=${CAPTION_Y}:fontsize=22` +
      `:fontcolor=${TEXT_PRIMARY}:enable='${enable}':alpha='${alpha}'[${postT1}]`,
  );
  return postT1;
}

/* ── Escaping ────────────────────────────────────────────────────────────── */

/**
 * Escape a string for use inside an ffmpeg drawtext `text=...` expression.
 * Backslash first, then the characters with special meaning inside a
 * filtergraph (`:`, `'`, `,`, `%`).
 */
function escapeForDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g,  '\\\\:')
    .replace(/'/g,  "\\\\\\'")
    .replace(/,/g,  '\\\\,')
    .replace(/%/g,  '\\\\%');
}
