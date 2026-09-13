import { describe, it, expect } from 'vitest';
import { bulkDetail } from '../../../src/util/bulkEdit';
import { plural } from '../../../src/util/plural';

/**
 * La ligne de detail d un dialogue en masse s accorde comme le reste.
 *
 * Elle accordait a la main avec `n > 1`, ce qui est juste partout sauf a zero :
 * `plural(0, 'file')` rend « 0 files », le ternaire rendait « 0 file ». Le
 * gardien des pluriels laissait passer cette forme en la declarant « la forme
 * longue de ce que plural fait », ce qui est faux precisement la.
 *
 * Zero est atteignable. `RemoveTestOnlyCode` est le seul appelant a ne pas
 * retourner quand le compte est nul, et son nombre de FICHIERS vient de ce que
 * la construction a vraiment touche : si chaque plage est refusee parce que le
 * fichier a bouge depuis le scan, il vaut zero.
 */
describe('bulkDetail s accorde a zero', () => {
  it('zero changement, zero fichier', () => {
    expect(bulkDetail(0, 0)).toContain('0 changes in 0 files.');
  });

  it('un seul de chaque garde le singulier', () => {
    expect(bulkDetail(1, 1)).toContain('1 change in 1 file.');
  });

  it('plusieurs restent au pluriel', () => {
    expect(bulkDetail(5, 2)).toContain('5 changes in 2 files.');
  });

  it('un changement dans zero fichier, le cas degenere', () => {
    expect(bulkDetail(3, 0)).toContain('3 changes in 0 files.');
  });

  it('dit toujours ce que chaque bouton fait', () => {
    expect(bulkDetail(2, 1)).toContain('Apply all skips the preview');
    expect(bulkDetail(2, 1)).toContain('nothing ticked');
  });

  it('accorde exactement comme plural, a tous les comptes qui comptent', () => {
    for (const n of [0, 1, 2, 11]) {
      expect(bulkDetail(n, n), `n=${n}`).toContain(`${plural(n, 'change')} in ${plural(n, 'file')}.`);
    }
  });
});
