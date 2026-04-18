import { TimelineEvent } from './timeline';

/**
 * Escape a string for use inside an ffmpeg drawtext `text=...` expression.
 * The escape rules in ffmpeg are finicky — we MUST escape backslash first,
 * then the characters that have special meaning inside the filtergraph syntax.
 */
function escapeForDrawtext(s: string): string {
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g,  '\\\\:')
    .replace(/'/g,  "\\\\\\'")
    .replace(/,/g,  '\\\\,')
    .replace(/%/g,  '\\\\%');
}

function enable(startMs: number, durationMs: number): string {
  const start = (startMs / 1000).toFixed(3);
  const end   = ((startMs + durationMs) / 1000).toFixed(3);
  return `between(t\\,${start}\\,${end})`;
}

export interface OverlayOptions {
  /** Absolute path to the TTF used for all overlay text (Inter-Regular) */
  fontPath: string;
}

/**
 * Build a single ffmpeg `-vf` filter string that renders all timeline overlays
 * on top of the captured video. One pass, one ffmpeg invocation.
 */
export function buildOverlayFilter(events: readonly TimelineEvent[], opts: OverlayOptions): string {
  const parts: string[] = [];
  const font = opts.fontPath;

  for (const ev of events) {
    switch (ev.type) {
      case 'keystroke':
        parts.push(...renderKeystroke(ev, ev.t, font));
        break;
      case 'click':
        parts.push(...renderClick(ev, ev.t, font));
        break;
      case 'caption':
        parts.push(...renderCaption(ev, ev.t, font));
        break;
    }
  }

  return parts.join(',');
}

/* ── Layout constants (for 1280×720 capture) ─────────────────────────────── */

const BANNER_X = 24;
const BANNER_Y = 24;
const BANNER_W = 420;
const BANNER_H = 72;

const CARD_W   = 480;
const CARD_H   = 96;
const CARD_Y   = 560;   // bottom-center ~140 px from bottom

const CAPTION_Y = 660;  // near bottom

/* ── Individual overlay builders ─────────────────────────────────────────── */

function renderKeystroke(ev: TimelineEvent, t: number, font: string): string[] {
  const between = enable(t, ev.duration);
  const main    = escapeForDrawtext(ev.label);
  const sub     = ev.sublabel ? escapeForDrawtext(ev.sublabel) : '';

  const box = `drawbox=x=${BANNER_X}:y=${BANNER_Y}:w=${BANNER_W}:h=${BANNER_H}` +
              `:color=black@0.82:t=fill:enable='${between}'`;
  const title = `drawtext=fontfile='${font}':text='${main}':x=${BANNER_X + 16}:y=${BANNER_Y + 10}` +
                `:fontsize=24:fontcolor=white:enable='${between}'`;
  if (!sub) return [box, title];
  const subline = `drawtext=fontfile='${font}':text='${sub}':x=${BANNER_X + 16}:y=${BANNER_Y + 44}` +
                  `:fontsize=16:fontcolor=0xBBBBBB:enable='${between}'`;
  return [box, title, subline];
}

function renderClick(ev: TimelineEvent, t: number, font: string): string[] {
  const between = enable(t, ev.duration);
  const main    = escapeForDrawtext(ev.label);
  const sub     = ev.sublabel ? escapeForDrawtext(ev.sublabel) : '';

  // NB: inside drawbox, the variable `w` in expressions means the BOX width
  // (which we're defining here = CARD_W), NOT the input frame width. So
  // `x=(w-CARD_W)/2` would collapse to x=0 and the card would cling to the
  // left edge. `iw` explicitly means "input frame width" and avoids that
  // ambiguity. Same pitfall for y with `h`/`ih`.
  const cardX = `(iw-${CARD_W})/2`;

  const box = `drawbox=x=${cardX}:y=${CARD_Y}:w=${CARD_W}:h=${CARD_H}` +
              `:color=0x0E639C@0.92:t=fill:enable='${between}'`;
  const title = `drawtext=fontfile='${font}':text='${main}':x=(w-text_w)/2:y=${CARD_Y + 18}` +
                `:fontsize=22:fontcolor=white:enable='${between}'`;
  if (!sub) return [box, title];
  const subline = `drawtext=fontfile='${font}':text='${sub}':x=(w-text_w)/2:y=${CARD_Y + 56}` +
                  `:fontsize=16:fontcolor=0xD0E6F7:enable='${between}'`;
  return [box, title, subline];
}

function renderCaption(ev: TimelineEvent, t: number, font: string): string[] {
  const between = enable(t, ev.duration);
  const main    = escapeForDrawtext(ev.label);

  // Caption: white text on semi-transparent dark strip, centered near bottom.
  // Use hardcoded 1280×720 dimensions — drawbox doesn't let you reference the
  // input width in its `w` param the same way drawtext does, so we inline.
  const VIDEO_W    = 1280;
  const BOX_PAD    = 40;
  const boxSimple = `drawbox=x=${BOX_PAD}:y=${CAPTION_Y - 8}:w=${VIDEO_W - 2 * BOX_PAD}:h=40` +
                    `:color=black@0.72:t=fill:enable='${between}'`;
  const title = `drawtext=fontfile='${font}':text='${main}':x=(w-text_w)/2:y=${CAPTION_Y}` +
                `:fontsize=22:fontcolor=white:enable='${between}'`;
  return [boxSimple, title];
}
