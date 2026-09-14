import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Retirer la premiere entree d une ligne ne vole pas son indentation a la
 * voisine qui reste sur cette ligne.
 *
 * Vu sur le projet de reference : `NewIndicatorPulseState { NEVER_PULSE, PULSING }`
 * ecrit sur une ligne indentee. La coupe de `NEVER_PULSE` partait du debut de
 * la ligne, parce que ce qui precede le nom n y est que des blancs et que la
 * remontee sur les annotations accepte une suite vide d annotations. Il restait
 * `PULSING` colle a la marge, et detekt refusait le fichier (`Indentation`).
 *
 * Reculer au debut de ligne reste juste quand rien ne survit apres la coupe sur
 * cette ligne : sinon ce sont des espaces orphelins qui restent.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const USE = f(`${MAIN}/U.kt`, 'package com.x\n\nfun u() = listOf(E.VIVANT, E.AUTRE)\n');

const apres = (texte: string, nom = 'MORT') => {
  const e = (findUnusedEnumEntries({
    sources: [f(`${MAIN}/E.kt`, texte), USE, GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(x => x.name === nom);
  if (!e || e.removeStart < 0) return undefined;
  return texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);
};

describe('KJ-039 la voisine garde son indentation', () => {
  it('le cas du projet de reference : premiere entree, la voisine reste indentee', () => {
    expect(apres('package com.x\n\nenum class E {\n    MORT, VIVANT\n}\n'))
      .toBe('package com.x\n\nenum class E {\n    VIVANT\n}\n');
  });

  it('avec une annotation sur la meme ligne : elle part, l indentation reste', () => {
    expect(apres('package com.x\n\nenum class E {\n    @Deprecated("x") MORT, VIVANT\n}\n'))
      .toBe('package com.x\n\nenum class E {\n    VIVANT\n}\n');
  });

  it('avec une annotation sur la ligne du dessus : elle part, l indentation reste', () => {
    expect(apres('package com.x\n\nenum class E {\n    @Deprecated("x")\n    MORT, VIVANT\n}\n'))
      .toBe('package com.x\n\nenum class E {\n    VIVANT\n}\n');
  });

  it('temoin : seule sur sa ligne, la ligne entiere part', () => {
    expect(apres('package com.x\n\nenum class E {\n    MORT,\n    VIVANT\n}\n'))
      .toBe('package com.x\n\nenum class E {\n    VIVANT\n}\n');
  });

  it('temoin : entree du milieu, rien ne bouge autour', () => {
    expect(apres('package com.x\n\nenum class E {\n    AUTRE, MORT, VIVANT\n}\n'))
      .toBe('package com.x\n\nenum class E {\n    AUTRE, VIVANT\n}\n');
  });
});
