import { describe, it, expect } from 'vitest';
import { findUnusedMembers, explainMembers } from '../../src/providers/unusedMembers';

// Audit 44 : le même défaut que l'audit 43, dans le détecteur de membres.
// `unmentionedDuplicateMembers` sommait `selfInFile` par candidat, donc un
// fichier portant deux membres homonymes était compté deux fois et le groupe
// passait pour mentionné. Il fallait un troisième porteur du nom pour que la
// règle entre en jeu, ce qui explique que le cas à deux membres marchait déjà.

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const find = (sources: { path: string; text: string }[]) =>
  findUnusedMembers({ sources, testSourceSets: TEST_SETS });
const noms = (sources: { path: string; text: string }[]) =>
  find(sources).map(m => `${m.container}.${m.name}`).sort();
const pourquoi = (sources: { path: string; text: string }[], name: string) =>
  explainMembers({ sources, testSourceSets: TEST_SETS }).filter(e => e.name === name).map(e => e.outcome);

const DEUX_SURCHARGES = f(`${MAIN}/X.kt`,
  'package com.x\n\nclass X {\n    fun rendre(a: Int) {}\n\n    fun rendre(a: String) {}\n}\n');

describe('Trois porteurs morts dont deux dans le même fichier', () => {
  const AILLEURS = f(`${MAIN}/Y.kt`, 'package com.y\n\nclass Y {\n    fun rendre(a: Double) {}\n}\n');

  it('les trois sont signalés', () => {
    expect(noms([DEUX_SURCHARGES, AILLEURS])).toEqual(['X.rendre', 'X.rendre', 'Y.rendre']);
  });

  it('le verdict est `unreferenced`, pas `alive:same-file`', () => {
    expect(pourquoi([DEUX_SURCHARGES, AILLEURS], 'rendre'))
      .toEqual(['unreferenced', 'unreferenced', 'unreferenced']);
  });

  it('un homonyme d\'une autre sorte compte comme porteur', () => {
    const propriete = f(`${MAIN}/Z.kt`, 'package com.z\n\nclass Z {\n    val rendre = 1\n}\n');
    expect(noms([DEUX_SURCHARGES, propriete])).toEqual(['X.rendre', 'X.rendre', 'Z.rendre']);
  });
});

describe('Ce qui doit rester silencieux', () => {
  it('une seule mention, même dans un XML, tait tout le groupe', () => {
    // Le sac de jetons ne sait pas à quel porteur la mention appartient.
    const layout = f('/w/app/src/main/res/layout/a.xml', '<View android:onClick="rendre" />\n');
    expect(noms([DEUX_SURCHARGES, layout])).toEqual([]);
  });

  it('un appel Kotlin depuis un autre fichier tait tout le groupe', () => {
    const appel = f(`${MAIN}/Appel.kt`, 'package com.x\n\nfun go(x: X) = x.rendre(1)\n');
    const ailleurs = f(`${MAIN}/Y.kt`, 'package com.y\n\nclass Y {\n    fun rendre(a: Double) {}\n}\n');
    expect(noms([DEUX_SURCHARGES, ailleurs, appel])).toEqual([]);
  });

  it('une surcharge qui délègue à sa sœur tait tout le groupe', () => {
    const delegue = f(`${MAIN}/X.kt`,
      'package com.x\n\nclass X {\n    fun rendre(a: Int) = rendre(a.toString())\n\n    fun rendre(a: String) {}\n}\n');
    const ailleurs = f(`${MAIN}/Y.kt`, 'package com.y\n\nclass Y {\n    fun rendre(a: Double) {}\n}\n');
    expect(noms([delegue, ailleurs])).toEqual([]);
  });
});
