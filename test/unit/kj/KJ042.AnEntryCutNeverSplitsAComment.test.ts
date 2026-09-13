import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Retirer une entree d enum ne coupe pas un commentaire de bloc en deux.
 *
 * Apres la virgule, la marche prenait les espaces pour ne pas coller les
 * voisines. Elle les lisait sur la copie BLANCHIE, ou un commentaire est
 * efface a la meme longueur : elle traversait donc `/* on garde` et s arretait
 * au retour a la ligne, laissant `as is *​/` seul derriere. Le fichier ne
 * compilait plus.
 *
 * Le code affirmait qu une entree portant un commentaire de bloc sur sa ligne
 * n etait pas detectee du tout, et s en servait pour ne pas traiter le cas.
 * Elle l est.
 *
 * Meme famille que 1.42.318, autre chemin de coupe : celui la n a pas de
 * `removalExtent` pour le proteger.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const USAGE = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(Etat.VIVANT); println(Etat.AUTRE) }\n');

const source = (apresMort: string) =>
  `package com.x\n\nenum class Etat {\n    VIVANT,\n    MORT,${apresMort}\n    AUTRE,\n}\n`;

const coupe = (texte: string) => {
  const t = (findUnusedEnumEntries({
    sources: [f(`${MAIN}/E.kt`, texte), USAGE, GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(e => e.name === 'MORT');
  return t && t.removeStart >= 0 ? texte.slice(t.removeStart, t.removeEnd) : undefined;
};
/** Le fichier tel qu il resterait apres application. */
const reste = (texte: string) => {
  const t = (findUnusedEnumEntries({
    sources: [f(`${MAIN}/E.kt`, texte), USAGE, GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(e => e.name === 'MORT');
  return t && t.removeStart >= 0 ? texte.slice(0, t.removeStart) + texte.slice(t.removeEnd) : texte;
};
const equilibre = (s: string) => (s.split('/*').length - 1) === (s.split('*/').length - 1);

describe('la coupe d une entree d enum laisse les commentaires entiers', () => {
  it('un bloc ouvert sur la ligne et ferme plus bas reste en place', () => {
    const src = source(' /* on garde\n       as is */');
    expect(coupe(src)).toBe('    MORT, ');
    expect(reste(src)).toContain('/* on garde');
    expect(reste(src)).toContain('as is */');
    expect(equilibre(reste(src))).toBe(true);
  });

  it('un bloc ferme sur la ligne part avec l entree, comme avant', () => {
    const src = source(' /* plus utilise */');
    expect(coupe(src)).toContain('/* plus utilise */');
    expect(equilibre(reste(src))).toBe(true);
    expect(reste(src)).not.toContain('plus utilise');
  });

  it('un commentaire de ligne part avec l entree, comme avant', () => {
    const src = source(' // plus utilise');
    expect(coupe(src)).toContain('// plus utilise');
    expect(reste(src)).not.toContain('plus utilise');
  });

  it('sans commentaire, la coupe prend la ligne entiere', () => {
    expect(coupe(source(''))).toBe('    MORT,\n');
  });

  it('les voisines vivantes restent, dans tous les cas', () => {
    for (const apres of ['', ' // note', ' /* note */', ' /* on garde\n       as is */']) {
      const r = reste(source(apres));
      expect(r, apres).toContain('VIVANT,');
      expect(r, apres).toContain('AUTRE,');
      expect(r, apres).not.toMatch(/^\s*MORT\b/m);
      expect(equilibre(r), apres).toBe(true);
    }
  });

  it('un bloc ferme sur la ligne part meme si un autre bloc s ouvre dessous', () => {
    // Le commentaire qui COMMENCE apres la coupe appartient a ce qui suit.
    // Sans cette distinction, la garde se declenchait sur lui et ramenait la
    // coupe avant `/* plus utilise */`, qui restait orphelin derriere.
    const src = source(' /* plus utilise */\n    /* note sur la suivante\n       sur deux lignes */');
    expect(coupe(src)).toContain('/* plus utilise */');
    const r = reste(src);
    expect(r).not.toContain('plus utilise');
    expect(r).toContain('note sur la suivante');
    expect(equilibre(r)).toBe(true);
  });
});
