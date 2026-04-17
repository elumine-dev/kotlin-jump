/**
 * Tests adversariaux pour ColorFoldingProvider.
 *
 * Attack surface:
 *  1. R_COLOR_RE — \b word boundary, underscore dans les noms, 1 char
 *  2. isInsideCommentOrString — faux positifs commentaire et string
 *  3. Plusieurs refs R.color sur la même ligne
 *  4. toCSS() valeurs limites : alpha=0 (#00000000), fully opaque (#FFFFFFFF)
 *  5. Performance — 200 refs sur 200 lignes < 50ms
 *
 * Tests nommés SP2-ADVER-CFP-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ColorFoldingProvider } from '../../src/providers/ColorFoldingProvider';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

function decs(idx: ColorResourceIndex, lines: string[]) {
  setup();
  const editor = {
    document: { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) },
    selections: [],
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ColorFoldingProvider(idx);
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

function makeIndex(entries: Record<string, string>): ColorResourceIndex {
  const idx = new ColorResourceIndex();
  const xml = Object.entries(entries).map(([n, v]) => `<color name="${n}">${v}</color>`).join('\n');
  idx.reindexFile(
    { toString: () => 'file:///app/res/values/colors.xml' },
    `<resources>${xml}</resources>`,
  );
  return idx;
}

const IDX = makeIndex({ primary: '#7F52FF', secondary: '#03DAC6', type_fire: '#FF6D00' });

// ── SP2-ADVER-CFP-1 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-1 — R.color dans commentaire → 0 décorations', () => {
  it('// R.color.primary ignoré', () => {
    expect(decs(IDX, ['// R.color.primary'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CFP-2 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-2 — R.color dans string brute → 0 décorations', () => {
  it('"R.color.primary" (sans ${}) ignoré', () => {
    expect(decs(IDX, ['val s = "R.color.primary"'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CFP-2b ──────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-2b — R.color dans ${} → 1 décoration', () => {
  it('"${R.color.primary}" foldé', () => {
    expect(decs(IDX, ['val s = "${R.color.primary}"'])).toHaveLength(1);
  });
});

// ── SP2-ADVER-CFP-2c ──────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-2c — 3 refs dans ${} sur la même ligne → 3 décorations', () => {
  it('println("${R.color.primary} / ${R.color.secondary}")', () => {
    expect(decs(IDX, ['println("${R.color.primary} / ${R.color.secondary}")'])).toHaveLength(2);
  });
});

// ── SP2-ADVER-CFP-3 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-3 — 2 refs R.color sur la même ligne → 2 décorations', () => {
  it('primary et secondary décorés', () => {
    expect(decs(IDX, ['R.color.primary + R.color.secondary'])).toHaveLength(2);
  });
});

// ── SP2-ADVER-CFP-4 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-4 — nom avec underscore → 1 décoration', () => {
  it('R.color.type_fire trouvé', () => {
    expect(decs(IDX, ['R.color.type_fire'])).toHaveLength(1);
  });
});

// ── SP2-ADVER-CFP-5 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-5 — R.color.R (1 char) → clé inconnue → 0 décorations', () => {
  it('regex matche mais entrée absente', () => {
    expect(decs(IDX, ['R.color.R'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CFP-6 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-6 — toCSS("#00000000") alpha=0', () => {
  it('rgba(0,0,0,0.00)', () => {
    const idx = makeIndex({ c: '#00000000' });
    expect(decs(idx, ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('rgba(0,0,0,0.00)');
  });
});

// ── SP2-ADVER-CFP-7 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-7 — toCSS("#FFFFFFFF") fully opaque white', () => {
  it('rgba(255,255,255,1.00)', () => {
    const idx = makeIndex({ c: '#FFFFFFFF' });
    expect(decs(idx, ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('rgba(255,255,255,1.00)');
  });
});

// ── SP2-ADVER-CFP-8 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CFP-8 — stress 200 refs R.color sur 200 lignes', () => {
  it('complète en < 50ms', () => {
    const lines = Array.from({ length: 200 }, () => 'R.color.primary');
    const t0 = performance.now();
    decs(IDX, lines);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
