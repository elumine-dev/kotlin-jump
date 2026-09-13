import { describe, it, expect } from 'vitest';
import { intersectionParCle } from '../../../src/util/intersectionParCle';

/**
 * La cle d intersection n est pas toujours unique, et une cle ambigue ne peut
 * pas servir de consentement.
 *
 * Mesure sur le projet de reference : `scanTestOnly` rend cinq groupes, dont
 * DEUX partagent `chemin | libelle`, parce qu une ile morte pousse un groupe
 * par membre et que tous portent le meme libelle. Un filtre par appartenance
 * a un ensemble laisse alors passer un groupe jamais annonce des lors qu un
 * homonyme, lui, l a ete.
 */

type Item = { cle: string; quoi: string };
const k = (i: Item) => i.cle;

describe('intersection par cle', () => {
  it('ne garde que ce qui a ete annonce', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'un' }];
    const r: Item[] = [{ cle: 'x', quoi: 'un' }, { cle: 'y', quoi: 'deux' }];
    expect(intersectionParCle(a, r, k).map(i => i.quoi)).toEqual(['un']);
  });

  it('laisse tomber ce qui a disparu de la relecture', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'un' }, { cle: 'y', quoi: 'deux' }];
    const r: Item[] = [{ cle: 'y', quoi: 'deux' }];
    expect(intersectionParCle(a, r, k).map(i => i.quoi)).toEqual(['deux']);
  });

  it('cle ambigue intacte : le groupe passe entier', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'a' }, { cle: 'x', quoi: 'b' }];
    const r: Item[] = [{ cle: 'x', quoi: 'a' }, { cle: 'x', quoi: 'b' }];
    expect(intersectionParCle(a, r, k).length).toBe(2);
  });

  it('cle ambigue dont le compte a change : rien ne passe', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'a' }];
    const r: Item[] = [{ cle: 'x', quoi: 'a' }, { cle: 'x', quoi: 'jamais annonce' }];
    expect(intersectionParCle(a, r, k)).toEqual([]);
  });

  it('et dans l autre sens aussi : un de moins, on ne devine pas', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'a' }, { cle: 'x', quoi: 'b' }];
    const r: Item[] = [{ cle: 'x', quoi: 'a' }];
    expect(intersectionParCle(a, r, k)).toEqual([]);
  });

  it('temoin : un simple filtre par appartenance laisserait passer l inconnu', () => {
    const a: Item[] = [{ cle: 'x', quoi: 'a' }];
    const r: Item[] = [{ cle: 'x', quoi: 'a' }, { cle: 'x', quoi: 'jamais annonce' }];
    const naif = r.filter(i => new Set(a.map(k)).has(k(i)));
    expect(naif.length).toBe(2);
    expect(intersectionParCle(a, r, k).length).toBe(0);
  });
});
