/**
 * Adversarial & stress tests for HexColorFoldingProvider.
 *
 * Attack surface:
 *  1. HEX_0X_RE — word boundary (\b) behaviour, exactly-8-digit requirement
 *  2. HEX_STR_RE — quote-delimited, 3/4/6/8 hex digits, no escape handling
 *  3. isInsideCommentOrString vs. isInsideComment (different functions per format)
 *  4. argbHexToCSS / cssHexToCSS — conversion correctness at boundary values
 *  5. Same naive triple-quote raw string tracking as NullAssertionProvider
 *
 * Tests are named ADVER-HEX-* so they're easy to grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

function decs(lines: string[]) {
  setup();
  const provider = new HexColorFoldingProvider();
  const editor = {
    document: { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) },
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  provider.invalidateAll();
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

function color(d: any): string { return d.renderOptions.before.color; }

// ── ADVER-HEX-1: 0xAARRGGBB regex boundary attacks ───────────────────────────

describe('ADVER-HEX-1 — 0x format: digit count and word boundaries', () => {
  it('exactly 8 hex digits: 0xFF7F52FF MUST decorate', () => {
    expect(decs(['0xFF7F52FF'])).toHaveLength(1);
  });

  it('7 hex digits: 0xABCDEF1 must NOT decorate', () => {
    expect(decs(['0xABCDEF1'])).toHaveLength(0);
  });

  it('9 hex digits: 0xABCDEF123 must NOT decorate (\\b blocks the 8th-char match)', () => {
    // Regex \b...\b requires word boundary after 8th digit — 9th digit is a word char, no boundary
    expect(decs(['0xABCDEF123'])).toHaveLength(0);
  });

  it('lowercase hex digits 0xffffffff MUST decorate', () => {
    expect(decs(['0xffffffff'])).toHaveLength(1);
  });

  it('mixed case 0xFfFfFfFf MUST decorate', () => {
    expect(decs(['0xFfFfFfFf'])).toHaveLength(1);
  });

  it('0x with invalid hex char 0xGGGGGGGG must NOT decorate', () => {
    expect(decs(['0xGGGGGGGG'])).toHaveLength(0);
  });

  it('0x00000000 (fully transparent black) MUST decorate', () => {
    const result = decs(['0x00000000']);
    expect(result).toHaveLength(1);
    expect(color(result[0])).toBe('rgba(0,0,0,0.00)');
  });

  it('0xFFFFFFFF (fully opaque white) MUST decorate', () => {
    const result = decs(['0xFFFFFFFF']);
    expect(result).toHaveLength(1);
    expect(color(result[0])).toBe('rgba(255,255,255,1.00)');
  });

  it('0x80000000 (50% transparent black): alpha = ~0.50', () => {
    const result = decs(['0x80000000']);
    expect(result).toHaveLength(1);
    expect(color(result[0])).toMatch(/rgba\(0,0,0,0\.5\d\)/);
  });

  it('two 0x colors on same line MUST produce two swatches', () => {
    expect(decs(['val a = 0xFF0000FF; val b = 0xFF00FF00'])).toHaveLength(2);
  });

  it('0x color inside // comment must NOT decorate', () => {
    expect(decs(['// color: 0xFF7F52FF'])).toHaveLength(0);
  });

  it('0x color inside /* */ comment must NOT decorate', () => {
    expect(decs(['/* 0xFF7F52FF */'])).toHaveLength(0);
  });

  it('0x color inside string "0xFF7F52FF" must NOT decorate', () => {
    expect(decs(['"0xFF7F52FF"'])).toHaveLength(0);
  });

  it('0x color immediately after // comment close is still in comment — no decorate', () => {
    expect(decs(['val x = 1 // 0xFF7F52FF'])).toHaveLength(0);
  });

  it('0x color after closed block comment MUST decorate', () => {
    expect(decs(['/* skip */ 0xFF7F52FF'])).toHaveLength(1);
  });
});

