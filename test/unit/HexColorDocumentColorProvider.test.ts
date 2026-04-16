import { describe, it, expect } from 'vitest';
import { Range } from './__mocks__/vscode';
import { HexColorDocumentColorProvider } from '../../src/providers/HexColorDocumentColorProvider';

const provider = new HexColorDocumentColorProvider();

function makeDocument(lines: string[], languageId = 'kotlin') {
  return {
    languageId,
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
    getText: (range?: any) => {
      if (!range) return lines.join('\n');
      const line = lines[range.start.line] ?? '';
      return line.slice(range.start.character, range.end.character);
    },
  } as any;
}

// ── 0xAARRGGBB — provideDocumentColors ───────────────────────────────────────

describe('HexColorDocumentColorProvider — 0xAARRGGBB colors', () => {
  it('finds a 0xAARRGGBB literal', () => {
    const doc    = makeDocument(['val c = 0xFF7F52FF']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(1);
  });

  it('color channels are in 0.0–1.0 (ARGB → RGBA)', () => {
    // 0xFF7F52FF: AA=FF=255, RR=7F=127, GG=52=82, BB=FF=255
    const doc  = makeDocument(['val c = 0xFF7F52FF']);
    const [ci] = provider.provideDocumentColors(doc);
    expect(ci.color.red).toBeCloseTo(127 / 255, 4);
    expect(ci.color.green).toBeCloseTo(82 / 255, 4);
    expect(ci.color.blue).toBeCloseTo(255 / 255, 4);
    expect(ci.color.alpha).toBeCloseTo(1.0, 4);
  });

  it('range covers the full 0x literal', () => {
    const line = 'val c = 0xFF7F52FF';
    const doc  = makeDocument([line]);
    const [ci] = provider.provideDocumentColors(doc);
    expect(ci.range.start.character).toBe(line.indexOf('0x'));
    expect(ci.range.end.character).toBe(line.indexOf('0x') + '0xFF7F52FF'.length);
  });

  it('does NOT find a 7-digit 0x literal', () => {
    const doc    = makeDocument(['val mask = 0x7F52FF']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });

  it('does NOT find 0xAARRGGBB inside a string literal', () => {
    const doc    = makeDocument(['val s = "0xFF7F52FF"']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });

  it('does NOT find 0xAARRGGBB inside a // comment', () => {
    const doc    = makeDocument(['// color: 0xFF7F52FF']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });

  it('does NOT find 0xAARRGGBB inside a raw string block', () => {
    const doc = makeDocument(['val s = """', '0xFF7F52FF', '"""']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });
});

// ── "#RRGGBB" string literals — provideDocumentColors ────────────────────────

describe('HexColorDocumentColorProvider — "#RRGGBB" string literals', () => {
  it('finds a 6-digit "#RRGGBB" string', () => {
    const doc    = makeDocument(['val c = "#FF0000"']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(1);
  });

  it('color is correct for "#FF0000" (red=1, green=0, blue=0)', () => {
    const doc  = makeDocument(['val c = "#FF0000"']);
    const [ci] = provider.provideDocumentColors(doc);
    expect(ci.color.red).toBeCloseTo(1.0, 4);
    expect(ci.color.green).toBeCloseTo(0.0, 4);
    expect(ci.color.blue).toBeCloseTo(0.0, 4);
    expect(ci.color.alpha).toBeCloseTo(1.0, 4);
  });

  it('finds a 3-digit "#RGB" shorthand', () => {
    const doc    = makeDocument(['val c = "#F00"']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(1);
  });

  it('#F00 expands to red=1, green=0, blue=0', () => {
    const doc  = makeDocument(['val c = "#F00"']);
    const [ci] = provider.provideDocumentColors(doc);
    expect(ci.color.red).toBeCloseTo(1.0, 4);
    expect(ci.color.green).toBeCloseTo(0.0, 4);
    expect(ci.color.blue).toBeCloseTo(0.0, 4);
  });

  it('finds an 8-digit "#AARRGGBB" string (Android ARGB)', () => {
    const doc    = makeDocument(['val c = "#FF7F52FF"']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(1);
  });

  it('#FF7F52FF: alpha=1, red≈0.498, green≈0.322, blue=1', () => {
    const doc  = makeDocument(['val c = "#FF7F52FF"']);
    const [ci] = provider.provideDocumentColors(doc);
    expect(ci.color.alpha).toBeCloseTo(1.0, 4);
    expect(ci.color.red).toBeCloseTo(127 / 255, 4);
    expect(ci.color.green).toBeCloseTo(82 / 255, 4);
    expect(ci.color.blue).toBeCloseTo(255 / 255, 4);
  });

  it('range covers only the hex value — not the surrounding quotes', () => {
    const line = 'val c = "#FF0000"';
    const doc  = makeDocument([line]);
    const [ci] = provider.provideDocumentColors(doc);
    const hexStart = line.indexOf('#');
    expect(ci.range.start.character).toBe(hexStart);
    expect(ci.range.end.character).toBe(hexStart + '#FF0000'.length);
  });

  it('does NOT find "#RRGGBB" inside a // comment', () => {
    const doc    = makeDocument(['// color: "#FF0000"']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });

  it('does NOT find "#RRGGBB" inside a /* */ comment', () => {
    const doc    = makeDocument(['/* "#FF0000" */']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(0);
  });

  it('finds both "#RRGGBB" and 0xAARRGGBB on the same line', () => {
    const doc    = makeDocument(['val a = "#FF0000"; val b = 0xFF00FF00']);
    const colors = provider.provideDocumentColors(doc);
    expect(colors).toHaveLength(2);
  });
});

// ── provideColorPresentations — 0xAARRGGBB ───────────────────────────────────

describe('HexColorDocumentColorProvider — presentations for 0xAARRGGBB', () => {
  it('round-trips: 0xFF7F52FF → Color → back to 0xFF7F52FF', () => {
    const doc  = makeDocument(['val c = 0xFF7F52FF']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    expect(p.label).toBe('0xFF7F52FF');
  });

  it('semi-transparent round-trip: 0x807F52FF', () => {
    const doc  = makeDocument(['val c = 0x807F52FF']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    expect(p.label).toBe('0x807F52FF');
  });

  it('textEdit replaces the range with the new 0x label', () => {
    const doc  = makeDocument(['val c = 0xFF7F52FF']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    expect(p.textEdit!.newText).toBe(p.label);
  });
});

// ── provideColorPresentations — "#RRGGBB" ─────────────────────────────────────

describe('HexColorDocumentColorProvider — presentations for "#RRGGBB"', () => {
  it('round-trips: "#FF0000" → Color → back to "#FF0000"', () => {
    const doc  = makeDocument(['val c = "#FF0000"']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    expect(p.label).toBe('#FF0000');
  });

  it('round-trips: "#5731c0" → Color → back to "#5731C0" (uppercase)', () => {
    const doc  = makeDocument(['val c = "#5731c0"']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    expect(p.label).toMatch(/^#[0-9A-F]{6}$/);
    expect(p.label).toBe('#5731C0');
  });

  it('round-trips: "#FF7F52FF" (AARRGGBB) → keeps ARGB format', () => {
    const doc  = makeDocument(['val c = "#FF7F52FF"']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    // 8-digit → should stay 8-digit ARGB
    expect(p.label).toMatch(/^#[0-9A-F]{8}$/);
    expect(p.label).toBe('#FF7F52FF');
  });

  it('textEdit replaces only the hex part — quotes remain in the document', () => {
    const doc  = makeDocument(['val c = "#FF0000"']);
    const [ci] = provider.provideDocumentColors(doc);
    const ctx  = { document: doc, range: ci.range };
    const [p]  = provider.provideColorPresentations(ci.color, ctx);
    // textEdit range does not include the quotes
    expect(p.textEdit!.range.start.character).toBe(doc.lineAt(0).text.indexOf('#'));
    expect(p.textEdit!.newText).toBe('#FF0000');
  });
});
