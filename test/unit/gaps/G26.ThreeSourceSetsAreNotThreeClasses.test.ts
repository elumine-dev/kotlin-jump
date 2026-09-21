import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G26 — trois source sets ne font pas trois classes.
 *
 * Piege relev'e en ecrivant G25, instruit ici. Android compile UN source set
 * de type de build a la fois : `debug`, `release` et `staging` s excluent.
 * Une classe declaree dans les trois est UNE classe en trois versions, pas
 * trois homonymes. `topLevelNameCounts` (unusedSymbols.ts:1515) les compte
 * pourtant comme trois, et F3 ecarte les trois.
 *
 * ## Ce que le corpus contient
 *
 * Six familles, dix huit declarations :
 *
 *   ShortcutHelper    app/src/{debug,release,staging}/, meme paquet
 *   BaseActivity      app/src/{debug,release,staging}/, meme paquet
 *   LogBindingModule  app et host/app, trois variantes chacun
 *   LogProvideModule  app et host/app, trois variantes chacun
 *
 * Une seule de ces six familles cesserait completement d etre un homonyme si
 * les jumeaux etaient fusionnes : `ShortcutHelper`, trois declarations. Les
 * `Log*Module` existent dans DEUX modules, donc l homonymie inter modules
 * subsiste et F3 continuerait de s appliquer, a juste titre.
 *
 * ## Le cas reel
 *
 *
 *   appele depuis
 *       ShortcutHelper().initializeShortcuts(this)
 *
 * L appel est unique, l import est unique, le paquet est le meme, le module
 * est le meme. Il n y a aucune ambiguite a lever : dans chaque variante, une
 * seule declaration existe. Et pourtant les trois sortent en F3.
 *
 * ## Ce que ca rapporte, honnetement
 *
 * Zero trouvaille. `ShortcutHelper` est vivant, appele par `StartupActivity`.
 * Ce que la correction change est le meme gain que G24 et G25 : trois
 * declarations passent de « jamais jugee » a « jugee vivante ». Le jour ou
 * `StartupActivity` cessera de l appeler, personne ne le dira aujourd hui.
 *
 * C est la troisieme fois de suite que ce dossier trouve un angle mort plutot
 * qu une recolte, et c est en soi un resultat : sur ce corpus, le detecteur ne
 * rate presque plus de code mort, il refuse seulement de se prononcer sur
 * certaines declarations.
 *
 * ## La frontiere, mesuree
 *
 *   trois variantes du meme module et paquet -> F3, et c est le trou
 *   deux modules, meme paquet                -> F3, et c est JUSTE
 *   `main` + `debug`, meme paquet            -> F3, et c est juste : `main`
 *                                               compile avec tous, donc deux
 *                                               declarations coexisteraient
 *   une seule declaration                    -> `alive:main`, deja correct
 *
 * La garde `main` est la plus importante des trois. Un source set `main` n est
 * exclusif de rien ; la relache ne doit porter que sur des source sets qui s
 * excluent deux a deux.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const f = (path: string, text: string) => ({ path, text });

const verdict = (chemin: string, nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom && s.path.includes(chemin));

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(s => s.name);

