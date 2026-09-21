import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G25 — la resolution des homonymes ne travaille que dans un sens.
 *
 * G24 a laisse une observation en passant : `duplicatesResolvedByPackage`
 * (KJ-064) resout la copie que la mention ne vise PAS, jamais celle qu elle
 * vise. Ce fichier instruit cette asymetrie, mesure ce qu elle coute, et
 * surtout delimite les trois pieges qui rendent la relache dangereuse.
 *
 * ## L asymetrie, mesuree
 *
 * Deux copies de `BLUR_RADIUS`, dans `com.a` et `com.b`, et un lecteur :
 *
 *   le lecteur importe com.b  ->  com.a sort `unreferenced`, elle est jugee
 *   le lecteur importe com.a  ->  com.a sort `F3:duplicate-name`
 *
 * Autrement dit : la resolution sait eliminer une copie, jamais en garder
 * une.
 *
 * ## Correction apportee par deux `it.fails()` qui ont passe
 *
 * J avais ecrit que la copie non importee n etait pas rapportee : faux, elle
 * l est deja, quel que soit le sens de l import, et une mention venue du meme
 * paquet resout deja elle aussi. La resolution existante fait donc TOUT le
 * travail de suppression.
 *
 * Ce qui reste est plus etroit, et c est le seul `it.fails()` de ce fichier :
 * la copie que la mention DESIGNE reste `F3:duplicate-name` au lieu de sortir
 * `alive:main`. Elle n est jamais jugee. Comme pour G24, le gain n est pas une
 * recolte, c est un angle mort en moins : le jour ou son dernier lecteur
 * disparait, elle reste F3 et personne ne le dit.
 *
 * ## Ce que la resolution a deux sens rapporterait, et pourquoi le chiffre
 * ## ne tient pas
 *
 * Regle simulee sur le corpus : pour chaque nom F3, chaque fichier qui le
 * mentionne est attribue a la copie qu il importe, ou a celle de son propre
 * paquet ; une copie sans aucune mention attribuee est morte.
 *
 *   748 declarations F3, 362 noms
 *   165 noms entierement resolus par import ou paquet
 *   197 abandonnes : 87 mentions non resolues, 76 hors code, 34 ambigues
 *    25 copies sans aucune mention attribuee
 *
 * Les deux premieres relues a la main sont des artefacts de la sonde, et la
 * troisieme est pire qu un artefact :
 *
 *   VersionRange      la sonde ignorait les mentions du PROPRE fichier de la
 * declaration (,
 *                     utilise lignes 25 et 32 du meme fichier)
 *   LocalDimensions   idem, quatre copies dont deux utilisees seulement chez
 * elles
 *   BaseActivity      TROIS copies dans debug, release et staging du meme
 *                     module et du meme paquet
 *
 * Le chiffre de 25 n est donc pas exploitable. Ce qui l est, ce sont les
 * pieges qu il a reveles, et ce fichier les fixe en gardes avant qu on ecrive
 * le correctif.
 *
 * ## Les trois pieges
 *
 * **1. Les jumeaux de variante.** `host/app/src/{debug,release,staging}/`
 * declarent chacun `com.example.host.core.BaseActivity`. Ce sont trois versions
 * d UNE classe, dont une seule est compilee a la fois, pas trois homonymes.
 * Une resolution qui attribue l unique `import ...BaseActivity` a une copie
 * laisserait les deux autres sans mention, et les declarerait mortes. Le
 * corpus en contient au moins deux familles, `BaseActivity` et
 * `ShortcutHelper`.
 *
 * **2. Les mentions du propre fichier.** Une declaration peut n etre utilisee
 * que chez elle. Ce n est pas la mort, c est `alive:same-file`, et cela rend
 * la declaration eligible a la famille des ilots, qui est le bon juge.
 *
 * **3. Les mentions hors code.** 76 des 362 noms sont nommes par un XML, un
 * fichier de regles ou un Gradle, ou il n y a ni import ni paquet. Aucune
 * attribution n y est possible, et le nom doit rester ecarte.
 *
 * ## Ce que ces tests demandent
 *
 * La resolution dans les deux sens, avec ces trois gardes. Le gain n est pas
 * un tas de trouvailles : c est, comme pour G24, de sortir des declarations de
 * l etat « jamais jugee ». Sur les 165 noms entierement resolus, chaque copie
 * recevrait enfin un verdict.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const APP = '/w/app';
const f = (path: string, text: string) => ({ path, text });

const verdict = (chemin: string, nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom && s.path.includes(chemin));

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(s => s.name);

