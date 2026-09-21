import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G13 — un ilot plus grand que la limite disparait en silence.
 *
 * Voir doc/gaps-detection.md. Trouve en auditant une dimension que les
 * fixtures n exploraient pas : les fichiers Kotlin qui declarent PLUSIEURS
 * types au premier niveau. Le corpus en compte 443 sur 3542, soit 13 %, dont
 * un a neuf declarations et plusieurs a sept ou huit.
 *
 * ## La dimension elle meme est couverte
 *
 * Mesure faite avant d ecrire ces tests. Deux declarations qui se tiennent
 * MUTUELLEMENT en vie sortent toutes les deux en `alive:same-file` chez
 * `findUnusedSymbols`, et `findDeadIslands` les rattrape :
 *
 *   class First  { fun make() = Second() }
 *   class Second { fun back() = First() }
 *   -> symboles: (rien)   iles: First+back | Second+make
 *
 * Rien a signaler de ce cote : la famille des ilots fait son travail.
 *
 * ## Mais sa limite est une falaise, pas une pente
 *
 * `collecterUnePasse` appelle `findDeadIslands` avec `maxIslandSize: 8`. Sur
 * une chaine de N classes ou chacune nomme la suivante et ou personne ne
 * nomme la premiere, donc un ilot entierement mort :
 *
 *   chaine de  3 classes -> 1 ilot, 3 noms
 *   chaine de  6 classes -> 1 ilot, 6 noms
 *   chaine de  8 classes -> 1 ilot, 8 noms
 *   chaine de  9 classes -> 0 ilot, 0 nom
 *   chaine de 12 classes -> 0 ilot, 0 nom
 *
 * A huit tout sort, a neuf plus rien. L ilot ne devient pas moins mort en
 * grossissant ; il devient invisible. Et c est le mauvais sens : un module
 * entier abandonne fait plus de huit declarations, pas moins.
 *
 * ## CORRECTION, mesuree au niveau du circuit complet
 *
 * Tout ce qui precede est vrai de `findDeadIslands` SEUL. Ce ne l est pas de
 * la commande, qui enchaine les familles jusqu au point fixe. Mesure dans
 * `Circuit.WhatTheWholeLoopStillMisses.test.ts` :
 *
 *   chaine de  9 classes -> entierement retiree, en sept rondes
 *   chaine de 20 classes -> seize rondes, et la commande demande un deuxieme
 *                           passage pour finir
 *   cycle  de 12 classes -> entierement retire, en trois rondes
 *
 * Une chaine se defait par un bout, la premiere classe n etant nommee par
 * personne. Un cycle dont les methodes ne sont pas LUES se defait par le
 * milieu : la famille des membres coupe les methodes, ce qui casse le cycle.
 *
 * Ce qui survit est plus etroit, et la falaise n est pas ou ce fichier la
 * situe. La limite compte les DECLARATIONS, membres compris : une classe qui
 * porte une methode en vaut deux.
 *
 *   cycle de 4 classes, chaque methode lue par la voisine -> retire
 *   cycle de 5 classes, idem                              -> INTACT
 *
 * La marche est donc a cinq classes, pas a neuf, et sur du vrai code, ou une
 * classe porte cinq ou six membres, elle est a deux. Les tests ci dessous
 * restent justes sur ce qu ils mesurent, la famille des ilots ; c est leur
 * conclusion sur le cout pour l utilisateur qu il faut lire avec cette
 * correction.
 *
 * ## Ce que ces tests demandent
 *
 * Pas forcement de supprimer la limite, qui protege d un cout quadratique.
 * Mais une limite qui coupe doit le DIRE : un ilot ecarte pour sa taille
 * devrait ressortir en signalement, avec son nombre de membres, pour qu un
 * humain sache qu il existe. Un detecteur qui se tait sur les plus gros cas
 * est pire qu un detecteur qui les rapporte imparfaitement.
 */

const mod: any = await importOrNull('src/providers/deadIslands');
const allow: any = await importOrNull('src/util/resourceAllowlists');

const MAIN = '/w/app/src/main/java/com/x';

/**
 * Une chaine de N classes : chacune nomme la suivante, personne ne nomme la
 * premiere. L ilot entier est mort, quelle que soit sa taille.
 */
const chaine = (n: number, prefixe = 'C') => {
  const L = ['package com.x', ''];
  for (let i = 0; i < n; i++) {
    L.push(`class ${prefixe}${i} {`);
    if (i + 1 < n) L.push(`    fun next() = ${prefixe}${i + 1}()`);
    L.push('}', '');
  }
  return { path: `${MAIN}/Chain${prefixe}${n}.kt`, text: L.join('\n') };
};

const iles = (source: { path: string; text: string }, maxIslandSize = 8) =>
  mod.findDeadIslands({
    sources: [source], testSourceSets: ['/src/test/'], maxIslandSize,
  }) as any[];

const noms = (trouves: any[]) => trouves.flatMap(x => x.names ?? [x.name]);

describe.skipIf(!mod)('G13 — le corpus de test est lisible', () => {
  it('rapporte un petit ilot entierement mort', () => {
    expect(noms(iles(chaine(3)))).toEqual(
      expect.arrayContaining(['C0', 'C1', 'C2']));
  });

  it('rapporte encore un ilot de huit, la taille limite', () => {
    expect(noms(iles(chaine(8)))).toHaveLength(8);
  });

  /**
   * SENTINELLE. Elle fixe la falaise mesuree. Si ces deux lignes bougent, la
   * limite a change et l entree G13 du document doit etre relue.
   */
  it('aujourd hui, un ilot de neuf disparait entierement', () => {
    expect(iles(chaine(8))).toHaveLength(1);
    expect(iles(chaine(9))).toHaveLength(0);
    expect(iles(chaine(12))).toHaveLength(0);
  });
});

