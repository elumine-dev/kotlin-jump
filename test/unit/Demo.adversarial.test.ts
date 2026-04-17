/**
 * Tests adversariaux contre les vrais fichiers du workspace démo.
 *
 * Principe : chaque test remplace une vérification manuelle dans VS Code.
 *   ✓ CE QU'ON VEUT    → assertions positives
 *   ✗ CE QU'ON NE VEUT PAS → assertions négatives (faux positifs potentiels)
 *
 * Aucun mock pour les données — on lit les vrais fichiers .kt, .xml, .toml,
 * on les parse avec le vrai KotlinParser, et on fait tourner les vrais providers.
 *
 * Providers testés :
 *   1. OverrideGutterProvider  — ⬆ overrides / ⬇ implementations
 *   2. KotlinCodeLensProvider  — usageOnly lens (interface / abstract class)
 *   3. SuspendMarkerProvider   — ⚡ sur les call sites suspend
 *   4. ColorResourceIndex      — parsing colors.xml
 *   5. VersionCatalogIndex     — parsing libs.versions.toml
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs   from 'fs';
import * as path from 'path';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { OverrideGutterProvider } from '../../src/providers/OverrideGutterProvider';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { SuspendMarkerProvider } from '../../src/providers/SuspendMarkerProvider';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEMO = path.resolve('test/kotlin-jump-demo');

function demoPath(...segs: string[]) {
  return path.join(DEMO, ...segs);
}

function demoUri(...segs: string[]): string {
  return `file://${demoPath(...segs)}`;
}

function readDemo(...segs: string[]): string {
  return fs.readFileSync(demoPath(...segs), 'utf-8');
}

function makeDoc(uri: string, lang = 'kotlin') {
  const code = readDemo(...uri.replace(`file://${DEMO}/`, '').split('/'));
  return mockDocument(uri, code);
}

function addDemo(index: SymbolIndex, ...segs: string[]) {
  const uri  = demoUri(...segs);
  const code = readDemo(...segs);
  index.add(parse(uri, code));
  return { uri, code };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 1 — OverrideGutterProvider sur les fichiers démo réels
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-OGP-1 — ApiService.kt : interface → ⬇ implementations', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'ApiServiceImpl.kt');
  });

  it('✓ ApiService (interface) → lens ⬇ class-level', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt')));
    const classLens = lenses.find(l => l.command?.title.startsWith('⬇') && !l.command.title.includes('→'));
    // La déclaration d'interface doit avoir un lens ⬇
    const classLevel = lenses.find(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToClassImpl',
    );
    expect(classLevel).toBeDefined();
    expect(classLevel!.command!.title).toBe('⬇ 1 implementation');
  });

  it('✓ fetchUser (méthode interface) → lens ⬇ method-level', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt')));
    const methodLenses = lenses.filter(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToMethodImpl',
    );
    // fetchUser, updateUser, deleteUser → 3 méthodes d'interface
    expect(methodLenses.length).toBeGreaterThanOrEqual(1);
    expect(methodLenses[0].command!.title).toBe('⬇ 1 implementation');
  });

  it('✓ total : 4 lenses ⬇ sur ApiService.kt (1 classe + 3 méthodes)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt')));
    const implLenses = lenses.filter(l => l.command?.title.startsWith('⬇'));
    expect(implLenses).toHaveLength(4); // 1 class + fetchUser + updateUser + deleteUser
  });

  it('✗ aucun lens ⬆ sur ApiService.kt (interface pure, pas d\'override)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt')));
    const overrideLenses = lenses.filter(l => l.command?.title.startsWith('⬆'));
    expect(overrideLenses).toHaveLength(0);
  });

  it('✗ command class-level ≠ goToMethodImpl (bug critique corrigé)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt')));
    const classLens = lenses.find(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToMethodImpl',
    );
    // Aucun lens de classe ne doit utiliser goToMethodImpl
    const badLens = lenses.find(l =>
      l.command?.command === 'kotlin-jump.goToMethodImpl' &&
      l.range.start.line === 2, // ligne de "interface ApiService"
    );
    expect(badLens).toBeUndefined();
  });
});

describe('DEMO-OGP-2 — ApiServiceImpl.kt : override methods → ⬆ overrides', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'ApiServiceImpl.kt');
  });

  it('✓ 3 overrides dans ApiServiceImpl → 3 lenses ⬆', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiServiceImpl.kt')));
    const overrideLenses = lenses.filter(l => l.command?.title === '⬆ overrides');
    expect(overrideLenses).toHaveLength(3); // fetchUser, updateUser, deleteUser
  });

  it('✓ commande ⬆ = revealDefinitionAt', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiServiceImpl.kt')));
    const overrideLenses = lenses.filter(l => l.command?.title === '⬆ overrides');
    for (const lens of overrideLenses) {
      expect(lens.command!.command).toBe('kotlin-jump.revealDefinitionAt');
    }
  });

  it('✗ aucun lens ⬇ sur ApiServiceImpl.kt (méthodes concrètes, pas abstract)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiServiceImpl.kt')));
    const implLenses = lenses.filter(l => l.command?.title.startsWith('⬇'));
    expect(implLenses).toHaveLength(0);
  });
});

describe('DEMO-OGP-3 — UserRepository.kt : interface + impl dans le même fichier', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'UserRepository.kt');
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'UserCache.kt');
  });

  it('✓ UserRepository (interface) → ⬇ 1 implementation (class-level)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserRepository.kt')));
    const classLens = lenses.find(l => l.command?.command === 'kotlin-jump.goToClassImpl');
    expect(classLens).toBeDefined();
    expect(classLens!.command!.title).toBe('⬇ 1 implementation');
  });

  it('✓ méthodes getUser/saveUser/observeUsers dans interface → 3 lenses ⬇ method-level', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserRepository.kt')));
    const methodImpls = lenses.filter(l => l.command?.command === 'kotlin-jump.goToMethodImpl');
    expect(methodImpls.length).toBeGreaterThanOrEqual(3);
  });

  it('✓ overrides dans UserRepositoryImpl → 3 lenses ⬆', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserRepository.kt')));
    const overrideLenses = lenses.filter(l => l.command?.title === '⬆ overrides');
    expect(overrideLenses).toHaveLength(3); // getUser, saveUser, observeUsers
  });
});

describe('DEMO-OGP-4 — Pokemon.kt : BattleResult sealed class → ⬇', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'Pokemon.kt');
  });

  it('✓ BattleResult sealed → ⬇ 3 implementations (Victory, Defeat, Draw)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'Pokemon.kt')));
    const sealedLens = lenses.find(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToClassImpl',
    );
    expect(sealedLens).toBeDefined();
    expect(sealedLens!.command!.title).toBe('⬇ 3 implementations');
  });

  it('✗ data class Pokemon → aucun lens ⬇ (classe concrète ordinaire)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'Pokemon.kt')));
    // Pokemon est une data class ordinaire → pas de lens ⬇ class-level
    const pokemonEntry = index.lookup('Pokemon').find(e => e.kind === 'dataClass');
    if (pokemonEntry) {
      const pokemonLens = lenses.find(l =>
        l.range.start.line === pokemonEntry.line &&
        l.command?.title.startsWith('⬇'),
      );
      expect(pokemonLens).toBeUndefined();
    }
  });
});

describe('DEMO-OGP-5 — SealedWhenDemo.kt : CombatResult sealed → ⬇', () => {
  const DEMO_PKG = 'src/main/kotlin/com/example/demo';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, DEMO_PKG, 'SealedWhenDemo.kt');
  });

  it('✓ CombatResult sealed → ⬇ 3 implementations', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(DEMO_PKG, 'SealedWhenDemo.kt')));
    const combatLens = lenses.find(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToClassImpl' &&
      l.command?.arguments?.[0] === 'CombatResult',
    );
    expect(combatLens).toBeDefined();
    expect(combatLens!.command!.title).toBe('⬇ 3 implementations');
  });

  it('✓ LoadState sealed → ⬇ 3 implementations (Loading, Success, Error)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(DEMO_PKG, 'SealedWhenDemo.kt')));
    const loadLens = lenses.find(l => l.command?.arguments?.[0] === 'LoadState');
    expect(loadLens).toBeDefined();
    expect(loadLens!.command!.title).toBe('⬇ 3 implementations');
  });

  it('✓ NetworkState sealed → ⬇ 4 implementations', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(DEMO_PKG, 'SealedWhenDemo.kt')));
    const netLens = lenses.find(l => l.command?.arguments?.[0] === 'NetworkState');
    expect(netLens).toBeDefined();
    expect(netLens!.command!.title).toBe('⬇ 4 implementations');
  });

  it('✓ PokemonAction sealed → ⬇ 5 implementations', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(DEMO_PKG, 'SealedWhenDemo.kt')));
    const actionLens = lenses.find(l => l.command?.arguments?.[0] === 'PokemonAction');
    expect(actionLens).toBeDefined();
    expect(actionLens!.command!.title).toBe('⬇ 5 implementations');
  });

  it('✗ fonctions libres (describeResult, etc.) → aucun lens ⬇', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(DEMO_PKG, 'SealedWhenDemo.kt')));
    // Les fonctions ordinaires ne doivent pas avoir de lens ⬇
    const fnLenses = lenses.filter(l =>
      l.command?.title.startsWith('⬇') &&
      l.command?.command === 'kotlin-jump.goToMethodImpl',
    );
    expect(fnLenses).toHaveLength(0);
  });
});

describe('DEMO-OGP-6 — classes concrètes régulières → 0 lenses', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'UserCache.kt');
    addDemo(index, MAIN, 'PokemonStorage.kt');
    addDemo(index, MAIN, 'BattleEngine.kt');
  });

  it('✗ UserCache (classe concrète) → 0 lenses OverrideGutter', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserCache.kt')));
    expect(lenses).toHaveLength(0);
  });

  it('✗ PokemonStorage (classe concrète) → 0 lenses OverrideGutter', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'PokemonStorage.kt')));
    expect(lenses).toHaveLength(0);
  });

  it('✗ BattleEngine (classe concrète) → 0 lenses OverrideGutter', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'BattleEngine.kt')));
    expect(lenses).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 2 — KotlinCodeLensProvider sur les fichiers démo réels
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-CL-1 — ApiService.kt : CodeLensProvider → usageOnly lens uniquement', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'ApiServiceImpl.kt');
    provider = new KotlinCodeLensProvider(index);
  });

  it('✓ ApiService (interface) → 1 lens usageOnly dans CodeLensProvider', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt'))) as any[];
    const usageOnly = lenses.filter(l => l.data?.usageOnly === true);
    expect(usageOnly).toHaveLength(1);
    // La lens usageOnly doit être sur la ligne de l'interface
    const apiEntry = index.lookup('ApiService')[0]!;
    expect(usageOnly[0].range.start.line).toBe(apiEntry.line);
  });

  it('✗ CodeLensProvider NE génère PAS de lens normal pour ApiService (c\'est une interface)', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt'))) as any[];
    const normal = lenses.filter(l => l.data && !l.data.usageOnly);
    expect(normal).toHaveLength(0);
  });

  it('✗ méthodes d\'interface (fetchUser, updateUser, deleteUser) → 0 lens CodeLensProvider', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiService.kt'))) as any[];
    const fetchEntry = index.lookup('fetchUser').find(e => !e.isOverride);
    if (fetchEntry) {
      const lens = lenses.find(l => l.range.start.line === fetchEntry.line);
      expect(lens).toBeUndefined();
    }
  });
});

describe('DEMO-CL-2 — ApiServiceImpl.kt : CodeLensProvider → lens normal (pas usageOnly)', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'ApiServiceImpl.kt');
    provider = new KotlinCodeLensProvider(index);
  });

  it('✓ ApiServiceImpl (classe concrète) → lens normal (data.usageOnly absent)', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiServiceImpl.kt'))) as any[];
    const implEntry = index.lookup('ApiServiceImpl')[0]!;
    const classLens = lenses.find(l => l.range.start.line === implEntry.line && l.data);
    expect(classLens).toBeDefined();
    expect((classLens as any).data?.usageOnly).toBeFalsy();
  });

  it('✗ override methods dans ApiServiceImpl → 0 lens (isOverride → skip)', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'ApiServiceImpl.kt'))) as any[];
    const overrideEntries = index.getFileSymbols(demoUri(MAIN, 'ApiServiceImpl.kt'))
      .filter(e => e.isOverride);
    for (const entry of overrideEntries) {
      const lens = (lenses as any[]).find(l => l.range.start.line === entry.line && l.data);
      expect(lens).toBeUndefined();
    }
  });
});

describe('DEMO-CL-3 — UserRepository.kt : interface + impl → double registre', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'UserRepository.kt');
    addDemo(index, MAIN, 'ApiService.kt');
    addDemo(index, MAIN, 'UserCache.kt');
    provider = new KotlinCodeLensProvider(index);
  });

  it('✓ UserRepository (interface) → lens usageOnly', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserRepository.kt'))) as any[];
    const usageOnly = lenses.filter(l => l.data?.usageOnly === true);
    const repoEntry = index.lookup('UserRepository').find(e => e.kind === 'interface');
    expect(usageOnly.some(l => l.range.start.line === repoEntry?.line)).toBe(true);
  });

  it('✓ UserRepositoryImpl (classe concrète) → lens normal', () => {
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'UserRepository.kt'))) as any[];
    const implEntry = index.lookup('UserRepositoryImpl')[0]!;
    const normal = (lenses as any[]).filter(l => l.data && !l.data.usageOnly);
    expect(normal.some(l => l.range.start.line === implEntry.line)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 3 — SuspendMarkerProvider sur CoroutinesDemo.kt
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-SMP-1 — CoroutinesDemo.kt : ⚡ sur les call sites suspend', () => {
  const DEMO_PKG = 'src/main/kotlin/com/example/demo';
  const CODE_PATH = demoPath(DEMO_PKG, 'CoroutinesDemo.kt');
  const CODE_URI  = demoUri(DEMO_PKG, 'CoroutinesDemo.kt');

  let index: SymbolIndex;
  let provider: SuspendMarkerProvider;
  let doc: any;

  beforeAll(() => {
    index = new SymbolIndex();
    const code = readDemo(DEMO_PKG, 'CoroutinesDemo.kt');
    index.add(parse(CODE_URI, code));
    provider = new SuspendMarkerProvider(index);
    doc = mockDocument(CODE_URI, code);
  });

  function hintsForFile() {
    const lines = readDemo(DEMO_PKG, 'CoroutinesDemo.kt').split('\n');
    const range = { start: { line: 0 }, end: { line: lines.length - 1 } } as any;
    return (provider as any).provideInlayHints(doc, range);
  }

  function lineOf(snippet: string): number {
    const code = readDemo(DEMO_PKG, 'CoroutinesDemo.kt');
    return code.split('\n').findIndex(l => l.includes(snippet));
  }

  it('✓ fetchAllPokemon() call site → ⚡ hint présent', () => {
    const hints = hintsForFile();
    const callLine = lineOf('val allPokemon = fetchAllPokemon()');
    expect(callLine).toBeGreaterThan(-1);
    expect(hints.some((h: any) => h.position.line === callLine)).toBe(true);
  });

  it('✓ delay(500) call site → ⚡ hint présent', () => {
    const hints = hintsForFile();
    const callLine = lineOf('delay(500)');
    expect(callLine).toBeGreaterThan(-1);
    expect(hints.some((h: any) => h.position.line === callLine)).toBe(true);
  });

  it('✓ savePokemon() call site → ⚡ hint présent', () => {
    const hints = hintsForFile();
    const callLine = lineOf('savePokemon(allPokemon.first())');
    expect(callLine).toBeGreaterThan(-1);
    expect(hints.some((h: any) => h.position.line === callLine)).toBe(true);
  });

  it('✗ suspend fun fetchAllPokemon() déclaration → PAS de ⚡ hint', () => {
    const hints = hintsForFile();
    const declLine = lineOf('suspend fun fetchAllPokemon(): List<Pokemon>');
    expect(declLine).toBeGreaterThan(-1);
    const hintsOnDecl = hints.filter((h: any) => h.position.line === declLine);
    expect(hintsOnDecl).toHaveLength(0);
  });

  it('✗ suspend fun delay() déclaration → PAS de ⚡ hint', () => {
    const hints = hintsForFile();
    const declLine = lineOf('suspend fun delay(ms: Long)');
    expect(declLine).toBeGreaterThan(-1);
    expect(hints.some((h: any) => h.position.line === declLine)).toBe(false);
  });

  it('✗ commentaire "// ⚡ (stdlib suspend)" → PAS de ⚡ hint sur la ligne de commentaire pur', () => {
    const hints = hintsForFile();
    const code = readDemo(DEMO_PKG, 'CoroutinesDemo.kt');
    // Lignes qui commencent par "// " ne doivent pas avoir de hint
    const commentLines = code.split('\n')
      .map((l, i) => ({ i, t: l.trimStart() }))
      .filter(x => x.t.startsWith('//'))
      .map(x => x.i);
    for (const ln of commentLines) {
      expect(hints.some((h: any) => h.position.line === ln)).toBe(false);
    }
  });

  it('✓ ⚡ label présent sur tous les hints', () => {
    const hints = hintsForFile();
    expect(hints.length).toBeGreaterThan(0);
    for (const h of hints) {
      expect(h.label).toBe('⚡');
    }
  });

  it('✓ paddingRight = true sur tous les hints', () => {
    const hints = hintsForFile();
    for (const h of hints) {
      expect(h.paddingRight).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 4 — ColorResourceIndex sur colors.xml réel
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-CRI-1 — colors.xml réel : toutes les couleurs indexées correctement', () => {
  const XML_PATH = 'src/main/res/values/colors.xml';
  let index: ColorResourceIndex;

  beforeAll(() => {
    index = new ColorResourceIndex();
    const uri = { toString: () => `file://${demoPath(XML_PATH)}` };
    index.reindexFile(uri, readDemo(XML_PATH));
  });

  // ── Couleurs existantes ────────────────────────────────────────────────────

  it('✓ primary → #7F52FF', () => {
    expect(index.getValue('primary')?.value).toBe('#7F52FF');
  });

  it('✓ secondary → #FF5722', () => {
    expect(index.getValue('secondary')?.value).toBe('#FF5722');
  });

  it('✓ error → #B00020', () => {
    expect(index.getValue('error')?.value).toBe('#B00020');
  });

  it('✓ type_fire → #FF4500 (Pokémon type color)', () => {
    expect(index.getValue('type_fire')?.value).toBe('#FF4500');
  });

  it('✓ type_water → #1E90FF', () => {
    expect(index.getValue('type_water')?.value).toBe('#1E90FF');
  });

  it('✓ translucent_black → #99000000 (AARRGGBB format)', () => {
    expect(index.getValue('translucent_black')?.value).toBe('#99000000');
  });

  it('✓ accent_short → #F00 (RGB shorthand)', () => {
    expect(index.getValue('accent_short')?.value).toBe('#F00');
  });

  it('✓ semi_transparent_white → #8FFF (ARGB shorthand)', () => {
    expect(index.getValue('semi_transparent_white')?.value).toBe('#8FFF');
  });

  it('✓ scrim → #66000000 (AARRGGBB avec alpha)', () => {
    expect(index.getValue('scrim')?.value).toBe('#66000000');
  });

  // ── Couleurs inexistantes ─────────────────────────────────────────────────

  it('✗ this_color_does_not_exist → undefined', () => {
    expect(index.getValue('this_color_does_not_exist')).toBeUndefined();
  });

  it('✗ clé vide → undefined', () => {
    expect(index.getValue('')).toBeUndefined();
  });

  it('✗ après removeFile → toutes les couleurs deviennent undefined', () => {
    const idx = new ColorResourceIndex();
    const uri = { toString: () => `file://${demoPath(XML_PATH)}` };
    idx.reindexFile(uri, readDemo(XML_PATH));
    expect(idx.getValue('primary')?.value).toBe('#7F52FF'); // sanity
    idx.removeFile(uri);
    expect(idx.getValue('primary')).toBeUndefined();
    expect(idx.getValue('type_fire')).toBeUndefined();
  });

  it('✓ 6 couleurs de type Pokémon toutes présentes', () => {
    const types = ['type_fire', 'type_water', 'type_grass', 'type_electric', 'type_psychic', 'type_dragon'];
    for (const t of types) {
      expect(index.getValue(t)).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 5 — VersionCatalogIndex sur libs.versions.toml réel
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-VCI-1 — libs.versions.toml réel : accesseurs résolus correctement', () => {
  let index: VersionCatalogIndex;

  beforeAll(() => {
    index = new VersionCatalogIndex();
    index.reindexFile(readDemo('gradle', 'libs.versions.toml'));
  });

  // ── Dépendances coroutines ────────────────────────────────────────────────

  it('✓ libs.coroutines.core → org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3', () => {
    const e = index.getByAccessor('coroutines.core');
    expect(e).toBeDefined();
    expect(e!.group).toBe('org.jetbrains.kotlinx');
    expect(e!.name).toBe('kotlinx-coroutines-core');
    expect(e!.version).toBe('1.7.3');
  });

  it('✓ libs.coroutines-core (hyphen direct) → même résultat', () => {
    const e = index.getByAccessor('coroutines-core');
    expect(e).toBeDefined();
    expect(e!.version).toBe('1.7.3');
  });

  // ── AndroidX ─────────────────────────────────────────────────────────────

  it('✓ libs.core.ktx → androidx.core:core-ktx:1.12.0', () => {
    const e = index.getByAccessor('core.ktx');
    expect(e).toBeDefined();
    expect(e!.group).toBe('androidx.core');
    expect(e!.name).toBe('core-ktx');
    expect(e!.version).toBe('1.12.0');
  });

  it('✓ libs.lifecycle.viewmodel → androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0', () => {
    const e = index.getByAccessor('lifecycle.viewmodel');
    expect(e).toBeDefined();
    expect(e!.group).toBe('androidx.lifecycle');
    expect(e!.version).toBe('2.7.0');
  });

  it('✓ libs.navigation.fragment → androidx.navigation:navigation-fragment-ktx:2.7.6', () => {
    const e = index.getByAccessor('navigation.fragment');
    expect(e).toBeDefined();
    expect(e!.group).toBe('androidx.navigation');
    expect(e!.version).toBe('2.7.6');
  });

  // ── Network ───────────────────────────────────────────────────────────────

  it('✓ libs.retrofit.core → com.squareup.retrofit2:retrofit:2.9.0', () => {
    const e = index.getByAccessor('retrofit.core');
    expect(e).toBeDefined();
    expect(e!.group).toBe('com.squareup.retrofit2');
    expect(e!.name).toBe('retrofit');
    expect(e!.version).toBe('2.9.0');
  });

  it('✓ libs.okhttp.logging → com.squareup.okhttp3:logging-interceptor:4.12.0', () => {
    const e = index.getByAccessor('okhttp.logging');
    expect(e).toBeDefined();
    expect(e!.name).toBe('logging-interceptor');
    expect(e!.version).toBe('4.12.0');
  });

  // ── Testing ───────────────────────────────────────────────────────────────

  it('✓ libs.junit4 → junit:junit:4.13.2', () => {
    const e = index.getByAccessor('junit4');
    expect(e).toBeDefined();
    expect(e!.group).toBe('junit');
    expect(e!.name).toBe('junit');
    expect(e!.version).toBe('4.13.2');
  });

  it('✓ libs.junit5.api → org.junit.jupiter:junit-jupiter-api:5.10.1', () => {
    const e = index.getByAccessor('junit5.api');
    expect(e).toBeDefined();
    expect(e!.group).toBe('org.junit.jupiter');
    expect(e!.version).toBe('5.10.1');
  });

  it('✓ libs.mockk → io.mockk:mockk:1.13.9', () => {
    const e = index.getByAccessor('mockk');
    expect(e).toBeDefined();
    expect(e!.group).toBe('io.mockk');
    expect(e!.version).toBe('1.13.9');
  });

  // ── Compose ───────────────────────────────────────────────────────────────

  it('✓ libs.compose.ui → androidx.compose.ui:ui:1.6.2', () => {
    const e = index.getByAccessor('compose.ui');
    expect(e).toBeDefined();
    expect(e!.group).toBe('androidx.compose.ui');
    expect(e!.name).toBe('ui');
    expect(e!.version).toBe('1.6.2');
  });

  it('✓ libs.compose.material3 → androidx.compose.material3:material3:1.2.0', () => {
    const e = index.getByAccessor('compose.material3');
    expect(e).toBeDefined();
    expect(e!.version).toBe('1.2.0');
  });

  // ── Cas négatifs ──────────────────────────────────────────────────────────

  it('✗ libs.unknown.lib → undefined', () => {
    expect(index.getByAccessor('unknown.lib')).toBeUndefined();
  });

  it('✗ libs.bundles.compose → undefined (section [bundles] ignorée)', () => {
    // Les bundles ne doivent PAS être dans l'index des bibliothèques
    expect(index.getByAccessor('compose')).toBeUndefined();
  });

  it('✗ libs.plugins.android → undefined (section [plugins] ignorée)', () => {
    expect(index.getByAccessor('android.application')).toBeUndefined();
  });

  it('✓ reindexFile appelé 2× → seule la deuxième version est retenue', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(readDemo('gradle', 'libs.versions.toml'));
    const first = idx.getByAccessor('junit4')?.version;
    // Réindexer avec un TOML minimal
    idx.reindexFile('[libraries]\njunit4 = "junit:junit:3.0.0"');
    expect(idx.getByAccessor('junit4')?.version).toBe('3.0.0');
    expect(idx.getByAccessor('coroutines.core')).toBeUndefined(); // disparu
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 6 — Constants.kt : KotlinParser émet bien isConst + constValue
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-CONST-1 — Constants.kt réel : parser émet constValue correct', () => {
  const APP_PKG = 'src/main/kotlin/com/example/app';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, APP_PKG, 'Constants.kt');
  });

  it('✓ TIMEOUT_MS → isConst=true, constValue="5000"', () => {
    const e = index.lookup('TIMEOUT_MS')[0];
    expect(e).toBeDefined();
    expect(e!.isConst).toBe(true);
    expect(e!.constValue).toBe('5000');
  });

  it('✓ API_VERSION → isConst=true, constValue=\'"v2"\'', () => {
    const e = index.lookup('API_VERSION')[0];
    expect(e).toBeDefined();
    expect(e!.isConst).toBe(true);
    expect(e!.constValue).toBe('"v2"');
  });

  it('✓ MAX_RETRIES → constValue="3"', () => {
    const e = index.lookup('MAX_RETRIES')[0];
    expect(e!.constValue).toBe('3');
  });

  it('✓ BASE_XP_MULTIPLIER → constValue="1.5f"', () => {
    const e = index.lookup('BASE_XP_MULTIPLIER')[0];
    expect(e!.constValue).toBe('1.5f');
  });

  it('✓ ENABLE_ANALYTICS → constValue="true"', () => {
    const e = index.lookup('ENABLE_ANALYTICS')[0];
    expect(e!.constValue).toBe('true');
  });

  it('✓ MAX_POKEMON_ID → constValue="151L" (Long)', () => {
    const e = index.lookup('MAX_POKEMON_ID')[0];
    expect(e!.constValue).toBe('151L');
  });

  it('✓ toutes les const val de Constants.kt sont isConst=true', () => {
    const constNames = [
      'TIMEOUT_MS', 'MAX_RETRIES', 'PAGE_SIZE', 'MAX_TEAM_SIZE', 'LEVEL_CAP',
      'BASE_XP_MULTIPLIER', 'ENABLE_ANALYTICS', 'DEBUG_MODE', 'API_VERSION',
      'BASE_URL_PATH', 'CACHE_SUFFIX', 'LOG_TAG', 'MAX_POKEMON_ID', 'BATTLE_ROUND_LIMIT',
    ];
    for (const name of constNames) {
      const e = index.lookup(name)[0];
      expect(e, `${name} introuvable dans l'index`).toBeDefined();
      expect(e!.isConst, `${name}.isConst devrait être true`).toBe(true);
      expect(e!.constValue, `${name}.constValue devrait être défini`).toBeDefined();
    }
  });

  it('✗ classes PaginationConfig / BattleConfig → isConst absent', () => {
    const e = index.lookup('PaginationConfig')[0];
    expect(e).toBeDefined();
    expect(e!.isConst).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTIE 7 — PokeApiService.kt : désambiguïsation (même pattern que Handler)
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO-OGP-7 — PokeApiService.kt : no name collision → count correct', () => {
  const MAIN = 'src/main/kotlin/com/example/data';
  let index: SymbolIndex;

  beforeAll(() => {
    index = new SymbolIndex();
    addDemo(index, MAIN, 'PokeApiService.kt');
  });

  it('✓ PokeApiService (interface) → ⬇ 1 implementation (sans faux positif)', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'PokeApiService.kt')));
    const classLens = lenses.find(l => l.command?.command === 'kotlin-jump.goToClassImpl');
    expect(classLens).toBeDefined();
    expect(classLens!.command!.title).toBe('⬇ 1 implementation');
    // arguments = [name, packageName]
    expect(classLens!.command!.arguments![0]).toBe('PokeApiService');
    expect(classLens!.command!.arguments![1]).toBe('com.example.data');
  });

  it('✓ PokeApiServiceImpl overrides → 2 lenses ⬆', () => {
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(demoUri(MAIN, 'PokeApiService.kt')));
    const overrides = lenses.filter(l => l.command?.title === '⬆ overrides');
    expect(overrides).toHaveLength(2); // fetchPokemon + searchByType
  });
});
