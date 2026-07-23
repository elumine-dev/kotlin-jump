/**
 * Issue #3 — multi-root workspace, même FQN dans deux roots.
 *
 * Deux fichiers copiés d'un root à l'autre (même package, même classe,
 * même méthode) doivent produire des TestItems distincts, et le run doit
 * résoudre l'entry du fichier de l'item — pas une entry arbitraire via
 * lookupFqn (qui ne garde qu'une entry par FQN, donc l'autre root gagnait
 * et le runner choisissait la task du mauvais projet Gradle : `test` au
 * lieu de `testDebugUnitTest`).
 *
 * Vecteurs :
 *   MR-1  Deux class items distincts, un par root, avec le bon uri
 *   MR-2  collectSpecs résout l'entry du fichier de l'item cliqué
 *   MR-3  findMethodItem / findClassItem épinglés par uri
 *   MR-4  findMethodItem sans uri — fallback premier match (compat)
 *   MR-5  Item périmé (fichier retiré de l'index) → spec ignorée, pas de
 *         résolution croisée vers l'autre root
 *   MR-6  removeFileTests d'un root ne supprime pas les items de l'autre
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinTestController } from '../../src/testing/KotlinTestController';
import { NullLogger } from '../../src/util/logger';

const URI_A = 'file:///workspace/app/src/test/java/com/example/ExampleUnitTest.kt';
const URI_B = 'file:///workspace/android-studio/app/src/test/java/com/example/ExampleUnitTest.kt';
const CLASS_FQN  = 'com.example.ExampleUnitTest';
const METHOD_FQN = 'com.example.ExampleUnitTest.addition_isCorrect';

const KT_SOURCE = [
  'package com.example',
  '',
  'class ExampleUnitTest {',
  '  @Test',
  '  fun addition_isCorrect() {',
  '  }',
  '}',
].join('\n');

function makeController(index: SymbolIndex): KotlinTestController {
  const context = {
    subscriptions: [] as { dispose(): void }[],
    workspaceState: {
      get: <T>(_k: string, def?: T) => def,
      update: async () => {},
    },
  } as unknown as vscode.ExtensionContext;
  return new KotlinTestController(index, context, new NullLogger() as any);
}

describe('Issue #3 — same test FQN across workspace roots', () => {
  let index: SymbolIndex;
  let ctrl: KotlinTestController;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI_A, KT_SOURCE), ':app');
    index.add(parse(URI_B, KT_SOURCE), ':app');
    ctrl = makeController(index);
    ctrl.refreshFileTests(vscode.Uri.parse(URI_A));
    ctrl.refreshFileTests(vscode.Uri.parse(URI_B));
  });

  it('MR-1 — deux class items distincts, un par root, chacun avec le bon uri', () => {
    const itemA = ctrl.findClassItem(CLASS_FQN, URI_A);
    const itemB = ctrl.findClassItem(CLASS_FQN, URI_B);
    expect(itemA).toBeDefined();
    expect(itemB).toBeDefined();
    expect(itemA!.id).not.toBe(itemB!.id);
    expect(itemA!.uri!.toString()).toBe(URI_A);
    expect(itemB!.uri!.toString()).toBe(URI_B);
  });

  it('MR-2 — collectSpecs résout l\'entry du fichier de l\'item cliqué', () => {
    const methodB = ctrl.findMethodItem(METHOD_FQN, URI_B);
    expect(methodB).toBeDefined();

    const specs = (ctrl as any).collectSpecs(new vscode.TestRunRequest([methodB]));
    expect(specs).toHaveLength(1);
    // Avant le fix : lookupFqn renvoyait l'entry du root A (dernier indexé
    // écrase, ou premier gagne) → mauvais projet Gradle détecté.
    expect(specs[0].entry.uri.toString()).toBe(URI_B);
    expect(specs[0].entry.fqn).toBe(METHOD_FQN);
  });

  it('MR-3 — le run du root A résout le fichier A', () => {
    const methodA = ctrl.findMethodItem(METHOD_FQN, URI_A);
    const specs = (ctrl as any).collectSpecs(new vscode.TestRunRequest([methodA]));
    expect(specs).toHaveLength(1);
    expect(specs[0].entry.uri.toString()).toBe(URI_A);
  });

  it('MR-4 — findMethodItem sans uri retombe sur un match par FQN (compat)', () => {
    const item = ctrl.findMethodItem(METHOD_FQN);
    expect(item).toBeDefined();
    expect(item!.id.startsWith('mth|' + METHOD_FQN + '|')).toBe(true);
  });

  it('MR-5 — item périmé : fichier retiré de l\'index → spec ignorée, pas de résolution croisée', () => {
    const methodB = ctrl.findMethodItem(METHOD_FQN, URI_B);
    expect(methodB).toBeDefined();

    // Le fichier B disparaît de l'index mais l'item n'a pas encore été purgé
    index.remove(vscode.Uri.parse(URI_B) as any);

    const specs = (ctrl as any).collectSpecs(new vscode.TestRunRequest([methodB]));
    // Ancien comportement : lookupFqn aurait résolu l'entry du root A et
    // lancé le test du mauvais projet. On attend zéro spec.
    expect(specs).toHaveLength(0);
  });

  it('MR-6 — removeFileTests d\'un root laisse les items de l\'autre intacts', () => {
    ctrl.removeFileTests(vscode.Uri.parse(URI_A));
    expect(ctrl.findClassItem(CLASS_FQN, URI_A)).toBeUndefined();
    expect(ctrl.findClassItem(CLASS_FQN, URI_B)).toBeDefined();
    expect(ctrl.findMethodItem(METHOD_FQN, URI_B)).toBeDefined();
  });
});
