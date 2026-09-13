import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Le commentaire de fin de ligne d une entree morte part avec elle.
 *
 * La v1.42.282 a ajoute un repli sur les blancs qui suivent la derniere entree,
 * pour que `enum class E { VIVANT, MORT }` ne rende pas `{ VIVANT}`. Le repli
 * lit `clean`, ou un commentaire est blanchi en espaces de meme longueur : il
 * recule donc AUSSI par dessus le commentaire de l entree, qui reste dans le
 * fichier et se retrouve accroche a la voisine vivante.
 *
 * Le lecteur voit alors « plus utilise » au dessus, ou a cote, d une entree qui
 * l est. Et le meme repli rend la ligne de la voisine avec ses blancs de fin en
 * multiligne, la ou la coupe les emportait avant.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

const apres = (texte: string) => {
  const e = (findUnusedEnumEntries({
    sources: [f(`${MAIN}/E.kt`, texte), GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(x => x.name === 'MORT');
  if (!e || e.removeStart < 0) return undefined;
  return texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);
};

const PREAMBULE = 'package com.x\n\n';
const USAGE = '\n\nfun u() = E.VIVANT\n';

describe('KJ-039 le commentaire de fin de ligne suit la coupe', () => {
  it('multiligne : le commentaire de la morte ne passe pas a la vivante', () => {
    const r = apres(`${PREAMBULE}enum class E {\n    VIVANT,\n    MORT // plus utilise\n}${USAGE}`)!;
    expect(r).not.toContain('plus utilise');
    expect(r).toContain('    VIVANT\n}');
  });

  it('multiligne : les blancs de fin de ligne partent avec l entree', () => {
    const r = apres(`${PREAMBULE}enum class E {\n    VIVANT,\n    MORT   \n}${USAGE}`)!;
    expect(r).toContain('    VIVANT\n}');
  });

  it('une ligne : l accolade garde toujours son espace, un seul', () => {
    expect(apres(`${PREAMBULE}enum class E { VIVANT, MORT  }${USAGE}`))
      .toContain('enum class E { VIVANT }');
  });

  it('une ligne collee : la coupe ne fabrique pas d espace', () => {
    expect(apres(`${PREAMBULE}enum class E { VIVANT, MORT}${USAGE}`))
      .toContain('enum class E { VIVANT}');
  });

  it('le point-virgule ne garde pas de blanc devant lui', () => {
    const r = apres(`${PREAMBULE}enum class E {\n    VIVANT,\n    MORT ;\n\n    fun n() = 1\n}\n\nfun u() = E.VIVANT.n()\n`)!;
    expect(r).toContain('    VIVANT;');
  });
});
