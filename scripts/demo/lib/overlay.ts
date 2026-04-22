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
// y=104 puts the banner below VS Code's chrome stack (title ~30 + command
// center ~30 + tab bar ~35 = ~95 px). At y=24 the banner used to cover
// the tab bar entirely — only the inactive tab peeked out on the right.
// 104 is 8×13, grid-compliant, and sits just into the editor area.
export const BANNER_Y = 104;
export const BANNER_W = 424;   // 8×53 — was 420, snapped to grid
export const BANNER_H = 72;    // 8×9

// CARD_W was 480 — too narrow for labels like
// "Click → ⬇ 6 implementations → Go to Implementation" (~700 px at
// fontsize 28). Text is drawn centered on the FULL frame
// (`x=(w-text_w)/2`), so when text_w > CARD_W the label renders OUTSIDE
// the blue card background and bleeds onto the editor code —
// visually broken. 8×100 = 800 fits every demo label in this repo
// with comfortable breathing room; still leaves 240 px margin
// (120 per side) so short labels don't look lost.
export const CARD_W   = 800;   // 8×100
export const CARD_H   = 96;    // 8×12
export const CARD_Y   = 560;   // 8×70

export const CAPTION_Y = 664;  // 8×83 — was 660, snapped to grid
export const CAPTION_BAR_H = 40;
export const CAPTION_BAR_PAD = 40;

/* ── Rounded-corner mask ─────────────────────────────────────────────────── */

/**
 * Rounded-corner radius in 1280×720 render coordinates.
 *
 * Bumped from 12 → 24 so the macOS-style corner is visually OBVIOUS on
 * the final 960×540 WebP (24 × 0.75 scale = 18 px of arc). At the old
 * 12 px value the arc was only ~9 px on the README-rendered WebP, too
 * subtle to read as "rounded window chrome" — the user noticed only
 * pointy corners on dark README backgrounds.
 *
 * Larger radius also prevents any sliver of the recorded macOS desktop
 * bleeding through at the very edge of the video (screencapture -R may
 * include a fraction of the chrome border in some rare positions).
 */
export const CORNER_RADIUS = 24;

export interface CornerMaskOpts {
  width?:    number;
  height?:   number;
  radius?:   number;
  outLabel?: string;
  /** When `false`, emit a single-frame source (no `loop=-1:1:0` tail) so the
   *  caller can apply additional per-frame compute (e.g. gblur) BEFORE
   *  looping. Default `true` — matches the common alphamerge-with-video case
   *  where the mask needs to match every frame of the video. */
  loop?:     boolean;
  /** Output frame rate when `loop=true`. Normalising the looped stream to
   *  the final WebP rate avoids time-base reconciliation cost inside the
   *  main filter graph's `alphamerge` / `overlay` nodes (a disparate fps
   *  between static cornermask and main video caused 2 min+ hangs). */
  fps?:      number;
}

/**
 * Build a filter chain that generates a `[cornermask]` stream — a static
 * GRAYSCALE frame looped to infinity, intended for `alphamerge`:
 *   - Lum = 255 (white) inside the rounded rectangle → pixel becomes fully
 *     opaque after alphamerge (video shows through)
 *   - Lum = 0 (black) in the four corner "triangles" outside the arc →
 *     pixel becomes fully transparent after alphamerge (corner is alpha=0
 *     in the final WebP, lets the README background show through)
 *
 * The caller pipes this through `alphamerge` with the scaled video BEFORE
 * the overlay chain runs, so banners/cards/captions compose on a cleanly-
 * rounded canvas with transparent corners.
 *
 * Perf: one `geq` evaluation for one frame; `loop=-1:size=1` reuses that
 * frame for the whole clip — no per-frame per-pixel cost beyond the
 * alphamerge filter itself.
 */
export function buildCornerMaskFilter(opts: CornerMaskOpts = {}): string {
  const W = opts.width    ?? VIDEO_W;
  const H = opts.height   ?? VIDEO_H;
  const R = opts.radius   ?? CORNER_RADIUS;
  const out = opts.outLabel ?? 'cornermask';

  // Four disjoint corner-region tests. A pixel is MASKED OUT (lum=0,
  // becomes transparent after alphamerge) iff it sits in one of the four
  // R×R corner squares AND outside that corner's circular arc of radius R.
  const r2 = R * R;
  const term = (cxCond: string, cyCond: string, cxExpr: string, cyExpr: string) =>
    `${cxCond}*${cyCond}*gt(pow(${cxExpr}\\,2)+pow(${cyExpr}\\,2)\\,${r2})`;
  const cornerExpr =
    `${term(`lt(X\\,${R})`, `lt(Y\\,${R})`, `X-${R}`,   `Y-${R}`)}` +
    `+${term(`gt(X\\,W-${R})`, `lt(Y\\,${R})`, `X-(W-${R})`, `Y-${R}`)}` +
    `+${term(`lt(X\\,${R})`, `gt(Y\\,H-${R})`, `X-${R}`,   `Y-(H-${R})`)}` +
    `+${term(`gt(X\\,W-${R})`, `gt(Y\\,H-${R})`, `X-(W-${R})`, `Y-(H-${R})`)}`;

  // INVERSE logic vs. the old overlay mask: we want lum=0 (black) in the
  // corner triangles (→ alpha=0 after alphamerge) and lum=255 (white) in
  // the interior (→ alpha=255 after alphamerge, fully opaque video).
  const expr = `if(${cornerExpr}\\,0\\,255)`;

  const fps = opts.fps ?? 12;
  const loopTail = (opts.loop ?? true) ? `,loop=-1:1:0,fps=${fps}` : '';
  // `d=1:r=1` is the canonical "one frame, one second" form — cleaner than
  // `d=0.04:r=25` and identical semantically once `loop=-1:1:0` caches it.
  return (
    `color=c=black:s=${W}x${H}:d=1:r=1,` +
    `format=gray,` +
    `geq=lum='${expr}'` +
    loopTail +
    `[${out}]`
  );
}

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
  // Use a replacement callback so every special char gets EXACTLY one
  // leading backslash in the final filtergraph. Replacement-string
  // literals (`'\\\\:'`, etc.) are easy to over-escape and silently
  // produce `\\:` / `\\,`, which ffmpeg rejects in drawtext text=...
  return s.replace(/[\\:',%]/g, ch => `\\${ch}`);
}
