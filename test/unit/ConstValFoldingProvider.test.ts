/**
 * Tests pour ConstValFoldingProvider — inline folding const val.
 *
 * Attack surface:
 *  1. CONST_NAME_RE — SCREAMING_SNAKE_CASE ≥3 chars
 *  2. Skip déclarations const val
 *  3. Ambiguïté (0 ou 2+ entries) → 0 décorations
 *  4. Couleur string vs number (ThemeColor.id)
 *  5. Troncature à 40 chars avec …
 *  6. Ligne révélée (curseur) → 0 décorations
 *  7. Setting constValFolding: false → 0 décorations
 *
 * Tests nommés SP2-CVF-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ConstValFoldingProvider } from '../../src/providers/ConstValFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

type Entry = { name: string; isConst?: boolean; constValue?: string };

function makeIndex(entries: Entry[]) {
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  return { lookup: (name: string) => byName.get(name) ?? [] };
}

function decs(entries: Entry[], lines: string[], lang = 'kotlin', cursorLine?: number) {
  setup();
  const editor = {
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
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ConstValFoldingProvider(makeIndex(entries) as any);
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

// ── SP2-CVF-1 ─────────────────────────────────────────────────────────────────

describe('SP2-CVF-1 — 1 entry isConst+constValue → décoration avec contentText', () => {
  it('TIMEOUT_MS → contentText = "5000"', () => {
    const result = decs(
      [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }],
      ['val x = TIMEOUT_MS'],
    );
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

// ── SP2-CVF-2 ─────────────────────────────────────────────────────────────────

describe('SP2-CVF-2 — 2 entries (ambiguïté) → 0 décorations', () => {
  it('nom ambigu ignoré', () => {
    const result = decs(
      [
        { name: 'TIMEOUT_MS', isConst: true, constValue: '5000' },
        { name: 'TIMEOUT_MS', isConst: true, constValue: '9000' },
      ],
      ['val x = TIMEOUT_MS'],
    );
    expect(result).toHaveLength(0);
  });
});

// ── SP2-CVF-3 ─────────────────────────────────────────────────────────────────

describe('SP2-CVF-3 — ligne de déclaration const val → 0 décorations', () => {
  it('skip de la ligne de déclaration', () => {
    const result = decs(
      [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }],
      ['const val TIMEOUT_MS = 5000'],
    );
    expect(result).toHaveLength(0);
  });
});

// ── SP2-CVF-4 : couleur string ────────────────────────────────────────────────

describe('SP2-CVF-4 — constValue string → ThemeColor debugTokenExpression.string', () => {
  it('couleur string', () => {
    const result = decs(
      [{ name: 'API_VERSION', isConst: true, constValue: '"v2"' }],
      ['val x = API_VERSION'],
    );
    expect(result[0].renderOptions.before.color.id).toBe('debugTokenExpression.string');
  });
});

// ── SP2-CVF-5 : couleur number ────────────────────────────────────────────────

describe('SP2-CVF-5 — constValue number → ThemeColor debugTokenExpression.number', () => {
  it('couleur number', () => {
    const result = decs(
      [{ name: 'PAGE_SIZE', isConst: true, constValue: '20' }],
      ['val x = PAGE_SIZE'],
    );
    expect(result[0].renderOptions.before.color.id).toBe('debugTokenExpression.number');
  });
});

// ── SP2-CVF-6 : nom trop court ────────────────────────────────────────────────

describe('SP2-CVF-6 — nom 2 chars (OK) → regex [A-Z][A-Z0-9_]{2,} exige ≥3 → 0 décorations', () => {
  it('OK non matché par CONST_NAME_RE', () => {
    const result = decs(
      [{ name: 'OK', isConst: true, constValue: 'true' }],
      ['val x = OK'],
    );
    expect(result).toHaveLength(0);
  });
});

// ── SP2-CVF-7 : ligne révélée ─────────────────────────────────────────────────

describe('SP2-CVF-7 — ligne révélée (curseur) → 0 décorations', () => {
  it('curseur sur la ligne → pas de décoration', () => {
    const result = decs(
      [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }],
      ['val x = TIMEOUT_MS'],
      'kotlin',
      0,
    );
    expect(result).toHaveLength(0);
  });
});

// ── SP2-CVF-8 : setting off ───────────────────────────────────────────────────

describe('SP2-CVF-8 — constValFolding: false → 0 décorations', () => {
  it('setting désactivé', () => {
    setup();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'constValFolding' ? false : def,
    } as any);
    const editor = {
      document: { languageId: 'kotlin', lineCount: 1, lineAt: () => ({ text: 'val x = TIMEOUT_MS' }) },
      selections: [],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    new ConstValFoldingProvider(makeIndex([{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }]) as any);
    expect(editor.setDecorations.mock.lastCall?.[1] ?? []).toHaveLength(0);
  });
});

// ── SP2-CVF-9 : troncature ────────────────────────────────────────────────────

describe('SP2-CVF-9 — valeur > 40 chars tronquée avec …', () => {
  it('contentText de longueur 41 terminé par …', () => {
    const longVal = '"' + 'a'.repeat(50) + '"';
    const result = decs(
      [{ name: 'LONG_STR', isConst: true, constValue: longVal }],
      ['val x = LONG_STR'],
    );
    const text = result[0].renderOptions.before.contentText as string;
    expect(text.length).toBe(41);
    expect(text.endsWith('…')).toBe(true);
  });
});
