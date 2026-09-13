import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';

/**
 * Une ligne INTERIEURE d un commentaire de bloc n est pas la suite du code.
 *
 * Deux mecanismes la faisaient passer pour telle, et les deux emportaient la
 * declaration vivante posee dessous.
 *
 * Le premier : « la ligne suivante ouvre-t-elle quelque chose de neuf ? » se
 * posait au texte brut. Une ligne comme `   as is pour l instant *​/` ne
 * commence ni par une accolade, ni par un mot cle, ni par les deux barres
 * d un commentaire de ligne, donc elle repondait non et la marche partait.
 *
 * Le second : « cette ligne finit-elle sur un operateur ? » se posait a la
 * ligne strippee TOUTE SEULE. Privee de son ouverture, elle n a rien a
 * effacer, et sa fermeture `*​/` se lit alors comme une division.
 *
 * Meme famille que 1.42.314 et 1.42.316, troisieme site : une question de
 * structure posee a la mauvaise copie du fichier.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const VIVANT = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(vivant()) }\n');

const coupe = (texte: string) => {
  const t = (findUnusedSymbols({
    sources: [f(`${MAIN}/A.kt`, texte), VIVANT, GRADLE], testSourceSets: ['/src/test/'],
  } as any) as any[]).find(s => s.name === 'fantome');
  return t && t.removeStart >= 0 ? texte.slice(t.removeStart, t.removeEnd) : undefined;
};

const avecBloc = (interieur: string) =>
  `package com.x\n\nval fantome = 1 /* on garde\n${interieur}\n*/\n\nfun vivant() = 2\n`;

describe('un commentaire de bloc ne prolonge pas la declaration', () => {
  // Chacun de ces interieurs commence ou finit par un signe que la liste des
  // suites reconnait. Tous emportaient `fun vivant()`.
  for (const interieur of [', suite', '.suite', 'else on verra', 'as is', ') fin', '+ encore']) {
    it(`interieur « ${interieur} » : la fonction vivante reste`, () => {
      const c = coupe(avecBloc(interieur))!;
      expect(c).toBeDefined();
      expect(c).not.toContain('fun vivant');
    });

    it(`interieur « ${interieur} » : le commentaire part entier`, () => {
      // Couper au milieu laisserait la fermeture seule et le fichier ne
      // compilerait plus. Le nombre d ouvertures et de fermetures doit
      // s equilibrer dans ce qui part.
      const c = coupe(avecBloc(interieur))!;
      const ouvertures = c.split('/*').length - 1;
      const fermetures = c.split('*/').length - 1;
      expect(ouvertures).toBe(fermetures);
    });
  }

  it('le bloc ferme sur la ligne meme se coupe comme avant', () => {
    const c = coupe('package com.x\n\nval fantome = 1 /* as is */\n\nfun vivant() = 2\n')!;
    expect(c).toBe('val fantome = 1 /* as is */\n');
  });

  it('sans commentaire de bloc, la coupe tient sur sa ligne', () => {
    const c = coupe('package com.x\n\nval fantome = 1\n\nfun vivant() = 2\n')!;
    expect(c).toBe('val fantome = 1\n');
  });

  it('un bloc jamais ferme fait renoncer plutot que couper au milieu', () => {
    const c = coupe('package com.x\n\nval fantome = 1 /* jamais ferme\nas is\n');
    if (c !== undefined) {
      expect(c.split('/*').length - 1).toBe(c.split('*/').length - 1);
    }
  });

  it('une vraie suite est toujours suivie', () => {
    // La garde ne doit pas avoir eteint la marche legitime.
    const c = coupe('package com.x\n\nval fantome = listOf(1, 2)\n    .filter { it > 0 }\n\nfun vivant() = 2\n')!;
    expect(c).toContain('.filter');
    expect(c).not.toContain('fun vivant');
  });

  it('une chaine brute reste entiere', () => {
    const src = 'package com.x\n\nval fantome = """\n, contenu\n"""\n\nfun vivant() = 2\n';
    const c = coupe(src);
    if (c !== undefined) {
      expect((c.split('"""').length - 1) % 2).toBe(0);
      expect(c).not.toContain('fun vivant');
    }
  });

  it('une ouverture ecrite dans une chaine ne compte pas', () => {
    // La garde lit les marqueurs la ou la copie sans commentaires differe du
    // brut. Dans une chaine, rien ne differe.
    const c = coupe('package com.x\n\nval fantome = "/*"\n\nfun vivant() = 2\n')!;
    expect(c).toBe('val fantome = "/*"\n');
  });

  /**
   * Un commentaire qui COMMENCE apres la coupe n enjambe rien.
   *
   * La garde regarde le premier caractere qui suit la coupe et demande s il
   * est dans un commentaire. Il y en a un dans les deux cas : celui qu on
   * tranche, et celui qui appartient a la declaration d apres. Sans cette
   * distinction la garde se declenche a tort, et le prix est lourd des deux
   * cotes : soit la coupe disparait, soit elle emporte le commentaire du
   * voisin, son KDoc compris.
   */
  const suivi = (apres: string) => `package com.x\n\nval fantome = 1\n${apres}fun vivant() = 2\n`;

  for (const [nom, apres] of [
    ['une ligne de commentaire', '// une note\n'],
    ['une ligne de commentaire apres une vide', '\n// une note\n'],
    ['un bloc sur une ligne', '/* une note */\n'],
    ['un bloc sur deux lignes', '/* une note\n   suite */\n'],
    ['le KDoc de la declaration suivante', '/** doc */\n'],
  ] as Array<[string, string]>) {
    it(`${nom} apres la coupe : elle reste, et s arrete a elle meme`, () => {
      // Sans la distinction, les deux premiers cas rendaient `undefined`, donc
      // plus aucun correctif propose, et les trois autres emportaient le
      // commentaire du voisin.
      expect(coupe(suivi(apres))).toBe('val fantome = 1\n');
    });
  }
});
