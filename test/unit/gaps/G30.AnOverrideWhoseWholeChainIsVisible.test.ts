import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G30 — une surcharge dont toute la chaine est sous les yeux.
 *
 * M2, `@Override`, est le plus gros filtre du projet : **4965 membres**, plus
 * du quart de tous ceux examines. Son argument est juste dans le cas general :
 * un supertype peut appeler la methode, et si ce supertype vit hors du corpus,
 * personne ne peut le savoir.
 *
 * Mais quand toute la chaine est DANS le corpus, il n y a plus rien a deviner.
 *
 * ## Mesure
 *
 *   4965  M2:override
 *   1498  dont tous les supertypes du conteneur sont declares par le corpus
 *   1666  dont au moins un supertype vit dehors
 *   1801  dont la clause n a pas pu etre lue par la sonde
 *
 * Sur les 1498, 650 noms distincts. En comptant les occurrences de chaque nom
 * dans les sources de production, 38 n en ont pas plus que de declarations,
 * c est a dire **aucun appel**. Affinage :
 *
 *    9  fournitures Dagger (`provide*`), appelees par le code genere
 *    7  appelees seulement par un test, donc `testCoRemoval` et non mortes
 *   22  jamais appelees
 *
 * ## Trois paires verifiees a la main
 *
 * getCurrentMemoryUsage
 * la surcharge
 *       aucun appel dans tout le depot
 *
 * evictFromCaches
 * la surcharge
 *       aucun appel dans tout le depot
 *
 * computeSeekPositionFromPercentage
 * la surcharge
 *       aucun appel dans tout le depot
 *
 * Ce sont des paires : la methode d interface et sa surcharge meurent
 * ensemble. C est G7 au niveau du MEMBRE, et avec un chiffre.
 *
 * ## La garde que la mesure a reclamee elle meme
 *
 * La sonde ne regardait que le supertype DIRECT. `EllipsizingTextView`
 * etend `FontTextView`,
 * qui est dans le corpus, mais `FontTextView` etend `TextView`, qui ne l est
 * pas. Ses surcharges `getMaxLines` et `setEllipsize` sont appelees par le
 * cadre pendant la mise en page, et la sonde les annoncait mortes.
 *
 * La regle doit donc remonter TOUTE la chaine jusqu a la frontiere du corpus,
 * comme `frameworkAncestor` le fait deja pour F7. Deux des vingt deux
 * trouvailles tombent avec cette garde ; les autres tiennent.
 *
 * ## Ce que ces tests demandent
 *
 * Qu une surcharge soit jugee quand aucun de ses ancetres, direct ou non, ne
 * sort du corpus. Le gain est reel cette fois, une vingtaine de paires, et il
 * se double du plus gros filtre du projet rendu conditionnel.
 */

const memb: any = await importOrNull('src/providers/unusedMembers');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any);

const membre = (nom: string, ...sources: { path: string; text: string }[]) =>
  (memb.explainMembers(base(sources)) as any[]).find((m: any) => m.name === nom);

const morts = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers(base(sources)) as any[]).map((m: any) => m.name);

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/**
 * pour la declaration,
 * :38 pour la surcharge. Une methode appelee, une qui ne l est pas, dans la
 * meme interface : c est ce qui rend le cas lisible.
 */
const INTERFACE = f('MediaPositionDelegate.kt', [
  'package com.x',
  '',
  'interface MediaPositionDelegate {',
  '',
  '    fun computeSeek(p: Float): Float',
  '',
  '    fun used(): Int',
  '}',
  '',
].join('\n'));

const IMPLEMENTATION = f('MediaPositionDelegateImpl.kt', [
  'package com.x',
  '',
  'class MediaPositionDelegateImpl : MediaPositionDelegate {',
  '',
  '    override fun computeSeek(p: Float) = p',
  '',
  '    override fun used() = 1',
  '}',
  '',
].join('\n'));

