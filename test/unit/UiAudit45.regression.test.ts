import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, currentRemovalExtent, wholeLineExtent } from '../../src/providers/unusedSymbols';

// Audit 45 : conséquence directe de l'audit 43. En signalant pour la première
// fois deux homonymes déclarés dans le MÊME fichier, on a ouvert un chemin que
// la suppression ne savait pas traiter : `currentRemovalExtent` retrouvait la
// déclaration par (nom, sorte) et prenait la PREMIÈRE. Supprimer la seconde
// surcharge supprimait donc la première, son annotation comprise.

const MAIN = '/w/app/src/main/kotlin';
const TEST_SETS = ['test', 'androidTest'];
const f = (path: string, text: string) => ({ path, text });
const VIVANT = f(`${MAIN}/Autre.kt`, 'package p\n\nfun vivant() = 1\n');
const find = (sources: { path: string; text: string }[]) =>
  findUnusedSymbols({ sources, testSourceSets: TEST_SETS });

describe('Supprimer une surcharge ne touche pas sa sœur', () => {
  const PATH = `${MAIN}/Charge.kt`;
  const AVEC_KEEP = [
    'package p',
    '',
    '@Keep',
    'fun charger(a: Int) {}',
    '',
    'fun charger(a: String) {}',
    '',
  ].join('\n');

  it('la déclaration protégée par une annotation n\'est pas celle qu\'on retire', () => {
    const trouvailles = find([f(PATH, AVEC_KEEP), VIVANT]).filter(t => t.name === 'charger');
    // Seule la surcharge sans annotation est signalée.
    expect(trouvailles.map(t => t.line)).toEqual([5]);

    const cible = trouvailles[0];
    const extent = currentRemovalExtent(PATH, AVEC_KEEP, cible.name, cible.kind, cible.line)!;
    expect(extent).toBeDefined();
    const ligne = wholeLineExtent(AVEC_KEEP, extent.removeStart, extent.removeEnd);
    const supprime = AVEC_KEEP.slice(ligne.start, ligne.end);
    expect(supprime).toContain('fun charger(a: String)');
    expect(supprime).not.toContain('@Keep');
    expect(supprime).not.toContain('a: Int');
  });

  it('deux surcharges mortes donnent deux étendues distinctes', () => {
    const DEUX = 'package p\n\nfun charger(a: Int) {}\n\nfun charger(a: String) {}\n';
    const trouvailles = find([f(PATH, DEUX), VIVANT]).filter(t => t.name === 'charger');
    expect(trouvailles.map(t => t.line)).toEqual([2, 4]);
    const debuts = trouvailles.map(t => currentRemovalExtent(PATH, DEUX, t.name, t.kind, t.line)!.removeStart);
    // Avant : les deux valaient l'offset de la première, donc une seule
    // suppression survivait au tri et l'autre déclaration restait.
    expect(new Set(debuts).size).toBe(2);
    expect(debuts).toEqual([...debuts].sort((a, b) => a - b));
  });

  it('sans homonyme, et sans ligne fournie, le comportement ne change pas', () => {
    const SEUL = 'package p\n\nfun charger(a: Int) {}\n';
    const avecLigne = currentRemovalExtent(PATH, SEUL, 'charger', 'fun', 2);
    const sansLigne = currentRemovalExtent(PATH, SEUL, 'charger', 'fun');
    expect(avecLigne).toEqual(sansLigne);
    expect(avecLigne).toBeDefined();
    // Un nom que le fichier ne déclare plus reste introuvable.
    expect(currentRemovalExtent(PATH, SEUL, 'renomme', 'fun', 2)).toBeUndefined();
  });

  it('une édition au-dessus décale la déclaration sans tromper le choix', () => {
    const DEUX = 'package p\n\nfun charger(a: Int) {}\n\nfun charger(a: String) {}\n';
    // Deux lignes insérées en tête : le finding pointe encore l'ancienne ligne.
    const decale = 'package p\n\nval ajoute = 1\nval encore = 2\n\nfun charger(a: Int) {}\n\nfun charger(a: String) {}\n';
    const secondeAvant = find([f(PATH, DEUX), VIVANT]).filter(t => t.name === 'charger')[1];
    const extent = currentRemovalExtent(PATH, decale, secondeAvant.name, secondeAvant.kind, secondeAvant.line)!;
    const ligne = wholeLineExtent(decale, extent.removeStart, extent.removeEnd);
    // La ligne 4 du scan tombe entre les deux : la plus proche est retenue,
    // et rien ne part hors des deux déclarations.
    expect(decale.slice(ligne.start, ligne.end)).toContain('fun charger(');
  });
});
