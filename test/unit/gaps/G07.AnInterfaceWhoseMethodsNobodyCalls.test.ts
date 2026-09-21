import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G7 — une interface implementee dont aucune methode n est jamais appelee.
 *
 * Voir doc/gaps-detection.md. KJ-072 cherche des surcharges VIDES ; celle ci
 * cherche des surcharges qui ont un vrai corps mais que personne n atteint.
 * Sur le projet de reference, 726 interfaces declarees, 690 apres retrait de
 * celles qu un framework fabrique, et 6 implementees sans jamais etre ecrites
 * comme type ailleurs qu en clause ou en import :
 *
 * (2 implementations)
 *
 * Classement fait depuis : DEUX de ces six ne relevent pas de la famille.
 * `PageIndicatorInterface` et `MarginPageIndicator` prolongent une interface
 * de la plateforme (`ViewPager.OnPageChangeListener`), donc leurs methodes
 * sont appelees par le framework ; une garde dediee est plus bas.
 * `ScrollViewEventHelper` a sa methode appelee uniquement par ses tests :
 * c est `testCoRemoval`, pas G7. `FontedTextView` est un cas 7b, `setFont`
 * etant appelee en production (`AdSpotView`).
 *
 * ## Deux sous familles, et la difference porte sur la COUPE
 *
 * 7a, l interface et sa methode meurent ensemble.
 * `AnalyticsTimerPanelListener` declare `void panelEnabledUpdated(boolean)`.
 * Le nom de l interface n apparait que deux fois dans le corpus, sa
 * declaration et la clause de `AnalyticsTimerPanelView`. Le nom de la
 * methode deux fois aussi, sa declaration et son implementation ligne 188.
 * Aucun appel. Partent : l interface, la clause, et le corps de la surcharge.
 *
 * 7b, l abstraction meurt, l implementation vit.
 * `CountdownAnalyticsTimer` declare `boolean isComplete`. L interface
 * n est nommee que par sa declaration et la clause de
 * `CountdownAnalyticsTimerImpl`. Mais `isComplete` EST appelee, deux
 * fois, depuis l implementation elle meme (lignes 56 et 69, sur `this`).
 * Partent : l interface et sa clause seulement. La methode reste et devient
 * une methode ordinaire de la classe.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Mesure faite avant d ecrire ces tests :
 *
 *   7a, l interface et sa surcharge     -> membres: (rien)  symboles: la CLASSE seulement
 *   7b, la surcharge appelee sur this   -> membres: (rien)  symboles: la CLASSE seulement
 *   une methode SANS @Override, morte   -> membres: Plain.neverCalled
 *
 * Deux choses a la fois, donc. Cote symboles, la clause `implements` garde
 * l interface vivante (le mecanisme que la sentinelle de `G04` verrouille).
 * Cote membres, une surcharge n est jamais candidate, et c est juste dans le
 * cas general puisque l interface l exige ; ca cesse de l etre quand
 * l interface elle meme est morte.
 *
 * `idleImplementations.ts` ne peut pas rattraper : il exige `empty: true` sur
 * chaque surcharge concernee, et ici les corps ne sont pas vides.
 */

