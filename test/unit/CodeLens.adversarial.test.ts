/**
 * Tests adversariaux pour KotlinCodeLensProvider.
 *
 * Bug couvert :
 *   CL-1 — implementation count : collision de noms entre packages → compteur gonflé
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
