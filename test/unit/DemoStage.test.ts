/**
 * Unit coverage for the motion + feedback primitives in
 * `scripts/demo/lib/stage.ts`:
 *
 *   - `scrollThrough` — duration-driven continuous scroll. The step size and
 *     inter-step delay are derived from `durationMs` so every WebP frame
 *     (@ 12 fps ≈ 83 ms/frame) catches the viewport at a distinct position.
 *     We assert the motion contract: right direction, sum equals total
 *     lines, final selection lands on (toLine, column), pure-motion (no
 *     decoration).
 *   - `dwellOn` — narrative accent: halo + pause.
 *   - `click` — must flash a word-sized halo at the SOURCE position before
 *     navigating, otherwise the card overlay announces "Cmd+Click on X"
 *     with no visible confirmation on the editor surface.
 *   - `openFile` `reveal` option — `'if-offscreen'` / `'default'` / `'center'`
 *     map to the matching `TextEditorRevealType`.
 *
 * The tests stub `vscode.window.activeTextEditor` (the mock leaves it
 * `undefined`) and spy on `vscode.commands.executeCommand` to inspect the
 * step sequence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

import { Stage } from '../../scripts/demo/lib/stage';

// ── Fake editor that records selection + revealRange + decoration calls ────

interface FakeEditor {
  selection: { active: { line: number; character: number } };
  revealCalls: Array<{ type: number; line: number }>;
  decorationCalls: Array<{ ranges: any[] }>;
  document: {
    fileName: string;
    uri: unknown;
    getWordRangeAtPosition?: (pos: vscode.Position) => vscode.Range | undefined;
  };
}

function makeEditor(opts: {
  line?:       number;
  character?:  number;
  fileName?:   string;
  wordRange?:  vscode.Range;
} = {}): FakeEditor {
  const line = opts.line ?? 0;
  const character = opts.character ?? 0;
  const ed: any = {
    selection: {
      active: new vscode.Position(line, character) as any,
      anchor: new vscode.Position(line, character) as any,
    },
    revealCalls: [] as Array<{ type: number; line: number }>,
    decorationCalls: [] as Array<{ ranges: any[] }>,
    document: {
      fileName: opts.fileName ?? '/workspace/Fake.kt',
      uri: { toString: () => 'file:///workspace/Fake.kt' },
      getWordRangeAtPosition: (_pos: vscode.Position) =>
        opts.wordRange ?? new vscode.Range(
          new vscode.Position(line, character),
          new vscode.Position(line, character + 5),
        ),
    },
    revealRange: (range: any, type: number) => {
      ed.revealCalls.push({ type, line: range.start.line });
    },
    setDecorations: (_deco: any, ranges: any[]) => {
      ed.decorationCalls.push({ ranges });
    },
  };
  return ed as FakeEditor;
}

// ── Harness ────────────────────────────────────────────────────────────────

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
});

// ── scrollThrough ──────────────────────────────────────────────────────────

function cursorMoveCalls() {
  return execSpy.mock.calls.filter(c => c[0] === 'cursorMove');
}

describe('Stage.scrollThrough — duration-driven continuous scroll', () => {
  it('descends 22 lines with the full delta split across cursorMove calls', async () => {
    const editor = makeEditor({ line: 7 });
    (vscode.window as any).activeTextEditor = editor;

    // 100ms duration → exactly 2 steps of 11 lines each (deterministic).
    await stage.scrollThrough({ fromLine: 7, toLine: 29, column: 12, durationMs: 100 });

    const moves = cursorMoveCalls();
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(c => (c[1] as any).to === 'down')).toBe(true);
    const totalLines = moves.reduce((s, c) => s + ((c[1] as any).value as number), 0);
    expect(totalLines).toBe(22);
  });

  it('ascends with to="up" when the delta is negative', async () => {
    const editor = makeEditor({ line: 67 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 67, toLine: 46, durationMs: 100 });

    const moves = cursorMoveCalls();
    expect(moves.every(c => (c[1] as any).to === 'up')).toBe(true);
    const totalLines = moves.reduce((s, c) => s + ((c[1] as any).value as number), 0);
    expect(totalLines).toBe(21);
  });

  it('yields ≥ N steps for a long scroll so each WebP frame (@ 12 fps) sees a fresh viewport position', async () => {
    const editor = makeEditor({ line: 21 });
    (vscode.window as any).activeTextEditor = editor;

    // 1200 ms @ 12 fps ≈ 14 frames. Algo targets 50-80 ms/step, so 46-line
    // descent yields ~23 steps — nearly double the frame count.
    await stage.scrollThrough({ fromLine: 21, toLine: 67, column: 8, durationMs: 1200 });

    const moves = cursorMoveCalls();
    expect(moves.length).toBeGreaterThanOrEqual(14);
    const totalLines = moves.reduce((s, c) => s + ((c[1] as any).value as number), 0);
    expect(totalLines).toBe(46);
  }, 10_000);

  it('resets the final selection to (toLine, column)', async () => {
    const editor = makeEditor({ line: 21 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 21, toLine: 67, column: 8, durationMs: 100 });

    expect(editor.selection.active.line).toBe(67);
    expect(editor.selection.active.character).toBe(8);
  });

  it('short duration still produces at least one cursorMove for any non-zero delta', async () => {
    const editor = makeEditor({ line: 7 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 7, toLine: 10, durationMs: 50 });

    expect(cursorMoveCalls().length).toBeGreaterThan(0);
    expect(editor.selection.active.line).toBe(10);
  });

  it('short-circuits a zero-delta call — no cursorMove, no decoration', async () => {
    const editor = makeEditor({ line: 42 });
    (vscode.window as any).activeTextEditor = editor;

    await stage.scrollThrough({ fromLine: 42, toLine: 42, durationMs: 100 });

    expect(cursorMoveCalls()).toHaveLength(0);
  });
});

describe('Stage.scrollThrough — pure-motion contract (no flash)', () => {
  // Narrative accent is dwellOn's job; stacking a flash in scrollThrough
  // would double up the halo when callers pair the two (and also clash
  // with waitForEditor's auto-flash downstream).
  it('does not create any decoration type during the scroll', async () => {
    const editor = makeEditor({ line: 7 });
    (vscode.window as any).activeTextEditor = editor;
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType');

    await stage.scrollThrough({ fromLine: 7, toLine: 29, durationMs: 100 });

    expect(decoSpy).not.toHaveBeenCalled();
    decoSpy.mockRestore();
  });
});

describe('Stage.scrollThrough — failure mode', () => {
  it('throws a readable error when no editor is active', async () => {
    (vscode.window as any).activeTextEditor = undefined;

    await expect(stage.scrollThrough({ fromLine: 0, toLine: 10, durationMs: 50 }))
      .rejects.toThrow(/no active editor/);
  });
});

// ── dwellOn ────────────────────────────────────────────────────────────────

describe('Stage.dwellOn', () => {
  it('flashes the landing line and awaits the requested duration', async () => {
    const editor = makeEditor({ line: 29 });
    (vscode.window as any).activeTextEditor = editor;
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType');

    const t0 = Date.now();
    await stage.dwellOn({ line: 29 }, 60);
    const elapsed = Date.now() - t0;

    expect(decoSpy).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeGreaterThanOrEqual(55);  // 60 ms with ~5 ms timer jitter
    decoSpy.mockRestore();
  });

  it('is a no-op on the flash when no editor is active (still pauses)', async () => {
    (vscode.window as any).activeTextEditor = undefined;
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType');

    await stage.dwellOn({ line: 7 }, 10);

    expect(decoSpy).not.toHaveBeenCalled();
    decoSpy.mockRestore();
  });
});

// ── click source halo ──────────────────────────────────────────────────────

describe('Stage.click — source halo makes the click visible', () => {
  // The card overlay announces "Cmd+Click on X" but without a source halo
  // nothing on the editor surface confirms WHERE the click landed — the
  // viewer has to infer from the card text alone. `flashClickSource` paints
  // a strong word-sized halo at the caret position BEFORE the navigation
  // fires.
  it('creates exactly one source halo at the word range BEFORE the target landing flash', async () => {
    const sourceEditor = makeEditor({
      line: 10, character: 20,
      wordRange: new vscode.Range(
        new vscode.Position(10, 18),
        new vscode.Position(10, 25),
      ),
    });
    (vscode.window as any).activeTextEditor = sourceEditor;

    // Fake definition provider: single result pointing at Target.kt:50.
    const targetUri = { toString: () => 'file:///workspace/Target.kt' };
    execSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.executeDefinitionProvider') {
        return [{
          uri: targetUri,
          range: new vscode.Range(new vscode.Position(50, 4), new vscode.Position(50, 10)),
        }];
      }
      return undefined;
    });

    const targetEditor = makeEditor({ line: 50, fileName: '/workspace/Target.kt' });
    const openDocSpy = vi.spyOn(vscode.workspace, 'openTextDocument')
      .mockResolvedValue({ uri: targetUri } as any);
    const showSpy = vi.spyOn(vscode.window, 'showTextDocument')
      .mockResolvedValue(targetEditor as any);
    const decoSpy = vi.spyOn(vscode.window, 'createTextEditorDecorationType');

    await stage.click('releasePokemon', {
      modifier: 'Cmd',
      label:    'Go to Definition',
      duration: 100,
    });

    // Two decorations total: (1) source halo, (2) landing flash.
    expect(decoSpy).toHaveBeenCalledTimes(2);

    // The source halo was painted on the word range (positions 18..25), not
    // the full line — that's the visual cue that says "clicked HERE".
    const sourceDecoCall = sourceEditor.decorationCalls[0];
    expect(sourceDecoCall).toBeDefined();
    const sourceRange = sourceDecoCall!.ranges[0];
    expect(sourceRange.start.line).toBe(10);
    expect(sourceRange.start.character).toBe(18);
    expect(sourceRange.end.character).toBe(25);

    openDocSpy.mockRestore();
    showSpy.mockRestore();
    decoSpy.mockRestore();
  });

  it('falls back gracefully when the caret is not on a word', async () => {
    const sourceEditor = makeEditor({ line: 10, character: 4 });
    // Force getWordRangeAtPosition to return undefined (cursor on whitespace).
    (sourceEditor.document as any).getWordRangeAtPosition = () => undefined;
    (vscode.window as any).activeTextEditor = sourceEditor;

    execSpy.mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.executeDefinitionProvider') {
        return [{
          uri: { toString: () => 'file:///workspace/Target.kt' },
          range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        }];
      }
      return undefined;
    });

    const openDocSpy = vi.spyOn(vscode.workspace, 'openTextDocument')
      .mockResolvedValue({} as any);
    const showSpy = vi.spyOn(vscode.window, 'showTextDocument')
      .mockResolvedValue(makeEditor() as any);

    await expect(stage.click('target', {
      modifier: 'Cmd', label: 'Go to Definition', duration: 10,
    })).resolves.not.toThrow();

    openDocSpy.mockRestore();
    showSpy.mockRestore();
  });
});

// ── openFile reveal option ─────────────────────────────────────────────────

describe('Stage.openFile — reveal strategy', () => {
  async function openAndCaptureReveal(
    reveal: 'center' | 'if-offscreen' | 'default' | undefined,
  ): Promise<number> {
    const captured = makeEditor({ line: 0 });
    const openDocSpy = vi.spyOn(vscode.workspace, 'openTextDocument')
      .mockResolvedValue({ uri: vscode.Uri.file('/workspace/x.kt') } as any);
    const showSpy = vi.spyOn(vscode.window, 'showTextDocument')
      .mockResolvedValue(captured as any);

    await stage.openFile('x.kt', { line: 5, column: 2, reveal });

    openDocSpy.mockRestore();
    showSpy.mockRestore();
    return captured.revealCalls[0]?.type ?? -1;
  }

  it('defaults to InCenter (rétrocompat — no reveal key)', async () => {
    expect(await openAndCaptureReveal(undefined)).toBe(vscode.TextEditorRevealType.InCenter);
  });

  it('maps "center" to InCenter', async () => {
    expect(await openAndCaptureReveal('center')).toBe(vscode.TextEditorRevealType.InCenter);
  });

  it('maps "if-offscreen" to InCenterIfOutsideViewport', async () => {
    expect(await openAndCaptureReveal('if-offscreen'))
      .toBe(vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  });

  it('maps "default" to Default', async () => {
    expect(await openAndCaptureReveal('default')).toBe(vscode.TextEditorRevealType.Default);
  });
});
