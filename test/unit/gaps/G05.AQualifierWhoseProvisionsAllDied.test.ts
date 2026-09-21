import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G5 — un qualificateur Dagger dont toutes les fournitures sont mortes.
 *
 * Voir doc/gaps-detection.md. Le cas reel est
 *, qui declare six
 * qualificateurs, et, qui
 * fournit un `Scheduler` pour chacun. Le graphe genere en consomme DEUX :
 *
 * @UIScheduler SchedulerAnnotations SchedulersModule vivant
 * @IoScheduler SchedulerAnnotations SchedulersModule vivant
 * @TrampolineScheduler SchedulerAnnotations SchedulersModule MORT
 * @ComputationScheduler SchedulerAnnotations SchedulersModule MORT
 * @NewThreadScheduler SchedulerAnnotations SchedulersModule MORT
 * @SingleScheduler SchedulerAnnotations SchedulersModule MORT
 *
 * Les deux premieres lignes sont le temoin de controle du projet reel : meme
 * fichier, meme forme, et elles vivent. Pour les quatre autres, chaque
 * annotation n est ecrite que trois fois : sa declaration, son import dans le
 * module, et son usage sur la methode morte. Personne n injecte un
 * `@ComputationScheduler Scheduler`.
 *
 * Cinquieme cas isole : `@RenderPagePool`, declaree
 *, ecrite exactement deux
 * fois, la seconde sur une fourniture que le graphe ne consomme pas.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Mesure faite avant d ecrire ces tests, avec `explainSymbols` :
 *
 *   annotation class ComputationScheduler  -> AUCUN CANDIDAT
 *   @interface CellSelectionType (Java)    -> AUCUN CANDIDAT
 *   class ComputationScheduler             -> unreferenced (main = 1)
 *
 * Meme nom, meme corpus, verdicts opposes : la sorte `annotation` n est pas
 * dans `CANDIDATE_KINDS` (`unusedSymbols.ts:150`), qui annonce d ailleurs en
 * toutes lettres que « typealias and annotation are v2 ». L annotation n est
 * donc jamais jugee, ni vraie ni fausse.
 *
 * ## Le tour deux
 *
 * G5 est une trouvaille de la ronde SUIVANTE : tant que la fourniture est la,
 * l annotation est legitimement vivante. Elle ne meurt qu une fois G1
 * applique. Les cas ci dessous qui simulent cette ronde le disent dans leur
 * nom, et le corpus y est donne sans le module, exactement comme la boucle de
 * point fixe le verrait au tour d apres.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const iles: any = await importOrNull('src/providers/deadIslands');
const memb: any = await importOrNull('src/providers/unusedMembers');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

/**
 * Le canari : une annotation morte de facon evidente, que rien n applique.
 * Aujourd hui le detecteur ne la rapporte pas, donc les gardes sont ROUGES,
 * ce qui est le verdict honnete : rien n est protege tant que rien n est juge.
 */
