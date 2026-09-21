import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G9 — la garde « supertype hors du corpus » de KJ-067 ne se relache jamais.
 *
 * Voir doc/gaps-detection.md. C est la CAUSE de l arret que G8 constate, et
 * le trou le plus interessant du document, parce que la garde a RAISON au
 * premier tour et tort ensuite.
 *
 * KJ-067 sait qu une declaration `inject(target: X)` est un parametre et ne
 * tient aucune instance. Sur `AnalyticsTimerPanelView`, les quatre mentions
 * hors du fichier sont exactement ce motif :
 *
 * AppApplicationComponent import
 * AppApplicationComponent fun inject(target: AnalyticsTimerPanelView)
 * EmptyAppApplicationComponent import
 * EmptyAppApplicationComponent override fun inject(target: …) {}
 *
 * Il devrait donc la voir. Il se retient a cause de sa propre garde : toute
 * la chaine des supertypes doit etre declaree dans le workspace, et
 * `AnalyticsTimerPanelView extends LinearLayout`, qui vit dans un AAR.
 *
 * ## La garde a raison, puis elle a tort
 *
 * Au premier tour elle a raison : une classe dont la base est hors corpus
 * peut etre instanciee par une convention que personne ne lit, et c est
 * precisement le cas, la balise
 * `<ca.example...AnalyticsTimerPanelView` du layout. Le defaut est qu elle
 * est STATIQUE. Une fois le layout supprime a la ronde deux, plus aucun XML
 * ne nomme la classe, la convention invisible n existe plus, et la garde
 * protege encore.
 *
 * ## Ce que ces tests affirment
 *
 * Une vue Android n a que deux voies d instanciation : `new X(...)` dans du
 * code, et une balise XML portant son nom pleinement qualifie. Quand le
 * corpus ne contient ni l une ni l autre, et que les seules mentions
 * restantes sont des declarations d injection, l argument « une convention
 * invisible la construit peut etre » tombe.
 *
 * Les gardes de ce fichier sont donc aussi importantes que les cas positifs,
 * et pour une raison inhabituelle : elles decrivent le comportement d
 * AUJOURD HUI qu il faut CONSERVER. Un relachement trop large supprimerait
 * une vue bel et bien instanciee par un XML, ce que le compilateur ne
 * rattraperait pas : le projet compilerait et planterait a l inflation.
 *
 * ## Mesure faite avant d ecrire
 *
 * Meme corpus, meme motif d injection, seul le supertype change :
 *
 *   supertype DANS le workspace   -> unreferenced, via=injection, 2 sites
 *   supertype HORS workspace      -> alive:main, non rapportee
 *   aucun supertype               -> unreferenced, via=injection, 2 sites
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const RES = '/w/app/src/main/res';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const trouve = (nom: string, ...sources: { path: string; text: string }[]) =>
  symboles(...sources).find(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

// ── Fixtures ───────────────────────────────────────────────────────────────

const COMPOSANT = f(`${MAIN}/AppComponent.kt`, [
  'package com.x',
  '',
  'import dagger.Component',
  '',
  '@Component',
  'interface AppComponent {',
  '    fun inject(target: Cible)',
  '}',
  '',
].join('\n'));

const FAUX_COMPOSANT = f(`${MAIN}/EmptyComponent.kt`, [
  'package com.x',
  '',
  'class EmptyComponent : AppComponent {',
  '    override fun inject(target: Cible) {}',
  '}',
  '',
].join('\n'));

/** La classe cible, parametree par son supertype. */
const cible = (supertype: string | null) => f(`${MAIN}/Cible.java`, [
  'package com.x;',
  '',
  `public class Cible${supertype ? ` extends ${supertype}` : ''} {`,
  '',
  '\tvoid work() {',
  '\t}',
  '}',
  '',
].join('\n'));

/** Une base declaree par le workspace : la chaine est alors lisible. */
const BASE_LOCALE = f(`${MAIN}/LocalBase.java`, [
  'package com.x;',
  '',
  'public class LocalBase {',
  '}',
  '',
].join('\n'));

/** Le canari : meme motif, base locale, donc juge des aujourd hui. */
const CANARI = f(`${MAIN}/CanaryGone.java`, [
  'package com.x;',
  '',
  'public class CanaryGone extends LocalBase {',
  '}',
  '',
].join('\n'));

const CANARI_COMPOSANT = f(`${MAIN}/CanaryComponent.kt`, [
  'package com.x',
  '',
  'import dagger.Component',
  '',
  '@Component',
  'interface CanaryComponent {',
  '    fun inject(target: CanaryGone)',
  '}',
  '',
].join('\n'));

/** Exige que le detecteur JUGE le corpus, et qu il epargne la cible. */
const epargne = (trouves: any[], nom: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(nom);
};

describe.skipIf(!mod)('G9 — le corpus de test est lisible', () => {
  it('rapporte une classe dont la chaine de supertypes est locale', () => {
    const t = trouve('Cible', cible('LocalBase'), BASE_LOCALE, COMPOSANT, FAUX_COMPOSANT);
    expect(t).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
    expect(t.injectionSites).toHaveLength(2);
  });

  it('rapporte une classe sans supertype du tout', () => {
    const t = trouve('Cible', cible(null), COMPOSANT, FAUX_COMPOSANT);
    expect(t).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  /**
   * SENTINELLE. Meme corpus, meme motif d injection, seul le supertype
   * change, et le verdict bascule. C est la demonstration que le trou est la
   * garde et rien d autre. Si ce test se met a echouer, la garde a bouge et
   * les entrees G8 et G9 du document doivent etre relues ensemble.
   */
  it('aujourd hui, un supertype hors du corpus suffit a tout retenir', () => {
    expect(pourquoi('Cible', cible('LocalBase'), BASE_LOCALE, COMPOSANT, FAUX_COMPOSANT))
      .toMatchObject({ outcome: 'unreferenced', mainMentions: 3 });
    expect(pourquoi('Cible', cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT))
      .toMatchObject({ outcome: 'alive:main', mainMentions: 3 });
  });
});

describe.skipIf(!mod)('G9 — la garde qui devrait se relacher', () => {
  it.fails('rapporte la classe quand aucun XML ni site de construction ne la nomme', () => {
    expect(trouve('Cible', cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT))
      .toBeDefined();
  });

  it.fails('la rapporte avec via=injection et ses deux sites', () => {
    const t = trouve('Cible', cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT);
    expect(t).toMatchObject({ via: 'injection' });
    expect(t?.injectionSites).toHaveLength(2);
  });

  it.fails('la rapporte meme quand la chaine hors corpus a plusieurs etages', () => {
    // `class Cible extends Intermediaire`, et `Intermediaire extends LinearLayout` :
    // la chaine sort du corpus au deuxieme etage, pas au premier.
    const intermediaire = f(`${MAIN}/Intermediaire.java`, [
      'package com.x;',
      '',
      'public class Intermediaire extends LinearLayout {',
      '}',
      '',
    ].join('\n'));
    expect(trouve('Cible', cible('Intermediaire'), intermediaire, COMPOSANT, FAUX_COMPOSANT))
      .toBeDefined();
  });

  /**
   * Le seul cas REEL trouve sur le corpus de reference, et le plus subtil :
   *
   * Ses seules mentions hors de son fichier sont un import, la declaration
 * `fun inject(target: CustomClickableSpan)` de `BaseComponent`, et
 * l override du faux composant `EmptyAppMainActivityComponent`.
   * Personne ne la construit. Mais son propre corps ecrit
   * `(widget.context as HasBaseComponent).getBaseComponent().inject(this)` :
   * elle CONSOMME la declaration qui la nomme.
   *
   * C est le piege : la classe et sa declaration d injection se tiennent
   * mutuellement en vie, et le couple entier est mort. Un detecteur qui
   * verrait `inject(this)` comme un usage laisserait les deux debout.
   */
  it.fails('rapporte la classe qui s injecte elle meme sans que rien ne la construise', () => {
    const span = f(`${MAIN}/Cible.java`, [
      'package com.x;',
      '',
      'public class Cible extends ClickableSpan {',
      '',
      '\tvoid onActionClicked(View widget) {',
      '\t\t((HasBaseComponent) widget.getContext()).getBaseComponent().inject(this);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(trouve('Cible', span, COMPOSANT, FAUX_COMPOSANT)).toBeDefined();
  });

  it.fails('la rapporte quand le layout qui la nommait vient d etre supprime', () => {
    // La ronde deux de G8, dite du point de vue de la garde : a la ronde un
    // le XML etait la et la garde avait raison de retenir.
    const avecLayout = symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT,
      f(`${RES}/layout/panel.xml`, '<com.x.Cible />\n'));
    expect(avecLayout.map(s => s.name)).not.toContain('Cible');   // ronde un, correct
    expect(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT).map(s => s.name))
      .toContain('Cible');                                        // ronde deux, le trou
  });
});

describe.skipIf(!mod)('G9 — les gardes, qui decrivent ce qu il faut CONSERVER', () => {
  /**
   * Inhabituel : ces gardes passent deja et doivent continuer a passer. Un
   * relachement trop large supprimerait une vue que le XML instancie, et le
   * compilateur ne rattraperait pas : le projet compile, puis plante a
   * l inflation du layout. C est une panne d execution, pas de build.
   */

  const CANARIS = [CANARI, BASE_LOCALE, CANARI_COMPOSANT];

  it('ne touche pas une classe qu une balise XML nomme', () => {
    const layout = f(`${RES}/layout/panel.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<com.x.Cible xmlns:android="http://schemas.android.com/apk/res/android" />',
      '',
    ].join('\n'));
    epargne(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, layout, ...CANARIS),
      'Cible');
  });

  it('ne touche pas une classe qu une balise XML imbriquee nomme', () => {
    const layout = f(`${RES}/layout/parent.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <com.x.Cible android:id="@+id/panel" />',
      '</FrameLayout>',
      '',
    ].join('\n'));
    epargne(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, layout, ...CANARIS),
      'Cible');
  });

  it('ne touche pas une classe construite en code', () => {
    const code = f(`${MAIN}/Builder.java`, [
      'package com.x;',
      '',
      'public class Builder {',
      '',
      '\tView make(Context context) {',
      '\t\treturn new Cible(context);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, code, ...CANARIS),
      'Cible');
  });

  it('ne touche pas une classe qu un autre fichier nomme comme type', () => {
    const usage = f(`${MAIN}/Holder.java`, [
      'package com.x;',
      '',
      'public class Holder {',
      '',
      '\tprivate Cible cible;',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, usage, ...CANARIS),
      'Cible');
  });

  /**
   * Un `inject(activity as Cible)` est un APPEL, il tient une instance. KJ-067
   * le sait deja, et le relachement de G9 ne doit pas defaire cette
   * distinction.
   */
  it('ne confond pas un appel a inject avec une declaration', () => {
    const appel = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'class Caller {',
      '    fun wire(component: AppComponent, view: Cible) {',
      '        component.inject(view)',
      '    }',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, appel, ...CANARIS),
      'Cible');
  });

  /**
   * Le pendant de la trouvaille `CustomClickableSpan` : un `inject(this)`
   * dans le corps ne CONSTRUIT rien, il consomme une declaration. Mais un
   * `inject(autreChose)` tient bien une instance de cette autre chose, et la
   * distinction ne doit pas se perdre.
   */
  it('ne compte pas inject(this) comme une construction de la classe', () => {
    const span = f(`${MAIN}/Cible.java`, [
      'package com.x;',
      '',
      'public class Cible extends ClickableSpan {',
      '',
      '\tvoid go(View widget) {',
      '\t\t((HasBaseComponent) widget.getContext()).getBaseComponent().inject(this);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const constructeur = f(`${MAIN}/Maker.java`, [
      'package com.x;',
      '',
      'public class Maker {',
      '',
      '\tObject make() {',
      '\t\treturn new Cible();',
      '\t}',
      '}',
      '',
    ].join('\n'));
    // Avec un vrai site de construction, la classe vit.
    epargne(symboles(span, constructeur, COMPOSANT, FAUX_COMPOSANT, ...CANARIS), 'Cible');
  });

  it('ne touche pas une classe que seul un test nomme', () => {
    const test = f('/w/app/src/test/java/com/x/CibleTest.kt', [
      'package com.x',
      '',
      'class CibleTest {',
      '    fun make(c: Context) = Cible(c)',
      '}',
      '',
    ].join('\n'));
    const t = trouve('Cible', cible('LinearLayout'), COMPOSANT, FAUX_COMPOSANT, test);
    expect(t?.verdict).not.toBe('unreferenced');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = {
      sources: [cible('LocalBase'), BASE_LOCALE, COMPOSANT, FAUX_COMPOSANT],
      testSourceSets: ['/src/test/'],
    };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
