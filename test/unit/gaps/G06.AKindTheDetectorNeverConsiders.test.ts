import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G6 — `typealias` et `annotation class` ne sont pas des sortes candidates.
 *
 * Voir doc/gaps-detection.md. `unusedSymbols.ts:147` l annonce en toutes
 * lettres, « typealias and annotation are v2 », et `CANDIDATE_KINDS` ligne 150
 * contient `class`, `interface`, `object`, `enum`, `dataClass`, `sealedClass`,
 * `fun`, `composable`, `val`, `var`. Ni `typealias`, ni `annotation`.
 *
 * ## Ce fichier couvre le typealias ; G5 couvre l annotation
 *
 * Les deux sortes tombent par le meme mecanisme, mais elles ne se cassent pas
 * de la meme facon. `G05` traite le qualificateur Dagger, sa cascade et ses
 * gardes de reflexion. Ici on traite le `typealias`, qui a un piege bien a
 * lui : un alias de classe s appelle comme un CONSTRUCTEUR, pas seulement
 * comme un type. Voir la garde correspondante.
 *
 * ## Mesure honnete sur le projet de reference
 *
 * Le corpus declare 7 `typealias`, 83 `annotation class` et 31 `@interface`
 * Java, et AUCUN n est orphelin au premier tour. Le plus maigre,
 * `@SearchResultViewModelKey`
 * , est ecrit
 * une fois de plus ligne 23, et cet usage est reel.
 *
 * Ce trou ne coute donc rien aujourd hui, et tout au tour SUIVANT : les cinq
 * annotations de G5 ne deviennent mortes qu une fois les fournitures coupees.
 * Un detecteur qui ignore la sorte ne les verra jamais, meme apres la coupe,
 * et la boucle de point fixe s arretera sur un fichier qui garde quatre
 * declarations que plus rien ne nomme. C est le meme motif que KJ-072 : zero
 * sur un corpus vierge, toute la valeur au tour d apres.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Mesure faite avant d ecrire ces tests, avec `explainSymbols`, sur un corpus
 * d un seul fichier et un seul nom, `StoryNavData` :
 *
 *   val StoryNavData        -> val   / unreferenced  (rapporte)
 *   class StoryNavData      -> class / unreferenced  (rapporte)
 *   typealias StoryNavData  -> AUCUN CANDIDAT
 *
 * Trois sortes, un seul nom, deux verdicts et un silence.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

