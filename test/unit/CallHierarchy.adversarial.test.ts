/**
 * Tests adversariaux pour KotlinCallHierarchyProvider.
 *
 * Bug couvert :
 *   CH-1 — outgoing calls : collision de noms entre packages → mauvaise cible
 *           `provideCallHierarchyOutgoingCalls` utilisait `targets[0]` sans résolution
 *           d'import → quand deux fonctions partagent le même nom simple, l'appel
 *           sortant pouvait pointer vers la mauvaise déclaration.
 *
 *           Fix : utiliser `resolveSearchTarget` (import + même-package) pour
 *           identifier la cible correcte avant de créer l'entrée sortante.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';
import { mockDocument, positionOf } from './helpers';
import { workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}
function noCancel() {
  return { isCancellationRequested: false } as any;
}

// ── CH-1 — outgoing calls : collision de noms entre packages ─────────────────

describe('CH-1 — outgoing calls : collision de noms entre packages', () => {
  //
  // Deux fonctions `helper()` dans des packages distincts.
  // `caller()` est dans le même package que com.pkg.helper.
  //
  // AVANT fix : targets[0] retournait le premier déclarant dans l'index
  //             (ordre d'insertion non garanti) → faux positif possible
  // APRÈS fix  : resolveSearchTarget préfère le même package → com.pkg.helper

  const PKG_HELPER_URI   = 'file:///pkg/PkgHelper.kt';
  const OTHER_HELPER_URI = 'file:///other/OtherHelper.kt';
  const CALLER_URI       = 'file:///pkg/Caller.kt';

  const PKG_HELPER_CODE   = 'package com.pkg\nfun helper() {}';
  const OTHER_HELPER_CODE = 'package com.other\nfun helper() {}';
  // caller est dans com.pkg : il doit appeler com.pkg.helper (même package, pas d'import)
  const CALLER_CODE       = 'package com.pkg\nfun caller() {\n  helper()\n}';

  let index: SymbolIndex;
  let provider: KotlinCallHierarchyProvider;
  let origOpenDoc: typeof workspace.openTextDocument;

  beforeEach(() => {
    origOpenDoc = workspace.openTextDocument;
    index = new SymbolIndex();
    // Indexer com.other.helper EN PREMIER pour rendre le bug déterministe :
    // si targets[0] était utilisé sans résolution, il retournerait com.other.helper.
    addKt(index, OTHER_HELPER_URI, OTHER_HELPER_CODE);
    addKt(index, PKG_HELPER_URI,   PKG_HELPER_CODE);
    addKt(index, CALLER_URI,       CALLER_CODE);
    provider = new KotlinCallHierarchyProvider(index);
    workspace.openTextDocument = async (uri: any) => {
      const u = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return mockDocument(CALLER_URI, CALLER_CODE) as any;
    };
  });

  afterEach(() => {
    workspace.openTextDocument = origOpenDoc;
  });

  it('appel sortant de com.pkg.caller → com.pkg.helper (pas com.other.helper)', async () => {
    const doc    = mockDocument(CALLER_URI, CALLER_CODE);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(CALLER_CODE, 'caller'))!;

    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    // BUG CH-1 (avant fix) : results[0].to.detail contenait 'com.other'
    // Fix : resolveSearchTarget → 'com.pkg' car même package que le caller
    expect(results).toHaveLength(1);
    expect(results[0].to.name).toBe('helper');
    expect(results[0].to.detail).toContain('com.pkg');
    expect(results[0].to.detail).not.toContain('com.other');
  });

  it('sans collision : résultat inchangé', async () => {
    // Quand il n'y a qu'une seule `solo()` dans l'index, pas de changement de comportement
    const SOLO_URI  = 'file:///solo/Solo.kt';
    const SOLO_CODE = 'package com.solo\nfun solo() {}';
    const CALL_URI  = 'file:///solo/Caller.kt';
    const CALL_CODE = 'package com.solo\nfun run() {\n  solo()\n}';

    const idx = new SymbolIndex();
    addKt(idx, SOLO_URI,  SOLO_CODE);
    addKt(idx, CALL_URI,  CALL_CODE);
    const p = new KotlinCallHierarchyProvider(idx);
    workspace.openTextDocument = async () => mockDocument(CALL_URI, CALL_CODE) as any;

    const doc    = mockDocument(CALL_URI, CALL_CODE);
    const [item] = p.prepareCallHierarchy(doc, positionOf(CALL_CODE, 'run'))!;
    const results = await p.provideCallHierarchyOutgoingCalls(item, noCancel());

    expect(results).toHaveLength(1);
    expect(results[0].to.name).toBe('solo');
    expect(results[0].to.detail).toContain('com.solo');
  });

  it('appel via import wildcard cross-package → cible correcte', async () => {
    // caller2 est dans com.app mais importe com.pkg.*
    // → doit appeler com.pkg.helper, pas com.other.helper
    const CALLER2_URI  = 'file:///app/Caller2.kt';
    const CALLER2_CODE = 'package com.app\nimport com.pkg.*\nfun caller2() {\n  helper()\n}';
    addKt(index, CALLER2_URI, CALLER2_CODE);
    workspace.openTextDocument = async () => mockDocument(CALLER2_URI, CALLER2_CODE) as any;

    const doc    = mockDocument(CALLER2_URI, CALLER2_CODE);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(CALLER2_CODE, 'caller2'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    expect(results).toHaveLength(1);
    expect(results[0].to.name).toBe('helper');
    expect(results[0].to.detail).toContain('com.pkg');
    expect(results[0].to.detail).not.toContain('com.other');
  });
});