describe.skipIf(!mod)('G13 — l ilot que sa taille rend invisible', () => {
  it.fails('rapporte un ilot de neuf classes entierement mort', () => {
    expect(noms(iles(chaine(9)))).toEqual(
      expect.arrayContaining(['C0', 'C8']));
  });

  it.fails('rapporte un ilot de douze, ou signale au moins son existence', () => {
    // La forme exacte du signalement est libre : une entree avec un compte,
    // un drapeau `truncated`, peu importe. Ce qui ne va pas est le silence.
    expect(iles(chaine(12))).not.toHaveLength(0);
  });

  it.fails('dit combien de membres l ilot ecarte comptait', () => {
    const trouves = iles(chaine(12));
    const total = trouves.reduce(
      (n: number, x: any) => n + (x.size ?? x.names?.length ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it.fails('rapporte deux ilots distincts quand le second depasse la limite', () => {
    // Un fichier peut porter un petit ilot et un gros. Aujourd hui seul le
    // petit ressort, et rien ne dit que l autre a ete vu puis ecarte.
    const melange = {
      path: `${MAIN}/Mixed.kt`,
      text: chaine(3, 'A').text + '\n' + chaine(9, 'B').text.replace('package com.x\n\n', ''),
    };
    const trouves = iles(melange);
    expect(noms(trouves)).toEqual(expect.arrayContaining(['A0', 'B0']));
  });
});

/**
 * Le contre exemple, et il compte autant que le reste du fichier.
 *
 * `isGeneratedSource` (`resourceAllowlists.ts:92`) cherche un marqueur de
 * generation dans les 1500 PREMIERS caracteres seulement. Cette limite ci est
 * atteinte par le corpus, et c est tant mieux :
 *
 * PopoverPropertiesBuilder « Please do not modify. See REPA-1202 »
 *       -> offset 4897 : un avertissement sur UNE methode, pas sur le fichier
 * StartupAdAnalyticsHelper « Internal error generated by rx stream »
 *       -> offset 1841 : une phrase anglaise ordinaire
 *
 * Sans la fenetre, le second passerait pour genere et TOUS ses findings
 * seraient supprimes. La limite protege ici, alors que `maxIslandSize: 8`
 * censure. La difference n est pas la taille du chiffre : c est que l une
 * borne un INDICE qui perd sa valeur en s eloignant du debut, et l autre
 * borne un RESULTAT qui reste vrai quelle que soit sa taille.
 *
 * Ces cas sont donc des gardes, pas des trouvailles. Ils doivent continuer a
 * passer si quelqu un touche a la fenetre.
 */
describe.skipIf(!allow)('G13 — la limite voisine qui, elle, est justifiee', () => {
  const entete = (lignes: string[]) => lignes.join('\n');

  it('reconnait un vrai fichier genere par son entete', () => {
    expect(allow.isGeneratedSource(entete([
      '// Generated by the protocol buffer compiler. DO NOT EDIT!',
      'package com.x;',
    ]))).toBe(true);
  });

  it('ne prend pas un avertissement de section pour un entete de fichier', () => {
 // `PopoverPropertiesBuilder`, a 4897 caracteres du debut.
    const remplissage = '// '.padEnd(1600, 'x') + '\n';
    expect(allow.isGeneratedSource(entete([
      'package com.x;',
      remplissage,
      '\t * Please do not modify. See REPA-1202 for more details',
    ]))).toBe(false);
  });

  it('ne prend pas une phrase ordinaire pour un marqueur de generation', () => {
 // `StartupAdAnalyticsHelper`, a 1841 caracteres du debut.
    const remplissage = '// '.padEnd(1600, 'x') + '\n';
    expect(allow.isGeneratedSource(entete([
      'package com.x',
      remplissage,
      '        // Internal error generated by rx stream',
    ]))).toBe(false);
  });
});

describe.skipIf(!mod)('G13 — les gardes, qui passent des maintenant', () => {
  /**
   * Ces gardes tiennent DES AUJOURD HUI et devront tenir apres : relever la
   * limite ne doit pas faire sortir un ilot dont une declaration est vivante.
   */

  it('ne touche pas un ilot dont une declaration est nommee ailleurs', () => {
    const lie = {
      path: `${MAIN}/Linked.kt`,
      text: chaine(9).text + '\nfun entryPoint(c: C0) = c.next()\n',
    };
    expect(noms(iles(lie))).not.toContain('C0');
  });

  it('ne touche pas un ilot de huit dont une declaration est vivante', () => {
    const lie = {
      path: `${MAIN}/Linked8.kt`,
      text: chaine(8).text + '\nfun entryPoint(c: C0) = c.next()\n',
    };
    expect(noms(iles(lie))).not.toContain('C0');
  });

  /**
   * La limite est un parametre, pas une constante : la relever doit suffire a
   * voir l ilot. Ce test le verifie, et documente au passage la porte de
   * sortie la plus simple si la famille devait etre corrigee.
   */
  it('voit l ilot de neuf des que la limite le permet', () => {
    expect(iles(chaine(9), 16)).toHaveLength(1);
    expect(noms(iles(chaine(9), 16))).toHaveLength(9);
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(mod.findDeadIslands({
      sources: [chaine(3)], testSourceSets: ['/src/test/'],
      maxIslandSize: 8, truncated: true,
    })).toHaveLength(0);
  });
});
