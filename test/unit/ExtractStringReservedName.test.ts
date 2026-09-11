/**
 * Le nom de ressource propose par « Extraire vers strings.xml ».
 *
 * Le nom derive du texte du litteral. Quand ce texte est un mot reserve du
 * langage, la cle l'est aussi : `<string name="default">` fait generer
 * `public static final int default` dans la classe R, que Java refuse, et
 * `R.string.is` ne s'ecrit pas en Kotlin sans accents graves. Dans les deux
 * cas le projet ne compile plus.
 *
 * Mesure sur un projet reel : sur 11786 litteraux, 85 produisaient une cle
 * reservee, soit dix mots distincts. `true` 34 fois, `null` 13, `false` 10,
 * `native` 9, `default` 7, puis `class`, `else`, `super`, `is`, `package`.
 *
 * Le prefixe employe est celui que le fichier utilise deja pour un nom qui
 * commence par un chiffre.
 */
import { describe, it, expect } from 'vitest';
import { suggestResourceName } from '../../src/providers/ExtractStringResourceProvider';

const VALIDE = /^[a-z_][a-z0-9_]*$/;
const RESERVES = ['true', 'false', 'null', 'default', 'class', 'else', 'super', 'is', 'package', 'native'];

describe('une cle de ressource n est jamais un mot reserve', () => {
  for (const mot of RESERVES) {
    it(`"${mot}" ne donne pas la cle ${mot}`, () => {
      const nom = suggestResourceName(mot, new Set());
      expect(nom, 'la cle ne peut pas etre le mot reserve').not.toBe(mot);
      expect(nom, 'et reste un nom de ressource valide').toMatch(VALIDE);
    });
  }

  it('un texte ordinaire garde son nom', () => {
    expect(suggestResourceName('Bonjour le monde', new Set())).toBe('bonjour_le_monde');
  });

  it('un nom commencant par un chiffre garde son sauvetage', () => {
    expect(suggestResourceName('3 articles', new Set())).toBe('s_3_articles');
  });

  it('et le nom sauve reste unique contre les cles existantes', () => {
    const nom1 = suggestResourceName('true', new Set());
    const nom2 = suggestResourceName('true', new Set([nom1]));
    expect(nom2).not.toBe(nom1);
    expect(nom2).toMatch(VALIDE);
  });
});