/** Le canari : un typealias mort, que le detecteur devra rapporter. */
const CANARI = f(`${MAIN}/CanaryAlias.kt`, [
  'package com.x',
  '',
  'typealias CanaryGone = List<Int>',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Le motif de `host/component-feed/.../BaseFeedController.kt:65`. */
const ALIAS_SEUL = f(`${MAIN}/BaseFeedController.kt`, [
  'package com.x',
  '',
  'typealias GenericBaseFeedController = BaseFeedController<*, *>',
  '',
].join('\n'));

/** Les temoins : le meme nom, porte par des sortes que le detecteur juge. */
const VAL_TEMOIN = f(`${MAIN}/AsVal.kt`, [
  'package com.x',
  '',
  'val StoryNavData = 1',
  '',
].join('\n'));

const CLASSE_TEMOIN = f(`${MAIN}/AsClass.kt`, [
  'package com.x',
  '',
  'class StoryNavData',
  '',
].join('\n'));

const ALIAS_TEMOIN = f(`${MAIN}/AsAlias.kt`, [
  'package com.x',
  '',
  'typealias StoryNavData = Pair<String, String>',
  '',
].join('\n'));

describe.skipIf(!mod)('G6 — le corpus de test est lisible', () => {
  it('rapporte un val de haut niveau que rien ne nomme', () => {
    expect(nomme(symboles(VAL_TEMOIN), 'StoryNavData')).toBe(true);
  });

  it('rapporte une classe de haut niveau que rien ne nomme', () => {
    expect(nomme(symboles(CLASSE_TEMOIN), 'StoryNavData')).toBe(true);
  });

  /**
   * SENTINELLE. Un seul nom, trois sortes, et le typealias est le seul a ne
   * meme pas exister pour le detecteur. Si ce test se met a echouer,
   * `CANDIDATE_KINDS` a bouge et les entrees G5 et G6 du document doivent
   * etre relues ensemble.
   */
  it('aujourd hui, un typealias n est jamais un candidat', () => {
    expect(pourquoi('StoryNavData', VAL_TEMOIN)).toMatchObject({ kind: 'val' });
    expect(pourquoi('StoryNavData', CLASSE_TEMOIN)).toMatchObject({ kind: 'class' });
    expect(pourquoi('StoryNavData', ALIAS_TEMOIN)).toBeUndefined();
  });

  it('aujourd hui, ni le typealias prive ni le generique ne sont candidats', () => {
    const prive = f(`${MAIN}/Priv.kt`, [
      'package com.x', '', 'private typealias Inner = List<Int>', '',
    ].join('\n'));
    const generique = f(`${MAIN}/Gen.kt`, [
      'package com.x', '', 'typealias Generic<T> = Map<String, T>', '',
    ].join('\n'));
    expect(pourquoi('Inner', prive)).toBeUndefined();
    expect(pourquoi('Generic', generique)).toBeUndefined();
  });
});

describe.skipIf(!mod)('G6 — le typealias que personne n utilise', () => {
  it.fails('rapporte un typealias de haut niveau que rien ne nomme', () => {
    expect(nomme(symboles(ALIAS_SEUL), 'GenericBaseFeedController')).toBe(true);
  });

  it.fails('rapporte un typealias prive que son propre fichier n utilise pas', () => {
    const prive = f(`${MAIN}/Priv.kt`, [
      'package com.x',
      '',
      'private typealias Inner = List<Int>',
      '',
      'fun visible() = 1',
      '',
    ].join('\n'));
    expect(nomme(symboles(prive), 'Inner')).toBe(true);
  });

  it.fails('rapporte un typealias generique que rien n instancie', () => {
    const generique = f(`${MAIN}/Gen.kt`, [
      'package com.x',
      '',
      'typealias Generic<T> = Map<String, T>',
      '',
    ].join('\n'));
    expect(nomme(symboles(generique), 'Generic')).toBe(true);
  });

  it.fails('rapporte les DEUX sortes ignorees dans le meme fichier', () => {
    // Un fichier qui ne declare qu un alias et une annotation, tous deux
    // orphelins, devrait se vider entierement et tomber par KJ-060 a la
    // ronde suivante. Aujourd hui il n en sort rien du tout.
    const melange = f(`${MAIN}/Aliases.kt`, [
      'package com.x',
      '',
      'typealias Orphan = List<Int>',
      '',
      'annotation class OrphanMarker',
      '',
    ].join('\n'));
    const noms = symboles(melange).map(s => s.name);
    expect(noms).toEqual(expect.arrayContaining(['Orphan', 'OrphanMarker']));
  });
});

describe.skipIf(!mod)('G6 — les gardes, en echec tant que G6 n est pas fait', () => {
  /**
   * Chacune passe par `epargne`, qui exige le canari. Elles sont ROUGES
   * aujourd hui : aucun typealias n etant juge, « ne rapporte pas X » serait
   * vrai par vacuite.
   */

  it('ne touche pas un typealias utilise comme type de retour', () => {
    const usage = f(`${MAIN}/Nav.kt`, [
      'package com.x',
      '',
      'typealias StoryNavData = Pair<String, String>',
      '',
      'fun build(a: String, b: String): StoryNavData = Pair(a, b)',
      '',
    ].join('\n'));
    epargne(symboles(usage, CANARI), 'StoryNavData');
  });

  /**
   * LE PIEGE PROPRE AU TYPEALIAS. Un alias de classe s appelle comme un
   * constructeur : `StoryNavData(selfLink, openMethod)` a
 * construit une
   * valeur sans jamais ecrire l alias en position de type. Un detecteur qui
   * ne compterait que les usages comme TYPE couperait du code vivant ici.
   */
  it('ne touche pas un typealias appele comme constructeur', () => {
    const construit = f(`${MAIN}/OpenStoryFromURI.kt`, [
      'package com.x',
      '',
      'typealias StoryNavData = Pair<String, String>',
      '',
      'fun navigate(selfLink: String, openMethod: String) =',
      '    StoryNavData(selfLink, openMethod)',
      '',
    ].join('\n'));
    epargne(symboles(construit, CANARI), 'StoryNavData');
  });

  it('ne touche pas un typealias importe par un autre fichier', () => {
    const ailleurs = f(`${MAIN}/Screen.kt`, [
      'package com.x',
      '',
      'import com.x.GenericBaseFeedController',
      '',
      'class Screen {',
      '    fun show(c: GenericBaseFeedController) = Unit',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(ALIAS_SEUL, ailleurs, CANARI), 'GenericBaseFeedController');
  });

  it('ne touche pas un typealias nomme dans une signature generique', () => {
    const generique = f(`${MAIN}/Box.kt`, [
      'package com.x',
      '',
      'typealias StoryNavData = Pair<String, String>',
      '',
      'class Box(val items: List<StoryNavData>)',
      '',
    ].join('\n'));
    epargne(symboles(generique, CANARI), 'StoryNavData');
  });

  it('ne touche pas un typealias que seul un test nomme', () => {
    const test = f('/w/app/src/test/java/com/x/NavTest.kt', [
      'package com.x',
      '',
      'class NavTest {',
      '    fun check(d: GenericBaseFeedController) = d',
      '}',
      '',
    ].join('\n'));
    const trouves = symboles(ALIAS_SEUL, test, CANARI);
    expect(trouves.map(s => s.name)).toContain('CanaryGone');
    expect(trouves.find(s => s.name === 'GenericBaseFeedController')?.verdict)
      .not.toBe('unreferenced');
  });

  /**
   * Un alias declare par un module publie fait partie de son API : personne
   * dans CE corpus ne l utilise, et c est normal.
   */
  it('ne touche pas un typealias declare par un module publie', () => {
    const publie = { path: '/w/sdk/src/main/java/com/x/PublicAlias.kt', text: [
      'package com.x',
      '',
      'typealias PublicNavData = Pair<String, String>',
      '',
    ].join('\n') };
    const trouves = mod.findUnusedSymbols({
      sources: [publie, CANARI],
      testSourceSets: ['/src/test/'],
      publishedModules: ['/w/sdk'],
    }) as any[];
    expect(trouves.map(s => s.name)).toContain('CanaryGone');
    expect(trouves.map(s => s.name)).not.toContain('PublicNavData');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [CLASSE_TEMOIN], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
