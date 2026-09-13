import { describe, it, expect } from 'vitest';
import {
  couvreDesLignesEntieres,
  doitCouperDesLignesEntieres,
  FAMILLES_A_COUPE_PARTIELLE,
} from '../../../scripts/invariants';

/**
 * The witnesses are the only thing standing between a one character offset
 * mistake and a shipped release, so the witnesses themselves need holding to
 * account. A rule that examines nothing reports zero just as loudly as a rule
 * that examines everything.
 *
 * Measured on the reference project, the whole line rule was applied to one
 * family out of four: 19 of the 52 deletions. Shifting every import cut by one
 * character left all seven counters at zero, while the same shift on the
 * declaration cuts was caught 19 times out of 19.
 */

const TEXTE = 'import a.B\nimport c.D\nclass E\n';

describe('la regle des lignes entieres', () => {
  it('accepte une coupe qui prend une ligne complete', () => {
    expect(couvreDesLignesEntieres(TEXTE, 0, 11)).toBe(true);
  });

  it('refuse la meme coupe decalee d un caractere', () => {
    expect(couvreDesLignesEntieres(TEXTE, 1, 12)).toBe(false);
  });

  it('accepte une coupe qui va jusqu a la fin du texte', () => {
    expect(couvreDesLignesEntieres(TEXTE, 22, TEXTE.length)).toBe(true);
  });

  it('refuse une coupe qui commence en milieu de ligne', () => {
    expect(couvreDesLignesEntieres(TEXTE, 7, 11)).toBe(false);
  });
});

describe('qui est tenu a la regle', () => {
  for (const famille of ['declarations', 'imports', 'writeOnly']) {
    it(`${famille} y est tenu`, () => {
      expect(doitCouperDesLignesEntieres('', famille)).toBe(true);
    });
  }

  it('locals en est dispense : il retire le prefixe d affectation et garde l appel', () => {
    expect(doitCouperDesLignesEntieres('', 'locals')).toBe(false);
  });

  it('un remplacement n est pas une suppression, donc pas concerne', () => {
    // `{ footerIcon ->` devient `{ _ ->`, une edition juste en milieu de ligne.
    expect(doitCouperDesLignesEntieres('_', 'declarations')).toBe(false);
  });

  it('une famille inconnue y est tenue, pas dispensee', () => {
    // Le defaut d un oracle doit etre de parler, pas de se taire : un nouveau
    // detecteur arriverait sinon sans verification et sans que rien le dise.
    expect(doitCouperDesLignesEntieres('', 'une-famille-a-venir')).toBe(true);
    expect(doitCouperDesLignesEntieres('', undefined)).toBe(true);
  });

  it('une seule famille est dispensee', () => {
    expect([...FAMILLES_A_COUPE_PARTIELLE]).toEqual(['locals']);
  });
});
