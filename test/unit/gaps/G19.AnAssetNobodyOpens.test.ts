import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G19 — un fichier d `assets/` que rien n ouvre.
 *
 * Troisieme piste ouverte de `doc/gaps-detection.md`, instruite ici. La
 * famille des ressources connait `res/`, et seulement `res/`. Le dossier
 * `assets/` est le second endroit ou un projet Android range des fichiers ;
 * personne ne le regarde.
 *
 * ## Pourquoi il est structurellement invisible
 *
 * `FileResourceIndex` reconnait un chemin par une expression qui exige le
 * segment `res/` suivi d une sorte connue (FileResourceIndex). Un
 * chemin sous `assets/` ne correspond a rien, `parseResourcePath` rend
 * `undefined`, et le fichier n entre jamais dans l index. Il n y a donc pas
 * de garde a relacher ni de sorte a ajouter : la representation manque.
 *
 * ## Mesure sur le corpus de reference
 *
 * 123 fichiers sous les `src/main/assets/` du projet. Une premiere sonde,
 * qui cherchait leur nom dans le CODE seulement, en a annonce 83 jamais
 * nommes. C etait faux, et de beaucoup : un asset en nomme souvent un autre.
 * nomme les 60 polices `.otf` du meme dossier.
 *
 * En comptant les assets eux memes comme des citants, il en reste HUIT que
 * rien ne nomme. Et sur ces huit, trois seulement sont decidables :
 *
 * 23,9 Ko
 * 9,2 Ko
 *   un dossier d animations d une nouveaute
 *       lottie_newFeatureNavigator.json
 *
 * Les cinq autres sont indecidables, et c est la nuance qui fait la valeur de
 * ce trou : voir les gardes.
 *
 * ## Ce qui rend les deux premiers decidables : leurs freres
 *
 * `DynamicAdAnimationHelper-51` est un `when` qui nomme DOUZE des
 * treize fichiers de `lottie/dynamicAd/`, en litteral complet :
 *
 * DOUBLE_BIGBOX.adSize -> ""
 * else -> ""
 *
 * `300x600_data.json` est le treizieme, et aucun litteral ne le nomme. Le
 * dossier prouve lui meme son mode d acces : douze freres cites en toutes
 * lettres, donc l acces n est pas construit, donc le treizieme est mort. Un
 * quasi homonyme laisse derriere une renommage, vraisemblablement.
 *
 * Meme forme pour l onboarding, par une autre voie : quatre layouts portent
 * `app:lottie_fileName="lottie/onboarding/<nom>.json"`
 * ( et ses
 * trois soeurs), et `login_finished.json` n y figure pas.
 *
 * ## Ce qui rend les cinq autres indecidables
 *
 * Deux chemins du corpus sont CONSTRUITS, et tout ce qu ils atteignent
 * echappe a toute analyse statique :
 *
 * FontServiceImpl Typeface.createFromAsset(a, "fonts/" + value + ".otf")
 * CrosswordsParser am.open("devAssets/" + path)
 *
 * Les soixante polices et le sudoku sont donc hors de portee. La famille des
 * ressources connait deja cette idee, elle l applique a `res/` sous le nom de
 * `dynamicallyLookedUpKinds` (UnusedResourceProvider): une recherche
 * dynamique eteint les sortes qu elle peut atteindre. Le trou n est pas de
 * ne pas savoir se taire, c est de ne pas savoir regarder.
 *
 * ## Ce que ces tests demandent
 *
 * Une sorte `asset`, dont la racine est le dossier `assets/` d un module, et
 * dont le nom est le chemin RELATIF a cette racine, parce que c est ce que
 * `AssetManager.open` prend. Avec la meme extinction dynamique que pour
 * `res/` : un `open(` dont l argument n est pas un litteral eteint le
 * REPERTOIRE qu il atteint, pas seulement le fichier.
 */

const res: any = await importOrNull('src/providers/UnusedResourceProvider');
const index: any = await importOrNull('src/indexer/FileResourceIndex');

const APP = '/w/app';
const MAIN = `${APP}/src/main`;
const f = (path: string, text: string) => ({ path, text });

const entree = (kind: string, name: string, path: string) => ({
  kind, name, variants: [{ path, moduleDir: APP }],
});

/**
 * Les assets voyagent dans leur PROPRE canal, jamais dans `sources`.
 *
 * Mesure faite sur le vrai projet : verses dans `sources`, leur texte passe
 * dans la recolte generale et garde en vie toute declaration dont le nom y
 * figure par hasard. Une extension `observe` cessait d etre rapportee parce
 * qu un JSON de bouchon contenait le mot. Le tri se fait donc ici, comme le
 * corpus de l extension le fait.
 */
