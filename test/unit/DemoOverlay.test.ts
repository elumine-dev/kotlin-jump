/**
 * Unit tests for the demo overlay filtergraph builder.
 *
 * Covers the P0 design-system contract: palette, 8-px grid, dual-font,
 * 150 ms fade in/out on every overlay, and the `[base] → [annot]` I/O
 * convention expected by the recorder.
 */

import { describe, it, expect } from 'vitest';
import {
  buildOverlayFilterGraph,
  alphaExpr,
  enableExpr,
  BANNER_W,
  BANNER_H,
  CARD_W,
  CARD_H,
  CARD_Y,
  CAPTION_Y,
  PRIMARY_BLUE,
  BANNER_BG_HEX,
  BANNER_BG_ALPHA,
  TEXT_CODE_LIKE,
} from '../../scripts/demo/lib/overlay';
import type { TimelineEvent } from '../../scripts/demo/lib/timeline';

const FONT_INTER = '/fake/Inter-Regular.ttf';
const FONT_MONO  = '/fake/JetBrainsMono-Regular.ttf';
const OPTS = { fontPath: FONT_INTER, fontPathMono: FONT_MONO };

// ── Design system — palette ──────────────────────────────────────────────────

describe('DemoOverlay — palette (playbook §5)', () => {
  it('click card uses VS Code primary blue 0x007ACC (not legacy 0x0E639C)', () => {
    const ev: TimelineEvent = {
      type: 'click', t: 1200, label: 'Cmd+Click', sublabel: 'fetchUser', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain(PRIMARY_BLUE);
    expect(chain).toContain('0x007ACC');
    expect(chain).not.toContain('0x0E639C');
  });

  it('keystroke banner uses dark grey 0x1E1E1E@0.85', () => {
    const ev: TimelineEvent = {
      type: 'keystroke', t: 0, label: 'Shortcut', sublabel: 'Navigate Back', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain(`${BANNER_BG_HEX}@${BANNER_BG_ALPHA}`);
  });

  it('click sublabel uses code-like grey 0xD4D4D4', () => {
    const ev: TimelineEvent = {
      type: 'click', t: 0, label: 'Cmd+Click', sublabel: 'fetchUser', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain(TEXT_CODE_LIKE);
  });
});

// ── Design system — dual-font (playbook §5) ──────────────────────────────────

describe('DemoOverlay — dual-font', () => {
  it('click sublabel (symbol name) is rendered in JetBrains Mono', () => {
    const ev: TimelineEvent = {
      type: 'click', t: 0, label: 'Cmd+Click', sublabel: 'fetchUser', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    // Find the drawtext segment whose text is 'fetchUser'
    const subSegment = chain
      .split(';')
      .find(s => s.includes("text='fetchUser'"));
    expect(subSegment).toBeDefined();
    expect(subSegment!).toContain(`fontfile='${FONT_MONO}'`);
    expect(subSegment!).not.toContain(`fontfile='${FONT_INTER}'`);
  });

  it('click title (human-readable action) is rendered in Inter', () => {
    const ev: TimelineEvent = {
      type: 'click', t: 0, label: 'Cmd+Click', sublabel: 'fetchUser', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    const titleSegment = chain
      .split(';')
      .find(s => s.includes("text='Cmd+Click'"));
    expect(titleSegment).toBeDefined();
    expect(titleSegment!).toContain(`fontfile='${FONT_INTER}'`);
  });

  it('keystroke banner uses Inter for both title and sublabel', () => {
    const ev: TimelineEvent = {
      type: 'keystroke', t: 0, label: '⌘+⌥+←', sublabel: 'Navigate Back', duration: 2500,
    };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    const interCount = (chain.match(new RegExp(FONT_INTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    const monoCount  = (chain.match(new RegExp(FONT_MONO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    expect(interCount).toBe(2);
    expect(monoCount).toBe(0);
  });

  it('caption uses Inter', () => {
    const ev: TimelineEvent = { type: 'caption', t: 0, label: 'A caption', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain(`fontfile='${FONT_INTER}'`);
    expect(chain).not.toContain(`fontfile='${FONT_MONO}'`);
  });
});

// ── Design system — 8-px grid (playbook §5) ──────────────────────────────────

describe('DemoOverlay — 8-px grid', () => {
  it('banner dimensions are 8-aligned (424×72)', () => {
    expect(BANNER_W % 8).toBe(0);
    expect(BANNER_H % 8).toBe(0);
    expect(BANNER_W).toBe(424); // snapped up from legacy 420
  });

  it('card dimensions are 8-aligned (480×96)', () => {
    expect(CARD_W % 8).toBe(0);
    expect(CARD_H % 8).toBe(0);
    expect(CARD_Y % 8).toBe(0);
  });

  it('caption y is 8-aligned (664)', () => {
    expect(CAPTION_Y % 8).toBe(0);
    expect(CAPTION_Y).toBe(664); // snapped up from legacy 660
  });

  it('generated banner source uses 424x72', () => {
    const ev: TimelineEvent = { type: 'keystroke', t: 0, label: 'x', sublabel: 'y', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain('s=424x72');
  });

  it('generated caption text sits at y=664', () => {
    const ev: TimelineEvent = { type: 'caption', t: 0, label: 'x', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toMatch(/y=664(?!\d)/);
  });
});

// ── Fade in/out (playbook §5 — 150 ms default) ──────────────────────────────

describe('DemoOverlay — fade in/out', () => {
  it('alphaExpr ramps over the default 150 ms fade window', () => {
    const expr = alphaExpr(1000, 2500);
    expect(expr).toContain('/0.150');
    expect(expr).toContain('1.000');   // t0 = 1.000 s
    expect(expr).toContain('3.500');   // t1 = 1.000 + 2.500 = 3.500 s
  });

  it('alphaExpr returns 0 outside the active window (has trailing ,0))', () => {
    const expr = alphaExpr(1000, 2500);
    expect(expr.startsWith('if(between(t\\,')).toBe(true);
    expect(expr.endsWith('\\,0)')).toBe(true);
  });

  it('alphaExpr respects a custom fadeMs override', () => {
    expect(alphaExpr(0, 1000, 300)).toContain('/0.300');
  });

  it('every background source is time-aligned via tpad + fade in/out (alpha baked-in)', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0,    label: 'a', sublabel: 'b', duration: 2500 },
      { type: 'click',     t: 3000, label: 'c', sublabel: 'd', duration: 2500 },
      { type: 'caption',   t: 6000, label: 'e',                duration: 2500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    const sourceSegments = chain.split(';').filter(s => s.startsWith('color=c='));
    expect(sourceSegments.length).toBe(3);
    for (const seg of sourceSegments) {
      expect(seg).toContain('format=yuva420p');
      expect(seg).toContain('tpad=start_duration=');
      expect(seg).toMatch(/fade=t=in:st=[^,]+:d=0\.150:alpha=1/);
      expect(seg).toMatch(/fade=t=out:st=[^,]+:d=0\.150:alpha=1/);
    }
  });

  it('each overlay uses eof_action=pass so the base video survives after the source ends', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0, label: 'a', sublabel: 'b', duration: 2500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toContain('overlay=x=24:y=104:eof_action=pass');
  });

  it('tpad start_duration aligns the source with the main-video timeline', () => {
    const ev: TimelineEvent = { type: 'keystroke', t: 3325, label: 'a', sublabel: 'b', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain('tpad=start_duration=3.325:color=black@0');
    // fade-in starts AT t0 (3.325), fade-out starts at t1-fade (3.325+2.5-0.15=5.675)
    expect(chain).toContain('fade=t=in:st=3.325:d=0.150:alpha=1');
    expect(chain).toContain('fade=t=out:st=5.675:d=0.150:alpha=1');
  });

  it('every drawtext has :alpha=\'…\'', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0,    label: 'a', sublabel: 'b', duration: 2500 },
      { type: 'click',     t: 3000, label: 'c', sublabel: 'd', duration: 2500 },
      { type: 'caption',   t: 6000, label: 'e',                duration: 2500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    const drawtextCount      = (chain.match(/drawtext=/g) ?? []).length;
    const drawtextWithAlpha  = (chain.match(/drawtext=[^;]*:alpha='[^']+'/g) ?? []).length;
    // 2 (banner) + 2 (card) + 1 (caption) = 5
    expect(drawtextCount).toBe(5);
    expect(drawtextWithAlpha).toBe(drawtextCount);
  });

  it('enableExpr matches the between() formula', () => {
    const expr = enableExpr(500, 1500);
    expect(expr).toBe('between(t\\,0.500\\,2.000)');
  });
});

// ── Filtergraph structure ────────────────────────────────────────────────────

describe('DemoOverlay — filter_complex graph', () => {
  it('empty events chain aliases [base] → [annot]', () => {
    const { chain } = buildOverlayFilterGraph([], OPTS);
    expect(chain).toBe('[base]null[annot]');
  });

  it('output label is always [annot]', () => {
    const ev: TimelineEvent = { type: 'caption', t: 0, label: 'x', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toMatch(/\[annot\]\s*$/);
  });

  it('first event consumes the [base] label exactly once', () => {
    const ev: TimelineEvent = { type: 'caption', t: 0, label: 'x', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    const baseRefs = (chain.match(/\[base\]/g) ?? []).length;
    expect(baseRefs).toBe(1);
    expect(chain).toMatch(/\[base\]\[[^\]]+\]overlay/);
  });

  it('chain segments are joined by `;` (filter_complex syntax, not `,`)', () => {
    const evs: TimelineEvent[] = [
      { type: 'keystroke', t: 0,    label: 'a', sublabel: 'b', duration: 2500 },
      { type: 'click',     t: 3000, label: 'c', sublabel: 'd', duration: 2500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    // A filter_complex uses `;` between chains; each chain is a single filter here.
    // With 2 events (each = 3-4 segments) plus the alias tail we expect ≥ 7 segments.
    const segmentCount = chain.split(';').length;
    expect(segmentCount).toBeGreaterThanOrEqual(7);
  });

  it('labels are unique across events (no collision for repeated types)', () => {
    const evs: TimelineEvent[] = [
      { type: 'click', t: 0,    label: 'a', sublabel: 'b', duration: 2500 },
      { type: 'click', t: 3000, label: 'c', sublabel: 'd', duration: 2500 },
    ];
    const { chain } = buildOverlayFilterGraph(evs, OPTS);
    expect(chain).toContain('[cl0_bg]');
    expect(chain).toContain('[cl1_bg]');
    expect(chain).toContain('[cl0_bg_src]');
    expect(chain).toContain('[cl1_bg_src]');
  });
});

// ── Font sizes (playbook §5) ────────────────────────────────────────────────

describe('DemoOverlay — font sizes', () => {
  it('banner title is 28 pt, sublabel 20 pt', () => {
    const ev: TimelineEvent = { type: 'keystroke', t: 0, label: 'a', sublabel: 'b', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    const segments = chain.split(';');
    const titleSeg = segments.find(s => s.includes("text='a'"))!;
    const subSeg   = segments.find(s => s.includes("text='b'"))!;
    expect(titleSeg).toContain('fontsize=28');
    expect(subSeg).toContain('fontsize=20');
  });

  it('card title is 28 pt, sublabel 20 pt', () => {
    const ev: TimelineEvent = { type: 'click', t: 0, label: 'a', sublabel: 'b', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    const segments = chain.split(';');
    const titleSeg = segments.find(s => s.includes("text='a'"))!;
    const subSeg   = segments.find(s => s.includes("text='b'"))!;
    expect(titleSeg).toContain('fontsize=28');
    expect(subSeg).toContain('fontsize=20');
  });

  it('caption text is 22 pt (mobile-safe minimum)', () => {
    const ev: TimelineEvent = { type: 'caption', t: 0, label: 'a caption', duration: 2500 };
    const { chain } = buildOverlayFilterGraph([ev], OPTS);
    expect(chain).toContain('fontsize=22');
  });
});
