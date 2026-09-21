import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G4 — une interface qui n existe que pour une liaison Dagger morte.
 *
 * Voir doc/gaps-detection.md. Le cas reel est `AspenPineLayout`, dont les cinq
 * seules occurrences du corpus de reference sont :
 *
 * la declaration
 * l import de la clause
 * `implements AspenPineLayout`
 * l import
 * `AspenPineLayout provideAspenPineLayout(...)`
 *
 * Rien n injecte un `AspenPineLayout`, et le graphe genere le confirme :
 * `AppPineActivityModule_ProvideAspenPineLayoutFactory` n est citee par
 * aucun fichier genere, alors que sa soeur `ProvideAspenPineDirectorFactory`
 * l est par quatre composants.
 *
 * Ce qui est mort ici, c est l ABSTRACTION, pas l implementation :
 * `AppMainLayout` garde ses methodes, elles sont appelees sur le type
 * concret. La coupe emporte l interface, ses deux imports, la clause
 * `implements` et la methode de fourniture.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Mesure faite avant d ecrire ces tests, avec `explainSymbols` :
 *
 *   interface seule                      -> unreferenced  (main = 1)
 *   + une classe qui l implemente        -> alive:main    (main = 2)
 *   + la fourniture Dagger               -> alive:main    (main = 3)
 *
 * La clause `implements` suffit donc a la garder vivante. Rien ne distingue,
 * dans le comptage, une mention qui UTILISE le type d une mention qui se
 * contente de le declarer implemente.
 *
 * ## Note sur les gardes
 *
 * Contrairement a G1 et G2, le detecteur juge bel et bien ces corpus : il
 * rapporte l interface quand elle est seule. Les gardes ci dessous passent
 * donc DES MAINTENANT, et pour la bonne raison. Le canari reste en place par
 * precaution, pour qu aucune d elles ne puisse devenir vacue si une garde
 * amont venait a ecarter tout le motif.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const iles: any = await importOrNull('src/providers/deadIslands');
const idle: any = await importOrNull('src/providers/idleImplementations');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

