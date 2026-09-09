import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, explainSymbols } from '../../src/providers/unusedSymbols';

// Audit 43 : suite de KJ-036. La règle qui relâche F3 quand personne ne nomme
// le doublon sommait `selfInFile` PAR CANDIDAT. Deux déclarations du même nom
// dans le MÊME fichier voient chacune le nom de l'autre, donc le fichier était
// compté deux fois et le groupe passait pour mentionné. Résultat : deux
// surcharges mortes côte à côte n'étaient jamais signalées, alors que les deux
// mêmes dans des fichiers séparés l'étaient. LaPresse porte 22 groupes de
// fonctions top level surchargées dans un même fichier.

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const j = (path: string, text: string) => ({ path, text });
const noms = (sources: { path: string; text: string }[]) =>
  findUnusedSymbols({ sources, testSourceSets: TEST_SETS }).map(f => f.name).sort();
const pourquoi = (sources: { path: string; text: string }[], name: string) =>
  explainSymbols({ sources, testSourceSets: TEST_SETS }).filter(e => e.name === name).map(e => e.outcome);

const VIVANT = j('/w/app/src/main/kotlin/Autre.kt', 'package p\n\nfun vivant() = 1\n');

describe('Deux surcharges mortes dans le même fichier', () => {
  const MEME_FICHIER = j('/w/app/src/main/kotlin/Charge.kt',
    'package p\n\nfun charger(id: Int) {}\n\nfun charger(nom: String) {}\n');

  it('sont signalées toutes les deux', () => {
    expect(noms([MEME_FICHIER, VIVANT])).toEqual(['charger', 'charger', 'vivant']);
  });

  it('le verdict est `unreferenced`, pas `F3:duplicate-name`', () => {
    expect(pourquoi([MEME_FICHIER, VIVANT], 'charger')).toEqual(['unreferenced', 'unreferenced']);
  });

  it('les deux mêmes dans des fichiers séparés restent signalées', () => {
    const separees = [
      j('/w/app/src/main/kotlin/M1.kt', 'package p\n\nfun charger(id: Int) {}\n'),
      j('/w/app/src/main/kotlin/M2.kt', 'package q\n\nfun charger(nom: String) {}\n'),
      VIVANT,
    ];
    expect(noms(separees)).toEqual(['charger', 'charger', 'vivant']);
  });
});

describe('Ce qui doit rester silencieux', () => {
  it('une surcharge appelée depuis son propre fichier tait tout le groupe', () => {
    // L'appel peut viser n'importe quel membre du groupe : rien n'est prouvable.
    const sources = [
      j('/w/app/src/main/kotlin/Charge.kt',
        'package p\n\nfun charger(id: Int) {}\n\nfun charger(nom: String) {}\n\nfun demarrer() {\n    charger(1)\n}\n'),
      VIVANT,
    ];
    expect(noms(sources)).toEqual(['demarrer', 'vivant']);
  });

  it('une surcharge appelée depuis un autre fichier tait tout le groupe', () => {
    const sources = [
      j('/w/app/src/main/kotlin/Charge.kt',
        'package p\n\nfun charger(id: Int) {}\n\nfun charger(nom: String) {}\n'),
      j('/w/app/src/main/kotlin/Appel.kt', 'package p\n\nfun demarrer() {\n    charger(1)\n}\n'),
      VIVANT,
    ];
    expect(noms(sources)).toEqual(['demarrer', 'vivant']);
  });

  it('une surcharge qui délègue à sa sœur tait tout le groupe', () => {
    const sources = [
      j('/w/app/src/main/kotlin/Charge.kt',
        'package p\n\nfun charger(id: Int) = charger(id.toString())\n\nfun charger(nom: String) {}\n'),
      VIVANT,
    ];
    expect(noms(sources)).toEqual(['vivant']);
  });
});
