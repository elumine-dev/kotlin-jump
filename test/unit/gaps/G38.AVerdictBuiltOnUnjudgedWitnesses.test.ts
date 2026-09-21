import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G38 — un verdict qui declenche une transformation, bati sur des temoins
 * non juges.
 *
 * Dernier recensement : `MakeSelfOnlyPrivate`. La commande prend les membres
 * dont le verdict est `selfOnly` (MakeSelfOnlyPrivate) et propose de les
 * rendre prives. C est la seule famille qui MODIFIE du code vivant au lieu d
 * en retirer, donc la justesse du verdict y compte autrement.
 *
 * ## Ce que `selfOnly` veut dire, et sur quoi il repose
 *
 * « Toutes les mentions restantes sont dans la classe qui declare le membre. »
 * Le detecteur ne demande pas si ces mentions sont, elles, vivantes.
 *
 * Mesure sur le corpus, avec `includeSelfOnly` :
 *
 *   selfOnly       169
 *   testOnly        40
 *   unreferenced     2
 *
 * Deux cas de figure, tous deux reproduits sur un corpus minimal.
 *
 * **1. Le seul utilisateur est rapporte MORT dans le meme appel.**
 *
 *   class Service {
 *       fun used() = 1          // alive:main
 *       fun dead() = helper()   // unreferenced, rapporte
 *       fun helper() = 2        // selfOnly
 *   }
 *
 * `helper` n est atteint que par `dead`, que le MEME appel declare mort. La
 * commande proposera donc de rendre `helper` prive, alors qu il part avec
 * `dead`. Le detecteur a l information et ne s en sert pas.
 *
 * Sur le corpus, **zero** cas : `unreferenced` n y vaut que 2, il n y a
 * presque rien dont un `selfOnly` puisse dependre. Le mecanisme est reel, la
 * recolte est nulle, comme en G23.
 *
 * **2. Le seul utilisateur est ECARTE par un filtre.**
 *
 *   class Service {
 *       fun used() = 1
 *       @Nullable fun filtered() = helper()   // M6:@Nullable
 *       fun helper() = 2                      // selfOnly
 *   }
 *
 * C est la quatrieme apparition de la meme erreur de categorie, apres G21,
 * G22 et G27 : une declaration que personne n a jugee sert de temoin. Mesure
 * approchee sur le corpus, en attribuant chaque mention au dernier membre
 * declare avant elle : **34 sur 169**. La plupart sont des constantes de
 * `companion object` lues depuis une methode `@Override` ou `@UnstableApi`,
 * donc bien vivantes ; aucune ne devient morte. Ce qui est en cause n est pas
 * le resultat, c est la PREUVE.
 *
 *
 * ## Ce que ces tests demandent
 *
 * Que `selfOnly` ne compte comme temoin qu une mention venue d un membre que
 * le detecteur juge vivant. Le gain ne se mesure pas en suppressions ; il se
 * mesure en transformations qu on ne propose pas a tort.
 */

const memb: any = await importOrNull('src/providers/unusedMembers');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[], includeSelfOnly = false) =>
  ({ sources, testSourceSets: ['/src/test/'], includeSelfOnly } as any);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (memb.explainMembers(base(sources)) as any[]).find((m: any) => m.name === nom);

/** Ce que la commande `MakeSelfOnlyPrivate` recevrait. */
const aRendrePrives = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers(base(sources, true)) as any[])
    .filter((m: any) => m.verdict === 'selfOnly').map((m: any) => m.name);

const morts = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers(base(sources, true)) as any[])
    .filter((m: any) => m.verdict === 'unreferenced').map((m: any) => m.name);

const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');

// ── Les trois corpus, qui ne different que par leur temoin ─────────────────

/** Le temoin est une methode vivante : `selfOnly` est justifie. */
const TEMOIN_VIVANT = f('Service.kt', [
  'package com.x',
  '',
  'class Service {',
  '',
  '    fun used() = helper()',
  '',
  '    fun helper() = 1',
  '}',
  '',
].join('\n'));

/** Le temoin est une methode que le MEME appel rapporte morte. */
const TEMOIN_MORT = f('Service.kt', [
  'package com.x',
  '',
  'class Service {',
  '',
  '    fun used() = 1',
  '',
  '    fun dead() = helper()',
  '',
  '    fun helper() = 2',
  '}',
  '',
].join('\n'));

/**
 * Le temoin est une methode ecartee par un filtre. Motif reel :
 *, une constante de
 * `companion object` lue depuis une methode annotee.
 */