// ── ADVER-HEX-2: "#RRGGBB" string format attacks ─────────────────────────────

describe('ADVER-HEX-2 — "#..." string format: length and character attacks', () => {
  it('"#RGB" 3-digit MUST decorate and expand to #RRGGBB', () => {
    const result = decs(['"#ABC"']);
    expect(result).toHaveLength(1);
    expect(color(result[0])).toBe('#AABBCC');
  });

  it('"#ARGB" 4-digit MUST decorate with alpha', () => {
    const result = decs(['"#8F00"']);
    // A=8→88=136/255≈0.53, R=F→FF=255, G=0→00=0, B=0→00=0
    expect(result).toHaveLength(1);
    expect(color(result[0])).toContain('rgba(');
  });

  it('"#RRGGBB" 6-digit MUST decorate', () => {
    expect(decs(['"#FF0000"'])).toHaveLength(1);
  });

  it('"#AARRGGBB" 8-digit MUST decorate with rgba()', () => {
    const result = decs(['"#80FF0000"']);
    // AA=80=128→0.50, RR=FF=255, GG=00=0, BB=00=0
    expect(result).toHaveLength(1);
    expect(color(result[0])).toContain('rgba(255,0,0,');
  });

  it('"#RRRRRR" — 7 hex digits must NOT decorate', () => {
    expect(decs(['"#FFFFFFF"'])).toHaveLength(0);
  });

  it('"#RR" — 2 hex digits must NOT decorate', () => {
    expect(decs(['"#FF"'])).toHaveLength(0);
  });

  it('"#RRGGBBX" — 7 chars but X is invalid hex must NOT decorate', () => {
    expect(decs(['"#RRGGBBX"'])).toHaveLength(0);
  });

  it('"#rrggbb" lowercase MUST decorate', () => {
    expect(decs(['"#ff0000"'])).toHaveLength(1);
  });

  it('#RRGGBB without quotes must NOT decorate', () => {
    expect(decs(['val s = #FF0000'])).toHaveLength(0);
  });

  it('"#FF0000" inside // comment must NOT decorate', () => {
    expect(decs(['// "#FF0000"'])).toHaveLength(0);
  });

  it('"#FF0000" inside /* */ comment must NOT decorate', () => {
    expect(decs(['/* "#FF0000" */'])).toHaveLength(0);
  });

  it('"#FF0000" and 0xFF0000FF on same line: 2 swatches', () => {
    expect(decs(['"#FF0000", 0xFF0000FF'])).toHaveLength(2);
  });

  it('three "#RRGGBB" strings on same line: 3 swatches', () => {
    expect(decs(['"#FF0000", "#00FF00", "#0000FF"'])).toHaveLength(3);
  });
});

// ── ADVER-HEX-3: Color conversion correctness ─────────────────────────────────

describe('ADVER-HEX-3 — color conversion boundary values', () => {
  it('argbHexToCSS: AA=FF → alpha=1.00', () => {
    const result = decs(['0xFFFF0000']);
    expect(color(result[0])).toBe('rgba(255,0,0,1.00)');
  });

  it('argbHexToCSS: AA=00 → alpha=0.00', () => {
    const result = decs(['0x00FF0000']);
    expect(color(result[0])).toBe('rgba(255,0,0,0.00)');
  });

  it('cssHexToCSS #RGB expands each digit: #ABC → #AABBCC', () => {
    const result = decs(['"#ABC"']);
    expect(color(result[0])).toBe('#AABBCC');
  });

  it('cssHexToCSS #000 → #000000', () => {
    const result = decs(['"#000"']);
    expect(color(result[0])).toBe('#000000');
  });

  it('cssHexToCSS #FFF → #FFFFFF', () => {
    const result = decs(['"#FFF"']);
    expect(color(result[0])).toBe('#FFFFFF');
  });

  it('cssHexToCSS #RRGGBB passthrough unchanged', () => {
    const result = decs(['"#ABCDEF"']);
    expect(color(result[0])).toBe('#ABCDEF');
  });
});

