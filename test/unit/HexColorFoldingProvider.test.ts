import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setupMocks() {
  const decorationType = { dispose: vi.fn() };
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue(decorationType as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
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
  const provider = new HexColorFoldingProvider();
  const editor   = makeEditor(lines, languageId);
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  provider.invalidateAll();
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

// ── 0xAARRGGBB format ─────────────────────────────────────────────────────────

describe('HexColorFoldingProvider — 0xAARRGGBB format', () => {
  it('decorates a 0xAARRGGBB literal', () => {
    const decs = decorationsFor(['val c = Color(0xFF7F52FF.toInt())']);
    expect(decs).toHaveLength(1);
  });

  it('swatch is placed at the start of the 0x literal (zero-width range)', () => {
    const line = 'val c = 0xFF7F52FF.toInt()';
    const decs = decorationsFor([line]);
    expect(decs[0].range.start.character).toBe(line.indexOf('0x'));
    expect(decs[0].range.end.character).toBe(line.indexOf('0x'));
  });

  it('swatch color is derived from AARRGGBB (ff7f52ff → rgba(127,82,255,1.00))', () => {
    const decs = decorationsFor(['val c = 0xff7f52ff']);
    // Alpha=0xff=255 → 1.00, R=0x7f=127, G=0x52=82, B=0xff=255
    expect(decs[0].renderOptions.before.color).toContain('rgba(127,82,255,1.00)');
  });

  it('handles semi-transparent: 0x807F52FF → alpha ~0.50', () => {
    const decs = decorationsFor(['val c = 0x807F52FF']);
    const color: string = decs[0].renderOptions.before.color;
    // Alpha = 0x80 = 128 → 128/255 ≈ 0.50
    expect(color).toMatch(/rgba\(127,82,255,0\.5\d\)/);
  });

  it('does NOT decorate a 7-digit 0x literal (not a color: 0x7F52FF)', () => {
    const decs = decorationsFor(['val mask = 0x7F52FF']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate a 0xAARRGGBB inside a string literal', () => {
    const decs = decorationsFor(['val s = "0xFF7F52FF"']);
    // The 0x is inside a string → isInsideCommentOrString returns true → skip
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate a 0xAARRGGBB inside a // comment', () => {
    const decs = decorationsFor(['// color: 0xFF7F52FF']);
    expect(decs).toHaveLength(0);
  });
});

// ── "#RRGGBB" string format ───────────────────────────────────────────────────

describe('HexColorFoldingProvider — "#RRGGBB" string format', () => {
  it('decorates a 6-digit "#RRGGBB" string literal', () => {
    const decs = decorationsFor(['val c = "#FF0000"']);
    expect(decs).toHaveLength(1);
  });

  it('swatch color is the original CSS hex string for 6-digit format', () => {
    const decs = decorationsFor(['val c = "#FF0000"']);
    expect(decs[0].renderOptions.before.color).toBe('#FF0000');
  });

  it('decorates a 3-digit "#RGB" shorthand', () => {
    const decs = decorationsFor(['val c = "#F00"']);
    expect(decs).toHaveLength(1);
    // #F00 → #FF0000
    expect(decs[0].renderOptions.before.color).toBe('#FF0000');
  });

  it('decorates an 8-digit "#AARRGGBB" string', () => {
    const decs = decorationsFor(['val c = "#FF7F52FF"']);
    expect(decs).toHaveLength(1);
    // AA=FF=255 → 1.00, R=7F=127, G=52=82, B=FF=255
    expect(decs[0].renderOptions.before.color).toContain('rgba(127,82,255,1.00)');
  });

  it('swatch is placed at the opening quote of the string', () => {
    const line = 'val c = "#FF0000"';
    const decs = decorationsFor([line]);
    expect(decs[0].range.start.character).toBe(line.indexOf('"'));
  });

  // ── REGRESSION: comment false-positive (the bug fixed in this sprint) ──────

  it('REGRESSION: does NOT decorate "#FF0000" inside a // comment', () => {
    const decs = decorationsFor(['// val c = "#FF0000" // use for red']);
    expect(decs).toHaveLength(0);
  });

  it('REGRESSION: does NOT decorate "#FF0000" inside a /* */ comment', () => {
    const decs = decorationsFor(['/* val c = "#FF0000" */']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate "#GHIJKL" — invalid hex characters', () => {
    const decs = decorationsFor(['val bad = "#GHIJKL"']);
    expect(decs).toHaveLength(0);
  });

  it('does NOT decorate "#FF" — too short (only 2 hex digits)', () => {
    const decs = decorationsFor(['val bad = "#FF"']);
    expect(decs).toHaveLength(0);
  });
});

// ── Mixed on the same line ────────────────────────────────────────────────────

describe('HexColorFoldingProvider — mixed formats on the same line', () => {
  it('decorates both 0xAARRGGBB and "#RRGGBB" on the same line', () => {
    const decs = decorationsFor(['val a = 0xFF0000FF; val b = "#0000FF"']);
    expect(decs).toHaveLength(2);
  });

  it('multiple "#RRGGBB" strings produce one swatch each', () => {
    const decs = decorationsFor(['mapOf("#FF0000" to "#00FF00")']);
    expect(decs).toHaveLength(2);
  });
});

// ── Non-Kotlin files ──────────────────────────────────────────────────────────

describe('HexColorFoldingProvider — non-Kotlin/Java files', () => {
  it('does NOT decorate in XML files', () => {
    setupMocks();
    const provider = new HexColorFoldingProvider();
    const editor   = makeEditor(['val c = "#FF0000"'], 'xml');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    const calls = editor.setDecorations.mock.calls;
    const hasDecorations = calls.some((c: any[]) => c[1].length > 0);
    expect(hasDecorations).toBe(false);
  });
});

// ── Setting disabled ──────────────────────────────────────────────────────────

describe('HexColorFoldingProvider — disabled setting', () => {
  it('clears decorations when kotlinJump.hexColorSwatch = false', () => {
    setupMocks();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'hexColorSwatch' ? false : def,
    } as any);
    const provider = new HexColorFoldingProvider();
    const editor   = makeEditor(['val c = 0xFF7F52FF'], 'kotlin');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    const [, decs] = editor.setDecorations.mock.lastCall!;
    expect(decs).toHaveLength(0);
  });
});
