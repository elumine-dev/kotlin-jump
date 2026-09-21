import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G1 — une methode `@Provides` / `@Binds` dont personne ne demande le type.
 *
 * Voir doc/gaps-detection.md. Sur le projet de reference, 65 methodes de
 * fourniture sur 393 ne sont citees par aucun fichier genere autre que leur
 * propre `Factory`, donc Dagger ne les appellera jamais. `ExoModule` est mort
 * en entier (11/11), supplante par `MediaModule` de `core/mediaplayer`.
 *
 * Reparties, ces 64 ne sont pas homogenes : 46 vivent dans du code de
 * PRODUCTION, 16 dans le module de demonstration `demo/adkit` (le seul
 * `CoreUiModule`, tout en objets anonymes, voir le cas du type implicite plus
 * bas), et 2 dans un module que la sonde n a pas su localiser. Le chiffre a
 * retenir pour la production est donc 46.
 *
 * Pourquoi le detecteur passe a cote : `unusedMembers.ts:446` ecarte tout
 * membre portant une annotation absente de `BENIGN_MEMBER_ANNOTATIONS`, et
 * `@Provides` en fait partie. La garde est prudente et protege les points
 * d entree reflexifs ; elle avale ici une famille entiere.
 *
 * ## Ce que ces tests affirment
 *
 * Un type fourni est DEMANDE quand il apparait comme parametre d un
 * constructeur `@Inject`, comme champ `@Inject`, comme parametre d une autre
 * methode de fourniture, comme methode d une interface `@Component`, ou sous
 * une enveloppe (`Provider<T>`, `Lazy<T>`, `Optional<T>`, un multibinding).
 * Toute forme absente de cette liste est un faux positif qui coupe du code
 * vivant : les gardes ci-dessous sont donc aussi importantes que les cas
 * positifs. Elles echouent AUJOURD HUI, et c est voulu : chacune exige un
 * canari, une fourniture morte que le detecteur doit rapporter dans le meme
 * appel. Sans ce canari, « ne rapporte pas X » serait vrai par vacuite tant
 * que le detecteur se tait sur les `@Module`, et la suite serait verte sans
 * rien proteger. Seule la garde du corpus tronque mord des maintenant.
 *
 * Les cas positifs sont en `it.fails()` : ils decrivent le comportement voulu,
 * pas l actuel. Un cas qui se met a passer fera echouer `it.fails()` et se
 * signalera tout seul.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const membres = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedMembers({
    sources,
    testSourceSets: ['/src/test/'],
    includeSelfOnly: false,
  }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(m => m.name === nom);

/**
 * Le canari, qui empeche une garde de passer par vacuite.
 *
 * Une garde dit « le detecteur ne doit PAS rapporter X ». Tant que le
 * detecteur ne rapporte RIEN sur un `@Module`, cette phrase est vraie sans
 * rien prouver, et la suite est verte alors qu elle ne protege personne.
 *
 * `epargne` exige donc deux choses du MEME appel : que le canari, une
 * fourniture morte au vu et au su de tous, soit bien rapporte, et que la
 * cible ne le soit pas. Aujourd hui la premiere moitie echoue, ce qui est le
 * verdict honnete. Le jour ou G1 sera implemente, la garde mordra pour de
 * vrai.
 */
const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(m => m.name)).toContain('provideCanary');
  expect(trouves.map(m => m.name)).not.toContain(cible);
};

// ── Fixtures, reduites du motif reel ────────────────────────────────────────

/**
 * Le motif du module de lecture video : une fourniture
 * dont le type de retour n est demande nulle part. La soeur `provideEvictor`
 * est le temoin vivant du meme fichier, comme `provideShellMainDirector` l est
 * de `provideShellMainLayout` dans `AppMainActivityModule`.
 */
const MODULE_AVEC_UNE_MORTE = f(`${MAIN}/ExoModule.kt`, [
  'package com.x',
  '',
  'import dagger.Module',
  'import dagger.Provides',
  '',
  '@Module',
  'class ExoModule {',
  '',
  '    @Provides',
  '    fun provideEvictor(context: Context): Evictor {',
  '        return Evictor(context)',
  '    }',
  '',
  '    @Provides',
  '    fun provideDatabaseProvider(context: Context): DatabaseProvider {',
  '        return ExoDatabaseProvider(context)',
  '    }',
  '',
  '    // Le canari : mort de facon evidente dans tous les cas, jamais demande',
  '    // par aucune fixture. Toute garde exige qu il soit rapporte.',
  '    @Provides',
  '    fun provideCanary(): Canary {',
  '        return Canary()',
  '    }',
  '}',
  '',
].join('\n'));

