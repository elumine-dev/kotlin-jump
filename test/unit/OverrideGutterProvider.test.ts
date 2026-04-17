/**
 * Tests pour OverrideGutterProvider — CodeLens ⬆/⬇, abstract val/var, interface methods.
 *
 * Attack surface:
 *  1. CodeLens ⬆ — override fun/val/var
 *  2. CodeLens ⬇ — abstract fun/val/var avec implémentations (Fix C inclus)
 *  3. CodeLens ⬇ — méthodes d'interface (implicitement abstraites, pas isAbstract=true)
 *  4. Filtrage : symboles $, setting overrideGutterIcons, languageId
 *  5. Pluralisation : "implementation" vs "implementations"
 *  6. Arguments des commandes kotlin-jump.revealDefinitionAt / goToMethodImpl
 *  7. Pas de lens dupliqué avec KotlinCodeLensProvider
 *
 * Tests nommés SP2-OGP-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { OverrideGutterProvider } from '../../src/providers/OverrideGutterProvider';

afterEach(() => vi.restoreAllMocks());

type Symbol = {
  name: string;
  kind: string;
  line: number;
  character: number;
  depth?: number;
  isOverride?: boolean;
  isAbstract?: boolean;
};

function makeDoc(lang = 'kotlin') {
  return {
    languageId: lang,
    uri: { toString: () => 'file:///Test.kt' },
  } as any;
}

function makeIndex(
  symbols: Symbol[],
  methodImplsMap: Record<string, any[]> = {},
  classImplsMap: Record<string, any[]> = {},
  lookupMap: Record<string, any[]> = {},
) {
  return {
    getFileSymbols: () => symbols,
    lookupMethodImplementations: (name: string) => methodImplsMap[name] ?? [],
    lookupImplementations: (name: string) => classImplsMap[name] ?? [],
    lookup: (name: string) => lookupMap[name] ?? [],
  };
}

function lenses(
  symbols: Symbol[],
  methodImplsMap: Record<string, any[]> = {},
  lang = 'kotlin',
  classImplsMap: Record<string, any[]> = {},
  lookupMap: Record<string, any[]> = {},
) {
  const index = makeIndex(symbols, methodImplsMap, classImplsMap, lookupMap);
  const provider = new OverrideGutterProvider(index as any);
  return provider.provideCodeLenses(makeDoc(lang));
}

function makeImpl(uri: string) {
  return { uri: { toString: () => uri } };
}

// ── SP2-OGP-1 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-1 — override fun → CodeLens ⬆ overrides', () => {
  it('title = "⬆ overrides"', () => {
    const result = lenses([{ name: 'toString', kind: 'fun', line: 0, character: 0, isOverride: true }]);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬆ overrides');
  });
});

// ── SP2-OGP-2 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-2 — override val → CodeLens ⬆ overrides', () => {
  it('val isOverride → ⬆', () => {
    const result = lenses([{ name: 'size', kind: 'val', line: 0, character: 0, isOverride: true }]);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬆ overrides');
  });
});

// ── SP2-OGP-3 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-3 — override var → CodeLens ⬆ overrides', () => {
  it('var isOverride → ⬆', () => {
    const result = lenses([{ name: 'count', kind: 'var', line: 0, character: 0, isOverride: true }]);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬆ overrides');
  });
});

// ── SP2-OGP-4 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-4 — abstract fun avec 2 implémentations → ⬇ 2 implementations', () => {
  it('pluriel', () => {
    const symbol = { name: 'fetch', kind: 'fun', line: 0, character: 0, isAbstract: true };
    const impls = { fetch: [makeImpl('file:///Impl1.kt'), makeImpl('file:///Impl2.kt')] };
    const result = lenses([symbol], impls);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 2 implementations');
  });
});

// ── SP2-OGP-5 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-5 — abstract fun avec 1 implémentation → ⬇ 1 implementation (singulier)', () => {
  it('singulier', () => {
    const symbol = { name: 'fetch', kind: 'fun', line: 0, character: 0, isAbstract: true };
    const result = lenses([symbol], { fetch: [makeImpl('file:///Impl.kt')] });
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-6 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-6 — abstract fun sans implémentation → 0 CodeLens', () => {
  it('impls.length === 0 → pas de CodeLens ⬇', () => {
    const symbol = { name: 'fetch', kind: 'fun', line: 0, character: 0, isAbstract: true };
    expect(lenses([symbol], {})).toHaveLength(0);
  });
});

// ── SP2-OGP-7 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-7 — abstract val avec implémentation → ⬇ 1 implementation (Fix C)', () => {
  it('kind=val + isAbstract → CodeLens ⬇', () => {
    const symbol = { name: 'size', kind: 'val', line: 0, character: 0, isAbstract: true };
    const result = lenses([symbol], { size: [makeImpl('file:///Impl.kt')] });
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-8 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-8 — symbole $anonymous → 0 CodeLens', () => {
  it('noms commençant par $ filtrés', () => {
    const symbol = { name: '$anonymous', kind: 'fun', line: 0, character: 0, isAbstract: true };
    expect(lenses([symbol], { $anonymous: [makeImpl('file:///X.kt')] })).toHaveLength(0);
  });
});

// ── SP2-OGP-9 ─────────────────────────────────────────────────────────────────

describe('SP2-OGP-9 — overrideGutterIcons: false → 0 CodeLenses', () => {
  it('setting désactivé', () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'overrideGutterIcons' ? false : def,
    } as any);
    const symbol = { name: 'toString', kind: 'fun', line: 0, character: 0, isOverride: true };
    expect(lenses([symbol])).toHaveLength(0);
  });
});

// ── SP2-OGP-10 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-10 — fichier XML → 0 CodeLenses', () => {
  it('languageId xml ignoré', () => {
    const symbol = { name: 'toString', kind: 'fun', line: 0, character: 0, isOverride: true };
    expect(lenses([symbol], {}, 'xml')).toHaveLength(0);
  });
});

// ── SP2-OGP-11 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-11 — command ⬆ = revealDefinitionAt avec bons arguments', () => {
  it('arguments[0]=uri, arguments[1]=Position(line, character)', () => {
    const symbol = { name: 'toString', kind: 'fun', line: 3, character: 6, isOverride: true };
    const doc = makeDoc();
    const provider = new OverrideGutterProvider(makeIndex([symbol], {}, {}) as any);
    const result = provider.provideCodeLenses(doc);
    expect(result[0].command!.command).toBe('kotlin-jump.revealDefinitionAt');
    expect(result[0].command!.arguments![0]).toBe(doc.uri);
    const pos = result[0].command!.arguments![1] as vscodeMock.Position;
    expect(pos.line).toBe(3);
    expect(pos.character).toBe(6);
  });
});

// ── SP2-OGP-12 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-12 — command ⬇ = goToMethodImpl avec bons arguments', () => {
  it('arguments[0]=uri, [1]=line, [2]=name, [3]=uris[]', () => {
    const symbol = { name: 'fetch', kind: 'fun', line: 5, character: 2, isAbstract: true };
    const doc = makeDoc();
    const index = makeIndex([symbol], { fetch: [makeImpl('file:///Impl.kt')] }, {});
    const provider = new OverrideGutterProvider(index as any);
    const result = provider.provideCodeLenses(doc);
    expect(result[0].command!.command).toBe('kotlin-jump.goToMethodImpl');
    expect(result[0].command!.arguments![0]).toBe(doc.uri);
    expect(result[0].command!.arguments![1]).toBe(5);
    expect(result[0].command!.arguments![2]).toBe('fetch');
    expect(result[0].command!.arguments![3]).toEqual(['file:///Impl.kt']);
  });
});

// ── SP2-OGP-13 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-13 — interface fun (sans isAbstract) → CodeLens ⬇', () => {
  it('méthode dans une interface → ⬇ 1 implementation', () => {
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
      { name: 'fetch', kind: 'fun', line: 1, character: 2, depth: 1 },
    ];
    const result = lenses(symbols, { fetch: [makeImpl('file:///Impl.kt')] });
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-14 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-14 — interface val (sans isAbstract) → CodeLens ⬇', () => {
  it('val dans une interface → ⬇ 1 implementation', () => {
    const symbols: Symbol[] = [
      { name: 'CacheStore', kind: 'interface', line: 0, character: 0, depth: 0 },
      { name: 'size', kind: 'val', line: 1, character: 2, depth: 1 },
    ];
    const result = lenses(symbols, { size: [makeImpl('file:///Impl.kt')] });
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-15 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-15 — interface fun sans implémentation → 0 CodeLens', () => {
  it('interface fun avec 0 impls → pas de lens ⬇', () => {
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
      { name: 'fetch', kind: 'fun', line: 1, character: 2, depth: 1 },
    ];
    const result = lenses(symbols, {});
    expect(result).toHaveLength(0);
  });
});

// ── SP2-OGP-16 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-16 — override fun DANS une interface → ⬆ (pas ⬇)', () => {
  it('une interface peut hériter d\'une autre → override → ⬆', () => {
    const symbols: Symbol[] = [
      { name: 'ExtendedSource', kind: 'interface', line: 0, character: 0, depth: 0 },
      { name: 'fetch', kind: 'fun', line: 1, character: 2, depth: 1, isOverride: true },
    ];
    const result = lenses(symbols, {});
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬆ overrides');
  });
});

// ── SP2-OGP-17 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-17 — méthode dans abstract class (depth correct) → ⬇', () => {
  it('class-stack tracking : depth 1 dans abstract class → ⬇', () => {
    const symbols: Symbol[] = [
      { name: 'BaseRepo', kind: 'class', line: 0, character: 0, depth: 0 },
      { name: 'load', kind: 'fun', line: 1, character: 2, depth: 1, isAbstract: true },
    ];
    const result = lenses(symbols, { load: [makeImpl('file:///Impl.kt')] });
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-18 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-18 — méthode après fermeture d\'interface → pas de ⬇ parasite', () => {
  it('classe après interface : profondeur 0 → pas traité comme interface member', () => {
    // DataSource (depth 0 interface) + RepositoryImpl (depth 0 class)
    // fetch est dans DataSource (depth 1), load est dans RepositoryImpl (depth 1)
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
      { name: 'fetch', kind: 'fun', line: 1, character: 2, depth: 1 },
      { name: 'RepositoryImpl', kind: 'class', line: 3, character: 0, depth: 0 },
      { name: 'load', kind: 'fun', line: 4, character: 2, depth: 1 },
    ];
    const result = lenses(symbols, { fetch: [makeImpl('file:///Impl.kt')] }, 'kotlin', {});
    // fetch → interface → 1 lens ⬇ (method level)
    // load → class (not interface, not abstract) → 0 lenses
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
  });
});

// ── SP2-OGP-19 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-19 — interface CLASS avec 1 implémentation → CodeLens ⬇ au niveau classe', () => {
  it('interface DataSource avec 1 impl de classe → ⬇ 1 implementation sur la déclaration', () => {
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
    ];
    const classImpls = { DataSource: [makeImpl('file:///Impl.kt')] };
    const result = lenses(symbols, {}, 'kotlin', classImpls);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 1 implementation');
    expect(result[0].range.start.line).toBe(0);
  });
});

// ── SP2-OGP-20 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-20 — abstract class avec 2 implémentations → CodeLens ⬇ au niveau classe', () => {
  it('abstract class + isAbstract=true → ⬇ 2 implementations', () => {
    const symbols: Symbol[] = [
      { name: 'BaseProcessor', kind: 'class', line: 0, character: 0, depth: 0, isAbstract: true },
    ];
    const classImpls = { BaseProcessor: [makeImpl('file:///ImplA.kt'), makeImpl('file:///ImplB.kt')] };
    const result = lenses(symbols, {}, 'kotlin', classImpls);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 2 implementations');
  });
});

// ── SP2-OGP-21 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-21 — interface sans implémentation de classe → 0 CodeLens de classe', () => {
  it('interface DataSource sans impl → pas de lens ⬇ sur la déclaration', () => {
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
    ];
    const result = lenses(symbols, {}, 'kotlin', {});
    expect(result).toHaveLength(0);
  });
});

// ── SP2-OGP-22 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-22 — sealed class avec 2 sous-types → CodeLens ⬇', () => {
  it('sealedClass + 2 impls → ⬇ 2 implementations', () => {
    const symbols: Symbol[] = [
      { name: 'Result', kind: 'sealedClass', line: 0, character: 0, depth: 0 },
    ];
    const classImpls = { Result: [makeImpl('file:///Success.kt'), makeImpl('file:///Failure.kt')] };
    const result = lenses(symbols, {}, 'kotlin', classImpls);
    expect(result).toHaveLength(1);
    expect(result[0].command!.title).toBe('⬇ 2 implementations');
  });
});

// ── SP2-OGP-23 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-23 — command class-level = kotlin-jump.goToClassImpl', () => {
  it('interface declaration → commande goToClassImpl (pas goToMethodImpl)', () => {
    const symbols: Symbol[] = [
      { name: 'DataSource', kind: 'interface', line: 0, character: 0, depth: 0 },
    ];
    const classImpls = { DataSource: [makeImpl('file:///Impl.kt')] };
    const result = lenses(symbols, {}, 'kotlin', classImpls);
    expect(result).toHaveLength(1);
    expect(result[0].command!.command).toBe('kotlin-jump.goToClassImpl');
    expect(result[0].command!.command).not.toBe('kotlin-jump.goToMethodImpl');
  });
});

// ── SP2-OGP-24 ────────────────────────────────────────────────────────────────

describe('SP2-OGP-24 — arguments class-level = [entry.name, entry.packageName]', () => {
  it('abstract class → args = [name, packageName]', () => {
    const sym = { name: 'BaseRepo', kind: 'class', line: 0, character: 0, depth: 0, isAbstract: true, packageName: 'com.example' } as any;
    const index = makeIndex([sym], {}, { BaseRepo: [makeImpl('file:///Impl.kt')] });
    const provider = new OverrideGutterProvider(index as any);
    const result = provider.provideCodeLenses(makeDoc());
    expect(result).toHaveLength(1);
    expect(result[0].command!.arguments).toEqual(['BaseRepo', 'com.example']);
  });
});
