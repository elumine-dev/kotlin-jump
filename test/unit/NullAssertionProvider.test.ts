import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';

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

  it('works in Java files', () => {
    // Java does not have !! but we still process it (no harm)
    const decs = decorationsFor(['Object x = obj!!;'], 'java');
    expect(decs).toHaveLength(1);
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