const VIVANT = f(`${APP}/src/main/java/com/x/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── L asymetrie ─────────────────────────────────────────────────────────────

/** core/ui/.../delegate/TransformationImageDelegate.kt:25 */
const COPIE_A = f(`${APP}/src/main/java/com/a/Delegate.kt`, [
  'package com.a',
  '',
  'const val BLUR_RADIUS = 130',
  '',
].join('\n'));

/** host/feature-game/.../visual/GameVisualPhoto.kt:71, rendue publique. */
const COPIE_B = f(`${APP}/src/main/java/com/b/Visual.kt`, [
  'package com.b',
  '',
  'const val BLUR_RADIUS = 15',
  '',
].join('\n'));

const lecteurDe = (paquet: string) => f(`${APP}/src/main/java/com/c/Reader.kt`, [
  'package com.c',
  '',
  `import ${paquet}.BLUR_RADIUS`,
  '',
  'fun read() = BLUR_RADIUS',
  '',
].join('\n'));

describe.skipIf(!mod)('la resolution existante, et le sens qui manque', () => {
  /**
   * Le sens qui marche : la mention vise `com.b`, donc rien ne peut voir la
   * copie de `com.a`, et elle est rapportee. C est KJ-064.
   */
  it('quand la mention vise l autre paquet, la copie est jugee', () => {
    expect(verdict('/com/a/', 'BLUR_RADIUS', COPIE_A, COPIE_B, lecteurDe('com.b'), VIVANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * Le sens qui manque : la meme mention, vers `com.a` cette fois. La copie de
   * `com.b` n est vue par personne, exactement comme `com.a` au cas precedent,
   * et pourtant elle sort F3.
   */
  it('aujourd hui, quand la mention vise CETTE copie, tout reste F3', () => {
    expect(verdict('/com/a/', 'BLUR_RADIUS', COPIE_A, COPIE_B, lecteurDe('com.a'), VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Ecrit en `it.fails()`, il a passe du premier coup et corrige ce que je
   * croyais : la copie que personne n importe EST deja rapportee, quel que
   * soit le sens de l import. La resolution existante fait donc tout le
   * travail de SUPPRESSION.
   */
  it('la copie que personne n importe est deja rapportee', () => {
    expect(morts(COPIE_A, COPIE_B, lecteurDe('com.a'), VIVANT)).toContain('BLUR_RADIUS');
  });

  it.fails('et la copie importee devrait sortir vivante, pas ecartee', () => {
    expect(verdict('/com/a/', 'BLUR_RADIUS', COPIE_A, COPIE_B, lecteurDe('com.a'), VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Une mention depuis le MEME paquet vaut un import : le fichier voit la
   * copie de son paquet et aucune autre.
   */
  /**
   * Idem : une mention venue du meme paquet resout deja. Deux `it.fails()`
   * qui passent, et le trou se reduit d autant.
   */
  it('une mention du meme paquet resout deja comme un import', () => {
    const voisin = f(`${APP}/src/main/java/com/a/Neighbour.kt`, [
      'package com.a',
      '',
      'fun near() = BLUR_RADIUS',
      '',
    ].join('\n'));
    expect(verdict('/com/b/', 'BLUR_RADIUS', COPIE_A, COPIE_B, voisin, VIVANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });
});

// ── Piege 1 : les jumeaux de variante ───────────────────────────────────────

/**
 * host/app/src/{debug,release,staging}/
 * Trois versions d une classe, une seule compilee a la fois.
 */
const variante = (v: string, corps: string) => f(`${APP}/src/${v}/java/com/core/ShortcutHelper.kt`, [
  'package com.core',
  '',
  'class ShortcutHelper {',
  `    fun go() = ${corps}`,
  '}',
  '',
].join('\n'));

const JUMEAUX = [variante('debug', '1'), variante('release', '2'), variante('staging', '3')];

const DEMARREUR = f(`${APP}/src/main/java/com/app/Boot.kt`, [
  'package com.app',
  '',
  'import com.core.ShortcutHelper',
  '',
  'fun boot() = ShortcutHelper().go()',
  '',
].join('\n'));

describe.skipIf(!mod)('piege 1 : trois source sets ne font pas trois homonymes', () => {
  /**
   * Corrige par KJ-074 : trois source sets qui s excluent ne font pas trois
   * classes, et les trois jumeaux sont juges vivants. Ce que ce fichier
   * surveille ici, c est que la correction n a PAS pris le chemin d une
   * resolution par import, qui en aurait tue deux (garde ci dessous).
   */
  it('les trois jumeaux sont juges vivants, pas ecartes', () => {
    for (const v of ['debug', 'release', 'staging']) {
      expect(verdict(`/src/${v}/`, 'ShortcutHelper', ...JUMEAUX, DEMARREUR, VIVANT), v)
        .toMatchObject({ outcome: 'alive:main' });
    }
  });

  /**
   * La garde. Un seul `import` existe, donc une resolution par import en
   * attribuerait la mention a UNE copie et declarerait les deux autres
   * mortes. Les supprimer casse deux variantes de compilation sur trois.
   */
  it('aucun des trois ne doit jamais etre rapporte mort', () => {
    const noms = morts(...JUMEAUX, DEMARREUR, VIVANT);
    expect(noms).not.toContain('ShortcutHelper');
  });

  /**
   * Et le temoin qui rend la garde honnete : dans le meme appel, une
   * declaration morte est bel et bien rapportee. La garde n est donc pas vraie
   * par vacuite.
   */
  it('pendant que le detecteur rapporte bien le reste du corpus', () => {
    expect(morts(...JUMEAUX, DEMARREUR, VIVANT)).toContain('boot');
  });
});

// ── Piege 2 : les mentions du propre fichier ────────────────────────────────

/** app/.../edition/template/webScreen/Version.kt:27 */
const VERSION_A = f(`${APP}/src/main/java/com/a/Version.kt`, [
  'package com.a',
  '',
  'data class VersionRange(val min: Int, val max: Int)',
  '',
  'fun until(a: Int, b: Int) = VersionRange(a, b)',
  '',
].join('\n'));

/** host/feature-game/.../misc/Version.kt:29 */
const VERSION_B = f(`${APP}/src/main/java/com/b/Version.kt`, [
  'package com.b',
  '',
  'internal data class VersionRange(val min: Int, val max: Int)',
  '',
  'internal fun until(a: Int, b: Int) = VersionRange(a, b)',
  '',
].join('\n'));

const UTILISE_A = f(`${APP}/src/main/java/com/c/Uses.kt`, [
  'package com.c',
  '',
  'import com.a.until',
  '',
  'fun go() = until(1, 2)',
  '',
].join('\n'));

describe.skipIf(!mod)('piege 2 : une declaration utilisee chez elle n est pas morte', () => {
  it('aujourd hui, les deux VersionRange sortent en F3', () => {
    expect(verdict('/com/a/', 'VersionRange', VERSION_A, VERSION_B, UTILISE_A, VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
    expect(verdict('/com/b/', 'VersionRange', VERSION_A, VERSION_B, UTILISE_A, VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * La garde. Chaque `VersionRange` est construit par le `until` de son propre
   * fichier. Une resolution qui ne compte que les mentions VENUES D AILLEURS
   * les declarerait toutes deux mortes. C est l artefact qui a fait tomber le
   * chiffre de 25 a rien.
   */
  it('aucun des deux ne doit etre rapporte mort', () => {
    const noms = morts(VERSION_A, VERSION_B, UTILISE_A, VIVANT);
    expect(noms).not.toContain('VersionRange');
    expect(noms).toContain('go');
  });

  /**
   * La resolution existante fait deja son travail sur le `until` de `com.b`,
   * que personne n importe. Ce qui prouve que la difference de traitement
   * entre `until` et `VersionRange` ne tient pas au paquet mais a l endroit
   * d ou vient la mention.
   */
  it('alors que le until de com.b, lui, est deja rapporte', () => {
    expect(verdict('/com/b/', 'until', VERSION_A, VERSION_B, UTILISE_A, VIVANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });
});

// ── Piege 3 : les mentions hors code ────────────────────────────────────────

describe.skipIf(!mod)('piege 3 : une mention sans import ni paquet', () => {
  const LAYOUT = f(`${APP}/src/main/res/layout/panel.xml`, [
    '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <com.a.BlurView android:id="@+id/blur" />',
    '</LinearLayout>',
    '',
  ].join('\n'));
  const VUE_A = f(`${APP}/src/main/java/com/a/BlurView.kt`, [
    'package com.a',
    '',
    'class BlurView',
    '',
  ].join('\n'));
  const VUE_B = f(`${APP}/src/main/java/com/b/BlurView.kt`, [
    'package com.b',
    '',
    'class BlurView',
    '',
  ].join('\n'));

  /**
   * Le XML porte le nom pleinement qualifie, donc il SERAIT attribuable ; mais
   * 76 des 362 noms du corpus sont nommes par un fichier ou rien ne permet de
   * trancher, un `.pro` ou un `.gradle`. La garde porte sur ce cas la.
   */
  it('une regle de conservation ne permet d attribuer a personne', () => {
    const regles = f(`${APP}/proguard-rules.pro`, '-keepnames class * { BlurView; }\n');
    const noms = morts(VUE_A, VUE_B, regles, VIVANT);
    expect(noms).not.toContain('BlurView');
  });

  it('et un layout non plus ne doit rendre aucune des deux morte', () => {
    expect(morts(VUE_A, VUE_B, LAYOUT, VIVANT)).not.toContain('BlurView');
  });
});

// ── Gardes generales ────────────────────────────────────────────────────────

describe.skipIf(!mod)('ce que la relache ne doit pas emporter', () => {
  it('un import etoile ne designe pas une copie', () => {
    const etoile = f(`${APP}/src/main/java/com/c/Star.kt`, [
      'package com.c',
      '',
      'import com.a.*',
      'import com.b.*',
      '',
      'fun read() = BLUR_RADIUS',
      '',
    ].join('\n'));
    expect(morts(COPIE_A, COPIE_B, etoile, VIVANT)).not.toContain('BLUR_RADIUS');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = {
      sources: [COPIE_A, COPIE_B, lecteurDe('com.b'), VIVANT],
      testSourceSets: ['/src/test/'],
    };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