const scan = (fichiers: { path: string; text: string }[], entries: any[], extra: any = {}) => {
  const estAsset = (p: string) => /[\\/]src[\\/]main[\\/]assets[\\/]/.test(p);
  return (res.findUnusedResources({
    sources: fichiers.filter(f => !estAsset(f.path)),
    assets: fichiers.filter(f => estAsset(f.path)),
    entries, modulesWithCode: [APP], libraryModules: [], ...extra,
  }) as any[]).map(r => r.name);
};

/**
 * Le canari : une ressource `res/raw/` que rien ne nomme. La famille la
 * rapporte aujourd hui, donc sa presence prouve que l appel JUGE le corpus.
 * Sans elle, « il n a pas rapporte l asset » serait vrai aussi d un appel qui
 * ne rapporte rien du tout, et chaque garde serait vacue.
 */
const CANARI = f(`${MAIN}/res/raw/canary_gone.json`, '{}\n');
const CANARI_ENTREE = entree('raw', 'canary_gone', CANARI.path);

const epargne = (noms: string[], cible: string) => {
  expect(noms).toContain('canary_gone');
  expect(noms).not.toContain(cible);
};

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/**
 * Le `when` complet nomme douze fichiers ; deux suffisent a montrer la forme.
 */
const AIDE_PUB = f(`${MAIN}/java/com/x/DynamicAdAnimationHelper.kt`, [
  'package com.x',
  '',
  'class DynamicAdAnimationHelper {',
  '    companion object {',
  '        fun animationFor(taille: String) = when (taille) {',
  '            DOUBLE_BIGBOX.adSize -> "lottie/dynamicAd/300x600_DBIGBOX_data.json"',
  '            BANNER.adSize -> "lottie/dynamicAd/980x70_BANNER_data.json"',
  '            else -> "lottie/dynamicAd/FULLSCREEN_data.json"',
  '        }',
  '    }',
  '}',
  '',
].join('\n'));

const PUB_CITEE = f(`${MAIN}/assets/lottie/dynamicAd/300x600_DBIGBOX_data.json`, '{"v":"5.5.7"}\n');
const PUB_MORTE = f(`${MAIN}/assets/lottie/dynamicAd/300x600_data.json`, '{"v":"5.5.7"}\n');

/**
 * L attribut de la bibliotheque Lottie nomme l asset depuis un layout.
 */
const LAYOUT_ONBOARDING = f(`${MAIN}/res/layout/onboarding_5_section_fragment.xml`, [
  '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '    xmlns:app="http://schemas.android.com/apk/res-auto">',
  '    <com.airbnb.lottie.LottieAnimationView',
  '        app:lottie_fileName="lottie/onboarding/section.json" />',
  '</FrameLayout>',
  '',
].join('\n'));

const ONBOARDING_CITEE = f(`${MAIN}/assets/lottie/onboarding/section.json`, '{"v":"5.5.7"}\n');
const ONBOARDING_MORTE = f(`${MAIN}/assets/lottie/onboarding/login_finished.json`, '{"v":"5.5.7"}\n');

/** app/.../common/service/impl/FontServiceImpl.java:32 */
const SERVICE_POLICE = f(`${MAIN}/java/com/x/FontServiceImpl.java`, [
  'package com.x;',
  '',
  'public class FontServiceImpl {',
  '\tTypeface build(String value) {',
  '\t\treturn Typeface.createFromAsset(context.getAssets(), "fonts/" + value + ".otf");',
  '\t}',
  '}',
  '',
].join('\n'));

const POLICE = f(`${MAIN}/assets/fonts/RobotoSerif-SemiBold.otf`, 'OTTO\n');

/** app/gridgame/.../crosswords/DO/CrosswordsParser.java:46 */
const ANALYSEUR = f(`${MAIN}/java/com/x/CrosswordsParser.java`, [
  'package com.x;',
  '',
  'public class CrosswordsParser {',
  '\tvoid load(String path) throws Exception {',
  '\t\tInputStream is = am.open("devAssets/" + path);',
  '\t}',
  '}',
  '',
].join('\n'));

const SUDOKU = f(`${MAIN}/assets/devAssets/sudoku/sudoku.xml`, '<puzzle />\n');

/** assets/css/fonts.css nomme les polices : un asset en cite un autre. */
const CSS = f(`${MAIN}/assets/css/fonts.css`, [
  '@font-face {',
  '  font-family: "Calluna";',
  '  src: url("../fonts/Calluna-Regular.otf");',
  '}',
  '',
].join('\n'));