const iles: any = await importOrNull('src/providers/deadIslands');
const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const idle: any = await importOrNull('src/providers/idleImplementations');
const mod = symb && memb ? { symb, memb, idle } : null;

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  symb.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const membres = (...sources: { path: string; text: string }[]) =>
  memb.findUnusedMembers({
    sources, testSourceSets: ['/src/test/'], includeSelfOnly: false,
  }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

/** Une interface morte de facon evidente : le detecteur la juge deja. */
const CANARI_IFACE = f(`${MAIN}/CanaryGone.java`, [
  'package com.x;',
  '',
  'public interface CanaryGone {',
  '',
  '\tvoid gone();',
  '}',
  '',
].join('\n'));

/** Une methode morte sans surcharge : le detecteur la juge deja aussi. */
const CANARI_MEMBRE = f(`${MAIN}/CanaryHolder.java`, [
  'package com.x;',
  '',
  'public class CanaryHolder {',
  '',
  '\tpublic void canaryGoneMember() {',
  '\t}',
  '}',
  '',
].join('\n'));

const epargneSymbole = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

const epargneMembre = (trouves: any[], cible: string) => {
  expect(trouves.map(m => m.name)).toContain('canaryGoneMember');
  expect(trouves.map(m => m.name)).not.toContain(cible);
};

// ── Fixtures 7a, reduites du motif reel ─────────────────────────────────────

const LISTENER_7A = f(`${MAIN}/AnalyticsTimerPanelListener.java`, [
  'package com.x;',
  '',
  'public interface AnalyticsTimerPanelListener {',
  '',
  '\tvoid panelEnabledUpdated(boolean isEnabled);',
  '}',
  '',
].join('\n'));

const VUE_7A = f(`${MAIN}/AnalyticsTimerPanelView.java`, [
  'package com.x;',
  '',
  'public class AnalyticsTimerPanelView extends LinearLayout implements AnalyticsTimerPanelListener {',
  '',
  '\tprivate boolean enabled;',
  '',
  '\t@Override',
  '\tpublic void panelEnabledUpdated(boolean isEnabled) {',
  '\t\tthis.enabled = isEnabled;',
  '\t}',
  '}',
  '',
].join('\n'));

// ── Fixtures 7b ─────────────────────────────────────────────────────────────

const TIMER_7B = f(`${MAIN}/CountdownAnalyticsTimer.java`, [
  'package com.x;',
  '',
  'public interface CountdownAnalyticsTimer {',
  '',
  '\tboolean isComplete();',
  '}',
  '',
].join('\n'));

const IMPL_7B = f(`${MAIN}/CountdownAnalyticsTimerImpl.java`, [
  'package com.x;',
  '',
  'public class CountdownAnalyticsTimerImpl implements CountdownAnalyticsTimer {',
  '',
  '\t@Override',
  '\tpublic boolean isComplete() {',
  '\t\treturn true;',
  '\t}',
  '',
  '\tvoid tick(boolean isSuccess) {',
  '\t\tif (isSuccess && !isComplete()) {',
  '\t\t\treset();',
  '\t\t}',
  '\t}',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('G7 — le corpus de test est lisible', () => {
  it('rapporte une interface que rien n implemente ni ne nomme', () => {
    expect(nomme(symboles(CANARI_IFACE), 'CanaryGone')).toBe(true);
  });

  it('rapporte une methode publique morte qui ne surcharge rien', () => {
    expect(nomme(membres(CANARI_MEMBRE), 'canaryGoneMember')).toBe(true);
  });

  /**
   * SENTINELLE, et un etage a bouge.
   *
   * Le trou est a deux etages. Cote SYMBOLES il tient : seule la CLASSE
   * ressort, jamais l interface, et c est ce que G7 demande.
   *
   * Cote MEMBRES, KJ-077 a ouvert une porte : `tick` n est declaree par aucun
   * supertype, toute la chaine est visible, et rien ne l appelle. Elle est
   * donc rapportee. `isComplete`, elle, reste retenue : c est une surcharge
   * dont le contrat vit dans l interface, et la couper seule ne compilerait
   * pas (KJ-073, `M11:bound-by-contract`).
   *
   * Si l un de ces deux constats bouge, l entree G7 du document doit etre
   * relue.
   */
  it('cote membres, seul ce qu aucun supertype ne declare est juge', () => {
    expect(membres(LISTENER_7A, VUE_7A)).toHaveLength(0);
    expect(membres(TIMER_7B, IMPL_7B).map(m => m.name)).toEqual(['tick']);
  });

  it('cote symboles, l interface reste vivante, seule la classe ressort', () => {
    expect(symboles(LISTENER_7A, VUE_7A).map(s => s.name))
      .toEqual(['AnalyticsTimerPanelView']);
    expect(symboles(TIMER_7B, IMPL_7B).map(s => s.name))
      .toEqual(['CountdownAnalyticsTimerImpl']);
  });

  /**
   * KJ-072 ne peut pas rattraper ce motif : il lui faut des corps VIDES.
   * Ce test le verrouille, pour qu on ne croie pas la famille deja couverte.
   */
  it.skipIf(!idle)('aujourd hui, KJ-072 ne voit pas une surcharge au corps plein', () => {
    const trouves = idle.findIdleImplementations({
      sources: [LISTENER_7A, VUE_7A], testSourceSets: ['/src/test/'],
    }) as any[];
    expect(trouves).toHaveLength(0);
  });
});

/**
 * LE RECOUVREMENT AVEC LES ILOTS, et pourquoi il ne suffit pas.
 *
 * En verifiant si G7 etait deja couvert par une autre famille, la reponse
 * s est averee : OUI en isolant, NON dans le contexte reel.
 *
 *   l interface et sa vue, seules        -> ilot Listener+View rapporte
 *   + les deux declarations d injection  -> aucun ilot
 *
 * La deuxieme ligne est le cas de `AnalyticsTimerPanelView` sur le corpus de
 * reference: `AppApplicationComponent` et l override du faux
 * composant nomment la vue, donc elle n est plus orpheline, donc l ilot se
 * defait. C est le meme mecanisme que G9, vu depuis une autre famille.
 *
 * Deux consequences. D abord, G7 n est pas redondant : le recouvrement
 * disparait precisement dans la configuration ou le motif se produit. Ensuite,
 * corriger G9 ferait tomber une partie de G7 sans effort, puisque l ilot se
 * reformerait des que les declarations d injection cesseraient de compter.
 *
 * Ces deux tests fixent le recouvrement conditionnel. Si le premier se met a
 * echouer, les ilots ont change ; si le second se met a passer, G9 a ete
 * corrige et G7 doit etre remesure.
 */
describe.skipIf(!iles)('G7 — ce que les ilots couvrent deja, et jusqu ou', () => {
  const ilots = (...sources: { path: string; text: string }[]) =>
    (iles.findDeadIslands({
      sources, testSourceSets: ['/src/test/'], maxIslandSize: 8,
    }) as any[]).flatMap((x: any) => x.names ?? [x.name]);

  const COMPOSANT = f(`${MAIN}/AppComponent.kt`, [
    'package com.x',
    '',
    'import dagger.Component',
    '',
    '@Component',
    'interface AppComponent {',
    '    fun inject(target: AnalyticsTimerPanelView)',
    '}',
    '',
  ].join('\n'));

  const FAUX = f(`${MAIN}/EmptyComponent.kt`, [
    'package com.x',
    '',
    'class EmptyComponent : AppComponent {',
    '    override fun inject(target: AnalyticsTimerPanelView) {}',
    '}',
    '',
  ].join('\n'));

  it('rapporte deja l ilot quand l interface et sa vue sont seules', () => {
    expect(ilots(LISTENER_7A, VUE_7A)).toEqual(
      expect.arrayContaining(['AnalyticsTimerPanelListener', 'AnalyticsTimerPanelView']));
  });

  it('ne rapporte plus rien des que les declarations d injection nomment la vue', () => {
    // Le contexte reel du corpus. L ilot se defait, et c est la que G7 devient
    // necessaire.
    expect(ilots(LISTENER_7A, VUE_7A, COMPOSANT, FAUX)).toEqual([]);
  });
});

describe.skipIf(!mod)('G7a — l interface et sa methode meurent ensemble', () => {
  it.fails('rapporte l interface que seule sa clause nomme', () => {
    expect(nomme(symboles(LISTENER_7A, VUE_7A), 'AnalyticsTimerPanelListener')).toBe(true);
  });

  it.fails('rapporte la surcharge, que rien n appelle', () => {
    expect(nomme(membres(LISTENER_7A, VUE_7A), 'panelEnabledUpdated')).toBe(true);
  });

  it.fails('rapporte aussi la declaration de la methode dans l interface', () => {
    const trouves = membres(LISTENER_7A, VUE_7A);
    expect(trouves.filter(m => m.name === 'panelEnabledUpdated').length)
      .toBeGreaterThanOrEqual(2);
  });

  it.fails('rapporte l interface meme quand deux classes l implementent', () => {
 // en a deux, et
    // aucune n est vue comme un `FontedTextView` ailleurs.
    const seconde = f(`${MAIN}/OtherPanel.java`, [
      'package com.x;',
      '',
      'public class OtherPanel extends LinearLayout implements AnalyticsTimerPanelListener {',
      '',
      '\t@Override',
      '\tpublic void panelEnabledUpdated(boolean isEnabled) {',
      '\t\tthis.state = isEnabled;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(LISTENER_7A, VUE_7A, seconde), 'AnalyticsTimerPanelListener'))
      .toBe(true);
  });
});

describe.skipIf(!mod)('G7b — l abstraction meurt, l implementation vit', () => {
  it.fails('rapporte l interface dont la methode n est appelee que sur this', () => {
    expect(nomme(symboles(TIMER_7B, IMPL_7B), 'CountdownAnalyticsTimer')).toBe(true);
  });

  /**
   * LA GARDE QUI SEPARE 7a DE 7b, et la plus importante du fichier. Couper
   * `isComplete()` casserait `tick()`, qui l appelle ligne 11 de la fixture.
   * Elle passe DES MAINTENANT, puisque rien n est rapporte, mais elle devra
   * continuer a passer apres l implementation : c est elle qui dira si la
   * coupe de 7a a ete appliquee a tort a 7b.
   */
  it('ne rapporte PAS la methode appelee depuis sa propre classe', () => {
    epargneMembre(membres(TIMER_7B, IMPL_7B, CANARI_MEMBRE), 'isComplete');
  });
});

describe.skipIf(!mod)('G7 — les gardes, qui passent des maintenant', () => {
  it('ne touche pas une interface utilisee comme type quelque part', () => {
    const usage = f(`${MAIN}/Presenter.java`, [
      'package com.x;',
      '',
      'public class Presenter {',
      '',
      '\tvoid attach(AnalyticsTimerPanelListener listener) {',
      '\t\tlistener.panelEnabledUpdated(true);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargneSymbole(symboles(LISTENER_7A, VUE_7A, usage, CANARI_IFACE),
      'AnalyticsTimerPanelListener');
  });

  it('ne touche pas la surcharge quand l interface est vivante', () => {
    const usage = f(`${MAIN}/Presenter.java`, [
      'package com.x;',
      '',
      'public class Presenter {',
      '',
      '\tvoid attach(AnalyticsTimerPanelListener listener) {',
      '\t\tlistener.panelEnabledUpdated(true);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargneMembre(membres(LISTENER_7A, VUE_7A, usage, CANARI_MEMBRE),
      'panelEnabledUpdated');
  });

  /**
   * Une surcharge d une classe de BIBLIOTHEQUE n a pas d interface lisible
   * dans ce corpus. `toString`, `onCreate`, `equals` : la machine virtuelle
   * les appelle, et rien ici ne peut le voir.
   */
  it('ne touche pas la surcharge d une methode de la plateforme', () => {
    const plateforme = f(`${MAIN}/Widget.java`, [
      'package com.x;',
      '',
      'public class Widget extends LinearLayout {',
      '',
      '\t@Override',
      '\tpublic String toString() {',
      '\t\treturn "widget";',
      '\t}',
      '',
      '\t@Override',
      '\tprotected void onDetachedFromWindow() {',
      '\t\tsuper.onDetachedFromWindow();',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const trouves = membres(plateforme, CANARI_MEMBRE);
    expect(trouves.map(m => m.name)).toContain('canaryGoneMember');
    expect(trouves.map(m => m.name)).not.toContain('toString');
    expect(trouves.map(m => m.name)).not.toContain('onDetachedFromWindow');
  });

  /**
   * FAUX POSITIF TROUVE EN CLASSANT LES SIX INTERFACES DU CORPUS.
   *
   * s ecrit `extends ViewPager.OnPageChangeListener`. Ses methodes sont
   * appelees par le framework, depuis du code qu aucun scan ne lit, et le
   * fait que le corpus ne la nomme jamais comme type ne prouve donc rien.
   *
   * La meme prudence vaut pour `MarginPageIndicator` et pour toute interface
   * qui prolonge un contrat hors corpus. Sans cette garde, la famille G7
   * couperait deux de ses six candidats a tort.
   */
  it('ne touche pas une interface qui prolonge une interface hors du corpus', () => {
    const heritee = f(`${MAIN}/PageIndicatorInterface.java`, [
      'package com.x;',
      '',
      'public interface PageIndicatorInterface extends ViewPager.OnPageChangeListener {',
      '',
      '\tvoid setViewPager(ViewPager view);',
      '}',
      '',
    ].join('\n'));
    const impl = f(`${MAIN}/CirclePageIndicator.java`, [
      'package com.x;',
      '',
      'public class CirclePageIndicator extends View implements PageIndicatorInterface {',
      '',
      '\t@Override',
      '\tpublic void setViewPager(ViewPager view) {',
      '\t\tthis.pager = view;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargneSymbole(symboles(heritee, impl, CANARI_IFACE), 'PageIndicatorInterface');
  });

  /**
 *: sa
   * methode `onScrollChanged` n est appelee QUE depuis
 * `ScrollViewEventHelperImplTest`. Ce n est pas un cas 7a, c est la
   * famille « kept alive only by their tests », qui a deja son detecteur. Le
   * verdict attendu est donc `testOnly`, jamais `unreferenced`.
   */
  it('rend testOnly, pas unreferenced, quand seuls les tests appellent la methode', () => {
    const iface = f(`${MAIN}/ScrollViewEventHelper.java`, [
      'package com.x;',
      '',
      'public interface ScrollViewEventHelper {',
      '',
      '\tvoid onScrollChanged(int y, int oldY);',
      '}',
      '',
    ].join('\n'));
    const impl = f(`${MAIN}/ScrollViewEventHelperImpl.java`, [
      'package com.x;',
      '',
      'public class ScrollViewEventHelperImpl implements ScrollViewEventHelper {',
      '',
      '\t@Override',
      '\tpublic void onScrollChanged(int y, int oldY) {',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const test = f('/w/app/src/test/java/com/x/ScrollViewEventHelperImplTest.java', [
      'package com.x;',
      '',
      'public class ScrollViewEventHelperImplTest {',
      '',
      '\tvoid check(ScrollViewEventHelper helper) {',
      '\t\thelper.onScrollChanged(5, 0);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const trouve = symboles(iface, impl, test, CANARI_IFACE)
      .find(s => s.name === 'ScrollViewEventHelper');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  it('ne touche pas une methode appelee sur le type concret ailleurs', () => {
    const appelant = f(`${MAIN}/Caller.java`, [
      'package com.x;',
      '',
      'public class Caller {',
      '',
      '\tvoid run(CountdownAnalyticsTimerImpl timer) {',
      '\t\ttimer.isComplete();',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargneMembre(membres(TIMER_7B, IMPL_7B, appelant, CANARI_MEMBRE), 'isComplete');
  });

  it('ne touche pas une interface qu un objet anonyme instancie', () => {
    const anonyme = f(`${MAIN}/Anon.java`, [
      'package com.x;',
      '',
      'public class Anon {',
      '',
      '\tAnalyticsTimerPanelListener make() {',
      '\t\treturn new AnalyticsTimerPanelListener() {',
      '\t\t\t@Override',
      '\t\t\tpublic void panelEnabledUpdated(boolean isEnabled) {',
      '\t\t\t}',
      '\t\t};',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargneSymbole(symboles(LISTENER_7A, anonyme, CANARI_IFACE),
      'AnalyticsTimerPanelListener');
  });

  it('ne touche pas une interface que seul un test nomme comme type', () => {
    const test = f('/w/app/src/test/java/com/x/PanelTest.kt', [
      'package com.x',
      '',
      'class PanelTest {',
      '    fun check(l: AnalyticsTimerPanelListener) = l.panelEnabledUpdated(true)',
      '}',
      '',
    ].join('\n'));
    const trouve = symboles(LISTENER_7A, VUE_7A, test, CANARI_IFACE)
      .find(s => s.name === 'AnalyticsTimerPanelListener');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [CANARI_IFACE], testSourceSets: ['/src/test/'] };
    expect(symb.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(symb.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
