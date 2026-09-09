import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { clearContentCache } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

// Audit 41 : le compteur du lens comptait les surcharges du même nom comme des
// usages. `withoutDeclaration` n'en retirait qu'une, celle sous le curseur, et
// la ligne `fun` d'une surcharge sœur restait dans le total. Cas réel :
// LaPresse, EmptyReplicaApplicationComponent (composant Dagger) déclare 176
// surcharges de `inject` ; le lens affichait 354 usages pour 179 réels. Une
// fonction que personne n'appelle pouvait afficher « 1 usage ».

const URI = 'file:///a41/Component.kt';
const CODE = [
  'package com.example',
  '',
  'class Envoyeur {',
  '    fun envoyer(n: Int) {}',
  '    fun envoyer(s: String) {}',
  '}',
  '',
  'fun appelant(e: Envoyeur) {',
  '    e.envoyer(1)',
  '}',
].join('\n');

const LIGNES = CODE.split('\n');
const ligneDe = (aiguille: string) => LIGNES.findIndex(l => l.includes(aiguille));

describe('Le compteur du lens ne compte pas les surcharges comme des usages', () => {
  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  const origRead = workspace.fs.readFile;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    provider = new KotlinCodeLensProvider(index);
    workspace.fs.readFile = (async () => Buffer.from(CODE)) as any;
  });

  afterEach(() => {
    workspace.fs.readFile = origRead;
    clearContentCache();
    provider.dispose();
  });

  it('deux surcharges et un seul appel donnent « 1 usage », pas deux', async () => {
    // Les deux `fun envoyer` partagent le FQN : c'est ce partage qui faisait
    // compter la ligne de la sœur.
    const decls = index.lookup('envoyer');
    expect(decls.length).toBe(2);
    expect(new Set(decls.map(d => d.fqn)).size).toBe(1);

    const doc = mockDocument(URI, CODE);
    const lenses = provider.provideCodeLenses(doc);
    const cible = lenses.find(l => {
      const d = (l as any).data;
      return d?.entry?.name === 'envoyer' && d.entry.line === ligneDe('fun envoyer(n: Int)');
    });
    expect(cible).toBeDefined();

    const resolu = await provider.resolveCodeLens(cible as any, { isCancellationRequested: false } as any);
    expect(resolu.command?.title).toBe('1 usage');
  });

  it('la seconde surcharge compte l\'appel, pas la déclaration de sa sœur', async () => {
    const doc = mockDocument(URI, CODE);
    const lenses = provider.provideCodeLenses(doc);
    const cible = lenses.find(l => {
      const d = (l as any).data;
      return d?.entry?.name === 'envoyer' && d.entry.line === ligneDe('fun envoyer(s: String)');
    });
    expect(cible).toBeDefined();
    const resolu = await provider.resolveCodeLens(cible as any, { isCancellationRequested: false } as any);
    // Le moteur cherche par nom sans résoudre les types, donc l'appel compte
    // pour les deux surcharges. Avant le correctif il s'y ajoutait la ligne
    // `fun envoyer(n: Int)`, et le lens annonçait « 2 usages ».
    expect(resolu.command?.title).toBe('1 usage');
  });

  it('une fonction sans homonyme garde son compte', async () => {
    const doc = mockDocument(URI, CODE);
    const lenses = provider.provideCodeLenses(doc);
    const cible = lenses.find(l => (l as any).data?.entry?.name === 'appelant');
    expect(cible).toBeDefined();
    const resolu = await provider.resolveCodeLens(cible as any, { isCancellationRequested: false } as any);
    expect(resolu.command?.title).toBe('0 usages');
  });
});
