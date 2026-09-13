import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';

/**
 * Un operateur dans un COMMENTAIRE ne prolonge pas la declaration.
 *
 * La marche d extension demande « cette ligne finit-elle sur un operateur ? »
 * pour savoir si la declaration continue en dessous, et elle le demande au
 * texte BRUT. La raison est bonne : le nettoyeur vide les chaines, donc
 * `val x = "done"` se lirait comme finissant sur son `=`.
 *
 * Mais un commentaire de fin de ligne se termine par ce qu il veut. Une virgule
 * ou un plus dans `// etape 1,` fait croire a une suite, la marche descend, et
 * la coupe emporte la DECLARATION SUIVANTE, vivante.
 *
 * C est le miroir exact du defaut corrige en 1.42.314, sur la meme ligne, dans
 * l autre sens : celui-la coupait trop court, celui-ci coupe trop loin. Trois
 * questions, trois copies : la profondeur veut le blanchi, le point-virgule
 * aussi, l operateur veut le brut SANS son commentaire.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const VIVANT = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(vivant()) }\n');

const coupe = (texte: string) => {
  const t = (findUnusedSymbols({
    sources: [f(`${MAIN}/A.kt`, texte), VIVANT, GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(s => s.name === 'fantome');
  return t && t.removeStart >= 0 ? texte.slice(t.removeStart, t.removeEnd) : undefined;
};

const avec = (commentaire: string) => [
  'package com.x',
  '',
  `val fantome = 1${commentaire}`,
  '',
  'fun vivant() = 2',
  '',
].join('\n');

describe('KJ-032 un operateur en commentaire ne prolonge rien', () => {
  it('temoin : sans commentaire, la coupe tient sur sa ligne', () => {
    expect(coupe(avec(''))).not.toContain('fun vivant');
  });

  it('temoin : un commentaire ordinaire ne change rien', () => {
    expect(coupe(avec(' // etape 1'))).not.toContain('fun vivant');
  });

  it('une virgule en fin de commentaire n emporte pas la declaration suivante', () => {
    expect(coupe(avec(' // etape 1,'))).not.toContain('fun vivant');
  });

  it('un plus en fin de commentaire non plus', () => {
    expect(coupe(avec(' // a + b +'))).not.toContain('fun vivant');
  });

  it('temoin : une chaine qui finit sur un operateur garde son sens', () => {
    // `val x = "done"` doit rester lisible comme TERMINE : la chaine est videe
    // par le nettoyeur, donc juger sur le blanchi ferait croire a une suite.
    const texte = [
      'package com.x',
      '',
      'val fantome = "done"',
      '',
      'fun vivant() = 2',
      '',
    ].join('\n');
    const c = coupe(texte);
    expect(c).toBeDefined();
    expect(c).not.toContain('fun vivant');
  });

  /**
   * Et la meme question posee par la MARCHE, ligne par ligne.
   *
   * Le test de l operateur existe a deux endroits : celui qui decide s il faut
   * descendre, et celui qui decide, a chaque ligne, s il faut continuer. Le
   * second n etait atteint par aucun decor le jour du correctif, qui l a donc
   * recu par coherence sans preuve. Une declaration qui s etale vraiment sur
   * plusieurs lignes y mene, et le commentaire se pose sur la DERNIERE.
   */
  const multiligne = (commentaire: string) => [
    'package com.x',
    '',
    'val fantome = listOf(',
    '    1,',
    '    2,',
    `)${commentaire}`,
    '',
    'fun vivant() = 2',
    '',
  ].join('\n');

  it('temoin : la declaration multiligne part en entier', () => {
    const c = coupe(multiligne(' // fin'))!;
    expect(c).toContain('listOf(');
    expect(c).toContain(') // fin');
    expect(c).not.toContain('fun vivant');
  });

  it('une virgule en fin de commentaire sur la DERNIERE ligne n emporte pas la suite', () => {
    const c = coupe(multiligne(' // fin,'))!;
    expect(c).toContain('listOf(');
    expect(c).not.toContain('fun vivant');
  });
});