/** Une interface morte de facon evidente : ni implementee, ni nommee. */
const CANARI = f(`${MAIN}/CanaryGone.java`, [
  'package com.x;',
  '',
  'public interface CanaryGone {',
  '',
  '\tvoid gone();',
  '}',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures, reduites du motif reel ────────────────────────────────────────

const IFACE = f(`${MAIN}/AspenPineLayout.java`, [
  'package com.x;',
  '',
  'public interface AspenPineLayout {',
  '',
  '\tvoid setTitle(String title);',
  '}',
  '',
].join('\n'));

const IMPL = f(`${MAIN}/AppMainLayout.java`, [
  'package com.x;',
  '',
  'public class AppMainLayout extends FrameLayout implements AspenPineLayout {',
  '',
  '\t@Override',
  '\tpublic void setTitle(String title) {',
  '\t\tthis.title = title;',
  '\t}',
  '}',
  '',
].join('\n'));

const MODULE = f(`${MAIN}/AppPineActivityModule.java`, [
  'package com.x;',
  '',
  'import dagger.Module;',
  'import dagger.Provides;',
  '',
  '@Module',
  'public class AppPineActivityModule {',
  '',
  '\t@Provides',
  '\tAspenPineLayout provideAspenPineLayout(AppMainLayout appMainLayout) {',
  '\t\treturn appMainLayout;',
  '\t}',
  '}',
  '',
].join('\n'));

/** Le consommateur qui rend l interface vivante, pour les gardes. */
const CONSOMMATEUR = f(`${MAIN}/Presenter.java`, [
  'package com.x;',
  '',
  'public class Presenter {',
  '',
  '\tprivate AspenPineLayout layout;',
  '',
  '\tvoid attach(AspenPineLayout layout) {',
  '\t\tthis.layout = layout;',
  '\t}',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('G4 — le corpus de test est lisible', () => {
  it('rapporte une interface que rien n implemente ni ne nomme', () => {
    expect(nomme(symboles(IFACE), 'AspenPineLayout')).toBe(true);
  });

  it('rapporte le canari, qui sert de preuve de vie aux gardes', () => {
    expect(nomme(symboles(CANARI, IFACE, IMPL), 'CanaryGone')).toBe(true);
  });

  /**
   * SENTINELLE. Elle fixe le mecanisme mesure : une clause `implements` fait
   * passer le compte de 1 a 2 et suffit a garder l interface vivante. Si ce
   * test se met a echouer, le comptage a change et l entree G4 du document
   * doit etre relue.
   */
  it('aujourd hui, une clause implements compte comme une mention vivante', () => {
    expect(pourquoi('AspenPineLayout', IFACE)).toMatchObject({
      outcome: 'unreferenced', mainMentions: 1,
    });
    expect(pourquoi('AspenPineLayout', IFACE, IMPL)).toMatchObject({
      outcome: 'alive:main', mainMentions: 2,
    });
    expect(pourquoi('AspenPineLayout', IFACE, IMPL, MODULE)).toMatchObject({
      outcome: 'alive:main', mainMentions: 3,
    });
  });
});

describe.skipIf(!mod)('G4 — l abstraction qui ne sert qu a une liaison morte', () => {
  it.fails('rapporte l interface dont le seul usage comme type est une fourniture', () => {
    expect(nomme(symboles(IFACE, IMPL, MODULE), 'AspenPineLayout')).toBe(true);
  });

  it.fails('la rapporte aussi sous la forme Kotlin `: Base(), I`', () => {
    const kIface = f(`${MAIN}/WrenLilacFromURI.kt`, [
      'package com.x',
      '',
      'interface WrenLilacFromURI {',
      '    fun open(uri: String)',
      '}',
      '',
    ].join('\n'));
    const kImpl = f(`${MAIN}/WrenLilacFromURIImpl.kt`, [
      'package com.x',
      '',
      'class WrenLilacFromURIImpl : BaseUseCase(), WrenLilacFromURI {',
      '    override fun open(uri: String) = Unit',
      '}',
      '',
    ].join('\n'));
    const kModule = f(`${MAIN}/ApricotCoconutModule.kt`, [
      'package com.x',
      '',
      'import dagger.Binds',
      'import dagger.Module',
      '',
      '@Module',
      'abstract class ApricotCoconutModule {',
      '',
      '    @Binds',
      '    abstract fun bindWrenLilacFromURI(impl: WrenLilacFromURIImpl): WrenLilacFromURI',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(kIface, kImpl, kModule), 'WrenLilacFromURI')).toBe(true);
  });

  it.fails('ne garde pas vivante une interface que SEULE sa clause nomme', () => {
    // Le cas G7 vu depuis G4 : meme mecanisme, sans Dagger du tout.
    expect(nomme(symboles(IFACE, IMPL), 'AspenPineLayout')).toBe(true);
  });

  it.fails('rapporte l interface meme quand plusieurs classes l implementent', () => {
 // en a deux, et
    // aucune n est vue comme un `FontedTextView` ailleurs.
    const second = f(`${MAIN}/OtherLayout.java`, [
      'package com.x;',
      '',
      'public class OtherLayout extends FrameLayout implements AspenPineLayout {',
      '',
      '\t@Override',
      '\tpublic void setTitle(String title) {',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(IFACE, IMPL, second), 'AspenPineLayout')).toBe(true);
  });
});

describe.skipIf(!mod)('G4 — les gardes, qui passent des maintenant', () => {
  it('ne touche pas une interface utilisee comme type de champ ou de parametre', () => {
    epargne(symboles(IFACE, IMPL, CONSOMMATEUR, CANARI), 'AspenPineLayout');
  });

  it('ne touche pas une interface rendue par une methode ordinaire', () => {
    const rendu = f(`${MAIN}/Factory.java`, [
      'package com.x;',
      '',
      'public class Factory {',
      '',
      '\tAspenPineLayout create() {',
      '\t\treturn new AppMainLayout();',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IFACE, IMPL, rendu, CANARI), 'AspenPineLayout');
  });

  it('ne touche pas une interface nommee par un transtypage', () => {
    const cast = f(`${MAIN}/Caller.java`, [
      'package com.x;',
      '',
      'public class Caller {',
      '',
      '\tvoid run(Object o) {',
      '\t\t((AspenPineLayout) o).setTitle("x");',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IFACE, IMPL, cast, CANARI), 'AspenPineLayout');
  });

  it('ne touche pas une interface fonctionnelle passee en lambda', () => {
    const sam = f(`${MAIN}/Sam.kt`, [
      'package com.x',
      '',
      'fun interface Clicked {',
      '    fun onClick()',
      '}',
      '',
      'class Button {',
      '    fun setListener(l: Clicked) = Unit',
      '    fun wire() = setListener(Clicked { })',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(sam, CANARI), 'Clicked');
  });

  it('ne touche pas une interface exposee par un @Component', () => {
    const composant = f(`${MAIN}/AppComponent.kt`, [
      'package com.x',
      '',
      'import dagger.Component',
      '',
      '@Component',
      'interface AppComponent {',
      '    fun layout(): AspenPineLayout',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IFACE, IMPL, composant, CANARI), 'AspenPineLayout');
  });

  it('ne touche pas une interface qu un objet anonyme instancie', () => {
    const anonyme = f(`${MAIN}/Anon.java`, [
      'package com.x;',
      '',
      'public class Anon {',
      '',
      '\tAspenPineLayout make() {',
      '\t\treturn new AspenPineLayout() {',
      '\t\t\t@Override',
      '\t\t\tpublic void setTitle(String title) {',
      '\t\t\t}',
      '\t\t};',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(IFACE, anonyme, CANARI), 'AspenPineLayout');
  });

  it('ne touche pas une interface que seul un test nomme comme type', () => {
    const test = f('/w/app/src/test/java/com/x/LayoutTest.kt', [
      'package com.x',
      '',
      'class LayoutTest {',
      '    fun check(layout: AspenPineLayout) = layout.setTitle("x")',
      '}',
      '',
    ].join('\n'));
    const trouve = symboles(IFACE, IMPL, test, CANARI)
      .find(s => s.name === 'AspenPineLayout');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  /**
   * UN IMPORT SEUL NE COMPTE PAS COMME UN USAGE, et c est ce qui rend les
   * verdicts coherents entre familles.
   *
   * Cas reel, verifie pendant l audit des trouvailles :
   * `com.example.app.core.service.location.LocationEvents` est importee par
 * `FetchWeatherTask` et n apparait nulle part ailleurs dans ce
   * fichier. Les deux detecteurs disent la meme chose sans se contredire :
   * le balayage rapporte l import mort (il est dans les 45 imports Java de
   * KJ-068), et le detecteur de symboles rapporte la classe morte.
   *
   * Si un import comptait comme une mention, la classe passerait pour vivante
   * et l import pour mort : deux verdicts qui se contredisent sur la meme
   * ligne. Ce test garde la regle en place.
   */
  it('ne garde pas une interface en vie pour un simple import', () => {
    const importee = f(`${MAIN}/FetchWeatherTask.java`, [
      'package com.x;',
      '',
      'import com.x.AspenPineLayout;',
      '',
      'public class FetchWeatherTask {',
      '',
      '\tvoid run() {',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(IFACE, importee), 'AspenPineLayout')).toBe(true);
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [IFACE], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});


/**
 * AUCUNE AUTRE FAMILLE NE VOIT CE MOTIF, verifie.
 *
 * G12 a montre qu une entree du document pouvait etre deja couverte ailleurs
 * (l enum vide imbrique, que `scanEnums` rapporte). La meme verification a ete
 * faite ici, sur les trois familles qui pourraient attraper `AspenPineLayout`,
 * son implementation et sa fourniture :
 *
 *   findDeadIslands        -> (rien)
 *   findUnusedSymbols      -> (rien)
 *   findIdleImplementations-> (rien)
 *
 * Les trois se taisent, chacune pour sa raison. Les ilots ne se forment pas
 * parce que le module `@Module` n est pas un candidat, les symboles voient
 * l interface `alive:main` a cause de sa clause `implements`, et KJ-072 exige
 * des surcharges vides alors que `setTitle` a un corps.
 *
 * G4 est donc un trou entier, sans recouvrement. Ces tests le fixent : si
 * l un des trois se met a rapporter quelque chose, l entree G4 du document
 * doit etre relue, et peut-etre retiree.
 */
describe.skipIf(!mod || !iles || !idle)('G4 — aucune autre famille ne couvre ce motif', () => {
  it('les ilots ne forment rien sur ce trio', () => {
    const trouves = iles.findDeadIslands({
      sources: [IFACE, IMPL, MODULE], testSourceSets: ['/src/test/'], maxIslandSize: 8,
    }) as any[];
    expect(trouves).toHaveLength(0);
  });

  it('les symboles ne rapportent rien non plus', () => {
    expect(symboles(IFACE, IMPL, MODULE)).toHaveLength(0);
  });

  it('KJ-072 ne voit rien, les surcharges ayant un corps', () => {
    const trouves = idle.findIdleImplementations({
      sources: [IFACE, IMPL, MODULE], testSourceSets: ['/src/test/'],
    }) as any[];
    expect(trouves).toHaveLength(0);
  });
});
