import { describe, it, expect } from 'vitest';
import { finDuCode, dernierNonBlanc, FINIT_SUR_UN_OPERATEUR_RE } from '../../../src/providers/unusedSymbols';
import { stripKotlinComments } from '../../../src/util/xmlRefs';

/**
 * « Cette declaration finit-elle sur un operateur ? » se pose au CODE.
 *
 * Pas au brut, ou un commentaire parle a sa place. Pas au blanchi, ou les
 * guillemets sont vides eux aussi et `"https://x"` ressemble trait pour trait
 * a un commentaire. A la troisieme copie : commentaires effaces, chaines
 * gardees, et prise sur le FICHIER pour que les blocs multilignes aient leur
 * contexte.
 *
 * Chaque reponse est verifiee contre ce que le code veut vraiment dire, pas
 * contre une formule recopiee : la source est donnee deux fois, une avec ses
 * commentaires et une sans, et les deux doivent rendre le meme verdict.
 */
describe('la question de l operateur va au code, pas au commentaire', () => {
  const verdict = (source: string, jusqu?: number) =>
    FINIT_SUR_UN_OPERATEUR_RE.test(finDuCode(stripKotlinComments(source), jusqu ?? source.length));

  /** [nom, source commentee, la meme sans commentaire] */
  const PAIRES: Array<[string, string, string]> = [
    ['virgule de fin de ligne', 'val a = 1 // etape 1,', 'val a = 1'],
    ['plus de fin de ligne', 'val a = 1 // et +', 'val a = 1'],
    ['bloc sur la ligne', 'val a = 1 /* note, */', 'val a = 1'],
    ['bloc multiligne ferme', 'val a = 1 /* note\n, suite\n*/', 'val a = 1'],
    ['bloc multiligne, fin sur la fermeture', 'val a = 1 /* note\nas is */', 'val a = 1'],
    ['ligne entiere commentee apres un operateur', 'val a = 1 +\n// note', 'val a = 1 +'],
    ['deux lignes commentees apres un operateur', 'val a = 1 +\n// une\n// deux', 'val a = 1 +'],
    ['bloc entier apres un operateur', 'val a = 1 +\n/* une\n deux */', 'val a = 1 +'],
    ['operateur nu', 'val a = 1 +', 'val a = 1 +'],
    ['fleche', 'val a = { x: Int ->', 'val a = { x: Int ->'],
  ];
  for (const [nom, commente, nu] of PAIRES) {
    it(`${nom} : le commentaire ne change pas la reponse`, () => {
      expect(verdict(commente)).toBe(verdict(nu));
    });
  }

  it('une chaine garde son contenu, sinon le verdict se lit sur le signe egal', () => {
    // Sur la copie blanchie `val x = "done"` finirait sur `=`. Ici la chaine
    // survit, donc la reponse est non.
    expect(verdict('val x = "done"')).toBe(false);
    expect(verdict('val x = "// pas un commentaire" +')).toBe(true);
  });

  it('une url dans une chaine n est pas un commentaire', () => {
    // Le premier essai du correctif de 1.42.316 lisait le blanchi et coupait
    // cette ligne apres `"https:`, qui finit sur un deux points.
    expect(verdict('val x = "https://host/x"')).toBe(false);
  });

  it('la borne depuis empeche de remonter a la ligne d avant', () => {
    // La marche pose la question a UNE ligne. Sans borne, une ligne toute en
    // commentaire rendait l operateur de la ligne precedente.
    const src = 'val a = 1 +\n// note\n';
    const sc = stripKotlinComments(src);
    const debutDeLaDeuxieme = src.indexOf('\n') + 1;
    expect(FINIT_SUR_UN_OPERATEUR_RE.test(finDuCode(sc, src.length, debutDeLaDeuxieme))).toBe(false);
    expect(FINIT_SUR_UN_OPERATEUR_RE.test(finDuCode(sc, src.length))).toBe(true);
  });

  it('dernierNonBlanc voit les memes blancs que trimEnd', () => {
    for (const s of ['a ', 'a\t\n', 'a ', 'a  ', 'a﻿', '  ', '', 'a']) {
      expect(dernierNonBlanc(s, s.length), JSON.stringify(s)).toBe(s.trimEnd().length - 1);
    }
  });

  it('ne lit jamais au dela de la borne demandee', () => {
    const src = 'val a = 1 +\nval b = 2';
    expect(verdict(src, 11)).toBe(true);
    expect(dernierNonBlanc(src, 999)).toBe(src.length - 1);
  });
});
