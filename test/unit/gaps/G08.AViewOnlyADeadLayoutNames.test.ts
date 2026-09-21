import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G8 — une vue Android que seul un layout mort reference.
 *
 * Voir doc/gaps-detection.md. C est une cascade a cinq etages, dont
 * l extension ne tient que les deux premiers :
 *
 * 1 AnalyticsTimerPanelController couvert, KJ-067 depuis v1.42.345
 * 2 couvert, ronde suivante
 * 3 AnalyticsTimerPanelView NON couvert, la cascade s arrete
 * 4 AnalyticsTimerPanelListener NON couvert, voir G7a
 *   5  panelEnabledUpdated dans la vue         NON couvert
 *
 * Le controleur meurt parce que ses seules mentions sont
 * `AppMainActivityComponent` (`fun inject(target: …)`) et l override
 * du faux composant `EmptyAppMainActivityComponent`. Le layout meurt
 * ensuite, puisque son seul `inflate` etait `AnalyticsTimerPanelController`.
 * Et la, plus rien ne nomme la vue... sauf deux declarations d injection.
 *
 * ## Pourquoi la cascade s arrete
 *
 * Mesure faite avant d ecrire ces tests, ronde par ronde, sur la fixture
 * reduite ci dessous :
 *
 *   R1  tout present                    alive:main, 5 mentions
 *   R2  sans le controleur              alive:main, 5 mentions
 *   R3  sans le controleur ni le layout alive:main, 3 mentions
 *   R3b sans les injections non plus    unreferenced, 1 mention  (rapportee)
 *
 * A R3 il ne reste que la declaration et les deux `inject(target: …)`. Le
 * detecteur les compte comme des mentions vivantes alors que KJ-067 sait
 * precisement qu une declaration d injection ne tient aucune instance. Ce qui
 * le retient, c est sa garde des supertypes hors corpus : la vue etend
 * `LinearLayout`, qui vit dans un AAR. Cette garde a RAISON au premier tour,
 * puisque la balise XML instancie bel et bien la classe, et elle a tort une
 * fois le layout parti. C est l objet de G9, qui traite la garde ; ce fichier
 * ci traite la cascade.
 *
 * ## Note sur les etages 1 et 2
 *
 * Ils sont couverts et ne sont pas retestes ici. `findUnusedResources` est
 * bien appele dans `collecterUnePasse` (`RemoveEverythingUnused`) et
 * les fichiers morts sortent par `fichiersMorts`. La garde KJ-071 ne bloque
 * pas non plus : le layout declare `@+id/analytics` et `@+id/page`, qu aucun
 * `R.id` ne lit ailleurs.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const RES = '/w/app/src/main/res';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

/** Une vue morte de facon evidente : ni XML, ni injection, ni appelant. */
const CANARI = f(`${MAIN}/CanaryGoneView.java`, [
  'package com.x;',
  '',
  'public class CanaryGoneView extends LinearLayout {',
  '}',
  '',
].join('\n'));

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGoneView');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

// ── Fixtures, reduites du motif reel ────────────────────────────────────────

const VUE = f(`${MAIN}/AnalyticsTimerPanelView.java`, [
  'package com.x;',
  '',
  'public class AnalyticsTimerPanelView extends LinearLayout {',
  '',
  '\tprivate boolean enabled;',
  '',
  '\tvoid refresh() {',
  '\t\tthis.enabled = true;',
  '\t}',
  '}',
  '',
].join('\n'));

/** La balise racine porte le nom PLEINEMENT QUALIFIE de la vue. */
const LAYOUT = f(`${RES}/layout/widget_admin_analytics_timer_panel.xml`, [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<com.x.AnalyticsTimerPanelView',
  '    xmlns:android="http://schemas.android.com/apk/res/android"',
  '    android:id="@+id/analytics">',
  '</com.x.AnalyticsTimerPanelView>',
  '',
].join('\n'));

