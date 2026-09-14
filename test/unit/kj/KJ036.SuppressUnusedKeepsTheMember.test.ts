import { describe, it, expect } from 'vitest';
import { findUnusedMembers } from '../../../src/providers/unusedMembers';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Un membre marque `@Suppress("unused")`, ou dont la classe l est, n est ni
 * signale ni supprime.
 *
 * `@Suppress` a ete range parmi les annotations benignes, celles qui ne
 * rendent rien atteignable, avec pour contrepartie un controle du diagnostic
 * NOMME. Le detecteur des declarations de haut niveau a recu ce controle.
 * Celui des membres a herite de la liste benigne sans le controle : un membre
 * ecrit `@Suppress("unused") fun garde() = 2` etait propose a la suppression,
 * et « Remove Everything Unused » l effacait, alors que l auteur avait ecrit
 * en toutes lettres de le laisser. La meme annotation sur une fonction de
 * haut niveau, elle, etait respectee.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const APPEL = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(C().vivante()) }\n');
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

const signales = (src: string) =>
  (findUnusedMembers({ sources: [f(`${MAIN}/C.kt`, src), APPEL, GRADLE], testSourceSets: ['/src/test/'] } as any) as any[])
    .map(m => m.name).sort();
const supprimes = (src: string) =>
  (collecterUnePasse([f(`${MAIN}/C.kt`, src), APPEL, GRADLE], ['/src/test/']).parFichier.get(`${MAIN}/C.kt`) ?? [])
    .filter((c: any) => c.famille === 'membres')
    .map((c: any) => src.slice(c.start, c.end).trim().split('\n').pop());

const classe = (annoClasse: string, annoMembre: string) =>
  `package com.x\n\n${annoClasse}class C {\n    ${annoMembre}fun garde() = 2\n    fun vivante() = 3\n}\n`;

describe('le membre respecte la demande de silence', () => {
  it('temoin : sans annotation le membre mort sort et part', () => {
    expect(signales(classe('', ''))).toEqual(['garde']);
    expect(supprimes(classe('', ''))).toEqual(['fun garde() = 2']);
  });

  for (const [nom, annoClasse, annoMembre] of [
    ['sur le membre', '', '@Suppress("unused")\n    '],
    ['sur le membre, en ligne', '', '@Suppress("unused") '],
    ['sur la classe', '@Suppress("unused")\n', ''],
    ['sur la classe, Java style', '@SuppressWarnings("unused")\n', ''],
    ['nom qualifie', '@kotlin.Suppress("unused")\n', ''],
    ['parmi d autres diagnostics', '@Suppress("MagicNumber", "unused")\n', ''],
  ] as Array<[string, string, string]>) {
    it(`${nom} : ni signale, ni supprime`, () => {
      const src = classe(annoClasse, annoMembre);
      expect(signales(src)).toEqual([]);
      expect(supprimes(src)).toEqual([]);
    });
  }

  it('une classe englobante plus haut dans la chaine suffit', () => {
    const src = 'package com.x\n\n@Suppress("unused")\nclass C {\n    class D {\n        fun garde() = 2\n    }\n    fun vivante() = 3\n}\n';
    expect(signales(src)).toEqual([]);
  });

  for (const anno of ['@Suppress("MagicNumber")\n', '@Suppress("UnusedPrivateMember")\n', '@Suppress("UNUSED_PARAMETER")\n']) {
    it(`${anno.trim()} ne vaut pas silence sur un membre public`, () => {
      // detekt `UnusedPrivateMember` ne parle que du prive, et le parametre
      // n est pas le membre.
      expect(signales(classe(anno, ''))).toEqual(['garde']);
    });
  }
});

/**
 * Et quand c est le `companion object` anonyme qui porte l annotation.
 *
 * Le correctif de 1.42.325 cherchait la demande de silence sur le membre et
 * sur la chaine de ses declarations englobantes. Le parseur n emet pas le
 * compagnon anonyme comme un symbole : il n est jamais dans cette chaine, et
 * `@Suppress("unused") companion object { fun garde() }` laissait `garde`
 * partir. Le compagnon NOMME, lui, etait couvert, ce qui masquait le trou.
 */
describe('le compagnon anonyme sous silence protege ses membres', () => {
  const avec = (annoCompagnon: string, nom = '') =>
    `package com.x\n\nclass C {\n    ${annoCompagnon}companion object${nom} {\n        fun garde() = 1\n    }\n    fun vivante() = 3\n}\n`;

  it('temoin : sans annotation le membre du compagnon sort', () => {
    expect(signales(avec(''))).toEqual(['garde']);
    expect(supprimes(avec(''))).toEqual(['fun garde() = 1']);
  });

  for (const [nom, anno] of [
    ['annotation sur sa ligne', '@Suppress("unused")\n    '],
    ['annotation en ligne', '@Suppress("unused") '],
    ['avec un modificateur', '@Suppress("unused")\n    internal '],
    ['SuppressWarnings', '@SuppressWarnings("unused")\n    '],
  ] as Array<[string, string]>) {
    it(`${nom} : ni signale, ni supprime`, () => {
      expect(signales(avec(anno))).toEqual([]);
      expect(supprimes(avec(anno))).toEqual([]);
    });
  }

  it('le compagnon nomme reste couvert', () => {
    expect(signales(avec('@Suppress("unused")\n    ', ' Usine'))).toEqual([]);
  });

  it('un autre diagnostic sur le compagnon ne vaut pas silence', () => {
    expect(signales(avec('@Suppress("MagicNumber")\n    '))).toEqual(['garde']);
  });

  it('le silence d un compagnon ne deborde pas sur les membres de la classe', () => {
    const src = 'package com.x\n\nclass C {\n    @Suppress("unused")\n    companion object {\n        fun calme() = 1\n    }\n    fun morte() = 2\n    fun vivante() = 3\n}\n';
    expect(signales(src)).toEqual(['morte']);
  });

  it('l annotation du membre juste au dessus n est pas celle du compagnon', () => {
    // La fenetre s arrete a la ligne du compagnon : lue plus haut, elle
    // prenait le silence demande pour `calme` et l etendait a tout le compagnon.
    const src = 'package com.x\n\nclass C {\n    @Suppress("unused")\n    fun calme() = 0\n    companion object {\n        fun morte() = 1\n    }\n    fun vivante() = 3\n}\n';
    expect(signales(src)).toEqual(['morte']);
  });
});

