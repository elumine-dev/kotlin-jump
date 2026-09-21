import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G20 — une vue personnalisee que plus aucun XML ne nomme.
 *
 * Quatrieme piste ouverte de `doc/gaps-detection.md`, instruite ici : « la
 * meme question pour les Fragments et les Activities, dont le supertype est
 * aussi hors corpus ». La reponse a deplace la question.
 *
 * ## Ce que la mesure a trouve, et ce qu elle a ecarte
 *
 * `explainSymbols` sur les 6273 sources du projet rend 7875 declarations, et
 * les range par filtre :
 *
 *   alive 4493 | F1 1627 | F3 748 | F5 438 | F7 290 | F8 93 | F12 74 | F6 56
 *   unreferenced 34 | testOnly 15
 *
 * Les 290 du filtre F7 sont ecartees pour leur SUPERTYPE de framework :
 * RecyclerView 106, Fragment 66, View 24, DialogFragment 19, ViewGroup 17,
 * les Activities 34, et le reste. Aucune ne peut devenir candidate, quelles
 * que soient ses mentions.
 *
 * Deux questions de la piste tombent tout de suite :
 *
 *   57 composants declares dans les 54 manifestes -> 0 que rien d autre ne nomme
 *   29 classes qui prolongent un Fragment         -> 0 que rien d autre ne nomme
 *
 * Le manifeste n est meme pas la raison : une `Activity` posee seule, sans
 * manifeste, sort deja en `F7:Activity`. Le filtre precede tout comptage.
 *
 * ## Ou le trou se trouve reellement
 *
 * En restreignant les 290 a celles qu aucun code ne construit et qu aucun XML
 * ne nomme, il reste QUATRE classes. Relues a la main, une est un faux
 * positif de la sonde (`GalleryLayoutItemViewHolder`, nommee comme type de
 * retour par une `@AssistedFactory`, ce que la sonde cherchait comme un appel).
 * Les trois autres tiennent :
 *
 *
 * Les deux premieres ont la meme forme : une vue personnalisee avec ses trois
 * constructeurs `(Context)`, `(Context, AttributeSet)` et
 * `(Context, AttributeSet, int)`, et rien d autre au monde qui les nomme. La
 * troisieme appartient a une bibliotheque recopiee dans le projet, dont les
 * quatre fichiers se tiennent mutuellement en vie.
 *
 * ## Pourquoi F7 a raison en general et tort ici
 *
 * Une classe qui prolonge `View` a deux voies d instanciation, et deux
 * seulement : `new X(...)` dans du code, ou une balise XML portant son nom
 * pleinement qualifie, que `LayoutInflater` lit par reflexion. C est cette
 * seconde voie, invisible a toute analyse de code, qui justifie F7.
 *
 * Quand le corpus ne contient NI l une NI l autre, l argument tombe : il ne
 * reste aucune convention invisible a craindre. C est exactement le
 * raisonnement que G9 propose pour la garde de KJ-067, applique un cran plus
 * haut, au filtre qui empeche la declaration d etre candidate.
 *
 * ## La nuance qui separe G20 de G8 et de G9
 *
 * G8 : la vue est nommee par un layout, et c est le LAYOUT qui est mort.
 * G9  : la garde de KJ-067 ne se relache pas apres que le layout soit parti.
 * G20 : aucun layout ne l a jamais nommee, dans l etat vierge du corpus.
 *
 * Les trois se suivent, et seul G20 se voit sans rien supprimer d abord.
 *
 * ## Ce que ces tests demandent
 *
 * Relacher F7 pour les seuls supertypes de VUE (`View`, `ViewGroup` et leurs
 * descendants), et seulement quand le corpus ne porte ni balise XML du nom, ni
 * site de construction. Pas pour les Fragments, les Activities ni les Workers,
 * dont le contrat d instanciation passe par un nom de classe que le corpus ne
 * contient pas forcement.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const APP = '/w/app';
const f = (path: string, text: string) => ({ path, text });

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[]).map(s => s.name);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[]).find(s => s.name === nom);

/**
 * Le canari : une classe ordinaire que rien ne nomme. Le detecteur la rapporte
 * aujourd hui. Sans elle, « il n a pas rapporte la vue » serait vrai aussi
 * d un appel qui ne rapporte rien, et chaque garde serait vacue.
 */
const CANARI = f(`${APP}/src/main/java/com/x/CanaryGone.java`, [
  'package com.x;',
  '',
  'public class CanaryGone {',
  '}',
  '',
].join('\n'));

