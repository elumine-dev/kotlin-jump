import { describe, it, expect } from 'vitest';
import { collectSubscriptions, buildTypeTable } from '../../../src/providers/unheardEvents';
import { sanitizeForUsageScan } from '../../../src/util/kotlinScan';

/**
 * L annotation se cherche dans le CODE, pas dans les commentaires.
 *
 * `handlerExtent` remonte jusqu a la ligne du `@Subscribe` pour que retirer un
 * abonne affame ne laisse pas son annotation orpheline. Il balaie le texte
 * BRUT et garde la derniere occurrence avant la cible. Une mention de
 * `@Subscribe` posee ENTRE l annotation et la fonction, dans un commentaire ou
 * une chaine, est donc plus proche de la cible que la vraie : la remontee
 * s arrete sur elle et la vraie annotation reste dans le fichier.
 *
 * Mesure sur le projet de reference : 3 des 298 occurrences de `@Subscribe`
 * sont hors code, toutes dans des messages d erreur d Otto, dans un fichier
 * qui ne declare aucun abonne. Le defaut ne s y declenche pas ; il tient a une
 * question de copie, comme celui de la 1.42.314, et se corrige de la meme
 * facon : la copie blanchie garde les offsets et perd les faux.
 */

const fichier = (texte: string) => ({
  path: '/w/app/src/main/java/p/Ecran.kt',
  raw: texte,
  clean: sanitizeForUsageScan(texte),
  isTest: false,
});

const EVENT = fichier.call(null, '');

const source = (entre: string) => [
  'package p',
  '',
  'class Ecran {',
  '    @Subscribe',
  entre,
  '    fun onEvent(e: MonEvent) {',
  '    }',
  '}',
  '',
].filter(l => l !== '').join('\n');

const AVEC_COMMENTAIRE = source('    // delivre via @Subscribe sur le thread principal');
const SANS = source('');

const evenement = {
  path: '/w/app/src/main/java/p/MonEvent.kt',
  raw: 'package p\n\nclass MonEvent\n',
  clean: 'package p\n\nclass MonEvent\n',
  isTest: false,
};

const apres = (texte: string) => {
  const files = [fichier(texte), evenement];
  const table = buildTypeTable(files.map(f => ({ path: f.path, text: f.raw })) as any);
  const scan = collectSubscriptions(files as any, table);
  const site = scan.sites[0];
  if (site === undefined) return undefined;
  return {
    coupe: texte.slice(site.removeStart, site.removeEnd),
    reste: texte.slice(0, site.removeStart) + texte.slice(site.removeEnd),
  };
};

describe('KJ-038 la remontee ne se laisse pas prendre par un commentaire', () => {
  // L assertion porte sur ce qui RESTE. Chercher `@Subscribe` dans la coupe se
  // laisse satisfaire par le COMMENTAIRE qui en parle, et la premiere version
  // de ce test passait ainsi sur un fichier ou la vraie annotation etait restee.
  const ANNOTATION_SEULE = /^[ \t]*@Subscribe[ \t]*$/m;

  it('temoin : sans commentaire, rien ne reste de l abonne', () => {
    const r = apres(SANS)!;
    expect(r.coupe).toContain('fun onEvent');
    expect(ANNOTATION_SEULE.test(r.reste)).toBe(false);
  });

  it('un @Subscribe dans un commentaire ne laisse pas la vraie annotation', () => {
    const r = apres(AVEC_COMMENTAIRE)!;
    expect(r.coupe).toContain('fun onEvent');
    expect(ANNOTATION_SEULE.test(r.reste)).toBe(false);
  });
});
