import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';
import { makeChangeEvent } from './helpers';

afterEach(() => vi.restoreAllMocks());

function setupMocks() {
  const decorationType = { dispose: vi.fn() };
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue(decorationType as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeVisibleTextEditors').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
  return { decorationType };
}

function makeEditor(lines: string[], languageId = 'kotlin') {
  return {
    document: {
      languageId,
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    setDecorations: vi.fn(),
  } as any;
}

function decorationsFor(lines: string[], languageId = 'kotlin') {
  setupMocks();
  const provider = new NullAssertionProvider();
  const editor   = makeEditor(lines, languageId);
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  provider.invalidateAll();
  return editor.setDecorations.mock.lastCall![1] as any[];
}

// ── Golden path ───────────────────────────────────────────────────────────────

describe('NullAssertionProvider — golden path', () => {
  it('decorates a single !! on a plain identifier', () => {
    const decs = decorationsFor(['val x = foo!!']);
    expect(decs).toHaveLength(1);
  });

  it('decorates each !! in a chained expression a!!.b!!', () => {
    const decs = decorationsFor(['val x = a!!.b!!']);
    expect(decs).toHaveLength(2);
  });

  it('decoration range spans exactly 2 characters "!!"', () => {
    const line = 'val x = foo!!';
    const decs = decorationsFor([line]);
    const range = decs[0].range;
    expect(range.start.character).toBe(line.indexOf('!!'));
    expect(range.end.character).toBe(line.indexOf('!!') + 2);
  });

  it('decorates !! at the very end of the line', () => {
    const decs = decorationsFor(['return x!!']);
    expect(decs).toHaveLength(1);
  });

  it('does NOT decorate `!!` in Java — it is a boolean double-negation, not a null-assert', () => {
    // Reproducer: `if (!!flag)` in Java is canonical-boolean coercion.
    // Painting it amber would make Java readers think they're looking at
    // unsafe Kotlin code. Provider must skip Java entirely.
    const decs = decorationsFor(['if (!!flag) { return true; }'], 'java');
    expect(decs).toHaveLength(0);
  });
});

// ── False positives — strings ─────────────────────────────────────────────────

describe('NullAssertionProvider — !! inside strings (must NOT decorate)', () => {
  it('does NOT decorate !! inside a double-quoted string', () => {
    const decs = decorationsFor(['val s = "foo!!"']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate !! inside a string with other content before it', () => {
    const decs = decorationsFor(['println("result: ${x}!!")']);
    // !! is inside the outer string literal
    expect(decs).toHaveLength(0);
  });

  it('decorates !! that comes AFTER the closing quote (outside string)', () => {
    const decs = decorationsFor(['val s = "text"; val y = x!!']);
    expect(decs).toHaveLength(1);
  });
});

// ── False positives — comments ────────────────────────────────────────────────

describe('NullAssertionProvider — !! inside comments (must NOT decorate)', () => {
  it('does NOT decorate !! in a trailing // comment', () => {
    const decs = decorationsFor(['val x = 1 // use x!! here']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate !! in a full-line // comment', () => {
    const decs = decorationsFor(['// x!! is dangerous']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate !! inside /* ... */ inline block comment', () => {
    const decs = decorationsFor(['val x = /* x!! */ y']);
    expect(decs).toHaveLength(0);
  });

  it('decorates !! on code that comes AFTER a closed block comment', () => {
    const decs = decorationsFor(['val x = /* ok */ y!!']);
    expect(decs).toHaveLength(1);
  });
});

// ── False positives — raw strings (multi-line) ────────────────────────────────

describe('NullAssertionProvider — !! inside raw strings (must NOT decorate)', () => {
  it('does NOT decorate !! on a line inside a multi-line raw string block', () => {
    // Line 0 starts the raw string: inRawString → true, line skipped
    // Line 1 is inside: skipped
    // Line 2 closes it
    const decs = decorationsFor([
      'val s = """',
      'foo!!',      // inside raw string — should be skipped
      '"""',
    ]);
    expect(decs).toHaveLength(0);
  });

  it('decorates !! after the raw string block ends', () => {
    const decs = decorationsFor([
      'val s = """raw"""',  // single-line raw string — opens and closes on same line
      'val x = y!!',
    ]);
    // Line 0 has even tripleCount (2) → not a block start — may or may not decorate
    // Line 1 has no raw string context → MUST decorate
    const line1Decs = decs.filter((d: any) => d.range.start.line === 1);
    expect(line1Decs).toHaveLength(1);
  });
});

// ── Non-Kotlin files ──────────────────────────────────────────────────────────

describe('NullAssertionProvider — non-Kotlin/Java files', () => {
  it('does NOT decorate in XML files', () => {
    setupMocks();
    const provider = new NullAssertionProvider();
    const editor   = makeEditor(['foo!!'], 'xml');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    // setDecorations called with empty array or not called at all
    const calls = editor.setDecorations.mock.calls;
    const hasDecorations = calls.some((call: any[]) => call[1].length > 0);
    expect(hasDecorations).toBe(false);
  });
});

// ── Setting disabled ──────────────────────────────────────────────────────────

describe('NullAssertionProvider — disabled setting', () => {
  it('clears decorations when kotlinJump.nullAssertionHighlight = false', () => {
    setupMocks();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'nullAssertionHighlight' ? false : def,
    } as any);
    const provider = new NullAssertionProvider();
    const editor   = makeEditor(['val x = foo!!'], 'kotlin');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    const [, decs] = editor.setDecorations.mock.lastCall!;
    expect(decs).toHaveLength(0);
  });
});

// ── Multiple !! on the same line ─────────────────────────────────────────────

describe('NullAssertionProvider — multiple !! on the same line', () => {
  it('finds 3 !! on one line', () => {
    const decs = decorationsFor(['val r = a!! + b!! + c!!']);
    expect(decs).toHaveLength(3);
  });
});

// ── GUARD-INCREMENTAL ─────────────────────────────────────────────────────────
// Ces tests échoueront si le scan incrémental est remplacé par un scan complet
// (régression CPU : O(n) par frappe au lieu de O(1)).

describe('GUARD-INCREMENTAL — NullAssertionProvider incremental scan', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function setupIncrementalEnv(lines = ['val x = foo!!']) {
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([]);

    const provider = new NullAssertionProvider();
    const editor = makeEditor(lines);

    // Initialise l'état incrémental directement (sans passer par les événements VS Code)
    (provider as any)._editor = editor;
    (provider as any)._fullScan(editor); // _flush immédiat → setDecorations appelé une fois
    editor.setDecorations.mockClear();

    return { provider, editor };
  }

  it('GUARD-INC-A: frappe → setDecorations PAS appelé avant 16ms, appelé après', () => {
    const { provider, editor } = setupIncrementalEnv(['val x = foo!!']);
    const newDoc = makeEditor(['val x = foo!!!']).document;

    (provider as any)._applyChanges(makeChangeEvent(newDoc, 0, 13, 0, 13, '!'));

    expect(editor.setDecorations).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15);
    expect(editor.setDecorations).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
  });

  it('GUARD-INC-B: 10 frappes rapides sur la même ligne → _rescanLine appelé 10 fois (pas 10×N)', () => {
    const N = 100;
    const lines = Array.from({ length: N }, (_, i) => `val x${i} = ${i}`);
    lines[50] = 'val x50 = foo!!';
    const { provider } = setupIncrementalEnv(lines);

    const spy = vi.spyOn(provider as any, '_rescanLine');

    for (let k = 0; k < 10; k++) {
      const updated = [...lines];
      updated[50] = `val x50 = foo!!${'!'.repeat(k + 1)}`;
      const newDoc = makeEditor(updated).document;
      (provider as any)._applyChanges(
        makeChangeEvent(newDoc, 50, 15 + k, 50, 15 + k, '!'),
      );
    }

    // 1 ligne rescannée par frappe × 10 frappes = 10, PAS 10 × 100
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('GUARD-INC-C: Entrée entre deux lignes → décoration en-dessous se décale de +1', () => {
    // Ligne 0 : pas de décoration, ligne 1 : a !!
    const lines = ['val a = 0', 'val b = foo!!'];
    const { provider } = setupIncrementalEnv(lines);

    expect((provider as any)._lineDecos.has(1)).toBe(true);
    expect((provider as any)._lineDecos.has(2)).toBe(false);

    // Entrée à la fin de la ligne 0 → nouvelle ligne vide entre 0 et 1
    const newDoc = makeEditor(['val a = 0', '', 'val b = foo!!']).document;
    (provider as any)._applyChanges(makeChangeEvent(newDoc, 0, 9, 0, 9, '\n'));

    vi.advanceTimersByTime(16);
    // La décoration de la ligne 1 s'est décalée à la ligne 2
    expect((provider as any)._lineDecos.has(1)).toBe(false);
    expect((provider as any)._lineDecos.has(2)).toBe(true);
  });

  it('GUARD-INC-D: suppression de ligne vide → décoration en-dessous se décale de -1', () => {
    // Ligne 0 : vide, ligne 1 : vide, ligne 2 : a !!
    const lines = ['val a = 0', '', 'val b = foo!!'];
    const { provider } = setupIncrementalEnv(lines);

    expect((provider as any)._lineDecos.has(2)).toBe(true);

    // Supprime la ligne vide 1 (backspace au début de la ligne 1 → join avec ligne 0)
    const newDoc = makeEditor(['val a = 0', 'val b = foo!!']).document;
    (provider as any)._applyChanges(makeChangeEvent(newDoc, 0, 9, 1, 0, ''));

    vi.advanceTimersByTime(16);
    expect((provider as any)._lineDecos.has(1)).toBe(true);
    expect((provider as any)._lineDecos.has(2)).toBe(false);
  });

  it('GUARD-INC-E: ajout de """ → rawState reconstruit, ligne suivante perd sa décoration', () => {
    const lines = ['val x = a!!', 'val y = b!!'];
    const { provider } = setupIncrementalEnv(lines);

    expect((provider as any)._lineDecos.has(1)).toBe(true);

    // Remplace la ligne 0 par """ → ouvre un raw string, ligne 1 est à l'intérieur
    const newDoc = makeEditor(['"""', 'val y = b!!']).document;
    (provider as any)._applyChanges(makeChangeEvent(newDoc, 0, 0, 0, 11, '"""'));

    vi.advanceTimersByTime(16);
    // rawState[1] = true → ligne 1 effacée du cache
    expect((provider as any)._lineDecos.has(1)).toBe(false);
  });

  it('GUARD-INC-F: multi-curseur (2 changements en 1 event) → 1 seul appel setDecorations', () => {
    const lines = ['val a = 0', 'val b = 0'];
    const { provider, editor } = setupIncrementalEnv(lines);

    const newDoc = makeEditor(['val a = 0!!', 'val b = 0!!']).document;
    (provider as any)._applyChanges({
      document: newDoc,
      reason: undefined,
      contentChanges: [
        { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 9 } }, text: '!!', rangeOffset: 0, rangeLength: 0 },
        { range: { start: { line: 1, character: 9 }, end: { line: 1, character: 9 } }, text: '!!', rangeOffset: 0, rangeLength: 0 },
      ],
    });

    vi.advanceTimersByTime(16);
    // Malgré 2 changements, 1 seul setDecorations (throttle de coalescence)
    expect(editor.setDecorations).toHaveBeenCalledTimes(1);
  });
});
