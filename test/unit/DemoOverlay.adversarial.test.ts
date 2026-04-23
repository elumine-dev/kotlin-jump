/**
 * Adversarial tests against the overlay filtergraph builder.
 *
 * Attack surface: `label` / `sublabel` on keystroke + click events get
 * inlined into a `drawtext=text='…'` filter argument. ffmpeg's filter
 * syntax gives special meaning to `:` `'` `,` `%` `\` `;` `[` `]` — a
 * naïve escape function that misses any of those lets a label CLOSE the
 * surrounding filter string and inject another filter. That's the class
 * of bug this file hunts.
 *
 * Captions are NOT covered by these tests because they render through a
 * Skia canvas (render-caption.ts) and the label is passed to `fillText()`,
 * not inlined into the filter string. The PNG bitmap is then attached as
 * a ffmpeg input — the label text never touches the filter parser.
 *
 * Strategy per project memory ("adversarial testing logic"):
 *   - Read the code as an attacker: WHAT characters does `escapeForDrawtext`
 *     actually escape? Anything else makes it through.
 *   - Feed payloads shaped like production strings (`: ; , %`) and exotic
 *     ones (RTL, NULL, newline, very long).
 *   - Verify the resulting filter string is still structurally sane:
 *     single quotes remain balanced, the filtergraph section terminates
 *     with the expected [annot] label.
 *   - Trace through: a malformed filter string would reach ffmpeg at
 *     recording time and kill the pipeline. Better to catch at build
 *     time, with a deterministic unit test.
 */

import { describe, it, expect } from 'vitest';
import { buildOverlayFilterGraph } from '../../scripts/demo/lib/overlay';
import type { TimelineEvent } from '../../scripts/demo/lib/timeline';

const OPTS = { fontPath: '/fake/Inter.ttf', fontPathMono: '/fake/JBM.ttf' };

/** Extract the drawtext segment whose post-escape text contains `needle`. */
function drawtextContaining(chain: string, needle: string): string | undefined {
  return chain.split(';').find(seg => seg.includes('drawtext=') && seg.includes(needle));
}

/** Every single-quoted region must open and close an even number of times. */
function singleQuotesAreBalanced(s: string): boolean {
  // In a filter string, each option value uses a pair of `'`. Unescaped `'`
  // inside would unbalance. We count `'` that are NOT preceded by an
  // even-length run of backslashes (escaped apostrophes).
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") {
      // Count preceding backslashes.
      let bs = 0;
      for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) bs++;
      if (bs % 2 === 0) count++;
    }
  }
  return count % 2 === 0;
}

// ── Injection payloads that MUST be fully escaped ──────────────────────────