const APPELANT = f('Main.kt', [
  'package com.x',
  '',
  'fun main() {',
  '    val d: MediaPositionDelegate = MediaPositionDelegateImpl()',
  '    d.used()',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!memb)('le detecteur juge bien les membres de ce corpus', () => {
  it('une methode ordinaire que personne n appelle est rapportee', () => {
    const classe = f('Service.kt', [
      'package com.x',
      '',
      'class Service {',
      '',
      '    fun used() = 1',
      '',
      '    fun neverCalled() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');
    expect(morts(classe, appel)).toContain('neverCalled');
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!memb)('M2 ne s applique plus quand la chaine est visible', () => {
  /**
   * M2 etait inconditionnel. Il ne l est plus : la chaine de
   * `MediaPositionDelegateImpl` s arrete a `MediaPositionDelegate`, qui est
   * declaree ici, donc il n y a plus rien a deviner.
   *
   * Ce qui retient la surcharge, c est desormais une garde qui dit une autre
   * chose : le contrat parent est toujours la, et couper la surcharge seule ne
   * compilerait plus. Mesure sur le vrai projet : retirer
   * `FileServiceImpl.createTempFile` en laissant
   * `FileService.createTempFile(): File?` fait echouer
   * `:common:compileDebugKotlin`.
   */
  it('la surcharge que personne n appelle n est plus retenue par M2', () => {
    expect(membre('computeSeek', INTERFACE, IMPLEMENTATION, APPELANT))
      .toMatchObject({ outcome: 'M11:bound-by-contract' });
  });

  /**
   * Et celle qui EST appelee est maintenant jugee comme n importe quel membre.
   * Avant, le filtre ne distinguait pas les deux : il ne protegeait pas, il
   * aveuglait.
   */
  it('celle que quelqu un appelle est jugee vivante, pas ecartee', () => {
    expect(membre('used', INTERFACE, IMPLEMENTATION, APPELANT))
      .toMatchObject({ outcome: 'M11:bound-by-contract' });
  });

  /**
   * Toujours rien de rapporte sur ce corpus, mais plus pour la meme raison :
   * ce n est plus « c est une surcharge », c est « son contrat reste ».
   */
  it('rien n est rapporte sur ce corpus, et la raison a change', () => {
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT)).toEqual([]);
  });

  /**
   * La preuve que la relache mord : un parent CONCRET n engage rien. Retirer
   * la surcharge laisse la version du parent prendre le relais, et ca compile.
   */
  it('une surcharge d un parent concret, elle, est rapportee', () => {
    const parent = f('Base.kt', [
      'package com.x',
      '',
      'open class Base {',
      '',
      '    open fun concrete() = 1',
      '',
      '    open fun used() = 2',
      '}',
      '',
    ].join('\n'));
    const enfant = f('Sub.kt', [
      'package com.x',
      '',
      'class Sub : Base() {',
      '',
      '    override fun concrete() = 3',
      '',
      '    override fun used() = 4',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    val b: Base = Sub()\n    b.used()\n}\n');
    expect(morts(parent, enfant, appel)).toContain('concrete');
    expect(morts(parent, enfant, appel)).not.toContain('used');
  });

  /**
   * Et la declaration du parent cesse de servir de preuve. C est la regle de
   * G40 appliquee a la verticale : sans cet escompte, toute surcharge d un
   * contrat visible se prouvait vivante par sa PROPRE declaration parente.
   */
  it('la declaration parente ne compte plus comme un appel', () => {
    const parent = f('Base.kt', 'package com.x\n\nopen class Base {\n\n    open fun seul() = 1\n}\n');
    const enfant = f('Sub.kt', 'package com.x\n\nclass Sub : Base() {\n\n    override fun seul() = 2\n}\n');
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Sub()\n}\n');
    expect(membre('seul', parent, enfant, appel)).toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * La methode d INTERFACE n apparait meme pas dans le rapport : les membres
   * d une interface ne sont pas des candidats. La paire est donc invisible des
   * deux cotes, ce qui explique qu aucune famille ne la voie.
   */
  it('et la methode d interface n est meme pas examinee', () => {
    const vus = (memb.explainMembers(base([INTERFACE, IMPLEMENTATION, APPELANT])) as any[])
      .map((m: any) => `${m.container}.${m.name}`);
    expect(vus).not.toContain('MediaPositionDelegate.computeSeek');
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!memb)('une chaine entierement visible devrait etre jugee', () => {
  it.fails('la surcharge que personne n appelle devrait etre rapportee', () => {
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT)).toContain('computeSeek');
  });

  it.fails('et celle qui est appelee devrait sortir vivante', () => {
    expect(membre('used', INTERFACE, IMPLEMENTATION, APPELANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
 * Motif reel:,
 * surcharge de.
   * Aucun appel dans tout le depot.
   */
  it.fails('la meme chose cote Java, ou @Override est explicite', () => {
    const iface = f('SystemInfoService.java', [
      'package com.x;',
      '',
      'public interface SystemInfoService {',
      '',
      '\tlong getCurrentMemoryUsage();',
      '}',
      '',
    ].join('\n'));
    const impl = f('SystemInfoServiceImpl.java', [
      'package com.x;',
      '',
      'public class SystemInfoServiceImpl implements SystemInfoService {',
      '',
      '\t@Override',
      '\tpublic long getCurrentMemoryUsage() {',
      '\t\treturn 0;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    SystemInfoServiceImpl()\n}\n');
    expect(morts(iface, impl, appel)).toContain('getCurrentMemoryUsage');
  });

  /**
   * Et le cas de deux implementations : si aucune des deux n est appelee, les
   * deux surcharges meurent. Motif reel : `setResetSmallAnimScale`, trois
   * surcharges et quatre occurrences, donc aucun appel
   */
  it.fails('deux implementations non appelees meurent ensemble', () => {
    const seconde = f('AutreImpl.kt', [
      'package com.x',
      '',
      'class AutreImpl : MediaPositionDelegate {',
      '',
      '    override fun computeSeek(p: Float) = p * 2',
      '',
      '    override fun used() = 2',
      '}',
      '',
    ].join('\n'));
    const noms = morts(INTERFACE, IMPLEMENTATION, seconde, APPELANT);
    expect(noms.filter((n: string) => n === 'computeSeek')).toHaveLength(2);
  });
});

// ── Gardes : ce que la relache ne doit pas emporter ────────────────────────

describe.skipIf(!memb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => {
    const classe = f('Service.kt', 'package com.x\n\nclass Service {\n\n    fun used() = 1\n\n    fun neverCalled() = 2\n}\n');
    const appel = f('Autre.kt', 'package com.x\n\nfun autre() = Service().used()\n');
    expect(morts(classe, appel)).toContain('neverCalled');
  };

  /**
   * La garde que la mesure a reclamee elle meme. `EllipsizingTextView`
 * etend `FontTextView`,
   * qui est dans le corpus, mais qui etend `TextView`, qui n y est pas. Ses
   * surcharges sont appelees par le cadre pendant la mise en page. La regle
   * doit remonter TOUTE la chaine, pas seulement le supertype direct.
   */
  it('une chaine qui atteint un type de cadre au deuxieme etage', () => {
    temoin();
    const intermediaire = f('FontTextView.kt', [
      'package com.x',
      '',
      'open class FontTextView : TextView {',
      '',
      '    open fun getMaxLines() = 1',
      '}',
      '',
    ].join('\n'));
    const feuille = f('EllipsizingTextView.kt', [
      'package com.x',
      '',
      'class EllipsizingTextView : FontTextView {',
      '',
      '    override fun getMaxLines() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    EllipsizingTextView()\n}\n');
    expect(morts(intermediaire, feuille, appel)).not.toContain('getMaxLines');
  });

  it('un supertype direct hors corpus', () => {
    temoin();
    const impl = f('Listener.kt', [
      'package com.x',
      '',
      'class Listener : OnPageChangeListener {',
      '',
      '    override fun onPageSelected(i: Int) = Unit',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Listener()\n}\n');
    expect(morts(impl, appel)).not.toContain('onPageSelected');
  });

  /**
   * Une fourniture Dagger qui surcharge celle d un module parent : le code
   * genere l appelle, et le corpus ne le contient pas. Neuf des trente huit
   * candidats de la mesure sont de cette forme.
   */
  it('une fourniture Dagger qui en surcharge une autre', () => {
    temoin();
    const parent = f('BaseModule.kt', [
      'package com.x',
      '',
      '@Module',
      'open class BaseModule {',
      '',
      '    @Provides',
      '    open fun provideEditionService() = 1',
      '}',
      '',
    ].join('\n'));
    const enfant = f('OverrideModule.kt', [
      'package com.x',
      '',
      '@Module',
      'class OverrideModule : BaseModule() {',
      '',
      '    @Provides',
      '    override fun provideEditionService() = 2',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    OverrideModule()\n}\n');
    expect(morts(parent, enfant, appel)).not.toContain('provideEditionService');
  });

  /**
   * Une surcharge que seul un test appelle n est pas morte : elle releve de
   * `testCoRemoval`, qui la retire AVEC son test. Sept des trente huit.
   * Motif reel : `DateFormatterImpl.formatMonth`
 *, appelee par
   */
  it('une surcharge que seul un test appelle', () => {
    const test = {
      path: '/w/app/src/test/java/com/x/DelegateTest.kt',
      text: 'package com.x\n\nclass DelegateTest {\n\n    fun t() = MediaPositionDelegateImpl().computeSeek(1f)\n}\n',
    };
    const vus = (memb.explainMembers(base([INTERFACE, IMPLEMENTATION, APPELANT, test])) as any[])
      .find((m: any) => m.name === 'computeSeek');
    expect(vus).toBeDefined();
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT, test)).not.toContain('computeSeek');
  });

  /**
   * LA garde que la mesure a reclamee, et la plus chere.
   *
   * `HostFirebaseMessagingService` etend le `FirebaseMessagingService` de
 * Firebase,
   * et le corpus declare SA PROPRE `interface FirebaseMessagingService`
 *. Resolue par nom
   * NU, la chaine paraissait visible : `onNewToken` et `onRegistered` cessaient
   * d etre gardees, et cinq ilots morts apparaissaient sur des rappels que
   * Firebase appelle. Les notifications push seraient parties avec.
   *
   * La resolution passe donc par l IMPORT du fichier.
   */
  it('un supertype homonyme d un type de bibliotheque', () => {
    temoin();
    const maison = f('service/FirebaseMessagingService.kt', [
      'package com.x.service',
      '',
      'interface FirebaseMessagingService {',
      '',
      '    fun refresh()',
      '}',
      '',
    ].join('\n'));
    const service = f('Service.kt', [
      'package com.x',
      '',
      'import com.google.firebase.messaging.FirebaseMessagingService',
      '',
      'class HostFirebaseMessagingService : FirebaseMessagingService() {',
      '',
      '    override fun onNewToken(token: String) = Unit',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    HostFirebaseMessagingService()\n}\n');
    expect(membre('onNewToken', maison, service, appel))
      .toMatchObject({ outcome: 'M2:override' });
    expect(morts(maison, service, appel)).not.toContain('onNewToken');
  });

  /**
   * Et l homonyme au niveau du MEMBRE. `PageExternalAnalyticsIdModelHelper`
   * et `PageAnalyticsIdModelHelper` surchargent toutes deux `restoreIdModel`
   * d un parent commun. La recolte compte par nom : la declaration de l une
   * prouvait la vie de l autre, et l ilot mort de la premiere disparaissait.
   *
   * Tant qu une declaration du meme nom n est ni la sienne ni celle d un
   * ancetre, aucune mention ne s attribue, et M2 reste la seule reponse.
   */
  it('une surcharge dont une soeur porte le meme nom', () => {
    temoin();
    const parent = f('Abstrait.kt', [
      'package com.x',
      '',
      'open class Abstrait {',
      '',
      '    open fun restoreIdModel() = Unit',
      '}',
      '',
    ].join('\n'));
    const une = f('Une.kt', [
      'package com.x',
      '',
      'class Une : Abstrait() {',
      '',
      '    override fun restoreIdModel() = Unit',
      '}',
      '',
    ].join('\n'));
    const soeur = f('Soeur.kt', [
      'package com.x',
      '',
      'class Soeur : Abstrait() {',
      '',
      '    override fun restoreIdModel() = Unit',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Une()\n    Soeur()\n}\n');
    const vus = (memb.explainMembers(base([parent, une, soeur, appel])) as any[])
      .filter((m: any) => m.name === 'restoreIdModel' && m.container !== 'Abstrait');
    expect(vus).toHaveLength(2);
    for (const v of vus) expect(v).toMatchObject({ outcome: 'M2:override' });
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const classe = f('Service.kt', 'package com.x\n\nclass Service {\n\n    fun used() = 1\n\n    fun neverCalled() = 2\n}\n');
    const appel = f('Autre.kt', 'package com.x\n\nfun autre() = Service().used()\n');
    const entier = base([classe, appel]);
    expect((memb.findUnusedMembers(entier) as any[]).length).toBeGreaterThan(0);
    expect(memb.findUnusedMembers({ ...entier, truncated: true })).toHaveLength(0);
  });
});