const VIVANT = f('/w/app/src/main/java/com/x/Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/**
 * host/app/src/{debug,release,staging}/
 * Le corps differe d une variante a l autre ; le nom et le paquet non.
 */
const jumeau = (variante: string, corps: string) =>
  f(`/w/app/src/${variante}/java/com/debug/ShortcutHelper.kt`, [
    'package com.debug',
    '',
    'class ShortcutHelper {',
    '',
    `    fun initializeShortcuts() = ${corps}`,
    '}',
    '',
  ].join('\n'));

const JUMEAUX = [jumeau('debug', '1'), jumeau('release', '2'), jumeau('staging', '3')];

/** host/app/src/main/.../examplemobile/StartupActivity.kt:122 */
const DEMARRAGE = f('/w/app/src/main/java/com/app/StartupActivity.kt', [
  'package com.app',
  '',
  'import com.debug.ShortcutHelper',
  '',
  'fun start() = ShortcutHelper().initializeShortcuts()',
  '',
].join('\n'));

/** Un appelant que quelque chose appelle, pour que le corpus ait une racine. */
const RACINE = f('/w/app/src/main/java/com/x/Main.kt', [
  'package com.x',
  '',
  'import com.app.start',
  '',
  'fun main() {',
  '    start()',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!mod)('le detecteur juge bien une declaration unique', () => {
  it('une seule variante, avec son appelant, sort vivante', () => {
    expect(verdict('/src/debug/', 'ShortcutHelper', JUMEAUX[0], DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!mod)('trois source sets ne font pas trois classes', () => {
  it('chacune des trois est jugee vivante', () => {
    for (const v of ['debug', 'release', 'staging']) {
      expect(verdict(`/src/${v}/`, 'ShortcutHelper', ...JUMEAUX, DEMARRAGE, RACINE), v)
        .toMatchObject({ outcome: 'alive:main' });
    }
  });

  /**
   * La ligne qui resumait le trou : la MEME declaration, le MEME appelant, et
   * un verdict qui changeait selon que ses deux autres versions etaient dans
   * le corpus ou non. Le verdict ne bouge plus.
   */
  it('l arrivee des deux sœurs ne change plus le verdict', () => {
    expect(verdict('/src/debug/', 'ShortcutHelper', JUMEAUX[0], DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'alive:main' });
    expect(verdict('/src/debug/', 'ShortcutHelper', ...JUMEAUX, DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Et quand personne ne les appelle, l echappatoire `unmentionedDuplicates`
   * les rapporte toutes les trois. Le trou ne porte donc que sur le cas ou
   * quelqu un appelle : exactement comme G25.
   */
  it('sans appelant, les trois sont deja rapportees', () => {
    const noms = morts(...JUMEAUX, VIVANT);
    expect(noms.filter(n => n === 'ShortcutHelper')).toHaveLength(3);
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!mod)('la contrepartie de la relache', () => {
  /**
   * Ecrit en `it.fails()` a l origine, il passait deja : quand l appelant se
   * tait, les trois sont rapportees par l echappatoire
   * `unmentionedDuplicates`. La contrepartie de la relache etait donc acquise
   * avant elle, et le trou ne portait que sur le verdict quand quelqu un
   * appelle.
   */
  it('quand l appelant cesse d appeler, les trois sont rapportees', () => {
    const muet = f('/w/app/src/main/java/com/app/StartupActivity.kt', [
      'package com.app',
      '',
      'fun start() = 1',
      '',
    ].join('\n'));
    const noms = morts(...JUMEAUX, muet, RACINE);
    expect(noms.filter(n => n === 'ShortcutHelper')).toHaveLength(3);
  });
});

// ── Gardes : ce qui reste un vrai homonyme ──────────────────────────────────

describe.skipIf(!mod)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(verdict('/src/debug/', 'ShortcutHelper', JUMEAUX[0], DEMARRAGE, RACINE))
    .toMatchObject({ outcome: 'alive:main' });

  /**
   * Deux modules qui declarent le meme paquet et le meme nom : les deux sont
   * compiles, l import ne dit pas lequel. C est le cas des `Log*Module` du
   * corpus, presents dans `app` et `host/app`.
   */
  it('deux modules, meme paquet, restent des homonymes', () => {
    temoin();
    const autreModule = f('/w/lib/src/debug/java/com/debug/ShortcutHelper.kt', [
      'package com.debug',
      '',
      'class ShortcutHelper {',
      '',
      '    fun initializeShortcuts() = 9',
      '}',
      '',
    ].join('\n'));
    expect(verdict('/w/app/src/debug/', 'ShortcutHelper', JUMEAUX[0], autreModule, DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * La garde la plus importante. `main` n est exclusif de rien : il compile
   * avec `debug` comme avec `release`. Deux declarations du meme nom, l une
   * dans `main` et l autre dans `debug`, coexisteraient donc dans le meme
   * build. La relache ne doit porter que sur des source sets qui s excluent.
   */
  /**
   * Deux modules DIFFERENTS et deux source sets DIFFERENTS : rien ne les
   * exclut l un l autre, un `lib` en `release` et un `app` en `debug` se
   * construisent ensemble. Sans la cle module + paquet, la fusion les prenait
   * pour deux versions d une meme classe.
   *
   * La garde voisine, elle, met les deux copies dans le MEME source set, donc
   * c est l unicite des source sets qui la sauve, pas cette cle : les deux
   * verifications se couvrent mutuellement et aucune n etait eprouvee seule.
   */
  it('deux modules ET deux source sets restent des homonymes', () => {
    temoin();
    const autreModule = f('/w/lib/src/release/java/com/debug/ShortcutHelper.kt', [
      'package com.debug',
      '',
      'class ShortcutHelper {',
      '',
      '    fun initializeShortcuts() = 9',
      '}',
      '',
    ].join('\n'));
    expect(verdict('/w/app/src/debug/', 'ShortcutHelper', JUMEAUX[0], autreModule, DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Deux copies dans le MEME source set ne s excluent pas : un fichier genere
   * lu avant le filtre des sources generees peut en produire une, et deux
   * declarations qui coexistent ne sont pas une classe en deux versions.
   */
  it('deux copies du meme source set ne fusionnent pas', () => {
    temoin();
    const jumeauDuMemeSourceSet = f('/w/app/src/debug/java/com/debug/ShortcutHelperBis.kt', [
      'package com.debug',
      '',
      'class ShortcutHelper {',
      '',
      '    fun initializeShortcuts() = 9',
      '}',
      '',
    ].join('\n'));
    expect(verdict('/w/app/src/debug/java/com/debug/ShortcutHelper.kt', 'ShortcutHelper',
      JUMEAUX[0], jumeauDuMemeSourceSet, DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  it('main et debug ne sont pas des variantes qui s excluent', () => {
    temoin();
    const dansMain = f('/w/app/src/main/java/com/debug/ShortcutHelper.kt', [
      'package com.debug',
      '',
      'class ShortcutHelper {',
      '',
      '    fun initializeShortcuts() = 0',
      '}',
      '',
    ].join('\n'));
    expect(verdict('/src/main/java/com/debug/', 'ShortcutHelper', dansMain, JUMEAUX[0], DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Meme module, meme source set, paquets differents : deux classes bien
   * distinctes qui se trouvent porter le meme nom. Rien a fusionner.
   */
  it('meme variante, paquets differents, restent des homonymes', () => {
    temoin();
    const autrePaquet = f('/w/app/src/debug/java/com/other/ShortcutHelper.kt', [
      'package com.other',
      '',
      'class ShortcutHelper {',
      '',
      '    fun initializeShortcuts() = 7',
      '}',
      '',
    ].join('\n'));
    expect(verdict('/com/debug/', 'ShortcutHelper', JUMEAUX[0], autrePaquet, DEMARRAGE, RACINE))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Et la garde qui protege du pire. Fusionner trois jumeaux ne doit jamais
   * produire une coupe : supprimer la version `release` d une classe parce
   * que l import a ete attribue a la version `debug` casse deux builds sur
   * trois.
   */
  it('aucune des trois n est jamais rapportee tant que l appelant appelle', () => {
    const noms = morts(...JUMEAUX, DEMARRAGE, RACINE);
    expect(noms).not.toContain('ShortcutHelper');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [...JUMEAUX, VIVANT], testSourceSets: ['/src/test/'] };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