describe('ADV-overlay — special chars in event text', () => {
  const payloads: Array<{ label: string; text: string; }> = [
    { label: 'colon',                text: 'a:b' },
    { label: 'apostrophe',           text: "a'b" },
    { label: 'comma',                text: 'a,b' },
    { label: 'percent (drawtext-expansion)',  text: 'a%{n}b' },
    { label: 'backslash',            text: 'a\\b' },
    { label: 'semicolon',            text: 'a;b' },
    { label: 'square brackets',      text: 'a[b]c' },
    { label: 'filter-close attempt', text: "x' enable='0' " },
    { label: 'newline',              text: 'a\nb' },
    { label: 'null byte',            text: 'a\x00b' },
    { label: 'RTL mark',             text: 'a\u200Fb' },
    { label: 'long (200 chars)',     text: 'x'.repeat(200) },
  ];

  for (const p of payloads) {
    it(`${p.label}: filter string stays balanced and ends at [annot]`, () => {
      // Use keystroke (drawtext-based) so the adversarial payload actually
      // reaches the filter string. Captions would detour through Skia.
      const evs: TimelineEvent[] = [
        { type: 'keystroke', t: 0, label: p.text, sublabel: 'sub', duration: 2000 },
      ];
      const { chain } = buildOverlayFilterGraph(evs, OPTS);

      // The chain must still terminate with [annot] — an injection that
      // closed the filter early would derail the label chain.
      expect(chain).toMatch(/\[annot\]\s*$/);
      // Quote balance survived escaping.
      expect(singleQuotesAreBalanced(chain)).toBe(true);
      // The alias segment appears exactly once.
      expect((chain.match(/\]null\[annot\]/g) ?? []).length).toBe(1);
    });
  }

  it("injection attempt with a '+enable=0' payload does NOT produce a real enable=0 option", () => {
    const evs: TimelineEvent[] = [
      // An attacker controls `label`. If escaping were broken, the text
      // value would close, a new option `enable='0'` would start.
      { type: 'keystroke', t: 0, label: "BOOM' :enable='0' :alpha='0'", sublabel: 'x', duration: 2000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    // Our legitimate alpha value contains `alpha='if(...'` — the attack
    // would add ANOTHER alpha= next to it. We make sure the number of
    // alpha='if(between(... openings exactly matches the number of
    // drawtexts (one per drawtext, no extras).
    const drawtextCount = (chain.match(/drawtext=/g) ?? []).length;
    const alphaOpens    = (chain.match(/alpha='if\(between/g) ?? []).length;
    expect(alphaOpens).toBe(drawtextCount);
  });

  it('empty label → drawtext with `text=\'\'` survives (no crash, segment present)', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0, label: '', sublabel: 'x', duration: 2000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toContain("text=''");
    expect(singleQuotesAreBalanced(chain)).toBe(true);
  });

  it('Unicode symbols (⌘ ⌥ ←) pass through unmodified', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0, label: '⌘ + ⌥ + ←', sublabel: 'Navigate Back', duration: 2000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toContain('⌘');
    expect(chain).toContain('⌥');
    expect(chain).toContain('←');
  });
});

// ── Filtergraph structural invariants under varied payloads ────────────────

describe('ADV-overlay — structural invariants under stress', () => {
  it('100 events with pathological labels produce a still-valid chain', () => {
    const evs: TimelineEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const kind: TimelineEvent['type'] = i % 3 === 0 ? 'caption' : (i % 3 === 1 ? 'click' : 'keystroke');
      const base = { t: i * 200, duration: 1000 };
      if (kind === 'caption') evs.push({ ...base, type: 'caption', label: `Cap ${i}: ,'%\\` });
      else                    evs.push({ ...base, type: kind,     label: `Lbl ${i}: ,'%\\`, sublabel: `sub_${i}` });
    }
    const { chain } = buildOverlayFilterGraph(evs, OPTS);

    // Invariants:
    expect(chain).toMatch(/\[annot\]\s*$/);
    expect(singleQuotesAreBalanced(chain)).toBe(true);

    // Exactly one overlay filter per event.
    const overlayCount = (chain.match(/]overlay=/g) ?? []).length;
    expect(overlayCount).toBe(100);

    // Every event source has a complete fade-in/out pair (captions fade their
    // PNG stream, banner/card fade their color-source).
    const fadeInCount  = (chain.match(/fade=t=in:/g) ?? []).length;
    const fadeOutCount = (chain.match(/fade=t=out:/g) ?? []).length;
    expect(fadeInCount).toBe(100);
    expect(fadeOutCount).toBe(100);
  });

  it('click events propagate fontPathMono ONLY to the sublabel drawtext, never the title', () => {
    const evs: TimelineEvent[] = [
      { type: 'click', t: 0, label: 'Title', sublabel: 'mySymbol', duration: 2000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);

    // Title drawtext uses Inter.
    const title = drawtextContaining(chain, "text='Title'");
    expect(title).toBeDefined();
    expect(title!).toContain(`fontfile='${OPTS.fontPath}'`);
    expect(title!).not.toContain(`fontfile='${OPTS.fontPathMono}'`);

    // Sublabel drawtext uses the mono font.
    const sub = drawtextContaining(chain, "text='mySymbol'");
    expect(sub).toBeDefined();
    expect(sub!).toContain(`fontfile='${OPTS.fontPathMono}'`);
    expect(sub!).not.toContain(`fontfile='${OPTS.fontPath}'`);
  });

  it('click without sublabel → no mono-font drawtext emitted (cannot claim a fake symbol name)', () => {
    const evs: TimelineEvent[] = [
      { type: 'click', t: 0, label: 'Title only', duration: 2000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).not.toContain(`fontfile='${OPTS.fontPathMono}'`);
  });

  it('identical label texts on two events still produce unique output labels (no filtergraph collision)', () => {
    const evs: TimelineEvent[] = [
      { type: 'click', t: 0,    label: 'Go', sublabel: 'foo', duration: 1500 },
      { type: 'click', t: 2000, label: 'Go', sublabel: 'foo', duration: 1500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toContain('[cl0_bg]');
    expect(chain).toContain('[cl1_bg]');
    expect(chain).toContain('[cl0_t1]');
    expect(chain).toContain('[cl1_t1]');
  });

  it('all three event types in one chain produce disjoint label prefixes', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0,    label: 'a', sublabel: 'b', duration: 1000 },
      { type: 'click',     t: 1500, label: 'c', sublabel: 'd', duration: 1000 },
      { type: 'caption',   t: 3000, label: 'e',                duration: 1000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toMatch(/\[ks0_bg_src\]/);
    expect(chain).toMatch(/\[cl1_bg_src\]/);
    // Captions no longer use a color source; they prep a PNG stream into cap${idx}_prep.
    expect(chain).toMatch(/\[cap2_prep\]/);
  });
});

// ── Timing / alpha-expression escaping under real events ──────────────────

describe('ADV-overlay — alpha expression reaches every drawtext and NO other filter', () => {
  it('drawtext gets alpha=\'…\'; overlay + color do NOT (they use tpad+fade instead)', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0, label: 'x', sublabel: 'y', duration: 1000 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    // drawtext has alpha=
    expect(chain).toMatch(/drawtext=[^;]*:alpha='/);
    // overlay MUST NOT have alpha= (it has no dynamic-alpha option — that's
    // the bug we patched earlier by switching to tpad+fade on the source).
    expect(chain).not.toMatch(/]overlay=[^;]*:alpha=/);
  });

  it('a zero-duration event still produces finite numbers in its alpha expression (no NaN, no Infinity)', () => {
    const evs: TimelineEvent[] = [
      { type: 'caption', t: 1000, label: 'x', duration: 0 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).not.toMatch(/NaN|Infinity/);
    // t0 and t1 collapse to the same value (1.000).
    expect(chain).toContain('1.000');
  });
});
