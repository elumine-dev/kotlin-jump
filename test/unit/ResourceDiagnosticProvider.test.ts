/**
 * Tests pour ResourceDiagnosticProvider — diagnostics R.string/R.color.
 *
 * Attack surface:
 *  1. R_STRING_RE et R_COLOR_RE — regex \bR\.(string|color)\.([A-Za-z_]\w*)\b
 *  2. isInsideCommentOrString — faux positifs commentaire/string
 *  3. Filtrage par languageId (kotlin/java uniquement)
 *  4. Setting resourceDiagnostics: false → 0 diagnostics
 *  5. onDidCloseTextDocument → suppression des diagnostics
 *  6. message et source vérifiés
 *
 * Tests nommés SP2-RDP-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ResourceDiagnosticProvider } from '../../src/providers/ResourceDiagnosticProvider';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';

afterEach(() => vi.restoreAllMocks());

function makeStrings(keys: string[]): StringResourceIndex {
  const idx = new StringResourceIndex();
  if (keys.length === 0) return idx;
  const xml = keys.map(k => `<string name="${k}">val</string>`).join('\n');
  idx.reindexFile(
    { toString: () => 'file:///res/values/strings.xml' },
    `<resources>${xml}</resources>`,
  );
  return idx;
}

function makeColors(keys: string[]): ColorResourceIndex {
  const idx = new ColorResourceIndex();
  if (keys.length === 0) return idx;
  const xml = keys.map(k => `<color name="${k}">#000000</color>`).join('\n');
  idx.reindexFile(
    { toString: () => 'file:///res/values/colors.xml' },
    `<resources>${xml}</resources>`,
  );
  return idx;
}

function setup() {
  vi.spyOn(vscodeMock.workspace, 'onDidOpenTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

function diagsFor(
  strings: StringResourceIndex,
  colors: ColorResourceIndex,
  lines: string[],
  lang = 'kotlin',
) {
  setup();
  const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
  vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
  const doc = {
    languageId: lang,
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
    uri: { toString: () => 'file:///Test.kt' },
  };
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([{ document: doc }]);
  new ResourceDiagnosticProvider(strings, colors);
  const calls = collection.set.mock.calls;
  return calls.length > 0 ? (calls.at(-1)?.[1] as any[]) : [];
}

// ── SP2-RDP-1 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-1 — R.string.unknown_key absent → 1 Diagnostic Error', () => {
  it('diagnostic créé', () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['R.string.unknown_key']);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(vscodeMock.DiagnosticSeverity.Error);
  });
});

// ── SP2-RDP-2 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-2 — R.color.unknown_color absent → 1 Diagnostic Error', () => {
  it('diagnostic créé', () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['R.color.unknown_color']);
    expect(result).toHaveLength(1);
  });
});

// ── SP2-RDP-3 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-3 — R.string.app_name présent → 0 diagnostics', () => {
  it('clé connue → aucun diagnostic', () => {
    const result = diagsFor(makeStrings(['app_name']), makeColors([]), ['R.string.app_name']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-RDP-4 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-4 — R.color.primary présent → 0 diagnostics', () => {
  it('couleur connue → aucun diagnostic', () => {
    const result = diagsFor(makeStrings([]), makeColors(['primary']), ['R.color.primary']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-RDP-5 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-5 — R.string dans commentaire → 0 diagnostics', () => {
  it('// R.string.bad_key ignoré', () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['// R.string.bad_key']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-RDP-6 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-6 — R.string dans string → 0 diagnostics', () => {
  it('"R.string.bad" dans string ignoré', () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['val s = "R.string.bad"']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-RDP-7 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-7 — message de diagnostic', () => {
  it("message = \"Cannot resolve string resource 'unknown_key'\"", () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['R.string.unknown_key']);
    expect(result[0].message).toBe("Cannot resolve string resource 'unknown_key'");
  });
});

// ── SP2-RDP-8 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-8 — source du diagnostic', () => {
  it("source = 'Kotlin Jump'", () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['R.string.unknown_key']);
    expect(result[0].source).toBe('Kotlin Jump');
  });
});

// ── SP2-RDP-9 ─────────────────────────────────────────────────────────────────

describe('SP2-RDP-9 — resourceDiagnostics: false → 0 diagnostics', () => {
  it('setting désactivé', () => {
    setup();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'resourceDiagnostics' ? false : def,
    } as any);
    const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
    const doc = {
      languageId: 'kotlin',
      lineCount: 1,
      lineAt: () => ({ text: 'R.string.unknown_key' }),
      uri: { toString: () => 'file:///Test.kt' },
    };
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([{ document: doc }]);
    new ResourceDiagnosticProvider(makeStrings([]), makeColors([]));
    const calls = collection.set.mock.calls;
    const diags = calls.length > 0 ? (calls.at(-1)?.[1] as any[]) : [];
    expect(diags).toHaveLength(0);
  });
});

// ── SP2-RDP-10 ────────────────────────────────────────────────────────────────

describe('SP2-RDP-10 — onDidCloseTextDocument → diagnostics supprimés', () => {
  it('collection.delete appelé avec l\'URI du document fermé', () => {
    let closeListener: ((doc: any) => void) | undefined;
    vi.spyOn(vscodeMock.workspace, 'onDidOpenTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockImplementation((listener: any) => {
      closeListener = listener;
      return { dispose: vi.fn() } as any;
    });
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
    const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([]);
    new ResourceDiagnosticProvider(makeStrings([]), makeColors([]));
    const fakeUri = { toString: () => 'file:///closing.kt' };
    closeListener!({ uri: fakeUri });
    expect(collection.delete).toHaveBeenCalledWith(fakeUri);
  });
});

// ── SP2-RDP-11 ────────────────────────────────────────────────────────────────

describe('SP2-RDP-11 — fichier XML → 0 diagnostics', () => {
  it('languageId xml ignoré', () => {
    const result = diagsFor(makeStrings([]), makeColors([]), ['R.string.bad_key'], 'xml');
    expect(result).toHaveLength(0);
  });
});

// ── SP2-RDP-12 ────────────────────────────────────────────────────────────────

describe('SP2-RDP-12 — 2 refs inconnues sur la même ligne → 2 diagnostics', () => {
  it('R.string + R.color sur même ligne → 2 diagnostics distincts', () => {
    const result = diagsFor(
      makeStrings([]),
      makeColors([]),
      ['R.string.bad + R.color.bad'],
    );
    expect(result).toHaveLength(2);
  });
});
