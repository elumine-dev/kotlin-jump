/**
 * Tests adversariaux pour KotlinCodeLensProvider.
 *
 * Bugs couverts :
 *   CL-1 — implementation count : collision de noms entre packages → compteur gonflé
 *   CL-A — Fix A : méthodes abstract (pas seulement interface) → "N implementations"
 *   CL-B — Fix B : objets anonymes ($anon$N) ne doivent PAS générer un code lens propre
 *           et doivent être comptés dans les implementations de l'interface
 *           `lookupImplementations(entry.name)` retournait les implementors de TOUTES
 *           les classes nommées "Handler" (même nom simple, packages distincts).
 *           Résultat : le CodeLens de com.a.Handler affichait "2 implementations"
 *           au lieu de "1 implementation".
 *
 *           Fix : appliquer la même logique de désambiguïsation que TypeHierarchyProvider
 *           (disambiguateSubtypes) : garder uniquement les implementors du même package,
 *           plus les cross-package dont le package n'a pas de classe de même nom.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { mockDocument } from './helpers';
import { Range, workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}
function noCancel() { return { isCancellationRequested: false } as any; }

// ── CL-1 — implementation count : collision de noms entre packages ─────────────

describe('CL-1 — implementation count : collision de noms entre packages', () => {
  //
  // Deux classes "Handler" dans des packages distincts.
  // Chaque package a sa propre sous-classe.
  //
  // AVANT fix : lookupImplementations("Handler") → [HandlerA, HandlerB]
  //             CodeLens de com.a.Handler → "2 implementations" ← faux
  // APRÈS fix  : disambiguation same-package → CodeLens → "1 implementation" ✓

  const URI_A_BASE  = 'file:///a/Handler.kt';
  const URI_A_IMPL  = 'file:///a/HandlerA.kt';
  const URI_B_BASE  = 'file:///b/Handler.kt';
  const URI_B_IMPL  = 'file:///b/HandlerB.kt';

  const CODE_A_BASE = 'package com.a\ninterface Handler';
  const CODE_A_IMPL = 'package com.a\nclass HandlerA : Handler';
  const CODE_B_BASE = 'package com.b\ninterface Handler';
  const CODE_B_IMPL = 'package com.b\nclass HandlerB : Handler';

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    // Indexer com.b.Handler EN PREMIER pour rendre le bug déterministe
    addKt(index, URI_B_BASE, CODE_B_BASE);
    addKt(index, URI_B_IMPL, CODE_B_IMPL);
    addKt(index, URI_A_BASE, CODE_A_BASE);
    addKt(index, URI_A_IMPL, CODE_A_IMPL);
    provider = new KotlinCodeLensProvider(index);

    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const map: Record<string, string> = {
        [URI_A_BASE]: CODE_A_BASE, [URI_A_IMPL]: CODE_A_IMPL,
        [URI_B_BASE]: CODE_B_BASE, [URI_B_IMPL]: CODE_B_IMPL,
      };
      return Buffer.from(map[u] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
  });

  it('sans collision : lookupImplementations retourne 2 au total (index brut)', () => {
    // Vérifie que le bug est bien présent sans filtrage
    expect(index.lookupImplementations('Handler')).toHaveLength(2);
  });

  it('CL-1 — CodeLens de com.a.Handler → "1 implementation" (pas 2)', async () => {
    const entry = index.lookup('Handler').find(e => e.packageName === 'com.a')!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;

    // BUG CL-1 (avant fix) : lookupImplementations("Handler").length = 2
    // → title contient "2 implementations" au lieu de "1 implementation"
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toContain('1 implementation');
    expect(resolved.command?.title).not.toContain('2 implementation');
  });

  it('CodeLens de com.b.Handler → "1 implementation" également', async () => {
    const entry = index.lookup('Handler').find(e => e.packageName === 'com.b')!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;

    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toContain('1 implementation');
    expect(resolved.command?.title).not.toContain('2 implementation');
  });

  it('sans collision : Handler unique → implementation count non affecté', async () => {
    const idx = new SymbolIndex();
    const ONLY_URI  = 'file:///only/Service.kt';
    const IMPL1_URI = 'file:///only/ServiceImpl1.kt';
    const IMPL2_URI = 'file:///only/ServiceImpl2.kt';
    const ONLY_CODE  = 'package com.only\ninterface Service';
    const IMPL1_CODE = 'package com.only\nclass ServiceImpl1 : Service';
    const IMPL2_CODE = 'package com.only\nclass ServiceImpl2 : Service';
    addKt(idx, ONLY_URI,  ONLY_CODE);
    addKt(idx, IMPL1_URI, IMPL1_CODE);
    addKt(idx, IMPL2_URI, IMPL2_CODE);
    const p = new KotlinCodeLensProvider(idx);
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const map: Record<string, string> = { [ONLY_URI]: ONLY_CODE, [IMPL1_URI]: IMPL1_CODE, [IMPL2_URI]: IMPL2_CODE };
      return Buffer.from(map[u] ?? '') as any;
    };
    try {
      const entry = idx.lookup('Service')[0]!;
      const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;
      const resolved = await p.resolveCodeLens(lens, noCancel());
      // Pas de collision → les 2 implementors sont gardés
      expect(resolved.command?.title).toContain('2 implementations');
    } finally {
      workspace.fs.readFile = orig;
    }
  });
});

// ── CL-A : méthodes abstract exclues de KotlinCodeLensProvider (délégué à OverrideGutterProvider) ──
//
// AVANT : CodeLensProvider gérait lui-même abstract → "N implementations" (branche resolveCodeLens)
// APRÈS : CodeLensProvider skip les méthodes abstract en provideCodeLenses ;
//         OverrideGutterProvider prend en charge avec ⬇.
// Résultat : plus de lens dupliqué sur les méthodes abstract.

describe('CL-A — méthodes abstract exclues de KotlinCodeLensProvider (no duplicate)', () => {
  const ABSTRACT_URI  = 'file:///a/Move.kt';
  const PHYSICAL_URI  = 'file:///a/PhysicalMove.kt';
  const SPECIAL_URI   = 'file:///a/SpecialMove.kt';

  const ABSTRACT_CODE = `package com.move
abstract class MoveStrategy {
    abstract fun execute(power: Int): Int
    abstract fun describe(): String
    fun isEffective(damage: Int) = damage > 0
}`;

  const PHYSICAL_CODE = `package com.move
class PhysicalMove : MoveStrategy() {
    override fun execute(power: Int): Int = power * 2
    override fun describe() = "physical"
}`;

  const SPECIAL_CODE = `package com.move
class SpecialMove : MoveStrategy() {
    override fun execute(power: Int): Int = power * 3
    override fun describe() = "special"
}`;

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, ABSTRACT_URI,  ABSTRACT_CODE);
    addKt(index, PHYSICAL_URI,  PHYSICAL_CODE);
    addKt(index, SPECIAL_URI,   SPECIAL_CODE);
    provider = new KotlinCodeLensProvider(index);

    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const map: Record<string, string> = {
        [ABSTRACT_URI]: ABSTRACT_CODE,
        [PHYSICAL_URI]: PHYSICAL_CODE,
        [SPECIAL_URI]:  SPECIAL_CODE,
      };
      return Buffer.from(map[u] ?? '') as any;
    };
  });

  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('CL-A — abstract fun execute → usage-only lens (impl count via OverrideGutter)', () => {
    const doc = mockDocument(ABSTRACT_URI, ABSTRACT_CODE);
    const lenses = provider.provideCodeLenses(doc);
    const executeEntry = index.lookup('execute').find(e => e.isAbstract)!;
    const lens = lenses.find(l => l.range.start.line === executeEntry.line);
    expect(lens).toBeDefined();
    // Marked usageOnly so resolveCodeLens reports `N usage(s)` only;
    // OverrideGutterProvider supplies the implementation count.
    expect(((lens as any).data as any).usageOnly).toBe(true);
  });

  it('CL-A — abstract fun describe → usage-only lens', () => {
    const doc = mockDocument(ABSTRACT_URI, ABSTRACT_CODE);
    const lenses = provider.provideCodeLenses(doc);
    const describeEntry = index.lookup('describe').find(e => e.isAbstract)!;
    const lens = lenses.find(l => l.range.start.line === describeEntry.line);
    expect(lens).toBeDefined();
    expect(((lens as any).data as any).usageOnly).toBe(true);
  });

  it('CL-A — méthode concrète (isEffective) reçoit toujours un lens usage', async () => {
    const doc = mockDocument(ABSTRACT_URI, ABSTRACT_CODE);
    const lenses = provider.provideCodeLenses(doc);
    const entry = index.lookup('isEffective')[0]!;
    expect(entry).toBeDefined();
    expect(entry.isAbstract).toBeFalsy();
    // isEffective n'est pas abstract → reçoit un lens normal
    const found = lenses.find(l => l.range.start.line === entry.line);
    expect(found).toBeDefined();
  });
});

// ── CL-B : objets anonymes ne génèrent pas de lens ($anon$ filtrés) (Fix B) ───
//
// AVANT fix : un symbole $anon$N de kind 'object' passait LENS_KINDS et recevait un lens.
// APRÈS fix : `entry.name.startsWith('$')` est rejeté avant la création du lens.

describe('CL-B — objets anonymes ($anon$N) ne génèrent pas de code lens', () => {
  const OBSERVER_URI = 'file:///b/Observer.kt';
  const AUDIT_URI    = 'file:///b/Audit.kt';
  const TRAINER_URI  = 'file:///b/Trainer.kt';

  const OBSERVER_CODE = `package com.obs
interface PokemonObserver {
    fun onCaught(name: String)
}`;

  const AUDIT_CODE = `package com.obs
class AuditObserver : PokemonObserver {
    override fun onCaught(name: String) {}
}`;

  const TRAINER_CODE = `package com.obs
class PokemonTrainer(val obs: PokemonObserver) {
    fun catchWith() {
        val silent = object : PokemonObserver {
            override fun onCaught(name: String) {}
        }
        silent.onCaught("Pikachu")
    }
}`;

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, OBSERVER_URI, OBSERVER_CODE);
    addKt(index, AUDIT_URI,    AUDIT_CODE);
    addKt(index, TRAINER_URI,  TRAINER_CODE);
    provider = new KotlinCodeLensProvider(index);

    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const map: Record<string, string> = {
        [OBSERVER_URI]: OBSERVER_CODE,
        [AUDIT_URI]:    AUDIT_CODE,
        [TRAINER_URI]:  TRAINER_CODE,
      };
      return Buffer.from(map[u] ?? '') as any;
    };
  });

  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('CL-B — $anon$N est indexé (le parser l\'émet)', () => {
    // Vérifie d'abord que le parser émet bien un symbole anonyme
    const trainerSymbols = index.getFileSymbols(TRAINER_URI);
    expect(trainerSymbols.some(s => s.name.startsWith('$anon$'))).toBe(true);
  });

  it('CL-B — provideCodeLenses ne génère PAS de lens pour $anon$N', () => {
    const doc = { uri: { toString: () => TRAINER_URI }, getText: () => TRAINER_CODE } as any;
    const lenses = provider.provideCodeLenses(doc);
    // Aucun lens ne doit avoir pour source un symbole $anon$
    // Les lenses pré-résolus ont une commande ; les non-résolus ont .data
    // On vérifie qu'aucun lens ne correspond à une ligne contenant 'object :'
    const trainerLines = TRAINER_CODE.split('\n');
    const anonLine = trainerLines.findIndex(l => l.includes('object : PokemonObserver'));
    expect(anonLine).toBeGreaterThan(-1); // sanity check
    // Aucun lens sur cette ligne
    expect(lenses.some(l => l.range.start.line === anonLine)).toBe(false);
  });

  it('CL-B — PokemonObserver.onCaught → "2 implementations" (anon + nommé)', async () => {
    // L'objet anonyme compte dans lookupImplementations → 2 impls total
    const impls = index.lookupImplementations('PokemonObserver');
    expect(impls.length).toBe(2); // AuditObserver + $anon$N
  });

  it('CL-B — interface method onCaught → usage-only lens (impl count via OverrideGutter)', () => {
    const doc = mockDocument(OBSERVER_URI, OBSERVER_CODE);
    const lenses = provider.provideCodeLenses(doc);
    const entry = index.lookup('onCaught').find(e => !e.isOverride)!;
    expect(entry).toBeDefined();
    const lens = lenses.find(l => l.range.start.line === entry.line);
    expect(lens).toBeDefined();
    // Avoids duplicating the implementation count owned by
    // OverrideGutterProvider; surfaces "N usage(s)" alongside.
    expect(((lens as any).data as any).usageOnly).toBe(true);
  });
});

// ── CL-C : lens usageOnly pour interface avec usages ─────────────────────────

describe('CL-C — interface avec 2 usages → lens usageOnly résolu à "2 usages"', () => {
  const IFACE_URI = 'file:///c/Repo.kt';
  const IMPL_URI  = 'file:///c/RepoImpl.kt';
  const USER1_URI = 'file:///c/UseA.kt';
  const USER2_URI = 'file:///c/UseB.kt';

  const IFACE_CODE = 'package com.c\ninterface Repo';
  const IMPL_CODE  = 'package com.c\nclass RepoImpl : Repo';
  const USER1_CODE = 'package com.c\nclass UseA(val r: Repo)';
  const USER2_CODE = 'package com.c\nclass UseB(val r: Repo)';

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, IFACE_URI,  IFACE_CODE);
    addKt(index, IMPL_URI,   IMPL_CODE);
    addKt(index, USER1_URI,  USER1_CODE);
    addKt(index, USER2_URI,  USER2_CODE);
    provider = new KotlinCodeLensProvider(index);

    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const map: Record<string, string> = {
        [IFACE_URI]: IFACE_CODE, [IMPL_URI]: IMPL_CODE,
        [USER1_URI]: USER1_CODE, [USER2_URI]: USER2_CODE,
      };
      return Buffer.from(map[u] ?? '') as any;
    };
  });

  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('CL-C — interface Repo → lens usageOnly présent dans provideCodeLenses', () => {
    const doc = mockDocument(IFACE_URI, IFACE_CODE);
    const lenses = provider.provideCodeLenses(doc);
    // interface Repo → lens usageOnly (pas de lens normal)
    expect(lenses.length).toBeGreaterThan(0);
    const usageOnlyLens = (lenses as any[]).find(l => l.data?.usageOnly === true);
    expect(usageOnlyLens).toBeDefined();
  });

  it('CL-C — lens usageOnly résolu → title contient "usages"', async () => {
    const entry = index.lookup('Repo').find(e => e.kind === 'interface')!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, usageOnly: true } } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toMatch(/\d+ usages?/);
  });
});

// ── CL-D : abstract class avec 0 usages → "0 usages" ────────────────────────

describe('CL-D — abstract class avec 0 usages → lens usageOnly résolu à "0 usages"', () => {
  const ABS_URI  = 'file:///d/Base.kt';
  const ABS_CODE = 'package com.d\nabstract class Base';

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, ABS_URI, ABS_CODE);
    provider = new KotlinCodeLensProvider(index);
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      return Buffer.from(u === ABS_URI ? ABS_CODE : '') as any;
    };
  });

  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('CL-D — abstract class Base → lens usageOnly résolu à "0 usages"', async () => {
    const entry = index.lookup('Base')[0]!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, usageOnly: true } } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toBe('0 usages');
  });
});

// ── CL-E : lens usageOnly utilise kotlin-jump.codeLensAction ─────────────────

describe('CL-E — lens usageOnly utilise kotlin-jump.codeLensAction', () => {
  const IFACE_URI  = 'file:///e/Store.kt';
  const IFACE_CODE = 'package com.e\ninterface Store';

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, IFACE_URI, IFACE_CODE);
    provider = new KotlinCodeLensProvider(index);
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      return Buffer.from(u === IFACE_URI ? IFACE_CODE : '') as any;
    };
  });

  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('CL-E — commande = kotlin-jump.codeLensAction', async () => {
    const entry = index.lookup('Store')[0]!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, usageOnly: true } } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.command).toBe('kotlin-jump.codeLensAction');
  });

  it('CL-E — arguments = [uri, line, character, name, fqn]', async () => {
    const entry = index.lookup('Store')[0]!;
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, usageOnly: true } } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    const args = resolved.command?.arguments!;
    expect(args[0]).toBe(entry.uri);
    expect(args[1]).toBe(entry.line);
    expect(args[2]).toBe(entry.character);
    expect(args[3]).toBe(entry.name);
    expect(args[4]).toBe(entry.fqn);
  });
});

// ── CL-F : interface reçoit DEUX lenses ──────────────────────────────────────

describe('CL-F — interface reçoit un lens usageOnly dans KotlinCodeLensProvider', () => {
  const IFACE_URI  = 'file:///f/Cache.kt';
  const IFACE_CODE = 'package com.f\ninterface Cache';

  it('CL-F — interface → exactement 1 lens usageOnly (pas de lens normal)', () => {
    const index = new SymbolIndex();
    addKt(index, IFACE_URI, IFACE_CODE);
    const provider = new KotlinCodeLensProvider(index);
    const doc = mockDocument(IFACE_URI, IFACE_CODE);
    const lenses = provider.provideCodeLenses(doc) as any[];
    // Le lens usageOnly doit être présent
    const usageOnly = lenses.filter(l => l.data?.usageOnly === true);
    expect(usageOnly).toHaveLength(1);
    // Aucun lens normal (data sans usageOnly)
    const normal = lenses.filter(l => l.data && !l.data.usageOnly);
    expect(normal).toHaveLength(0);
  });
});

// ── CL-G : chaque méthode d'interface reçoit un usage-lens (pas seulement la classe) ─

describe("CL-G — chaque suspend fun d'une interface a son propre usage-lens", () => {
  // Reproducer of Kevin's screenshot: ApiService with 3 methods.
  // IntelliJ shows "1 Usage  1 Implementation" above each fun.
  // Pre-fix Kotlin Jump emitted only the OverrideGutter ⬇ implementation
  // count and skipped the usage count entirely.
  const URI = 'file:///g/ApiService.kt';
  const CODE = `package com.example

interface ApiService {
    suspend fun fetchUser(id: String): User
    suspend fun updateUser(user: User)
    suspend fun deleteUser(id: String)
}`;

  it('chacune des 3 méthodes reçoit un lens usageOnly distinct', () => {
    const index = new SymbolIndex();
    addKt(index, URI, CODE);
    const provider = new KotlinCodeLensProvider(index);
    const doc = mockDocument(URI, CODE);
    const lenses = provider.provideCodeLenses(doc) as any[];

    const expectMethodLens = (name: string) => {
      const entry = index.lookup(name).find(e => !e.isOverride);
      expect(entry, `index miss: ${name}`).toBeDefined();
      const lens = lenses.find(l => l.range.start.line === entry!.line);
      expect(lens, `no lens for ${name}`).toBeDefined();
      expect((lens as any).data.usageOnly).toBe(true);
    };
    expectMethodLens('fetchUser');
    expectMethodLens('updateUser');
    expectMethodLens('deleteUser');
  });
});