const POLICE_CITEE_PAR_CSS = f(`${MAIN}/assets/fonts/Calluna-Regular.otf`, 'OTTO\n');

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!res)('un asset que rien n ouvre est rapporte', () => {
  it('l anim morte du dossier des pubs, dont douze freres sont cites', () => {
    const noms = scan([AIDE_PUB, PUB_CITEE, PUB_MORTE, CANARI], [CANARI_ENTREE]);
    expect(noms).toContain('lottie/dynamicAd/300x600_data.json');
  });

  it('l anim morte de l onboarding, dont les freres sont cites par un layout', () => {
    const noms = scan([LAYOUT_ONBOARDING, ONBOARDING_CITEE, ONBOARDING_MORTE, CANARI], [CANARI_ENTREE]);
    expect(noms).toContain('lottie/onboarding/login_finished.json');
  });

  /**
   * Le nom demande est le chemin RELATIF a la racine `assets/`, pas le nom de
   * base : c est ce que `AssetManager.open` prend, et deux modules peuvent
   * ranger un `feed.json` chacun. Le corpus en compte quatre.
   */
  it('sous son chemin relatif a la racine des assets, pas sous son nom', () => {
    const noms = scan([AIDE_PUB, PUB_CITEE, PUB_MORTE, CANARI], [CANARI_ENTREE]);
    expect(noms).not.toContain('300x600_data.json');
    expect(noms).toContain('lottie/dynamicAd/300x600_data.json');
  });

  it('un asset qu aucun frere ne cite, et que rien ne nomme nulle part', () => {
    const seul = f(`${MAIN}/assets/lottie/newFeature/navigator/lottie_newFeatureNavigator.json`, '{}\n');
    const noms = scan([seul, AIDE_PUB, CANARI], [CANARI_ENTREE]);
    expect(noms).toContain('lottie/newFeature/navigator/lottie_newFeatureNavigator.json');
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!index)('aujourd hui, un asset n a pas de representation', () => {
  /**
   * La preuve structurelle. L index exige `res/<sorte>/` ; un chemin d asset
   * n y entre pas, quelle que soit son extension, et l expression reconnait
   * pourtant `.json` pour `res/raw/`.
   */
  it('parseResourcePath refuse un chemin d asset', () => {
    expect(index.parseResourcePath(`${MAIN}/assets/lottie/onboarding/section.json`)).toBeUndefined();
    expect(index.parseResourcePath(`${MAIN}/assets/fonts/Calluna-Regular.otf`)).toBeUndefined();
  });

  it('et accepte le meme fichier range sous res/raw', () => {
    const vu = index.parseResourcePath(`${MAIN}/res/raw/section.json`);
    expect(vu).toMatchObject({ kind: 'raw', name: 'section' });
  });
});

describe.skipIf(!res)('la famille des ressources connait desormais assets/', () => {
  /**
   * Elle juge bien le corpus, le canari le prouve, et ne dit rien des deux
   * assets pourtant presents dans les memes sources.
   */
  it('rapporte le canari de res/ ET les assets morts', () => {
    const noms = scan([AIDE_PUB, PUB_CITEE, PUB_MORTE, CANARI], [CANARI_ENTREE]);
    expect(noms).toContain('canary_gone');
    expect(noms).toContain('lottie/dynamicAd/300x600_data.json');
  });
});

// ── Gardes : ce qui ne doit PAS etre rapporte ───────────────────────────────

describe.skipIf(!res)('les assets qu il ne faudra pas toucher', () => {
  it('un frere cite en toutes lettres par le code', () => {
    const noms = scan([AIDE_PUB, PUB_CITEE, PUB_MORTE, CANARI], [CANARI_ENTREE]);
    epargne(noms, 'lottie/dynamicAd/300x600_DBIGBOX_data.json');
  });

  it('un asset cite par un attribut de layout', () => {
    const noms = scan([LAYOUT_ONBOARDING, ONBOARDING_CITEE, ONBOARDING_MORTE, CANARI], [CANARI_ENTREE]);
    epargne(noms, 'lottie/onboarding/section.json');
  });

  /**
   * La garde qui compte le plus, et celle qui a fait tomber la premiere
   * mesure de 83 a 8 : un chemin construit eteint tout son repertoire. Soixante
   * polices en dependent.
   */
  it('une police, que seul un chemin construit atteint', () => {
    const noms = scan([SERVICE_POLICE, POLICE, CANARI], [CANARI_ENTREE]);
    epargne(noms, 'fonts/RobotoSerif-SemiBold.otf');
  });

  it('un fichier sous un repertoire ouvert par concatenation', () => {
    const noms = scan([ANALYSEUR, SUDOKU, CANARI], [CANARI_ENTREE]);
    epargne(noms, 'devAssets/sudoku/sudoku.xml');
  });

  /**
   * Un asset peut n etre nomme que par un autre asset. Le CSS embarque dans
   * `assets/` nomme les polices du dossier voisin, en chemin relatif au CSS
   * et non a la racine.
   */
  it('une police nommee seulement par un CSS lui meme dans assets/', () => {
    const noms = scan([CSS, POLICE_CITEE_PAR_CSS, CANARI], [CANARI_ENTREE]);
    epargne(noms, 'fonts/Calluna-Regular.otf');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    expect(scan([AIDE_PUB, PUB_MORTE, CANARI], [CANARI_ENTREE])).toContain('canary_gone');
    expect(scan([AIDE_PUB, PUB_MORTE, CANARI], [CANARI_ENTREE], { truncated: true })).toEqual([]);
  });
});