// ── ADVER-HEX-4: Raw string tracking ─────────────────────────────────────────

describe('ADVER-HEX-4 — 0x/# colors inside raw string blocks', () => {
  it('0x color inside multi-line raw string must NOT decorate', () => {
    expect(decs([
      '"""',
      'val c = 0xFF7F52FF',
      '"""',
    ])).toHaveLength(0);
  });

  it('# color string inside multi-line raw string must NOT decorate', () => {
    expect(decs([
      '"""',
      '"#FF0000" here',
      '"""',
    ])).toHaveLength(0);
  });

  it('color AFTER multi-line raw string MUST decorate', () => {
    expect(decs([
      '"""',
      'inside',
      '"""',
      '0xFF7F52FF',
    ])).toHaveLength(1);
  });
});

// ── ADVER-HEX-5: Edge cases and degenerate inputs ────────────────────────────

describe('ADVER-HEX-5 — degenerate inputs', () => {
  it('empty document produces 0 decorations', () => {
    expect(decs([])).toHaveLength(0);
  });

  it('empty line produces 0 decorations', () => {
    expect(decs([''])).toHaveLength(0);
  });

  it('line with only "0x" and no digits: no decoration', () => {
    expect(decs(['0x'])).toHaveLength(0);
  });

  it('line with "#" alone: no decoration', () => {
    expect(decs(['"#"'])).toHaveLength(0);
  });

  it('Java files: 0x color MUST decorate (languageId=java)', () => {
    setup();
    const provider = new HexColorFoldingProvider();
    const editor = {
      document: { languageId: 'java', lineCount: 1, lineAt: () => ({ text: 'int c = 0xFF7F52FF;' }) },
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    const decorations = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    expect(decorations).toHaveLength(1);
  });

  it('XML files: 0x color must NOT decorate', () => {
    setup();
    const provider = new HexColorFoldingProvider();
    const editor = {
      document: { languageId: 'xml', lineCount: 1, lineAt: () => ({ text: '0xFF7F52FF' }) },
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    const calls = editor.setDecorations.mock.calls;
    const hasDecos = calls.some((c: any[]) => c[1].length > 0);
    expect(hasDecos).toBe(false);
  });
});

// ── ADVER-HEX-6: Stress test ─────────────────────────────────────────────────

describe('ADVER-HEX-6 — stress: large document performance', () => {
  it('500-line document, one 0xAARRGGBB per line, returns 500 decorations in < 100ms', () => {
    const lines = Array.from({ length: 500 }, (_, i) =>
      `val c${i} = 0x${(0xFF000000 + i).toString(16).padStart(8, '0').toUpperCase()}`,
    );
    const start = performance.now();
    const result = decs(lines);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(500);
    expect(elapsed).toBeLessThan(100);
  });

  it('500-line document, one "#RRGGBB" per line, returns 500 decorations in < 100ms', () => {
    const lines = Array.from({ length: 500 }, (_, i) => {
      const r = (i % 256).toString(16).padStart(2, '0');
      const g = ((i * 7) % 256).toString(16).padStart(2, '0');
      const b = ((i * 13) % 256).toString(16).padStart(2, '0');
      return `val c${i} = "#${r}${g}${b}"`;
    });
    const start = performance.now();
    const result = decs(lines);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(500);
    expect(elapsed).toBeLessThan(100);
  });

  it('500-line document with colors inside comments — 0 decorations, < 100ms', () => {
    const lines = Array.from({ length: 500 }, (_, i) =>
      `val x${i} = 1 // 0xFF7F52FF "#FF0000"`,
    );
    const start = performance.now();
    const result = decs(lines);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(0);
    expect(elapsed).toBeLessThan(100);
  });
});