const VIVANT = f(`${APP}/src/main/java/com/x/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');

const epargne = (noms: string[], cible: string) => {
  expect(noms).toContain('CanaryGone');
  expect(noms).not.toContain(cible);
};

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/**
 * Trois constructeurs, un effet construit dans chacun, et aucune mention
 * ailleurs dans le corpus. La forme canonique du trou.
 */
const VUE_MORTE = f(`${APP}/src/main/java/com/x/OverlayView.java`, [
  'package com.x;',
  '',
  'import android.view.View;',
  '',
  'public class OverlayView extends View {',
  '',
  '\tprivate final OverlayEffect overlayEffect;',
  '',
  '\tpublic OverlayView(Context context) {',
  '\t\tsuper(context);',
  '\t\toverlayEffect = new OverlayEffect(this);',
  '\t}',
  '',
  '\tpublic OverlayView(Context context, AttributeSet attrs) {',
  '\t\tsuper(context, attrs);',
  '\t\toverlayEffect = new OverlayEffect(this, attrs);',
  '\t}',
  '',
  '\tpublic OverlayView(Context context, AttributeSet attrs, int defStyle) {',
  '\t\tsuper(context, attrs, defStyle);',
  '\t\toverlayEffect = new OverlayEffect(this, attrs, defStyle);',
  '\t}',
  '}',
  '',
].join('\n'));

/** app/common/.../common/view/FormArrowView.java:13, meme forme en Kotlin. */
const VUE_MORTE_KT = f(`${APP}/src/main/java/com/x/FormArrowView.kt`, [
  'package com.x',
  '',
  'import android.view.View',
  '',
  'class FormArrowView @JvmOverloads constructor(',
  '    context: Context,',
  '    attrs: AttributeSet? = null,',
  ') : View(context, attrs) {',
  '',
  '    fun pointUp() = Unit',
  '}',
  '',
].join('\n'));

/** Le layout qui nomme la vue par son nom pleinement qualifie. */
const LAYOUT = f(`${APP}/src/main/res/layout/panel.xml`, [
  '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <com.x.OverlayView android:id="@+id/overlay" />',
  '</LinearLayout>',
  '',
].join('\n'));

/** Un site de construction ordinaire. */
const CONSTRUCTEUR = f(`${APP}/src/main/java/com/x/Panel.java`, [
  'package com.x;',
  '',
  'public class Panel {',
  '',
  '\tvoid add(Context context) {',
  '\t\taddView(new OverlayView(context));',
  '\t}',
  '}',
  '',
].join('\n'));

/**
 * Un Fragment, dont le contrat d instanciation est different : le
 * `FragmentManager` le reconstruit apres une rotation a partir de son nom de
 * classe conserve dans le `Bundle`, que le corpus ne contient nulle part.
 */
const FRAGMENT = f(`${APP}/src/main/java/com/x/LoginContainerFragment.kt`, [
  'package com.x',
  '',
  'import androidx.fragment.app.Fragment',
  '',
  'class LoginContainerFragment : Fragment() {',
  '',
  '    fun show() = Unit',
  '}',
  '',
].join('\n'));

/** Une Activity, nommee par un manifeste. */
const ACTIVITE = f(`${APP}/src/main/java/com/x/OrphanActivity.kt`, [
  'package com.x',
  '',
  'import android.app.Activity',
  '',
  'class OrphanActivity : Activity()',
  '',
].join('\n'));

const MANIFESTE = f(`${APP}/src/main/AndroidManifest.xml`, [
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <application>',
  '        <activity android:name=".OrphanActivity" />',
  '    </application>',
  '</manifest>',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!mod)('le detecteur juge bien ce corpus', () => {
  it('rapporte la classe ordinaire que rien ne nomme', () => {
    expect(morts(VUE_MORTE, CANARI, VIVANT)).toContain('CanaryGone');
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!mod)('une vue que plus aucun XML ne nomme est rapportee', () => {
  it('la vue Java a trois constructeurs, seule dans le corpus', () => {
    expect(morts(VUE_MORTE, CANARI, VIVANT)).toContain('OverlayView');
  });

  it('la meme forme en Kotlin, avec @JvmOverloads', () => {
    expect(morts(VUE_MORTE_KT, CANARI, VIVANT)).toContain('FormArrowView');
  });

  it('les deux a la fois, sans que l une protege l autre', () => {
    const noms = morts(VUE_MORTE, VUE_MORTE_KT, CANARI, VIVANT);
    expect(noms).toContain('OverlayView');
    expect(noms).toContain('FormArrowView');
  });

  /**
   * Le troisieme cas reel : une bibliotheque recopiee dont les fichiers se
   * tiennent mutuellement en vie. F7 les ecarte un par un, donc la famille des
   * ilots ne les voit jamais arriver, alors que c est precisement sa forme.
   */
  it('une paire recopiee qui ne se tient en vie qu elle meme', () => {
    const adaptateur = f(`${APP}/src/main/java/com/x/StickyRecyclerHeadersAdapter.java`, [
      'package com.x;',
      '',
      'public class StickyRecyclerHeadersAdapter extends RecyclerView.Adapter {',
      '',
      '\tpublic long getHeaderId(int position) { return position; }',
      '}',
      '',
    ].join('\n'));
    const decoration = f(`${APP}/src/main/java/com/x/StickyRecyclerHeadersDecoration.java`, [
      'package com.x;',
      '',
      'public class StickyRecyclerHeadersDecoration extends RecyclerView.ItemDecoration {',
      '',
      '\tpublic StickyRecyclerHeadersDecoration(StickyRecyclerHeadersAdapter adapter) {',
      '\t\tthis.adapter = adapter;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const noms = morts(adaptateur, decoration, CANARI, VIVANT);
    expect(noms).toContain('StickyRecyclerHeadersDecoration');
  });
});

// ── F7 ne precede plus le comptage, pour les vues ──────────────────────────

describe.skipIf(!mod)('F7 ne s applique plus aux vues', () => {
  it('la vue seule est jugee, et jugee morte', () => {
    expect(pourquoi('OverlayView', VUE_MORTE, CANARI, VIVANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * Et le verdict DEPEND desormais des mentions, ce qui est toute la
   * difference entre un filtre et une garde : la balise de layout sauve la
   * vue, son absence la condamne.
   */
  it('le layout change le verdict, la ou le filtre l ignorait', () => {
    const sans = pourquoi('OverlayView', VUE_MORTE, CANARI, VIVANT);
    const avec = pourquoi('OverlayView', VUE_MORTE, LAYOUT, CANARI, VIVANT);
    expect(sans.outcome).toBe('unreferenced');
    expect(avec.outcome).toBe('alive:main');
    expect(avec.mainMentions).toBeGreaterThan(sans.mainMentions);
  });

  /**
   * La reponse a la piste ouverte, fixee par ecrit : le manifeste n est pas la
   * raison pour laquelle une Activity survit. Elle survit sans lui.
   */
  it('une Activity sans manifeste est deja ecartee, F7 precede le comptage', () => {
    expect(pourquoi('OrphanActivity', ACTIVITE, CANARI, VIVANT)).toMatchObject({ outcome: 'F7:Activity' });
  });

  it('et le manifeste ne fait qu ajouter une mention de plus', () => {
    const sans = pourquoi('OrphanActivity', ACTIVITE, CANARI, VIVANT);
    const avec = pourquoi('OrphanActivity', ACTIVITE, MANIFESTE, CANARI, VIVANT);
    expect(avec.mainMentions).toBe(sans.mainMentions + 1);
  });
});

// ── Gardes : ce qui ne doit PAS etre rapporte ───────────────────────────────

describe.skipIf(!mod)('ce que la relache ne doit pas emporter', () => {
  it('une vue nommee par une balise de layout', () => {
    epargne(morts(VUE_MORTE, LAYOUT, CANARI, VIVANT), 'OverlayView');
  });

  it('une vue construite quelque part dans le code', () => {
    epargne(morts(VUE_MORTE, CONSTRUCTEUR, CANARI, VIVANT), 'OverlayView');
  });

  /**
   * La garde qui delimite le trou. Un Fragment se reconstruit a partir d un
   * nom de classe range dans un `Bundle` a la rotation, et ce nom n est ecrit
   * nulle part dans le corpus. L argument « aucune balise, aucun appel, donc
   * mort » ne vaut pas pour lui.
   */
  it('un Fragment, dont le contrat d instanciation est ailleurs', () => {
    epargne(morts(FRAGMENT, CANARI, VIVANT), 'LoginContainerFragment');
  });

  it('une Activity, meme sans manifeste dans le corpus', () => {
    epargne(morts(ACTIVITE, CANARI, VIVANT), 'OrphanActivity');
  });

  /**
   * Une regle de conservation nomme la classe pleinement qualifiee : le
   * retrecisseur la garde, donc quelque chose la connait encore.
   */
  it('une vue nommee par une regle de conservation', () => {
    const regles = f(`${APP}/proguard-rules.pro`, [
      '-keep class com.x.OverlayView {',
      '   public *;',
      '}',
      '',
    ].join('\n'));
    epargne(morts(VUE_MORTE, regles, CANARI, VIVANT), 'OverlayView');
  });

  /**
   * Un style peut nommer une vue sans balise, par `android:parent` ou par un
   * attribut personnalise declare dans `attrs.xml`.
   */
  it('une vue nommee par un fichier de styles', () => {
    const styles = f(`${APP}/src/main/res/values/styles.xml`, [
      '<resources>',
      '    <declare-styleable name="OverlayView">',
      '        <attr name="overlayColor" format="color" />',
      '    </declare-styleable>',
      '</resources>',
      '',
    ].join('\n'));
    epargne(morts(VUE_MORTE, styles, CANARI, VIVANT), 'OverlayView');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [VUE_MORTE, CANARI, VIVANT], testSourceSets: ['/src/test/'] };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
