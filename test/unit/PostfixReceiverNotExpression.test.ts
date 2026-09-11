/**
 * Les templates postfixes sur une ligne de CONTINUATION.
 *
 * Kotlin se chaine volontiers sur plusieurs lignes :
 *
 *     valeur
 *         ?.let { ... }
 *     }.let(sac::add)
 *
 * Le fournisseur travaille ligne par ligne : sur ces lignes la, le recepteur
 * qu'il extrait est `?` ou `}`, et non l'expression, qui est plus haut.
 *
 * `let` s'en accommode, il ne fait qu'ajouter derriere : `?.let { }` est
 * exactement ce que l'utilisateur veut. Tous les autres ENCADRENT le
 * recepteur, et produisaient donc du Kotlin invalide :
 *
 *     if () { }          for (item in ) { }        val value =
 *     if (}) { }         when (}) { }              !}
 *
 * Mesure sur un projet reel : 1044 positions postfixes, dont 123 de cette
 * forme, soit 101 avec `?` et 22 avec `}`.
 */
import { describe, it, expect } from 'vitest';
import { expandPostfix, POSTFIX_TEMPLATES } from '../../src/providers/PostfixCompletionProvider';

const ENCADRANTS = POSTFIX_TEMPLATES.filter(t => t !== 'let');

describe('un recepteur qui n est pas une expression', () => {
  for (const recepteur of ['?', '}', ')', ']', '??']) {
    it(`${JSON.stringify(recepteur)} : seul let reste offert`, () => {
      for (const t of ENCADRANTS) {
        expect(expandPostfix(t, recepteur), `${t} doit etre refuse`).toBeNull();
      }
      expect(expandPostfix('let', recepteur), 'let reste utile').not.toBeNull();
    });
  }

  /**
   * Les compteurs peuvent s'annuler sans que le fragment tienne debout :
   * une fermeture avant son ouverture donne un total nul. Le refus doit se
   * prononcer des la fermeture orpheline, pas seulement sur le total.
   */
  it('une fermeture qui precede son ouverture ne passe pas', () => {
    for (const t of ENCADRANTS) {
      expect(expandPostfix(t, '} + a {'), `${t} doit etre refuse`).toBeNull();
    }
  });

  it('alors que les memes delimiteurs dans l ordre passent', () => {
    expect(expandPostfix('when', 'a { b } + c')).not.toBeNull();
  });

  it('let sur une ligne de continuation rend bien le point d interrogation', () => {
    expect(expandPostfix('let', '?')).toBe('?.let { $0 }');
  });
});

describe('un vrai recepteur garde tous ses templates', () => {
  it('un appel avec appel sur', () => {
    expect(expandPostfix('if', 'viewModel?')).toBe('if (viewModel) {\n    $0\n}');
    expect(expandPostfix('not', 'estVide')).toBe('!estVide');
    expect(expandPostfix('val', 'total')).toBe('val ${1:value} = total');
  });

  it('un recepteur qui contient des accolades equilibrees', () => {
    const r = 'liste.filter { it > 0 }';
    expect(expandPostfix('for', r)).toContain('for (item in liste.filter');
    expect(expandPostfix('when', r)).not.toBeNull();
  });

  it('un recepteur avec parentheses equilibrees', () => {
    expect(expandPostfix('null', 'calcule(1, 2)')).toBe('if (calcule(1, 2) == null) {\n    $0\n}');
  });

  it('et un nombre reste refuse la ou il l etait', () => {
    expect(expandPostfix('if', '3.14')).toBeNull();
    expect(expandPostfix('for', '42')).not.toBeNull();
  });
});
