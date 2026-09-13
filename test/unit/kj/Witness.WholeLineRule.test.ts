import { describe, it, expect } from 'vitest';
import { couvreDesLignesEntieres, coupeBienFormee } from '../../../scripts/invariants';
import { findWriteOnlyVariables } from '../../../src/providers/writeOnlyVariables';

/**
 * The witnesses are the only thing between a one character offset mistake and
 * a shipped release, so they need holding to account themselves. A rule that
 * examines nothing reports zero just as loudly as a rule that examines
 * everything, and a rule that examines too much reports faults that are not
 * faults, which gets a witness ignored and then removed.
 *
 * Both mistakes were made here, in that order, and the numbers are in
 * `scripts/invariants.ts`.
 */

const TEXTE = 'import a.B\nimport c.D\nclass E\n';

describe('lignes entieres', () => {
  it('une ligne complete', () => {
    expect(couvreDesLignesEntieres(TEXTE, 0, 11)).toBe(true);
  });
  it('la meme decalee d un caractere', () => {
    expect(couvreDesLignesEntieres(TEXTE, 1, 12)).toBe(false);
  });
  it('jusqu a la fin du texte', () => {
    expect(couvreDesLignesEntieres(TEXTE, 22, TEXTE.length)).toBe(true);
  });
});

describe('la forme attendue d une coupe', () => {
  it('accepte une suppression de lignes entieres', () => {
    expect(coupeBienFormee(TEXTE, 0, 11, '')).toBe(true);
  });

  it('accepte une suppression contenue dans une ligne', () => {
    // `var db = ` retire, l appel a droite reste pour son effet de bord.
    expect(coupeBienFormee(TEXTE, 7, 10, '')).toBe(true);
  });

  it('refuse une coupe qui commence en milieu de ligne ET franchit un retour', () => {
    // La signature exacte d un decalage d un caractere.
    expect(coupeBienFormee(TEXTE, 1, 12, '')).toBe(false);
  });

  it('un remplacement n est pas une suppression, donc pas concerne', () => {
    // `{ footerIcon ->` devient `{ _ ->`, une edition juste en milieu de ligne.
    expect(coupeBienFormee(TEXTE, 1, 12, '_')).toBe(true);
  });
});

/**
 * Contre le vrai detecteur, pas contre une idee de ce qu il produit. La
 * deuxieme version de cette regle tenait cette famille aux lignes entieres, et
 * ces deux coupes la auraient ete comptees comme des fautes.
 */
describe('les coupes que writeOnly produit vraiment', () => {
  const SOURCE = `fun f() {
    var db = openDatabase()
    db = openDatabase()
}
`;

  it('sont toutes acceptees', () => {
    const edits = findWriteOnlyVariables(SOURCE).flatMap(v => v.edits);
    expect(edits.length).toBeGreaterThan(0);
    const criees = edits
      .filter(e => !coupeBienFormee(SOURCE, e.start, e.end, e.text))
      .map(e => SOURCE.slice(e.start, e.end));
    expect(criees).toEqual([]);
  });

  it('temoin : ce sont bien des coupes partielles, pas des lignes entieres', () => {
    const edits = findWriteOnlyVariables(SOURCE).flatMap(v => v.edits);
    const partielles = edits
      .filter(e => !couvreDesLignesEntieres(SOURCE, e.start, e.end))
      .map(e => SOURCE.slice(e.start, e.end));
    expect(partielles).toEqual(['var db = ', 'db = ']);
  });

  it('mais un decalage sur une de ses suppressions de lignes est bien vu', () => {
    const avecLigne = `class A {
    private var flag = false
    fun f() {
        flag = compute()
    }
}
`;
    const entieres = findWriteOnlyVariables(avecLigne)
      .flatMap(v => v.edits)
      .filter(e => couvreDesLignesEntieres(avecLigne, e.start, e.end));
    expect(entieres.length).toBeGreaterThan(0);
    for (const e of entieres) {
      expect(coupeBienFormee(avecLigne, e.start, e.end, e.text)).toBe(true);
      expect(coupeBienFormee(avecLigne, e.start + 1, e.end + 1, e.text)).toBe(false);
    }
  });
});
