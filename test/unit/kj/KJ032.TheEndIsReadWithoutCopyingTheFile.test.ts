import { describe, it, expect } from 'vitest';
import { finSansCommentaire, dernierNonBlanc, FINIT_SUR_UN_OPERATEUR_RE } from '../../../src/providers/unusedSymbols';
import { stripKotlinComments } from '../../../src/util/xmlRefs';

/**
 * Les trois questions posees a la fin d une declaration se lisaient chacune sur
 * une copie de tout le debut du fichier : `copie.slice(0, endOffset).trimEnd()`,
 * pour ne regarder que le dernier caractere. `removalExtent` est appelee une
 * fois par declaration morte, donc des dizaines de milliers de fois par passe.
 *
 * L une de ces copies, `trailing`, n avait meme plus de lecteur : v1.42.314 lui
 * a pris la question du point virgule et v1.42.316 celle de l operateur, sans
 * retirer l allocation.
 *
 * Ce fichier fige l ANCIENNE formule comme oracle et exige que la nouvelle
 * reponde pareil, y compris sur la branche que le code reel n atteint pas.
 */
describe('la fin de declaration se lit sans recopier le fichier', () => {
  /** La formule d avant, mot pour mot. */
  const oracle = (text: string, jusqu: number): string => {
    const brut = text.slice(0, jusqu).trimEnd();
    const debutDeLigne = brut.lastIndexOf('\n') + 1;
    return (brut.slice(0, debutDeLigne) + stripKotlinComments(brut.slice(debutDeLigne))).trimEnd();
  };

  const CAS: Array<[string, string]> = [
    ['ligne simple', 'val a = 1'],
    ['operateur nu', 'val a = 1 +'],
    ['operateur puis commentaire', 'val a = 1 +\n   // note'],
    ['virgule dans le commentaire', 'val a = 1 // etape 1,'],
    ['fleche', 'val a = { x: Int ->'],
    ['url dans une chaine', 'val a = "https://x"'],
    ['chaine qui contient un slash slash', 'val a = "// pas un commentaire" +'],
    ['commentaire de bloc en fin', 'val a = 1 /* note, */'],
    ['derniere ligne tout en commentaire', 'val a = 1 +\n// suite,\n'],
    ['deux lignes de commentaire', 'val a = 1,\n// une\n// deux'],
    ['point virgule', 'val a = 1;'],
    ['blancs a la fin', 'val a = 1 +   \n\n   \n'],
    ['tabulations', '\tval a = 1 ->\t'],
    ['espace insecable final', 'val a = 1 + '],
    ['fichier vide', ''],
    ['que des blancs', '   \n  \n'],
    ['que du commentaire', '// rien,'],
  ];

  for (const [nom, source] of CAS) {
    it(`repond comme l ancienne formule : ${nom}`, () => {
      // Chaque prefixe, pas seulement le fichier entier : `endOffset` tombe ou
      // il veut, et c est la fin partielle qui a produit les deux bugs de coupe.
      for (let jusqu = 0; jusqu <= source.length; jusqu++) {
        // Le VERDICT, pas la chaine : l ancienne formule tirait tout le
        // prefixe derriere elle, la nouvelle s arrete a la derniere ligne, et
        // c est le seul point ou les deux sont lues.
        const attendu = FINIT_SUR_UN_OPERATEUR_RE.test(oracle(source, jusqu));
        const obtenu = FINIT_SUR_UN_OPERATEUR_RE.test(finSansCommentaire(source, jusqu));
        expect(obtenu, `${nom} @${jusqu}`).toBe(attendu);
      }
    });
  }

  it('la branche du commentaire pur remonte au texte brut', () => {
    // Sans elle, `val a = 1 +` suivi d une ligne de commentaire perdrait son
    // operateur et la coupe s arreterait avant sa continuation.
    expect(finSansCommentaire('val a = 1 +\n   // note', 22)).toBe('val a = 1 +');
  });

  it('dernierNonBlanc voit les memes blancs que trimEnd', () => {
    for (const s of ['a ', 'a\t\n', 'a ', 'a  ', 'a﻿', '  ', '', 'a']) {
      const attendu = s.trimEnd().length - 1;
      expect(dernierNonBlanc(s, s.length), JSON.stringify(s)).toBe(attendu);
    }
  });

  it('ne lit jamais au dela de la borne demandee', () => {
    const source = 'val a = 1 +\nval b = 2';
    expect(finSansCommentaire(source, 11)).toBe('val a = 1 +');
    expect(dernierNonBlanc(source, 999)).toBe(source.length - 1);
  });
});
