import { describe, it, expect, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { importOrNull } from '../kj/harness';
import { buildSymbolRemovalEdit } from '../../../src/providers/UnusedSymbolProvider';

/**
 * G62 — un Fragment que seul le composant Dagger nomme.
 *
 * Trouve par une revue humaine d une PR du projet de reference, que Kotlin
 * Jump n avait pas vu. `AdVideoMedia3Fragment` a une fabrique `newInstance`
 * que personne n appelle, et ses seules mentions hors de son fichier sont :
 *
 *   MainActivityComponent       import + fun inject(target: AdVideoMedia3Fragment)
 *   EmptyMainActivityComponent  import + override fun inject(target: …) {}
 *
 * Exactement le motif de KJ-067. Deux gardes empilees le retenaient, chacune
 * suffisante :
 *
 *   1. F7 ecartait tout ce qui prolonge `Fragment` avant le moindre comptage ;
 *   2. passe F7, KJ-067 exigeait que toute la chaine de supertypes soit
 *      declaree dans le workspace, et `androidx.fragment.app.Fragment` vit
 *      dans un AAR.
 *
 * ## L argument de G20, et pourquoi il ne tient pas
 *
 * G20, G28 et G29 gardaient les Fragments sous F7 : « un Fragment se
 * reconstruit apres une rotation a partir de son nom range dans un Bundle,
 * que le corpus ne contient pas forcement ». Le nom range dans le Bundle,
 * c est le `FragmentManager` qui l ecrit, a partir d une instance VIVANTE
 * qu il a deja ajoutee. Cette instance est nee d une des voies suivantes, et
 * chacune ecrit le nom dans le corpus :
 *
 *   - `X()` ou `X.newInstance(...)` dans du code ;
 *   - un graphe de navigation ou un layout (`android:name="com.x.X"`) ;
 *   - un nom en chaine (`FragmentFactory.instantiate`, `Class.forName`) ;
 *   - une regle de conservation.
 *
 * Mesure sur ce detecteur avant d ecrire : une classe ordinaire nommee par
 * chacune de ces voies sort `alive:main`. La restauration ne cree donc aucune
 * voie nouvelle, elle rejoue une voie que le corpus a deja lue. Reste un nom
 * construit a l execution, risque qui vaut pour n importe quelle classe et
 * que F7 ne couvrait pas mieux pour un Fragment que pour un autre type.
 *
 * C est le raisonnement de KJ-080 pour les vues, un cran plus loin.
 *
 * ## Ce que ces tests demandent
 *
 * La famille Fragment rejoint les vues : F7 ne l ecarte plus, et la garde de
 * chaine de KJ-067 accepte de s arreter sur elle comme sur `Any`. Les
 * Activities, Services, Workers et le reste ne bougent pas : leur
 * instanciation passe par le manifeste ou par un ordonnanceur.
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

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** `AdVideoMedia3Fragment.kt`, reduit a ce qui compte. */
const fragment = (supertype = 'Fragment()') => f(`${MAIN}/AdVideoMedia3Fragment.kt`, [
  'package com.x',
  '',
  'import androidx.fragment.app.Fragment',
  'import javax.inject.Inject',
  '',
  `class AdVideoMedia3Fragment : ${supertype}, BackableFragment {`,
  '',
  '    @Inject lateinit var viewModel: AdVideoMedia3ViewModel',
  '',
  '    override fun onAttach(context: Context) {',
  '        super.onAttach(context)',
  '        Graph.ui(context).inject(this)',
  '    }',
  '',
  '    companion object {',
  '        fun newInstance(url: String) = AdVideoMedia3Fragment().apply {',
  '            arguments = Bundle().apply { putString("EXTRA_URL", url) }',
  '        }',
  '    }',
  '}',
  '',
].join('\n'));

/** L interface du corpus que le fragment implemente aussi. */
const BACKABLE = f(`${MAIN}/BackableFragment.kt`, [
  'package com.x',
  '',
  'interface BackableFragment {',
  '    fun onBackPressed(): Boolean = false',
  '}',
  '',
].join('\n'));

const COMPOSANT = f(`${MAIN}/MainActivityComponent.kt`, [
  'package com.x',
  '',
  'import com.x.AdVideoMedia3Fragment',
  'import dagger.Subcomponent',
  '',
  '@Subcomponent',
  'interface MainActivityComponent {',
  '    fun inject(target: AdVideoMedia3Fragment)',
  '}',
  '',
].join('\n'));

const FAUX_COMPOSANT = f(`${MAIN}/EmptyMainActivityComponent.kt`, [
  'package com.x',
  '',
  'import com.x.AdVideoMedia3Fragment',
  '',
  'class EmptyMainActivityComponent : MainActivityComponent {',
  '    override fun inject(target: AdVideoMedia3Fragment) {}',
  '}',
  '',
].join('\n'));

/** Le canari : une classe ordinaire que rien ne nomme, jugee des aujourd hui. */
const CANARI = f(`${MAIN}/CanaryGone.kt`, 'package com.x\n\nclass CanaryGone\n');

const MOTIF = [BACKABLE, COMPOSANT, FAUX_COMPOSANT, CANARI];

/** Exige que le detecteur JUGE le corpus, et qu il epargne la cible. */
const epargne = (trouves: any[], nom: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryGone');
  expect(trouves.map(s => s.name)).not.toContain(nom);
};

describe.skipIf(!mod)('G62 — un Fragment que seul le composant Dagger nomme', () => {
  it('le rapporte, par injection, avec ses deux sites', () => {
    const t = trouve('AdVideoMedia3Fragment', fragment(), ...MOTIF);
    expect(t).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
    expect(t.injectionSites).toHaveLength(2);
  });

  it('et pour un DialogFragment de la meme facon', () => {
    const t = trouve('AdVideoMedia3Fragment', fragment('DialogFragment()'), ...MOTIF);
    expect(t).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('F7 ne l ecarte plus : le verdict vient du comptage', () => {
    expect(pourquoi('AdVideoMedia3Fragment', fragment(), ...MOTIF))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  /** Un Fragment que rien du tout ne nomme, pas meme Dagger. */
  it('rapporte un Fragment que rien ne nomme', () => {
    const seul = f(`${MAIN}/LoginContainerFragment.kt`, [
      'package com.x',
      '',
      'import androidx.fragment.app.Fragment',
      '',
      'class LoginContainerFragment : Fragment()',
      '',
    ].join('\n'));
    expect(trouve('LoginContainerFragment', seul, CANARI)).toMatchObject({ verdict: 'unreferenced' });
  });

  it('suit une base locale qui prolonge Fragment', () => {
    const base = f(`${MAIN}/BaseScreen.kt`, [
      'package com.x',
      '',
      'import androidx.fragment.app.Fragment',
      '',
      'abstract class BaseScreen : Fragment()',
      '',
    ].join('\n'));
    const vivante = f(`${MAIN}/Live.kt`, 'package com.x\n\nclass Live : BaseScreen()\n\nfun start() = Live()\n');
    const t = trouve('AdVideoMedia3Fragment', fragment('BaseScreen()'), base, vivante, ...MOTIF);
    expect(t).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });
});

describe.skipIf(!mod)('G62 — ce qui le garde en vie', () => {
  it('un appel a sa fabrique', () => {
    const appel = f(`${MAIN}/Host.kt`, 'package com.x\n\nfun show() = AdVideoMedia3Fragment.newInstance("u")\n');
    epargne(symboles(fragment(), appel, ...MOTIF), 'AdVideoMedia3Fragment');
  });

  it('un graphe de navigation qui le nomme', () => {
    const nav = f(`${RES}/navigation/nav_main.xml`, [
      '<navigation xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <fragment android:id="@+id/video" android:name="com.x.AdVideoMedia3Fragment" />',
      '</navigation>',
      '',
    ].join('\n'));
    epargne(symboles(fragment(), nav, ...MOTIF), 'AdVideoMedia3Fragment');
  });

  it('un FragmentContainerView qui le nomme', () => {
    const layout = f(`${RES}/layout/activity_video.xml`, [
      '<androidx.fragment.app.FragmentContainerView',
      '    xmlns:android="http://schemas.android.com/apk/res/android"',
      '    android:name="com.x.AdVideoMedia3Fragment" />',
      '',
    ].join('\n'));
    epargne(symboles(fragment(), layout, ...MOTIF), 'AdVideoMedia3Fragment');
  });

  it('un nom en chaine, comme FragmentFactory le lit', () => {
    const fabrique = f(`${MAIN}/Factory.kt`, [
      'package com.x',
      '',
      'fun make(f: FragmentFactory, cl: ClassLoader) =',
      '    f.instantiate(cl, "com.x.AdVideoMedia3Fragment")',
      '',
    ].join('\n'));
    epargne(symboles(fragment(), fabrique, ...MOTIF), 'AdVideoMedia3Fragment');
  });

  it('une base hors corpus qui n est pas un Fragment connu', () => {
    // `BaseVideoFragment` vit dans un AAR : la chaine ne s arrete sur rien de
    // connu, la convention qui l instancie reste invisible.
    epargne(symboles(fragment('BaseVideoFragment()'), ...MOTIF), 'AdVideoMedia3Fragment');
  });

  it('une Activity ne bouge pas : F7 la tient toujours', () => {
    const activite = f(`${MAIN}/OrphanActivity.kt`, [
      'package com.x',
      '',
      'import android.app.Activity',
      '',
      'class OrphanActivity : Activity()',
      '',
    ].join('\n'));
    epargne(symboles(activite, CANARI), 'OrphanActivity');
    expect(pourquoi('OrphanActivity', activite, CANARI)).toMatchObject({ outcome: 'F7:Activity' });
  });
});

/**
 * Le quick fix de l editeur. Remove All coupait deja les sites d injection
 * (KJ-067), mais `buildSymbolRemovalEdit`, derriere l ampoule et Find Unused
 * Symbols, ne retirait que la classe et ses imports : les deux
 * `inject(target: AdVideoMedia3Fragment)` restaient, et le projet ne
 * compilait plus. G62 rend le cas courant, puisque presque tout Fragment du
 * projet de reference est injecte par membres.
 */
describe.skipIf(!mod)('G62 — le quick fix emporte les sites d injection', () => {
  const ouvrir = (s: { path: string; text: string }) => {
    const lignes = s.text.split('\n');
    return {
      uri: vscodeMock.Uri.file(s.path),
      getText: () => s.text,
      isDirty: false,
      positionAt: (offset: number) => {
        let reste = offset;
        for (let l = 0; l < lignes.length; l++) {
          if (reste <= lignes[l].length) return new vscodeMock.Position(l, reste);
          reste -= lignes[l].length + 1;
        }
        return new vscodeMock.Position(lignes.length - 1, 0);
      },
    } as any;
  };
  const avant = vscodeMock.workspace.textDocuments;
  afterEach(() => { vscodeMock.workspace.textDocuments = avant; });

  /** Le texte de chaque fichier apres l edition, ou null s il est supprime. */
  const appliquer = async (sources: { path: string; text: string }[], f: any) => {
    vscodeMock.workspace.textDocuments = sources.map(ouvrir);
    const edit: any = (await buildSymbolRemovalEdit([f], undefined, false)).edit;
    const supprimes = new Set(edit._fileDeletes.map((d: any) => d.uri.fsPath));
    const out = new Map<string, string | null>();
    for (const s of sources) {
      if (supprimes.has(s.path)) { out.set(s.path, null); continue; }
      const debuts = [0];
      for (let i = 0; i < s.text.length; i++) if (s.text[i] === '\n') debuts.push(i + 1);
      const off = (p: any) => debuts[p.line] + p.character;
      const plages = edit._entries
        .filter((e: any) => e.uri.fsPath === s.path)
        .map((e: any) => ({ start: off(e.range.start), end: off(e.range.end), text: e.newText ?? '' }))
        .sort((a: any, b: any) => b.start - a.start);
      let t = s.text;
      for (const r of plages) t = t.slice(0, r.start) + r.text + t.slice(r.end);
      out.set(s.path, t);
    }
    return out;
  };

  it('supprime le fichier, les deux inject et leurs imports', async () => {
    const sources = [fragment(), ...MOTIF];
    const f = trouve('AdVideoMedia3Fragment', ...sources);
    const apres = await appliquer(sources, f);
    expect(apres.get(fragment().path)).toBeNull();
    for (const c of [COMPOSANT, FAUX_COMPOSANT]) {
      expect(apres.get(c.path)).not.toContain('AdVideoMedia3Fragment');
    }
    expect(apres.get(COMPOSANT.path)).toContain('interface MainActivityComponent {');
    expect(apres.get(FAUX_COMPOSANT.path)).toContain('class EmptyMainActivityComponent');
  });

  it('ne touche pas un site qui a bouge depuis le scan, ni la classe', async () => {
    const sources = [fragment(), ...MOTIF];
    const f = trouve('AdVideoMedia3Fragment', ...sources);
    // Le faux composant a change depuis : une ligne de plus avant le site.
    const bouge = { ...FAUX_COMPOSANT, text: FAUX_COMPOSANT.text.replace('class Empty', '// x\nclass Empty') };
    const apres = await appliquer([fragment(), BACKABLE, COMPOSANT, bouge, CANARI], f);
    // Toutes ou aucune : couper un site sans l autre ne compile pas.
    expect(apres.get(fragment().path)).not.toBeNull();
    expect(apres.get(COMPOSANT.path)).toContain('fun inject(target: AdVideoMedia3Fragment)');
    expect(apres.get(bouge.path)).toContain('override fun inject(target: AdVideoMedia3Fragment) {}');
  });
});
