import { describe, it, expect } from 'vitest';
import { cleDeBase, baseDe } from '../../../src/cleanup/cles';

/**
 * Campagne de nettoyage : la cle d une coupe.
 *
 * La simulation et la boucle reelle doivent nommer une coupe de la meme
 * facon, sinon « Apply a Cleanup Batch » ne retrouve pas ce que le plan a
 * promis. La cle ne porte jamais d offset : les offsets periment a la
 * premiere coupe appliquee.
 */

const texte = 'package k\n\nclass Dead {\n}\n\nfun helper() = 1\n';

describe('cleDeBase', () => {
  it('famille, chemin et nom, separes par des tabulations', () => {
    expect(cleDeBase({ start: 11, end: 25, texte: '', famille: 'symboles', quoi: 'Dead' }, '/w/A.kt', texte))
      .toBe('symboles\t/w/A.kt\tDead');
  });

  it('sans nom, le nom du detecteur, puis l extrait normalise', () => {
    expect(cleDeBase({ start: 27, end: 44, texte: '', famille: 'balayage', quoi: '', preuve: { verdict: 'unreferenced', nom: 'helper' } }, '/w/A.kt', texte))
      .toBe('balayage\t/w/A.kt\thelper');
    expect(cleDeBase({ start: 27, end: 44, texte: '', famille: 'balayage', quoi: '' }, '/w/A.kt', texte))
      .toBe('balayage\t/w/A.kt\tfun helper() = 1');
  });

  it('baseDe retire le suffixe de repetition', () => {
    expect(baseDe('symboles\t/w/A.kt\tDead#2')).toBe('symboles\t/w/A.kt\tDead');
    expect(baseDe('symboles\t/w/A.kt\tDead')).toBe('symboles\t/w/A.kt\tDead');
  });
});
