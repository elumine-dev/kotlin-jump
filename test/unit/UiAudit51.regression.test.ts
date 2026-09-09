import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { SealedWhenCoverageProvider } from '../../src/providers/SealedWhenCoverageProvider';
import { mockDocument } from './helpers';

// Audit 51 : dernier lens du dépôt qui dépendait d'une commande vide. Le cas
// visé est le plus fréquent de ce provider, un `when` exhaustif, et un lens
// dont `command.command` vaut la chaîne vide n'est pas rendu de façon fiable
// (constat du commit b0b065b sur le lens de prévisualisation drawable).

const SEALED_URI = 'file:///a51/Etat.kt';
const SEALED = [
  'package com.demo',
  '',
  'sealed class Etat {',
  '    object Pret : Etat()',
  '    object Charge : Etat()',
  '}',
].join('\n');

const MAIN_URI = 'file:///a51/Main.kt';
const exhaustif = [
  'package com.demo',
  '',
  'fun rendre(e: Etat) = when (e) {',
  '    is Etat.Pret -> 1',
  '    is Etat.Charge -> 2',
  '}',
].join('\n');
const incomplet = [
  'package com.demo',
  '',
  'fun rendre(e: Etat) = when (e) {',
  '    is Etat.Pret -> 1',
  '}',
].join('\n');

function lensesDe(code: string) {
  const index = new SymbolIndex();
  index.add(parse(SEALED_URI, SEALED));
  index.add(parse(MAIN_URI, code));
  index.finalize();
  return new SealedWhenCoverageProvider(index).provideCodeLenses(mockDocument(MAIN_URI, code));
}

describe('Le lens de couverture reste rendu dans les deux cas', () => {
  it('un when exhaustif porte une vraie commande', () => {
    const lenses = lensesDe(exhaustif);
    expect(lenses.length).toBe(1);
    expect(lenses[0].command?.title).toBe('✓ 2/2 branches');
    // Avant : la chaîne vide, donc un lens que VS Code peut ne pas dessiner.
    expect(lenses[0].command?.command).toBe('vscode.open');
  });

  it('et il mène à la déclaration du type scellé', () => {
    const [lens] = lensesDe(exhaustif);
    const [uri, options] = lens.command!.arguments as [any, { selection: any }];
    expect(String(uri)).toContain('Etat.kt');
    const ligneAttendue = SEALED.split('\n').findIndex(l => l.includes('sealed class Etat'));
    expect(options.selection.start.line).toBe(ligneAttendue);
  });

  it('un when incomplet garde son action d\'insertion', () => {
    const [lens] = lensesDe(incomplet);
    expect(lens.command?.title).toContain('missing');
    expect(lens.command?.command).toBe('kotlin-jump.addMissingWhenBranches');
  });

  it('aucun lens de ce provider ne porte une commande vide', () => {
    for (const code of [exhaustif, incomplet]) {
      for (const l of lensesDe(code)) {
        expect(l.command?.command, l.command?.title).toBeTruthy();
      }
    }
  });
});