const COMPOSANT = f(`${MAIN}/AppMainActivityComponent.kt`, [
  'package com.x',
  '',
  'import dagger.Component',
  '',
  '@Component',
  'interface AppMainActivityComponent {',
  '    fun inject(target: AnalyticsTimerPanelView)',
  '}',
  '',
].join('\n'));

const FAUX_COMPOSANT = f(`${MAIN}/EmptyAppMainActivityComponent.kt`, [
  'package com.x',
  '',
  'class EmptyAppMainActivityComponent : AppMainActivityComponent {',
  '    override fun inject(target: AnalyticsTimerPanelView) {}',
  '}',
  '',
].join('\n'));

const CONTROLEUR = f(`${MAIN}/AnalyticsTimerPanelController.java`, [
  'package com.x;',
  '',
  'public class AnalyticsTimerPanelController {',
  '',
  '\tvoid show(ViewGroup parent) {',
  '\t\tLayoutInflater.from(parent.getContext())',
  '\t\t\t.inflate(R.layout.widget_admin_analytics_timer_panel, parent);',
  '\t}',
  '}',
  '',
].join('\n'));

/** Les rondes, telles que la boucle de point fixe les verrait. */
const R1 = [VUE, LAYOUT, COMPOSANT, FAUX_COMPOSANT, CONTROLEUR];
const R2 = [VUE, LAYOUT, COMPOSANT, FAUX_COMPOSANT];
const R3 = [VUE, COMPOSANT, FAUX_COMPOSANT];

describe.skipIf(!mod)('G8 — le corpus de test est lisible', () => {
  it('rapporte une vue que ni un layout ni une injection ne nomme', () => {
    expect(nomme(symboles(CANARI), 'CanaryGoneView')).toBe(true);
  });

  it('rapporte le controleur, premier etage de la cascade', () => {
    // C est ce que KJ-067 fait deja : ses seules mentions sont l injection
    // et l override du faux composant.
    const controleurSeul = f(`${MAIN}/Orphan.kt`, [
      'package com.x',
      '',
      'class OrphanController',
      '',
    ].join('\n'));
    expect(nomme(symboles(controleurSeul), 'OrphanController')).toBe(true);
  });

  /**
   * SENTINELLE. Elle fixe la progression mesuree des rondes. Le point qui
   * compte est la derniere ligne : a R3 il ne reste que la declaration et les
   * deux injections, et la vue est encore tenue pour vivante. Si ces chiffres
   * bougent, l entree G8 du document doit etre relue.
   */
  it('aujourd hui, la cascade s arrete a la troisieme ronde', () => {
    expect(pourquoi('AnalyticsTimerPanelView', ...R1))
      .toMatchObject({ outcome: 'alive:main', mainMentions: 5 });
    expect(pourquoi('AnalyticsTimerPanelView', ...R2))
      .toMatchObject({ outcome: 'alive:main', mainMentions: 5 });
    expect(pourquoi('AnalyticsTimerPanelView', ...R3))
      .toMatchObject({ outcome: 'alive:main', mainMentions: 3 });
    // Sans les injections, la meme vue tombe : le detecteur sait juger.
    expect(pourquoi('AnalyticsTimerPanelView', VUE))
      .toMatchObject({ outcome: 'unreferenced', mainMentions: 1 });
  });
});