const TEMOIN_ECARTE = f('Service.kt', [
  'package com.x',
  '',
  'class Service {',
  '',
  '    fun used() = 1',
  '',
  '    @Nullable',
  '    fun filtered() = helper()',
  '',
  '    fun helper() = 2',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!memb)('le detecteur juge bien ces corpus', () => {
  it('un membre appele par une methode vivante est selfOnly, a juste titre', () => {
    expect(verdict('helper', TEMOIN_VIVANT, APPELANT)).toMatchObject({ outcome: 'selfOnly' });
    expect(aRendrePrives(TEMOIN_VIVANT, APPELANT)).toEqual(['helper']);
  });

  it('et la methode qui l appelle est bien vivante', () => {
    expect(verdict('used', TEMOIN_VIVANT, APPELANT)).toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Sentinelles : le verdict et son temoin, dans le meme appel ─────────────

describe.skipIf(!memb)('aujourd hui, le temoin n a pas besoin d etre vivant', () => {
  /**
   * Les deux lignes qui montrent le defaut : le meme appel rapporte `dead`
   * comme morte ET `helper` comme simplement privatisable, alors que `dead`
   * est le seul a nommer `helper`.
   */
  it('le seul utilisateur est rapporte mort dans le meme appel', () => {
    expect(morts(TEMOIN_MORT, APPELANT)).toContain('dead');
    expect(verdict('helper', TEMOIN_MORT, APPELANT)).toMatchObject({ outcome: 'selfOnly' });
  });

  /**
   * Corrige par KJ-076 : la commande ne recoit plus `helper`. `explainMembers`
   * dit toujours `selfOnly`, parce que la forme est bien celle la ; ce qui a
   * change, c est que `findUnusedMembers` ne la RAPPORTE plus, donc aucune
   * transformation n est proposee sur un temoin qui meurt.
   */
  it('mais la commande ne recoit plus helper a privatiser', () => {
    expect(aRendrePrives(TEMOIN_MORT, APPELANT)).not.toContain('helper');
  });

  /**
   * Quatrieme apparition de la meme erreur de categorie, apres G21, G22 et
   * G27 : une declaration que personne n a jugee sert de temoin.
   */
  it('un utilisateur ecarte par un filtre fait le meme effet', () => {
    expect(verdict('filtered', TEMOIN_ECARTE, APPELANT)).toMatchObject({ outcome: 'M6:@Nullable' });
    expect(verdict('helper', TEMOIN_ECARTE, APPELANT)).toMatchObject({ outcome: 'selfOnly' });
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!memb)('un temoin non vivant ne devrait pas prouver selfOnly', () => {
  it.fails('helper devrait partir avec la methode morte qui l appelle', () => {
    expect(morts(TEMOIN_MORT, APPELANT)).toContain('helper');
  });

  /**
   * Le premier cas, lui, reste ouvert et c est delibere : `helper` ne part pas
   * a la MEME ronde que `dead`. Le point fixe s en charge au tour suivant,
   * `dead` retire, `helper` n a plus aucune mention. Forcer la ronde 1 a
   * conclure demanderait de rejouer les verdicts sur un corpus qu on vient
   * seulement de decider de couper.
   */
  it('la privatisation, elle, n est plus proposee des la premiere ronde', () => {
    expect(aRendrePrives(TEMOIN_MORT, APPELANT)).not.toContain('helper');
  });

  /**
   * Pour le temoin ECARTE, la demande est plus prudente : un filtre dit « je
   * ne sais pas », donc on ne peut pas conclure a la mort. Mais on ne peut pas
   * non plus conclure a `selfOnly`, qui declenche une transformation.
   */
  it('un temoin ecarte ne suffit pas a conclure selfOnly', () => {
    expect(aRendrePrives(TEMOIN_ECARTE, APPELANT)).not.toContain('helper');
  });
});

// ── Gardes : ce que la relache ne doit pas emporter ────────────────────────

describe.skipIf(!memb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(aRendrePrives(TEMOIN_VIVANT, APPELANT)).toEqual(['helper']);

  it('un temoin vivant garde le verdict selfOnly', () => {
    temoin();
    expect(verdict('helper', TEMOIN_VIVANT, APPELANT)).toMatchObject({ outcome: 'selfOnly' });
  });

  /**
   * Un utilisateur hors de la classe rend le membre franchement vivant : ce n
   * est plus un `selfOnly`, et il ne doit surtout pas devenir prive.
   */
  it('un utilisateur hors de la classe empeche selfOnly', () => {
    temoin();
    const dehors = f('Autre.kt', [
      'package com.x',
      '',
      'fun ailleurs() = Service().helper()',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n    ailleurs()\n}\n');
    expect(verdict('helper', TEMOIN_VIVANT, dehors, appel)).toMatchObject({ outcome: 'alive:main' });
    expect(aRendrePrives(TEMOIN_VIVANT, dehors, appel)).not.toContain('helper');
  });

  /**
   * Deux temoins dont un seul est mort : le membre reste `selfOnly`, parce qu
   * il lui reste un utilisateur vivant. La relache ne doit pas se contenter de
   * « au moins un temoin est mort ».
   */
  it('deux temoins dont un vivant gardent le verdict', () => {
    temoin();
    const deux = f('Service.kt', [
      'package com.x',
      '',
      'class Service {',
      '',
      '    fun used() = helper()',
      '',
      '    fun dead() = helper()',
      '',
      '    fun helper() = 2',
      '}',
      '',
    ].join('\n'));
    expect(morts(deux, APPELANT)).toContain('dead');
    expect(aRendrePrives(deux, APPELANT)).toContain('helper');
  });

  /**
   * Un membre deja prive n a rien a gagner : la commande ne doit pas le
   * proposer, et le detecteur ne doit pas le compter.
   */
  it('un membre deja prive n est pas propose', () => {
    temoin();
    const deja = f('Service.kt', [
      'package com.x',
      '',
      'class Service {',
      '',
      '    fun used() = helper()',
      '',
      '    private fun helper() = 1',
      '}',
      '',
    ].join('\n'));
    expect(aRendrePrives(deja, APPELANT)).not.toContain('helper');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    temoin();
    expect(memb.findUnusedMembers({ ...base([TEMOIN_MORT, APPELANT], true), truncated: true })).toHaveLength(0);
  });
});
