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

// ── CL-A : méthodes abstract affichent "N implementations" (Fix A) ────────────
//
// AVANT fix : la condition `enclosingKind === 'interface'` excluait les méthodes
// dans les abstract class → elles affichaient "N usages" au lieu de "N implementations".
// APRÈS fix : `enclosingKind === 'interface' || entry.isAbstract`

describe('CL-A — méthodes abstract → "N implementations" et non "N usages"', () => {
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

  it('CL-A — abstract fun execute → resolveCodeLens contient "implementations"', async () => {
    const entry = index.lookup('execute').find(e => e.isAbstract)!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, enclosingKind: 'class' } } as any;

    const resolved = await provider.resolveCodeLens(lens, noCancel());
    // Fix A : doit afficher "2 implementations", pas "N usages"
    expect(resolved.command?.title).toContain('implementation');
    expect(resolved.command?.title).not.toContain('usage');
  });

  it('CL-A — abstract fun describe → même comportement que execute', async () => {
    const entry = index.lookup('describe').find(e => e.isAbstract)!;
    expect(entry).toBeDefined();
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, enclosingKind: 'class' } } as any;

    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toContain('implementation');
  });

  it('CL-A — méthode concrète (isEffective) ne reçoit PAS de traitement "implementations"', async () => {
    const entry = index.lookup('isEffective')[0]!;
    expect(entry).toBeDefined();
    expect(entry.isAbstract).toBeFalsy();
    // isEffective n'est pas abstract → pas de court-circuit "implementations"
    // Elle passe par le chemin normal (scan usages)
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry, enclosingKind: 'class' } } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    // Pas d'impls trouvées pour une méthode concrète → "0 usages" ou similaire
    expect(resolved.command?.title).toBeDefined();
    // Doit NE PAS contenir "implementation" (ce n'est pas une méthode abstract)
    expect(resolved.command?.title).not.toContain('implementation');
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

  it('CL-B — interface method lens → titre contient "2 implementations"', async () => {
    const entry = index.lookup('onCaught').find(e => !e.isOverride)!;
    expect(entry).toBeDefined();
    const lens = {
      range: new Range(entry.line, 0, entry.line, 0),
      data: { entry, enclosingKind: 'interface' },
    } as any;
    const resolved = await provider.resolveCodeLens(lens, noCancel());
    expect(resolved.command?.title).toContain('2 implementation');
  });
});
