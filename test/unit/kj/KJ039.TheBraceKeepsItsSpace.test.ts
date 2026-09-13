import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Retirer la DERNIERE entree d une liste sur une ligne ne colle pas
 * l accolade a celle qui reste.
 *
 * Les deux branches de la coupe ne traitaient pas l espace de la meme facon.
 * Celle qui emporte la virgule SUIVANTE preserve l espacement, et son
 * commentaire le dit : « plus the spaces that followed it on the same line so
 * the neighbours do not end up glued ». Celle de la derniere entree, qui
 * emporte la virgule PRECEDENTE, avalait l espace d apres et rendait
 * `enum class E { VIVANT}`.
 *
 * Valide, mais ecrit par nous dans le fichier du lecteur, et incoherent avec
 * les trois autres positions. En multiligne la question ne se posait pas :
 * l entree y est suivie d un retour a la ligne, que la coupe laisse deja.
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

describe('KJ-039 l accolade garde son espace', () => {
  it('derniere entree d une liste sur une ligne', () => {
    expect(apres('package com.x\n\nenum class E { VIVANT, MORT }\n\nfun u() = E.VIVANT\n'))
      .toContain('enum class E { VIVANT }');
  });

  it('derniere entree precedee d une vivante et d une morte', () => {
    const r = apres('package com.x\n\nenum class E { MORT_A, VIVANT, MORT }\n\nfun u() = E.VIVANT\n')!;
    expect(r).toContain('VIVANT }');
  });

  it('temoin : la premiere entree laissait deja le bon espacement', () => {
    expect(apres('package com.x\n\nenum class E { MORT, VIVANT }\n\nfun u() = E.VIVANT\n'))
      .toContain('enum class E { VIVANT }');
  });

  it('temoin : en multiligne, la coupe ne bouge pas', () => {
    expect(apres('package com.x\n\nenum class E {\n    VIVANT,\n    MORT\n}\n\nfun u() = E.VIVANT\n'))
      .toContain('    VIVANT\n}');
  });

  it('temoin : le point-virgule qui suit la liste reste en place', () => {
    expect(apres('package com.x\n\nenum class E {\n    VIVANT,\n    MORT;\n\n    fun n() = 1\n}\n\nfun u() = E.VIVANT.n()\n'))
      .toContain('    VIVANT;');
  });
});
