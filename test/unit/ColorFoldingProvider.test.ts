/**
 * Tests pour ColorFoldingProvider — swatches ■, toCSS(), paint initial.
 *
 * Attack surface:
 *  1. R_COLOR_RE — \bR\.color\.([A-Za-z_]\w*)\b
 *  2. toCSS() — #RGB, #RRGGBB, #ARGB, #AARRGGBB + fallback
 *  3. Fix A — invalidateAll() dans le constructeur
 *  4. Ligne révélée (curseur) — aucune décoration sur cette ligne
 *  5. Setting colorResourceFolding: false — 0 décorations
 *  6. languageId != kotlin/java — ignoré
 *
 * Tests nommés SP2-CFP-* pour faciliter le grep.
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

function makeEditor(lines: string[], lang = 'kotlin', cursorLine?: number) {
  return {
    document: {
      languageId: lang,
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    selections: cursorLine !== undefined
      ? [{ start: { line: cursorLine }, end: { line: cursorLine } }]
      : [],
    setDecorations: vi.fn(),
  } as any;
}

function decs(idx: ColorResourceIndex, lines: string[], lang = 'kotlin', cursorLine?: number) {
  setup();
  const editor = makeEditor(lines, lang, cursorLine);
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ColorFoldingProvider(idx);
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

function indexWith(entries: Record<string, string>): ColorResourceIndex {
  const idx = new ColorResourceIndex();
  const xml = Object.entries(entries)
    .map(([n, v]) => `<color name="${n}">${v}</color>`)
    .join('\n');
  idx.reindexFile(
    { toString: () => 'file:///app/res/values/colors.xml' },
    `<resources>${xml}</resources>`,
  );
  return idx;
}

// ── SP2-CFP-1 ─────────────────────────────────────────────────────────────────

describe('SP2-CFP-1 — R.color connu → swatch ■', () => {
  it('contentText = \\u00A0 (non-breaking space)', () => {
    const result = decs(indexWith({ primary: '#7F52FF' }), ['R.color.primary']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('\u00A0');
  });
});

// ── SP2-CFP-2 ─────────────────────────────────────────────────────────────────

describe('SP2-CFP-2 — R.color inconnu → 0 décorations', () => {
  it('clé absente de l\'index', () => {
    expect(decs(indexWith({ primary: '#7F52FF' }), ['R.color.nope'])).toHaveLength(0);
  });
});

// ── SP2-CFP-3..7 : toCSS() ────────────────────────────────────────────────────

describe('SP2-CFP-3..7 — toCSS() via renderOptions.before.backgroundColor', () => {
  it('SP2-CFP-3: #RRGGBB passthrough', () => {
    expect(decs(indexWith({ c: '#7F52FF' }), ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('#7F52FF');
  });

  it('SP2-CFP-4: #AARRGGBB → rgba()', () => {
    expect(decs(indexWith({ c: '#66000000' }), ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('rgba(0,0,0,0.40)');
  });

  it('SP2-CFP-5: #ARGB → rgba() — Fix B', () => {
    expect(decs(indexWith({ c: '#8FFF' }), ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('rgba(255,255,255,0.53)');
  });

  it('SP2-CFP-6: #RGB passthrough', () => {
    expect(decs(indexWith({ c: '#F00' }), ['R.color.c'])[0].renderOptions.before.backgroundColor).toBe('#F00');
  });

  it('SP2-CFP-7: valeur non-hex non-référence → AUCUNE décoration (pas de fallback gris)', () => {
    // Was: fallback #808080. New behavior: skip the swatch entirely.
    // A grey dot was misleading — it implied the color IS grey when in
    // fact we could not resolve it.
    expect(decs(indexWith({ c: 'transparent' }), ['R.color.c'])).toHaveLength(0);
  });
});

// ── @color/X reference resolution (one hop) ──────────────────────────────────

describe('SP2-CFP-REF — @color/X references resolve one hop', () => {
  it('R.color.brand pointing at @color/primary (#FF0000) → red swatch', () => {
    const result = decs(
      indexWith({ brand: '@color/primary', primary: '#FF0000' }),
      ['R.color.brand'],
    );
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.backgroundColor).toBe('#FF0000');
  });

  it('@android:color/X reference also resolves through the index', () => {
    const result = decs(
      indexWith({ accent: '@android:color/holo_green', holo_green: '#00FF00' }),
      ['R.color.accent'],
    );
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.backgroundColor).toBe('#00FF00');
  });

  it('reference to non-existent color → no swatch (avoids misleading gray)', () => {
    expect(decs(
      indexWith({ orphan: '@color/does_not_exist' }),
      ['R.color.orphan'],
    )).toHaveLength(0);
  });

  it('chained reference (a → b → c) is NOT followed — bounded depth', () => {
    // Refusing to recurse keeps cycles bounded and the implementation
    // O(1) per resolve. Two-hop references show no swatch.
    expect(decs(
      indexWith({ a: '@color/b', b: '@color/c', c: '#0000FF' }),
      ['R.color.a'],
    )).toHaveLength(0);
  });
});

// ── SP2-CFP-8 : ligne révélée ─────────────────────────────────────────────────

describe('SP2-CFP-8 — ligne révélée (curseur) → 0 décorations', () => {
  it('curseur sur la ligne 0', () => {
    expect(decs(indexWith({ primary: '#7F52FF' }), ['R.color.primary'], 'kotlin', 0)).toHaveLength(0);
  });
});

// ── SP2-CFP-9 : paint initial ─────────────────────────────────────────────────

describe('SP2-CFP-9 — invalidateAll() dans le constructeur (Fix A)', () => {
  it('editors visibles décorés sans appel externe', () => {
    setup();
    const editor = makeEditor(['R.color.primary']);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    new ColorFoldingProvider(indexWith({ primary: '#7F52FF' }));
    expect(editor.setDecorations).toHaveBeenCalled();
    expect(editor.setDecorations.mock.lastCall?.[1]).toHaveLength(1);
  });
});

// ── SP2-CFP-10 : setting off ──────────────────────────────────────────────────

describe('SP2-CFP-10 — colorResourceFolding: false → 0 décorations', () => {
  it('setting désactivé', () => {
    setup();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'colorResourceFolding' ? false : def,
    } as any);
    const editor = makeEditor(['R.color.primary']);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    new ColorFoldingProvider(indexWith({ primary: '#7F52FF' }));
    expect(editor.setDecorations.mock.lastCall?.[1] ?? []).toHaveLength(0);
  });
});

// ── SP2-CFP-11 : Java ─────────────────────────────────────────────────────────

describe('SP2-CFP-11 — languageId java → décorations actives', () => {
  it('fichier Java → swatch', () => {
    expect(decs(indexWith({ primary: '#7F52FF' }), ['R.color.primary'], 'java')).toHaveLength(1);
  });
});

// ── SP2-CFP-BORDER : ThemeColor border ───────────────────────────────────────

describe('SP2-CFP-BORDER — borderColor ThemeColor editor.foreground', () => {
  it('border = "1px solid" (style sans couleur inline)', () => {
    const result = decs(indexWith({ warning: '#FFC107' }), ['R.color.warning']);
    expect(result[0].renderOptions.before.border).toBe('1px solid');
  });

  it('borderColor = ThemeColor("editor.foreground")', () => {
    const result = decs(indexWith({ warning: '#FFC107' }), ['R.color.warning']);
    expect(result[0].renderOptions.before.borderColor).toBeInstanceOf(vscodeMock.ThemeColor);
    expect((result[0].renderOptions.before.borderColor as vscodeMock.ThemeColor).id).toBe('editor.foreground');
  });

  it('REGRESSION: warning yellow → pas de bordure noire codée en dur', () => {
    const result = decs(indexWith({ warning: '#FFC107' }), ['R.color.warning']);
    expect(result[0].renderOptions.before.border).not.toContain('#000000');
  });
});

// ── SP2-CFP-12 : XML ──────────────────────────────────────────────────────────

describe('SP2-CFP-12 — languageId xml → 0 décorations', () => {
  it('fichier XML ignoré', () => {
    expect(decs(indexWith({ primary: '#7F52FF' }), ['R.color.primary'], 'xml')).toHaveLength(0);
  });
});