/** Un consommateur qui demande l Evictor et rien d autre. */
const CONSOMMATEUR = f(`${MAIN}/Player.kt`, [
  'package com.x',
  '',
  'import javax.inject.Inject',
  '',
  'class Player @Inject constructor(private val evictor: Evictor)',
  '',
].join('\n'));

/** Le meme module, sans l annotation : le temoin de bonne formation. */
const MODULE_SANS_ANNOTATION = f(`${MAIN}/Plain.kt`, [
  'package com.x',
  '',
  'class Plain {',
  '',
  '    fun provideEvictor(context: Context): Evictor {',
  '        return Evictor(context)',
  '    }',
  '',
  '    fun provideDatabaseProvider(context: Context): DatabaseProvider {',
  '        return ExoDatabaseProvider(context)',
  '    }',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('G1 — le corpus de test est lisible', () => {
  /**
   * Sans ce temoin, un `it.fails()` plus bas pourrait echouer pour une raison
   * parasite (fixture mal formee, parseur qui ne voit pas la methode) et on
   * croirait avoir decrit le trou alors qu on decrit un bug de test.
   */
  it('rapporte une methode publique que personne n appelle, sans annotation', () => {
    const trouves = membres(MODULE_SANS_ANNOTATION, CONSOMMATEUR);
    expect(nomme(trouves, 'provideDatabaseProvider')).toBe(true);
  });

  /**
   * POURQUOI LIRE LES SOURCES NE SUFFIT PAS, chiffre sur le corpus.
   *
   * Le critere naif « le type fourni est ecrit quelque part ailleurs » a ete
   * mesure contre le graphe Dagger sur les 393 fournitures :
   *
   *   faux positifs sur les 328 vivantes  :  0
   *   mortes qu il declarerait vivantes   : 46 sur 48, soit 96 %
   *
   * Il est donc prudent et inutile : il ne coupe rien de vivant et rate
   * presque tout. La raison tient dans la fixture ci dessous : le type d une
   * fourniture morte est presque toujours mentionne ailleurs, par la classe
   * qui l implemente, par une variable locale, par un import. Ce qui compte
   * n est pas que le type soit ECRIT, c est qu il soit DEMANDE.
   *
   * Ce test fixe le contre exemple. Il passe aujourd hui pour la mauvaise
   * raison (rien n est juge sur un `@Module`) ; il devra passer demain pour
   * la bonne.
   */
  it.fails('une mention du type ailleurs ne prouve pas qu il est demande', () => {
    const module = f(`${MAIN}/ExoModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class ExoModule {',
      '',
      '    @Provides',
      '    fun provideDatabaseProvider(context: Context): DatabaseProvider {',
      '        return ExoDatabaseProvider(context)',
      '    }',
      '}',
      '',
    ].join('\n'));
    // Le type est ecrit trois fois de plus, et pourtant personne ne le
    // DEMANDE : aucun constructeur @Inject, aucun champ, aucune enveloppe.
    const ailleurs = f(`${MAIN}/ExoDatabaseProvider.kt`, [
      'package com.x',
      '',
      'class ExoDatabaseProvider(context: Context) : DatabaseProvider {',
      '    fun copy(): DatabaseProvider = this',
      '}',
      '',
    ].join('\n'));
    // L assertion disait `not.toContain`, ce qui contredit le titre et le
    // commentaire : si la mention ne prouve pas la demande, la fourniture est
    // morte et doit SORTIR. Corrigee en `toContain`, elle redevient un
    // `it.fails()` tant que G1 n est pas fait, et elle dit alors la verite au
    // lieu de passer pour la mauvaise raison.
    const trouves = membres(module, ailleurs);
    expect(trouves.map(m => m.name)).toContain('provideDatabaseProvider');
  });

  /**
   * SENTINELLE. Elle fixe l etat d aujourd hui : sur un `@Module`, le
   * detecteur ne rend RIEN, ni vrai ni faux. C est la raison pour laquelle
   * les gardes du dernier bloc exigent un canari : sans lui elles passeraient
   * toutes par vacuite.
   *
   * Le jour ou G1 sera implemente, ce test echouera, et les gardes
   * deviendront vertes en meme temps. Les deux mouvements vont ensemble : si
   * la sentinelle tombe sans que les gardes passent, l implementation juge
   * mais se trompe.
   */
  it('aujourd hui, une methode annotee @Provides n est jamais jugee', () => {
    expect(membres(MODULE_AVEC_UNE_MORTE, CONSOMMATEUR)).toHaveLength(0);
    expect(membres(MODULE_AVEC_UNE_MORTE)).toHaveLength(0);
  });
});

describe.skipIf(!mod)('G1 — la fourniture que rien ne demande', () => {
  it.fails('rapporte une @Provides dont le type de retour n est demande nulle part', () => {
    const trouves = membres(MODULE_AVEC_UNE_MORTE, CONSOMMATEUR);
    expect(nomme(trouves, 'provideDatabaseProvider')).toBe(true);
  });

  it.fails('rapporte une @Binds dont le type lie n est demande nulle part', () => {
    const binds = f(`${MAIN}/BindsModule.kt`, [
      'package com.x',
      '',
      'import dagger.Binds',
      'import dagger.Module',
      '',
      '@Module',
      'abstract class BindsModule {',
      '',
      '    @Binds',
      '    abstract fun bindOpenStory(impl: OpenStoryFromURIImpl): OpenStoryFromURI',
      '}',
      '',
    ].join('\n'));
    const impl = f(`${MAIN}/OpenStoryFromURIImpl.kt`, [
      'package com.x',
      '',
      'class OpenStoryFromURIImpl : OpenStoryFromURI',
      '',
    ].join('\n'));
    expect(nomme(membres(binds, impl), 'bindOpenStory')).toBe(true);
  });

  it.fails('rapporte la forme Java, `Type provideX(...)` dans un @Module', () => {
    const java = f(`${MAIN}/AppMainActivityModule.java`, [
      'package com.x;',
      '',
      'import dagger.Module;',
      'import dagger.Provides;',
      '',
      '@Module',
      'public class AppMainActivityModule {',
      '',
      '\t@Provides',
      '\tShellMainLayout provideShellMainLayout(AppMainLayout appMainLayout) {',
      '\t\treturn appMainLayout;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const layout = f(`${MAIN}/AppMainLayout.java`, [
      'package com.x;',
      '',
      'public class AppMainLayout extends FrameLayout implements ShellMainLayout {',
      '}',
      '',
    ].join('\n'));
    expect(nomme(membres(java, layout), 'provideShellMainLayout')).toBe(true);
  });

  /**
   * LA FORME « NULL OBJECT », mesuree en classant les 64 cas du corpus.
   *
 * ecrit:
   *
   *     @Provides
   *     fun provideEmptyContentCardRepository() = object : ContentCardRepository { … }
   *
   * Le type de retour est IMPLICITE et la valeur est un objet anonyme de
   * plusieurs dizaines de lignes. Deux consequences : le detecteur doit lire
   * le type depuis l expression et non depuis une annotation de retour, et la
   * coupe emporte tout le corps de l objet anonyme, pas seulement la
   * signature. `CoreUiModule` en aligne seize de cette forme.
   */
  it.fails('rapporte une fourniture dont le type de retour est implicite', () => {
    const nullObject = f(`${MAIN}/CoreUiModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class CoreUiModule {',
      '',
      '    @Provides',
      '    fun provideEmptyContentCardRepository() = object : ContentCardRepository {',
      '        override fun fetch(location: String): String? = null',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(nomme(membres(nullObject), 'provideEmptyContentCardRepository')).toBe(true);
  });

  /**
   * LES HOMONYMES, et c est le cas le plus tranchant du corpus.
   *
   * Trois fournitures IDENTIQUES, meme nom, meme signature, meme corps, dans
   * trois modules differents :
   *
 * MORTE
 * VIVANTE
 * MORTE
   *
   *     fun providesFeedRefreshListener(messageController: MessageController):
   *         FeedRefreshListener = messageController
   *
   * Un detecteur qui raisonnerait par NOM DE METHODE se tromperait dans les
   * deux sens : soit il les declare toutes vivantes a cause de `NewsModule`,
   * soit il les coupe toutes les trois. Le verdict se prend par (module,
   * methode), jamais par methode seule.
   */
  it.fails('juge separement deux fournitures homonymes de modules differents', () => {
    const mort = f(`${MAIN}/ShowcaseModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class ShowcaseModule {',
      '',
      '    @Provides',
      '    fun providesFeedRefreshListener(c: MessageController): FeedRefreshListener = c',
      '}',
      '',
    ].join('\n'));
    const vivant = f(`${MAIN}/NewsModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class NewsModule {',
      '',
      '    @Provides',
      '    fun providesFeedRefreshListener(c: MessageController): FeedRefreshListener = c',
      '}',
      '',
    ].join('\n'));
    const lecteur = f(`${MAIN}/NewsFeed.kt`, [
      'package com.x',
      '',
      'import javax.inject.Inject',
      '',
      'class NewsFeed @Inject constructor(private val l: FeedRefreshListener)',
      '',
    ].join('\n'));
    const trouves = membres(mort, vivant, lecteur);
    // Les deux portent le meme nom : c est le CONTENEUR qui les separe.
    expect(trouves.filter(m => m.container === 'ShowcaseModule')).toHaveLength(1);
    expect(trouves.filter(m => m.container === 'NewsModule')).toHaveLength(0);
  });

  /**
   * LE MODULE A ETAT, dont la coupe est une cascade.
   *
 * tient une
   * `Activity` en champ, la recoit par constructeur, et sa SEULE fourniture
   * la rend :
   *
   *     private final Activity activity;
   *     public AppActivityModule(Activity activity) { this.activity = activity; }
   *     @ScopeActivity @Provides public Activity provideActivity() { return activity; }
   *
   * Couper `provideActivity()` rend le champ orphelin, puis le constructeur,
   * puis le module entier. La trouvaille n est donc pas la methode seule : le
   * detecteur doit au moins la rapporter pour que les rondes suivantes
 * puissent tirer le fil. `MainActivityV2Module` a la meme forme.
   */
  it.fails('rapporte la fourniture unique d un module a etat', () => {
    const aEtat = f(`${MAIN}/AppActivityModule.java`, [
      'package com.x;',
      '',
      'import dagger.Module;',
      'import dagger.Provides;',
      '',
      '@Module',
      'public class AppActivityModule {',
      '',
      '\tprivate final Activity activity;',
      '',
      '\tpublic AppActivityModule(Activity activity) {',
      '\t\tthis.activity = activity;',
      '\t}',
      '',
      '\t@Provides',
      '\tpublic Activity provideActivity() {',
      '\t\treturn activity;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(nomme(membres(aEtat), 'provideActivity')).toBe(true);
  });

  /**
   * LA SIGNATURE SUR PLUSIEURS LIGNES.
   *
   * Trouvee en classant les 270 fournitures vivantes : 62 d entre elles
   * n avaient pas de type de retour lisible, et la moitie tient a cette
 * forme la. et
 * ecrivent tous:
   *
   *     @Provides
   *     fun providesGameDelegate(
   *         a: A,
   *         b: B,
   *     ): GameDelegate = GameDelegateImpl(a, b)
   *
   * Toutes les autres fixtures de ce fichier tiennent sur une ligne. Un
   * detecteur eprouve uniquement sur elles passerait a cote de ce module,
   * qui en aligne quatre.
   */
  it.fails('rapporte une fourniture dont la signature tient sur plusieurs lignes', () => {
    const multi = f(`${MAIN}/DelegateModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class DelegateModule {',
      '',
      '    @Provides',
      '    fun providesGameDelegate(',
      '        controller: GameController,',
      '        bus: EventBus,',
      '    ): GameDelegate = GameDelegateImpl(controller, bus)',
      '}',
      '',
    ].join('\n'));
    expect(nomme(membres(multi), 'providesGameDelegate')).toBe(true);
  });

  it.fails('rapporte TOUTES les fournitures quand le module entier est mort', () => {
    // `ExoModule` sur le projet de reference : 11 sur 11.
    const seul = membres(MODULE_AVEC_UNE_MORTE);
    expect(seul.filter(m => m.name.startsWith('provide'))).toHaveLength(3);
  });
});

describe.skipIf(!mod)('G1 — les gardes, en echec tant que G1 n est pas fait', () => {
  /**
   * Chacune de ces formes DEMANDE le type. Une sonde naive qui ne lisait que
   * les deux premieres a rendu 34 faux positifs sur le projet de reference,
   * dont `CompositeDisposable` (92 mentions) et `FeedToolbarViewModel` (65).
   *
   * Chacune passe par `epargne`, qui exige le canari. Elles sont donc
   * ROUGES aujourd hui, et c est le verdict honnete : rien n est protege
   * tant que rien n est juge. Elles verdiront avec l implementation, et
   * diront alors si elle coupe du code vivant.
   */

  it('ne touche pas une fourniture demandee par un constructeur @Inject', () => {
    epargne(membres(MODULE_AVEC_UNE_MORTE, CONSOMMATEUR), 'provideEvictor');
  });

  it('ne touche pas une fourniture demandee par un champ @Inject', () => {
    const champ = f(`${MAIN}/Screen.kt`, [
      'package com.x',
      '',
      'import javax.inject.Inject',
      '',
      'class Screen {',
      '    @Inject',
      '    lateinit var db: DatabaseProvider',
      '}',
      '',
    ].join('\n'));
    epargne(membres(MODULE_AVEC_UNE_MORTE, champ), 'provideDatabaseProvider');
  });

  it('ne touche pas une fourniture demandee sous Provider<T>', () => {
    const enveloppe = f(`${MAIN}/Lazy.kt`, [
      'package com.x',
      '',
      'import javax.inject.Inject',
      'import javax.inject.Provider',
      '',
      'class Holder @Inject constructor(private val db: Provider<DatabaseProvider>)',
      '',
    ].join('\n'));
    epargne(membres(MODULE_AVEC_UNE_MORTE, enveloppe), 'provideDatabaseProvider');
  });

  it('ne touche pas une fourniture demandee sous Lazy<T>', () => {
    const enveloppe = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'import dagger.Lazy',
      'import javax.inject.Inject',
      '',
      'class Holder @Inject constructor(private val db: Lazy<DatabaseProvider>)',
      '',
    ].join('\n'));
    epargne(membres(MODULE_AVEC_UNE_MORTE, enveloppe), 'provideDatabaseProvider');
  });

  it('ne touche pas une fourniture demandee par une autre fourniture', () => {
    const chaine = f(`${MAIN}/Cache.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class CacheModule {',
      '',
      '    @Provides',
      '    fun provideCache(db: DatabaseProvider): SimpleCache {',
      '        return SimpleCache(db)',
      '    }',
      '}',
      '',
    ].join('\n'));
    epargne(membres(MODULE_AVEC_UNE_MORTE, chaine), 'provideDatabaseProvider');
  });

  it('ne touche pas une fourniture exposee par une interface @Component', () => {
    const composant = f(`${MAIN}/AppComponent.kt`, [
      'package com.x',
      '',
      'import dagger.Component',
      '',
      '@Component',
      'interface AppComponent {',
      '    fun databaseProvider(): DatabaseProvider',
      '}',
      '',
    ].join('\n'));
    epargne(membres(MODULE_AVEC_UNE_MORTE, composant), 'provideDatabaseProvider');
  });

  it('ne touche pas un multibinding, que le graphe collecte sans le nommer', () => {
    // `CleanableJob` sur le projet de reference : trois modules en fournissent
    // un chacun, et rien n ecrit le type ailleurs que dans un Set injecte.
    const multi = f(`${MAIN}/JobModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      'import dagger.multibindings.IntoSet',
      '',
      '@Module',
      'class JobModule {',
      '',
      '    @Provides',
      '    @IntoSet',
      '    fun provideBookmarkJob(): CleanableJob {',
      '        return BookmarkJob()',
      '    }',
      '',
      '    @Provides',
      '    fun provideCanary(): Canary {',
      '        return Canary()',
      '    }',
      '}',
      '',
    ].join('\n'));
    const lecteur = f(`${MAIN}/Runner.kt`, [
      'package com.x',
      '',
      'import javax.inject.Inject',
      '',
      'class Runner @Inject constructor(private val jobs: Set<CleanableJob>)',
      '',
    ].join('\n'));
    epargne(membres(multi, lecteur), 'provideBookmarkJob');
  });

  /**
   * Celle ci mord DES AUJOURD HUI, parce qu elle s appuie sur le module sans
   * annotation, que le detecteur juge deja. Sans cette precaution, « rend un
   * tableau vide » serait vrai pour la mauvaise raison, comme les autres.
   */
  /**
   * LES ARGUMENTS DE TYPE FONT PARTIE DE LA CLE DAGGER.
   *
 * aligne quatre fournitures
   * qui ne different que par leur parametre generique :
   *
   *   :746 provideDynamicAdDao(p: DatabasesProvider<DynamicAdDatabase>)   MORTE
   *   :752 provideAdRepository(p: DatabasesProvider<DynamicAdDatabase>)   vivante
   *   :758 provideAdDao(p: DatabasesProvider<ClientAdDatabase>)           MORTE
   *   :764 provideClientAdRepository(p: DatabasesProvider<ClientAdDatabase>) vivante
   *
   * `DatabasesProvider<A>` et `DatabasesProvider<B>` sont DEUX liaisons
   * distinctes. Un detecteur qui effacerait les arguments de type verrait un
   * seul `DatabasesProvider`, conclurait qu il est demande, et raterait les
   * deux mortes ; ou pire, il tiendrait les quatre pour equivalentes.
   */
  it('ne confond pas deux liaisons du meme type brut parametre differemment', () => {
    const genres = f(`${MAIN}/AppApplicationModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class AppApplicationModule {',
      '',
      '    @Provides',
      '    fun provideDynamicAdDao(p: DatabasesProvider<DynamicAdDatabase>): DynamicAdDao {',
      '        return p.getDatabase().adDao()',
      '    }',
      '',
      '    @Provides',
      '    fun provideAdDao(p: DatabasesProvider<ClientAdDatabase>): AdDao {',
      '        return p.getDatabase().adDao()',
      '    }',
      '',
      '    @Provides',
      '    fun provideCanary(): Canary {',
      '        return Canary()',
      '    }',
      '}',
      '',
    ].join('\n'));
    const lecteur = f(`${MAIN}/Repo.kt`, [
      'package com.x',
      '',
      'import javax.inject.Inject',
      '',
      'class Repo @Inject constructor(private val dao: DynamicAdDao)',
      '',
    ].join('\n'));
    // Seul `DynamicAdDao` est demande : `AdDao` ne l est pas, bien que les
    // deux fournitures se ressemblent a une lettre pres.
    const trouves = membres(genres, lecteur);
    expect(trouves.map(m => m.name)).toContain('provideCanary');
    expect(trouves.map(m => m.name)).not.toContain('provideDynamicAdDao');
  });

  /**
   * LA LIMITE ASSUMEE : le type implicite venu d un APPEL.
   *
 * ecrit:
   *
   *     @Provides
   *     fun provideFirebaseAuth() = FirebaseAuth.getInstance()
   *
   * Le type fourni est le type de retour de `getInstance()`, qui vit dans une
   * bibliotheque. Sans resolution de type, le detecteur ne peut pas savoir ce
   * qui est fourni, donc il ne peut pas savoir si quelqu un le demande. Il
   * doit se TAIRE : c est un faux negatif assume, pas un oubli.
   *
   * A distinguer du cas `= object : Interface { … }`, ou le type est ecrit
   * juste apres le `:` et se lit sans rien resoudre. Celui la est un cas
   * positif, plus haut dans ce fichier.
   */
  it('se tait sur une fourniture dont le type vient d un appel non resolu', () => {
    const implicite = f(`${MAIN}/LoginBindingModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      'import dagger.Provides',
      '',
      '@Module',
      'class LoginBindingModule {',
      '',
      '    @Provides',
      '    fun provideFirebaseAuth() = FirebaseAuth.getInstance()',
      '',
      '    @Provides',
      '    fun provideCanary(): Canary {',
      '        return Canary()',
      '    }',
      '}',
      '',
    ].join('\n'));
    const trouves = membres(implicite);
    expect(trouves.map(m => m.name)).toContain('provideCanary');
    expect(trouves.map(m => m.name)).not.toContain('provideFirebaseAuth');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [MODULE_SANS_ANNOTATION], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedMembers(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedMembers({ ...entier, truncated: true })).toHaveLength(0);
  });
});
