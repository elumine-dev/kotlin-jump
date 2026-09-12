import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Une etendue calee sur des LIGNES ENTIERES emporte tout ce que la ligne
 * porte, y compris une seconde declaration.
 *
 *   val mort = 1; val vivant = 2
 *   static int MORT = 1; static int VIVANT = 2;
 *
 * Retirer la premiere supprimait la seconde, qui est vivante, et rien ne le
 * signalait : les cinq invariants du harnais de suppression regardent le nom,
 * les bornes, les lignes entieres, le solde des accolades et la premiere ligne
 * de code. Aucun ne compte les declarations dans la coupe.
 *
 * Cote Kotlin le defaut precedait 1.42.232 ; cote Java il s'est ouvert avec la
 * regle du point virgule de cette version, qui a rendu ces champs extractibles
 * pour la premiere fois.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');
const MAIN = '/w/app/src/main/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin'];

const coupe = (p: string, texte: string, nom: string): string | undefined => {
  const sources = [{ path: p, text: texte }, { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun r() = 1\n' }];
  const m = mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] })
    .find((x: any) => x.name === nom);
  if (!m) return undefined;
  return m.removeStart >= 0 ? texte.slice(m.removeStart, m.removeEnd) : undefined;
};

describe.skipIf(!mod)('deux declarations sur une ligne', () => {
  it('Kotlin : la premiere n est pas extractible', () => {
    const t = 'package com.x\n\nclass A {\n    val mort = 1; val vivant = 2\n    fun go() = vivant\n}\n';
    expect(coupe(`${MAIN}/A.kt`, t, 'mort')).toBeUndefined();
  });

  it('Java : idem', () => {
    const t = 'package com.x;\n\nclass B {\n    static int MORT = 1; static int VIVANT = 2;\n    int go() { return VIVANT; }\n}\n';
    expect(coupe('/w/app/src/main/java/com/x/B.java', t, 'MORT')).toBeUndefined();
  });

  it('temoin : un champ Java seul sur sa ligne reste extractible', () => {
    const t = 'package com.x;\n\nclass C {\n    static int MORT = 1;\n    int go() { return 2; }\n}\n';
    expect(coupe('/w/app/src/main/java/com/x/C.java', t, 'MORT')).toBe('    static int MORT = 1;\n');
  });

  it('temoin : un corps qui contient des points virgules reste extractible', () => {
    // Sans la restriction aux etendues calees sur les lignes, un `for` a
    // points virgules ferait refuser toutes les fonctions.
    const t = 'package com.x;\n\nclass D {\n    void mort() { for (int i = 0; i < 2; i++) { } }\n    int go() { return 2; }\n}\n';
    expect(coupe('/w/app/src/main/java/com/x/D.java', t, 'mort')).toContain('void mort()');
  });
});