const CANARI = f(`${MAIN}/CanaryAnnotation.kt`, [
  'package com.x',
  '',
  'annotation class CanaryGone',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures, reduites du motif reel ────────────────────────────────────────

/** `SchedulerAnnotations.kt`, reduit a un vivant et un mort. */
const ANNOTATIONS = f(`${MAIN}/SchedulerAnnotations.kt`, [
  'package com.x',
  '',
  'import javax.inject.Qualifier',
  '',
  '@Retention(AnnotationRetention.BINARY)',
  '@Qualifier',
  'annotation class UIScheduler',
  '',
  '@Retention(AnnotationRetention.BINARY)',
  '@Qualifier',
  'annotation class ComputationScheduler',
  '',
].join('\n'));

/** `SchedulersModule.kt`, avec la fourniture vivante et la morte. */
const MODULE = f(`${MAIN}/SchedulersModule.kt`, [
  'package com.x',
  '',
  'import dagger.Module',
  'import dagger.Provides',
  '',
  '@Module',
  'object SchedulersModule {',
  '',
  '    @UIScheduler',
  '    @Provides',
  '    fun provideUiScheduler(): Scheduler = AndroidSchedulers.mainThread()',
  '',
  '    @ComputationScheduler',
  '    @Provides',
  '    fun providesComputationScheduler(): Scheduler = Schedulers.computation()',
  '}',
  '',
].join('\n'));

/** Celui qui demande le scheduler vivant, et lui seul. */
const CONSOMMATEUR = f(`${MAIN}/Repo.kt`, [
  'package com.x',
  '',
  'import javax.inject.Inject',
  '',
  'class Repo @Inject constructor(@UIScheduler private val scheduler: Scheduler)',
  '',
].join('\n'));

/** Une classe du meme nom : le temoin de bonne formation. */
const CLASSE_TEMOIN = f(`${MAIN}/PlainName.kt`, [
  'package com.x',
  '',
  'class ComputationScheduler',
  '',
].join('\n'));

describe.skipIf(!mod)('G5 — le corpus de test est lisible', () => {
  it('rapporte une CLASSE du meme nom que rien ne mentionne', () => {
    expect(nomme(symboles(CLASSE_TEMOIN), 'ComputationScheduler')).toBe(true);
  });

  /**
   * SENTINELLE. Meme nom, meme corpus, deux sortes, deux verdicts. C est la
   * demonstration que le trou est la SORTE et rien d autre. Si ce test se met
   * a echouer, `CANDIDATE_KINDS` a bouge et l entree G5 du document, comme
   * G6, doit etre relue.
   */
  it('aujourd hui, une annotation n est jamais un candidat', () => {
    expect(pourquoi('ComputationScheduler', CLASSE_TEMOIN))
      .toMatchObject({ kind: 'class', outcome: 'unreferenced' });
    expect(pourquoi('ComputationScheduler', ANNOTATIONS)).toBeUndefined();
    expect(pourquoi('UIScheduler', ANNOTATIONS)).toBeUndefined();
  });

  it('aujourd hui, un @interface Java n est jamais un candidat non plus', () => {
    const java = f(`${MAIN}/CellSelectionType.java`, [
      'package com.x;',
      '',
      'public @interface CellSelectionType {',
      '}',
      '',
    ].join('\n'));
    expect(pourquoi('CellSelectionType', java)).toBeUndefined();
  });
});

describe.skipIf(!mod)('G5 — le qualificateur que plus aucune fourniture ne porte', () => {
  it.fails('rapporte une annotation class que rien n applique', () => {
    expect(nomme(symboles(ANNOTATIONS), 'ComputationScheduler')).toBe(true);
  });

  it.fails('rapporte un @interface Java que rien n applique', () => {
    const java = f(`${MAIN}/Unused.java`, [
      'package com.x;',
      '',
      'public @interface UnusedMarker {',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(java), 'UnusedMarker')).toBe(true);
  });

  it.fails('ronde deux : rapporte le qualificateur dont la fourniture vient d etre coupee', () => {
    // Le corpus est donne SANS `SchedulersModule` : c est exactement ce que la
    // boucle de point fixe lit au tour d apres, une fois G1 applique. Les
    // deux annotations sont alors orphelines.
    const trouves = symboles(ANNOTATIONS);
    expect(trouves.map(s => s.name)).toEqual(
      expect.arrayContaining(['UIScheduler', 'ComputationScheduler']));
  });

  it.fails('ne rapporte QUE le qualificateur mort quand son voisin vit', () => {
    // Le temoin interne du projet reel : `@UIScheduler` est injecte, pas
    // `@ComputationScheduler`. Un detecteur trop large emporterait les deux.
    const noms = symboles(ANNOTATIONS, MODULE, CONSOMMATEUR).map(s => s.name);
    expect(noms).toContain('ComputationScheduler');
    expect(noms).not.toContain('UIScheduler');
  });

  it.fails('rapporte le qualificateur isole du motif @RenderPagePool', () => {
 //: declaree dans le
    // module lui meme, ecrite une seule autre fois, sur la fourniture morte.
    const interne = f(`${MAIN}/AppApplicationModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      '',
      '@Module',
      'class AppApplicationModule {',
      '',
      '    @Qualifier',
      '    annotation class RenderPagePool',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(interne), 'RenderPagePool')).toBe(true);
  });
});

describe.skipIf(!mod)('G5 — les gardes, en echec tant que G5 n est pas fait', () => {
  /**
   * Chacune passe par `epargne`, qui exige le canari. Elles sont ROUGES
   * aujourd hui : aucune annotation n etant jugee, « ne rapporte pas X »
   * serait vrai par vacuite. Elles verdiront avec l implementation et diront
   * alors si elle emporte une annotation vivante.
   */

  it('ne touche pas un qualificateur qu une fourniture vivante porte', () => {
    epargne(symboles(ANNOTATIONS, MODULE, CONSOMMATEUR, CANARI), 'UIScheduler');
  });

  it('ne touche pas une annotation appliquee depuis un autre fichier', () => {
    const ailleurs = f(`${MAIN}/Screen.kt`, [
      'package com.x',
      '',
      'import com.x.ComputationScheduler',
      '',
      'class Screen {',
      '    @ComputationScheduler',
      '    lateinit var scheduler: Scheduler',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(ANNOTATIONS, ailleurs, CANARI), 'ComputationScheduler');
  });

  /**
   * Une annotation lisible a l execution peut etre cherchee par reflexion,
   * dans du code que ce corpus ne verra jamais. C est la garde qui separe
   * `AnnotationRetention.BINARY`, sur laquelle on peut raisonner, de
   * `RUNTIME`, sur laquelle on ne peut pas.
   */
  it('ne touche pas une annotation de retention RUNTIME', () => {
    const runtime = f(`${MAIN}/Reflected.kt`, [
      'package com.x',
      '',
      '@Retention(AnnotationRetention.RUNTIME)',
      'annotation class Reflected',
      '',
    ].join('\n'));
    epargne(symboles(runtime, CANARI), 'Reflected');
  });

  it('ne touche pas un @interface Java sans @Retention explicite', () => {
    // Par defaut, javac retient CLASS, mais les outils de generation lisent
    // souvent ces marqueurs. Sans retention ecrite, on ne tranche pas.
    const java = f(`${MAIN}/Marker.java`, [
      'package com.x;',
      '',
      'public @interface Marker {',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(java, CANARI), 'Marker');
  });

  it('ne touche pas une annotation que seul un test applique', () => {
    const test = f('/w/app/src/test/java/com/x/RepoTest.kt', [
      'package com.x',
      '',
      'class RepoTest {',
      '    @ComputationScheduler',
      '    lateinit var scheduler: Scheduler',
      '}',
      '',
    ].join('\n'));
    const trouves = symboles(ANNOTATIONS, test, CANARI);
    expect(trouves.map(s => s.name)).toContain('CanaryGone');
    expect(trouves.find(s => s.name === 'ComputationScheduler')?.verdict)
      .not.toBe('unreferenced');
  });

  /**
   * `@Qualifier` et `@Retention` sont portees PAR le qualificateur, elles ne
   * l utilisent pas. Un detecteur qui compterait « l annotation est mentionnee
   * dans son propre fichier » garderait tout le monde en vie.
   */
  it('ne compte pas les annotations portees par la declaration elle meme', () => {
    const trouves = symboles(ANNOTATIONS, CANARI);
    expect(trouves.map(s => s.name)).toContain('CanaryGone');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [CLASSE_TEMOIN], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});


/**
 * AUCUNE AUTRE FAMILLE NE VOIT CE MOTIF, verifie.
 *
 * Un qualificateur et le module qui le porte pourraient former un ilot, ou
 * ressortir comme membre mort. Ni l un ni l autre :
 *
 *   findDeadIslands   -> (rien)
 *   findUnusedSymbols -> (rien)   la sorte `annotation` n est pas candidate
 *   findUnusedMembers -> (rien)   @Provides est une annotation etrangere
 *
 * G5 cumule donc deux trous du document : celui de G1 sur la fourniture, et
 * celui de G6 sur la sorte. C est pour cette raison qu il ne peut pas tomber
 * par un autre chemin.
 */
describe.skipIf(!mod || !iles || !memb)('G5 — aucune autre famille ne couvre ce motif', () => {
  it('les ilots ne forment rien sur le qualificateur et son module', () => {
    expect(iles.findDeadIslands({
      sources: [ANNOTATIONS, MODULE], testSourceSets: ['/src/test/'], maxIslandSize: 8,
    })).toHaveLength(0);
  });

  it('les symboles ne rapportent ni l annotation ni le module', () => {
    expect(symboles(ANNOTATIONS, MODULE)).toHaveLength(0);
  });

  it('les membres ne rapportent pas la fourniture', () => {
    expect(memb.findUnusedMembers({
      sources: [ANNOTATIONS, MODULE], testSourceSets: ['/src/test/'], includeSelfOnly: false,
    })).toHaveLength(0);
  });
});
