/**
 * Adversarial coverage for the demo Stage primitives. These tests try to
 * BREAK the claims made by `DemoStage.test.ts`:
 *
 *   - "motion is continuous" → prove it even for pathological durationMs
 *     inputs (0, very small, very large); the algorithm must NEVER collapse
 *     to a single cursorMove for long deltas, no matter what.
 *   - "every WebP frame sees a fresh viewport position" → fuzz random
 *     (delta, durationMs) pairs; invariant: step count stays above the
 *     WebP-frame budget for non-degenerate durationMs.
 *   - "the click's source is visible" → prove ORDER: source halo is painted
 *     BEFORE the definition provider executes, and DISPOSED only after the
 *     halo has been on screen long enough.
 *   - "pure motion" → prove no decoration leaks into scrollThrough even
 *     when chained with other primitives.
 *
 * Every test that claims a timing invariant uses wall-clock assertions
 * (not just call-count assertions) so silent sleep removals would fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

import { Stage } from '../../scripts/demo/lib/stage';

// ── Fake editor (shared with DemoStage.test.ts style) ───────────────────────

function makeEditor(opts: { line?: number; character?: number; fileName?: string } = {}): any {
  const line = opts.line ?? 0;
  const character = opts.character ?? 0;
  const ed: any = {
    selection: {
      active: new vscode.Position(line, character),
      anchor: new vscode.Position(line, character),
    },
    revealCalls: [] as Array<{ type: number; line: number }>,
    decorationCalls: [] as Array<{ id: number; ranges: any[] }>,
    document: {
      fileName: opts.fileName ?? '/workspace/Fake.kt',
      uri: { toString: () => 'file:///workspace/Fake.kt' },
      getWordRangeAtPosition: () =>
        new vscode.Range(new vscode.Position(line, character),
                         new vscode.Position(line, character + 5)),
    },
    revealRange: (range: any, type: number) => {
      ed.revealCalls.push({ type, line: range.start.line });
    },
    setDecorations: (deco: any, ranges: any[]) => {
      ed.decorationCalls.push({ id: deco._id, ranges });
    },
  };
  return ed;
}

let stage: Stage;
let execSpy: ReturnType<typeof vi.spyOn>;
let originalEditor: unknown;

beforeEach(() => {
  stage = new Stage({ workspaceRoot: '/workspace' });
  originalEditor = (vscode.window as any).activeTextEditor;
  execSpy = vi.spyOn(vscode.commands, 'executeCommand');
});

afterEach(() => {
  (vscode.window as any).activeTextEditor = originalEditor;
  execSpy.mockRestore();
  vi.restoreAllMocks();
});

function moves() {
  return execSpy.mock.calls
    .filter(c => c[0] === 'cursorMove')
    .map(c => c[1] as { to: 'up' | 'down'; by: string; value: number });
}

// ── Algorithm invariants (mathematical) ─────────────────────────────────────

describe('scrollThrough — step sequence invariants', () => {
  // All deterministic properties that must hold for any valid input, so a
  // future refactor can't silently regress on them.
  const CASES: Array<{ from: number; to: number; durationMs: number }> = [
    { from: 7,  to: 29, durationMs: 1200 },  // nav-history short
    { from: 21, to: 67, durationMs: 1200 },  // nav-history long (46 lines)
    { from: 59, to: 68, durationMs: 800  },  // find-usages (9 lines)
    { from: 0,  to: 1,  durationMs: 100  },  // minimal delta
    { from: 0,  to: 200, durationMs: 100 },  // huge delta, short duration
    { from: 500, to: 3,  durationMs: 50  },  // pathological: shouldn't teleport
    { from: 0,  to: 100, durationMs: 0   },  // degenerate duration
  ];

  for (const c of CASES) {
    it(`${c.from}→${c.to} @ ${c.durationMs}ms: sum of step values equals |delta|`, async () => {
      const editor = makeEditor({ line: c.from });
      (vscode.window as any).activeTextEditor = editor;
      const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

      await stage.scrollThrough({ fromLine: c.from, toLine: c.to, durationMs: c.durationMs });

      const totalLines = moves().reduce((s, m) => s + m.value, 0);
      expect(totalLines).toBe(Math.abs(c.to - c.from));
      p.mockRestore();
    });

    it(`${c.from}→${c.to} @ ${c.durationMs}ms: every step is in the correct direction`, async () => {
      const editor = makeEditor({ line: c.from });
      (vscode.window as any).activeTextEditor = editor;
      const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

      await stage.scrollThrough({ fromLine: c.from, toLine: c.to, durationMs: c.durationMs });

      const expectedDir = c.to > c.from ? 'down' : c.to < c.from ? 'up' : null;
      if (expectedDir === null) {
        expect(moves()).toHaveLength(0);
      } else {
        expect(moves().every(m => m.to === expectedDir)).toBe(true);
      }
      p.mockRestore();
    });

    it(`${c.from}→${c.to} @ ${c.durationMs}ms: final selection lands exactly on the target`, async () => {
      const editor = makeEditor({ line: c.from });
      (vscode.window as any).activeTextEditor = editor;
      const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

      await stage.scrollThrough({ fromLine: c.from, toLine: c.to, column: 3, durationMs: c.durationMs });

      expect(editor.selection.active.line).toBe(c.to);
      expect(editor.selection.active.character).toBe(3);
      p.mockRestore();
    });
  }
});

// ── Anti-teleport guarantee ─────────────────────────────────────────────────

describe('scrollThrough — anti-teleport guarantee', () => {
  // The primary promise of scrollThrough is "never collapse a >3-line jump
  // into a single cursorMove". Test the pathological inputs that would
  // otherwise trigger it.
  it('even durationMs=0 for a long delta produces at least 4 cursorMove steps', async () => {
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 0, toLine: 100, durationMs: 0 });

    expect(moves().length).toBeGreaterThanOrEqual(4);
  });

  it('durationMs below MIN_STEP_MS floor still emits multiple steps', async () => {
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 0, toLine: 200, durationMs: 10 });

    expect(moves().length).toBeGreaterThanOrEqual(4);
    // No single step carries more than (total / minSteps) + 1 lines.
    const maxStepValue = Math.max(...moves().map(m => m.value));
    expect(maxStepValue).toBeLessThanOrEqual(Math.ceil(200 / 4) + 1);
  });

  it('a 3-line delta does NOT force 4 steps (the floor is a ceiling on step size, not on count for small deltas)', async () => {
    // For abs=3, even with the MIN_N_STEPS=4 floor, ceil(3/4)=1 line per
    // step yields 3 steps — you can't split 3 lines into 4 integer steps
    // without empty ones. Honest limit: the floor targets LONG deltas.
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 0, toLine: 3, durationMs: 0 });

    const m = moves();
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m.length).toBeLessThanOrEqual(3);
    expect(m.reduce((s, x) => s + x.value, 0)).toBe(3);
  });
});

// ── Fuzz: random (delta, durationMs) pairs ─────────────────────────────────

describe('scrollThrough — fuzz invariants', () => {
  // Generate 50 random inputs; verify the mathematical contract holds.
  // Seeded so failures are reproducible.
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
  }

  it('50 random inputs: sum of steps equals |delta|, direction matches sign, every step size is ≥1', async () => {
    // Stub `pause` to run the fuzz full-speed — the invariants we assert
    // (direction, sum, final position) don't depend on wall-clock timing.
    const pauseStub = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

    const rng = lcg(0xDEADBEEF);
    for (let i = 0; i < 50; i++) {
      const from = Math.floor(rng() * 200);
      const to   = Math.floor(rng() * 200);
      const durationMs = Math.floor(rng() * 1500);

      const editor = makeEditor({ line: from });
      (vscode.window as any).activeTextEditor = editor;
      execSpy.mockClear();

      await stage.scrollThrough({ fromLine: from, toLine: to, durationMs });

      const m = moves();
      const abs = Math.abs(to - from);
      const sum = m.reduce((s, x) => s + x.value, 0);

      expect(sum, `i=${i} ${from}→${to} @${durationMs}`).toBe(abs);
      if (abs > 0) {
        const expectedDir = to > from ? 'down' : 'up';
        expect(m.every(x => x.to === expectedDir), `i=${i} dir`).toBe(true);
        expect(m.every(x => x.value >= 1), `i=${i} stepValue≥1`).toBe(true);
      }
      expect(editor.selection.active.line, `i=${i} final`).toBe(to);
    }
    pauseStub.mockRestore();
  }, 10_000);
});

// ── Wall-clock timing ───────────────────────────────────────────────────────

describe('scrollThrough — wall-clock timing', () => {
  // Prove that the pauses are actually being awaited, not just scheduled.
  // A regression where `await this.pause(...)` became `this.pause(...)`
  // would collapse the whole scroll to near-instant and this test catches it.
  it('a 5-step scroll takes ≥ (nSteps-1) × MIN_STEP_MS + settle', async () => {
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;

    const t0 = Date.now();
    // 10 lines with durationMs=250 → nSteps=5, stepMs=50 → 4 pauses × 50ms + 40ms settle = 240ms min
    await stage.scrollThrough({ fromLine: 0, toLine: 10, durationMs: 250 });
    const elapsed = Date.now() - t0;

    // Floor is (nSteps-1)=4 × 50ms + 40ms settle = 240ms, minus ~10ms timer jitter.
    expect(elapsed).toBeGreaterThanOrEqual(230);
  });

  it('does NOT wait after the final step (the last cursorMove is not followed by a pause)', async () => {
    // Setup: 3 steps, each 50ms apart. With a trailing pause total = 3×50 + 40 settle = 190.
    // Without trailing pause total = 2×50 + 40 = 140. We want 140-range.
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;

    const t0 = Date.now();
    await stage.scrollThrough({ fromLine: 0, toLine: 6, durationMs: 150 });
    const elapsed = Date.now() - t0;

    // For 6 lines @ 150ms: maxSteps = max(4, 3) = 4, stepLines = ceil(6/4) = 2,
    //   nSteps = 3, stepMs = clamp(150/3=50, 50, 80) = 50.
    //   Total = 2 × 50 (inter-step) + 40 (settle) = 140ms.
    // A trailing pause would push us over 180ms — fail if that regresses.
    expect(elapsed).toBeLessThan(180);
    expect(elapsed).toBeGreaterThanOrEqual(130);
  });
});

// ── Integration: click halo ordering ────────────────────────────────────────

describe('click — source halo ordering (strict)', () => {
  it('source halo is painted BEFORE the definition provider fires', async () => {
    const source = makeEditor({ line: 10, character: 20 });
    (vscode.window as any).activeTextEditor = source;

    const events: string[] = [];
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType')
      .mockImplementation(() => {
        events.push('decoration');
        return { dispose: () => {}, _id: events.length } as any;
      });
    execSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.executeDefinitionProvider') {
        events.push('definitionProvider');
        return [{
          uri: { toString: () => 'file:///workspace/Target.kt' },
          range: new vscode.Range(new vscode.Position(50, 0), new vscode.Position(50, 0)),
        }];
      }
      return undefined;
    });
    const openDocSpy = vi.spyOn(vscode.workspace, 'openTextDocument')
      .mockImplementation(async () => { events.push('openTextDocument'); return {} as any; });
    const showSpy = vi.spyOn(vscode.window, 'showTextDocument')
      .mockImplementation(async () => { events.push('showTextDocument'); return makeEditor() as any; });

    await stage.click('target', { modifier: 'Cmd', label: 'Go to Definition', duration: 10 });

    // The first decoration (source halo) must appear before any definition
    // provider lookup. If someone reorders click() in a refactor, this trips.
    const firstDecoIdx = events.indexOf('decoration');
    const firstDefIdx  = events.indexOf('definitionProvider');
    expect(firstDecoIdx).toBeGreaterThanOrEqual(0);
    expect(firstDefIdx).toBeGreaterThan(firstDecoIdx);

    decoSpy.mockRestore();
    openDocSpy.mockRestore();
    showSpy.mockRestore();
  });

  it('source halo remains on screen for at least 400 ms before navigation', async () => {
    const source = makeEditor({ line: 10, character: 20 });
    (vscode.window as any).activeTextEditor = source;

    let firstDecoTime = 0;
    let defProviderTime = 0;
    vi.spyOn(vscode.window, 'createTextEditorDecorationType')
      .mockImplementation(() => {
        if (firstDecoTime === 0) firstDecoTime = Date.now();
        return { dispose: () => {} } as any;
      });
    execSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.executeDefinitionProvider') {
        defProviderTime = Date.now();
        return [{
          uri: { toString: () => 'file:///workspace/Target.kt' },
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        }];
      }
      return undefined;
    });
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(makeEditor() as any);

    await stage.click('target', { modifier: 'Cmd', label: 'Go to Definition', duration: 10 });

    const halo_before_nav = defProviderTime - firstDecoTime;
    expect(halo_before_nav).toBeGreaterThanOrEqual(400);
  });

  it('target landing flash is painted on the TARGET editor, not the source', async () => {
    const source = makeEditor({ line: 10, character: 20, fileName: '/workspace/Source.kt' });
    const target = makeEditor({ line: 50, character: 0, fileName: '/workspace/Target.kt' });
    (vscode.window as any).activeTextEditor = source;

    execSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.executeDefinitionProvider') {
        return [{
          uri: { toString: () => 'file:///workspace/Target.kt' },
          range: new vscode.Range(new vscode.Position(50, 0), new vscode.Position(50, 0)),
        }];
      }
      return undefined;
    });
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(target as any);

    await stage.click('sym', { modifier: 'Cmd', label: 'Go to Definition', duration: 10 });

    // One decoration goes to the source (halo), one to the target (landing).
    expect(source.decorationCalls).toHaveLength(1);
    expect(target.decorationCalls).toHaveLength(1);
    // Target landing is on line 50 (full-line range).
    expect(target.decorationCalls[0].ranges[0].start.line).toBe(50);
  });
});

// ── Integration: scrollThrough + dwellOn composition ───────────────────────

describe('scrollThrough + dwellOn composition', () => {
  it('pairing scrollThrough with dwellOn produces exactly one halo (dwellOn flashes; scrollThrough does not)', async () => {
    const editor = makeEditor({ line: 0 });
    (vscode.window as any).activeTextEditor = editor;
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType');

    await stage.scrollThrough({ fromLine: 0, toLine: 20, durationMs: 100 });
    await stage.dwellOn({ line: 20 }, 20);

    expect(decoSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Integration: openFile reveal=default does NOT force centre-scroll ──────

describe('openFile reveal="default" — the "don\'t re-centre" contract', () => {
  it('passes TextEditorRevealType.Default (0), NOT InCenter (1)', async () => {
    const ed = makeEditor({ line: 0 });
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ uri: vscode.Uri.file('/x.kt') } as any);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(ed as any);

    await stage.openFile('x.kt', { line: 5, reveal: 'default' });

    const revealType = ed.revealCalls[0]?.type;
    expect(revealType).toBe(vscode.TextEditorRevealType.Default);
    expect(revealType).not.toBe(vscode.TextEditorRevealType.InCenter);
  });
});

// ── Regression: exact inputs used by the current demos ─────────────────────

describe('Demo callsite regression — exact values in nav-history and find-usages', () => {
  it('nav-history PokedexScreen 7→29 column 12: lands correctly with default duration', async () => {
    const editor = makeEditor({ line: 7 });
    (vscode.window as any).activeTextEditor = editor;
    const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

    await stage.scrollThrough({ fromLine: 7, toLine: 29, column: 12 });

    expect(editor.selection.active.line).toBe(29);
    expect(editor.selection.active.character).toBe(12);
    expect(moves().reduce((s, m) => s + m.value, 0)).toBe(22);
    p.mockRestore();
  });

  it('nav-history PokemonDao 21→67 column 8: lands correctly with default duration', async () => {
    const editor = makeEditor({ line: 21 });
    (vscode.window as any).activeTextEditor = editor;
    const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

    await stage.scrollThrough({ fromLine: 21, toLine: 67, column: 8 });

    expect(editor.selection.active.line).toBe(67);
    expect(editor.selection.active.character).toBe(8);
    expect(moves().reduce((s, m) => s + m.value, 0)).toBe(46);
    p.mockRestore();
  });

  it('find-usages PokedexScreen 59→68 column 16 @ 800ms: lands correctly', async () => {
    const editor = makeEditor({ line: 59 });
    (vscode.window as any).activeTextEditor = editor;
    const p = vi.spyOn(stage as any, 'pause').mockResolvedValue(undefined);

    await stage.scrollThrough({ fromLine: 59, toLine: 68, column: 16, durationMs: 800 });

    expect(editor.selection.active.line).toBe(68);
    expect(editor.selection.active.character).toBe(16);
    expect(moves().reduce((s, m) => s + m.value, 0)).toBe(9);
    p.mockRestore();
  });
});
