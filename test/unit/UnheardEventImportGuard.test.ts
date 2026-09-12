/**
 * Le correctif « ajouter un abonne » ecrivait du code qui ne compile pas.
 *
 * Il insere une methode annotee dans le fichier ouvert, puis decide s il faut
 * aussi ajouter l import du type d evenement. La decision tenait en une ligne
 * et ses deux moities repondaient oui trop facilement, chaque oui SUPPRIMANT
 * l import :
 *
 *   - `text.includes('import ' + fqn)` attrape aussi un import plus long qui
 *     commence pareil : `import a.b.EventBus` passait pour `a.b.Event` ;
 *   - `fqn.startsWith(packageOf(text))` n a pas de separateur, et surtout un
 *     SOUS paquet n est pas visible sans import non plus.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, les 13 evenements que le
 * detecteur signale croises avec les 5 146 sources : la seconde moitie se
 * trompe 467 fois, la premiere 0 fois. Le cas dominant est le sous paquet, et
 * c est la disposition normale : l evenement vit dans le module, l ecran qui
 * devrait l ecouter vit au dessus.
 *
 *   fichier  package ca.lapresse.android.lapresseplus
 *   type     ca.lapresse.android.lapresseplus.module.fcm.FcmBreakingNewsEvent
 */
import { describe, it, expect } from 'vitest';
import { importNeeded } from '../../src/commands/FindUnheardEvents';

const NL = String.fromCharCode(10);
const fichier = (pkg: string, ...imports: string[]) =>
  [`package ${pkg}`, '', ...imports, '', 'class Ecran'].join(NL);

const FCM = 'ca.lapresse.android.lapresseplus.module.fcm.FcmBreakingNewsEvent';

describe('importNeeded', () => {
  it('un sous paquet a besoin de son import', () => {
    expect(importNeeded(fichier('ca.lapresse.android.lapresseplus'), FCM)).toBe(true);
  });

  it('un paquet voisin qui commence pareil aussi', () => {
    // `nuglif.rubicon.card` est un prefixe de `nuglif.rubicon.cardlist` sans
    // qu il y ait le moindre lien entre les deux.
    expect(importNeeded(fichier('nuglif.rubicon.card'), 'nuglif.rubicon.cardlist.OpenEvent'))
      .toBe(true);
  });

  it('un import plus long ne vaut pas pour le type qu il prefixe', () => {
    expect(importNeeded(fichier('x.y', 'import a.b.EventBus'), 'a.b.Event')).toBe(true);
  });

  it('temoin : le meme paquet exactement n a pas besoin d import', () => {
    expect(importNeeded(fichier('a.b'), 'a.b.Event')).toBe(false);
  });

  it('temoin : un import exact suffit, avec ou sans point virgule', () => {
    expect(importNeeded(fichier('x.y', 'import a.b.Event'), 'a.b.Event')).toBe(false);
    expect(importNeeded(fichier('x.y', 'import a.b.Event;'), 'a.b.Event')).toBe(false);
  });

  it('temoin : un import avec alias compte aussi', () => {
    expect(importNeeded(fichier('x.y', 'import a.b.Event as Ev'), 'a.b.Event')).toBe(false);
  });

  it('temoin : un fichier sans package a besoin de l import', () => {
    expect(importNeeded('class Ecran', 'a.b.Event')).toBe(true);
  });

  it('temoin : un type sans paquet ne s importe pas', () => {
    expect(importNeeded(fichier('a.b'), 'Event')).toBe(false);
  });

  it('temoin : un import en commentaire ne compte pas comme la ligne exacte', () => {
    // La ligne doit etre un import, pas une mention. L ancienne version prenait
    // n importe quelle occurrence du texte, ou qu elle soit.
    expect(importNeeded(fichier('x.y', '// import a.b.Event'), 'a.b.Event')).toBe(true);
  });
});
