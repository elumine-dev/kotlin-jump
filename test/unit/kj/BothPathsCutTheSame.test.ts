import { describe, it, expect } from 'vitest';
import { wholeLineExtent } from '../../../src/providers/unusedSymbols';
import { sansTrouDeLignesVides, Coupe } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Les deux chemins qui retirent une declaration coupent au meme endroit.
 *
 * `Remove all unreferenced declarations` elargit ses plages avec
 * `wholeLineExtent`, qui absorbe la ligne vide SUIVANTE. `Remove Everything
 * Unused` passe par ses propres plages, qui n absorbaient rien : le meme
 * symbole laissait un trou de lignes vides dans une commande et pas dans
 * l autre, sur 66 des 199 fichiers du projet de reference.
 *
 * Depuis que la passe fusionnee absorbe elle aussi, les deux s accordent sur
 * les 88 trouvailles de ce projet. Deux formulations de la meme politique dans
 * deux fichiers derivent en silence, alors ce test les confronte.
 *
 * La ou elles ne peuvent PAS s accorder, c est quand il n y a pas de ligne
 * vide au dessus : la passe fusionnee refuse alors de retirer le separateur
 * isole, l autre le prend. Zero cas sur le projet de reference, et le
 * desaccord est ecrit ici plutot que decouvert un jour dans un diff.
 */

const coupe = (start: number, end: number): Coupe =>
  ({ start, end, texte: '', famille: 'symboles', quoi: 'x' });

const lesDeux = (texte: string, debut: number, fin: number) => ({
  dediee: wholeLineExtent(texte, debut, fin),
  fusionnee: sansTrouDeLignesVides(texte, [coupe(debut, fin)])[0],
});

const bornes = (texte: string, quoi: string) => {
  const debut = texte.indexOf(quoi);
  return [debut, texte.indexOf('\n', texte.indexOf('}', debut)) + 1] as const;
};

describe('les deux chemins coupent au meme endroit', () => {
  const FORMES: [string, string][] = [
    ['vide des deux cotes', 'package p\n\nclass A {\n}\n\nclass Morte {\n}\n\nclass B {\n}\n'],
    ['derniere du fichier', 'package p\n\nclass A {\n}\n\nclass Morte {\n}\n'],
    ['collee a la suivante', 'package p\n\nclass A {\n}\n\nclass Morte {\n}\nclass B {\n}\n'],
    ['deux lignes vides apres', 'package p\n\nclass A {\n}\n\nclass Morte {\n}\n\n\nclass B {\n}\n'],
  ];

  for (const [nom, texte] of FORMES) {
    it(nom, () => {
      const [d, f] = bornes(texte, 'class Morte');
      const { dediee, fusionnee } = lesDeux(texte, d, f);
      expect({ start: fusionnee.start, end: fusionnee.end }).toEqual(dediee);
    });
  }

  it('le seul desaccord possible : pas de ligne vide au dessus', () => {
    // La passe fusionnee garde le separateur isole, la commande dediee le
    // prend. Aucune occurrence sur le projet de reference, mais la difference
    // est reelle et vaut mieux ecrite que subie.
    const texte = 'package p\nclass Morte {\n}\n\nclass B {\n}\n';
    const [d, f] = bornes(texte, 'class Morte');
    const { dediee, fusionnee } = lesDeux(texte, d, f);
    expect(dediee.end).toBeGreaterThan(fusionnee.end);
    expect(texte.slice(fusionnee.end, dediee.end)).toBe('\n');
  });
});