describe.skipIf(!mod)('G8 — la vue qui perd son dernier lecteur', () => {
  it.fails('ronde trois : rapporte la vue que seules des injections nomment', () => {
    expect(nomme(symboles(...R3), 'AnalyticsTimerPanelView')).toBe(true);
  });

  it.fails('la rapporte meme quand le faux composant garde son override', () => {
    // Couper la ligne du composant sans l override du faux composant ne
    // compile pas : les deux partent ensemble, ou aucune. La vue doit donc
    // etre vue comme morte alors que les DEUX declarations existent encore.
    expect(nomme(symboles(VUE, COMPOSANT, FAUX_COMPOSANT), 'AnalyticsTimerPanelView'))
      .toBe(true);
  });

  it.fails('la rapporte quand seul le composant la nomme, sans faux composant', () => {
    expect(nomme(symboles(VUE, COMPOSANT), 'AnalyticsTimerPanelView')).toBe(true);
  });

  it.fails('etage quatre : l interface tombe avec la vue', () => {
    // Une fois la vue coupee, `AnalyticsTimerPanelListener` n a plus que sa
    // declaration. Voir G7a pour le mecanisme de la clause `implements`.
    const listener = f(`${MAIN}/AnalyticsTimerPanelListener.java`, [
      'package com.x;',
      '',
      'public interface AnalyticsTimerPanelListener {',
      '',
      '\tvoid panelEnabledUpdated(boolean isEnabled);',
      '}',
      '',
    ].join('\n'));
    const vueAvecClause = f(`${MAIN}/AnalyticsTimerPanelView.java`, [
      'package com.x;',
      '',
      'public class AnalyticsTimerPanelView extends LinearLayout implements AnalyticsTimerPanelListener {',
      '',
      '\t@Override',
      '\tpublic void panelEnabledUpdated(boolean isEnabled) {',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const noms = symboles(listener, vueAvecClause, COMPOSANT, FAUX_COMPOSANT)
      .map(s => s.name);
    expect(noms).toEqual(expect.arrayContaining([
      'AnalyticsTimerPanelView', 'AnalyticsTimerPanelListener',
    ]));
  });
});

describe.skipIf(!mod)('G8 — les gardes, qui passent des maintenant', () => {
  it('ne touche pas une vue qu un layout VIVANT nomme', () => {
    epargne(symboles(...R1, CANARI), 'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue que le layout nomme, meme sans inflate lisible', () => {
    // Le layout peut etre gonfle par un binding genere, par `setContentView`,
    // ou par une inclusion depuis un autre XML. Tant que le fichier est la,
    // la balise est un lecteur.
    epargne(symboles(VUE, LAYOUT, COMPOSANT, FAUX_COMPOSANT, CANARI),
      'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue qu un autre XML inclut', () => {
    const parent = f(`${RES}/layout/parent.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <com.x.AnalyticsTimerPanelView android:id="@+id/panel" />',
      '</FrameLayout>',
      '',
    ].join('\n'));
    epargne(symboles(VUE, parent, CANARI), 'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue construite en code', () => {
    const code = f(`${MAIN}/Builder.java`, [
      'package com.x;',
      '',
      'public class Builder {',
      '',
      '\tView make(Context context) {',
      '\t\treturn new AnalyticsTimerPanelView(context);',
      '\t}',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(VUE, code, COMPOSANT, FAUX_COMPOSANT, CANARI),
      'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue nommee par un style ou un theme', () => {
    const styles = f(`${RES}/values/styles.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<resources>',
      '    <style name="Panel" parent="com.x.AnalyticsTimerPanelView" />',
      '</resources>',
      '',
    ].join('\n'));
    epargne(symboles(VUE, styles, CANARI), 'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue nommee par le manifeste', () => {
    const manifeste = f('/w/app/src/main/AndroidManifest.xml', [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <application>',
      '        <meta-data android:name="panel" android:value="com.x.AnalyticsTimerPanelView" />',
      '    </application>',
      '</manifest>',
      '',
    ].join('\n'));
    epargne(symboles(VUE, manifeste, CANARI), 'AnalyticsTimerPanelView');
  });

  it('ne touche pas une vue que seul un test nomme', () => {
    const test = f('/w/app/src/test/java/com/x/PanelTest.kt', [
      'package com.x',
      '',
      'class PanelTest {',
      '    fun make(c: Context) = AnalyticsTimerPanelView(c)',
      '}',
      '',
    ].join('\n'));
    const trouve = symboles(VUE, test, CANARI)
      .find(s => s.name === 'AnalyticsTimerPanelView');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [CANARI], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
