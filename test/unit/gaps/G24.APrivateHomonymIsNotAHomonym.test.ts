import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G24 — un homonyme prive n est pas un homonyme.
 *
 * Instruit la plus grosse poche non examinee du detecteur. Les 7875
 * declarations du corpus de reference se rangent ainsi :
 *
 *   alive 4493 | F1 1627 | F3 748 | F5 438 | F7 290 | F8 93 | F12 74
 *   F6 56 | unreferenced 34 | testOnly 15
 *
 * F1 et F3 sont les deux plus grosses, et aucune n avait ete regardee.
 *
 * ## F1, verifie : pas un trou
 *
 * F1 ecarte les declarations `private` de premier niveau, 1627 sur le corpus.
 * Elles ne sont pas perdues, elles sont deleguees : `sweepFile` les rapporte,
 * mesure faite sur un fichier a quatre declarations dont deux mortes. Rien a
 * signaler.
 *
 * ## F3, en revanche
 *
 * F3 ecarte une declaration dont le NOM SIMPLE est porte par plusieurs
 * declarations de premier niveau : le sac de jetons ne sait pas a laquelle
 * une mention se rapporte. 748 declarations, 362 noms distincts.
 *
 * Deux echappatoires existent deja : `unmentionedDuplicates` (aucune mention
 * nulle part, donc toutes les copies sont mortes) et `duplicatesResolvedByPackage`
 * (KJ-064, la mention vise un autre paquet). Il reste 748.
 *
 * Parmi ces 362 noms, **39 n ont qu une seule copie VISIBLE**, toutes les
 * autres etant `private`. Exemples reels :
 *
 * BLUR_RADIUS public
 * private
 * private
 *
 * CloseButton sealed class
 *                 + six `private fun CloseButton(...)` composables ailleurs
 *
 * ## Pourquoi c est une erreur
 *
 * Un `private` de premier niveau en Kotlin est visible dans SON FICHIER et
 * nulle part ailleurs. Aucune mention venue d un autre fichier ne peut le
 * designer. Il ne cree donc aucune ambiguite pour le sac de jetons, et le
 * compter dans `topLevelNameCounts` (unusedSymbols.ts:1515) aveugle la seule
 * copie que le corpus peut vraiment nommer.
 *
 * Six composables prives appeles `CloseButton`, chacun dans son fichier,
 * n empechent personne de savoir de quoi parle `import ...login.CloseButton`.
 *
 * ## Ce que ca rapporte, honnetement
 *
 * Zero trouvaille aujourd hui. Simulation faite : renommer les homonymes
 * prives dans leurs propres fichiers et relancer le detecteur ne fait passer
 * AUCUNE des 39 en `unreferenced`. Elles sont toutes vivantes.
 *
 * Ce que ca change quand meme, et pourquoi le trou vaut d etre ecrit : ces 39
 * declarations sont aujourd hui **jamais jugees**. Le jour ou la derniere
 * utilisation de `BLUR_RADIUS` disparaitra, elle restera F3 et personne ne le
 * dira. Corriger enleve 39 angles morts permanents, pas 39 lignes de code. Et
 * l une d elles, `TOP_BAR_HEIGHT`, passe a `alive:same-file`, ce qui la rend
 * eligible a la famille des ilots.
 *
 * ## La frontiere, mesuree
 *
 *   public + homonyme prive    -> F3 aujourd hui, devrait etre juge
 *   public + homonyme internal -> F3, et c est JUSTE, internal voit le module
 *   public + homonyme public   -> F3, et c est juste
 *   java public + package-private -> F3, et c est juste, le paquet le voit
 *
 * Trois gardes, une relache. C est la forme habituelle d une garde trop large.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const sweep: any = await importOrNull('src/providers/DeadCodeSweep');

const APP = '/w/app';
const f = (path: string, text: string) => ({ path, text });

const verdict = (chemin: string, nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .find(s => s.name === nom && s.path.endsWith(chemin));

const morts = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[]).map(s => s.name);

const VIVANT = f(`${APP}/src/main/java/com/x/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** core/ui/.../delegate/TransformationImageDelegate.kt:25 — la copie publique. */
const PUBLIQUE = f(`${APP}/src/main/java/com/a/TransformationImageDelegate.kt`, [
  'package com.a',
  '',
  'const val BLUR_RADIUS = 130',
  '',
].join('\n'));

/** core/uikit/.../thematic/ThematicPodcastVisual.kt:8 — une copie privee. */
const PRIVEE = f(`${APP}/src/main/java/com/b/ThematicPodcastVisual.kt`, [
  'package com.b',
  '',
  'private const val BLUR_RADIUS = 130',
  '',
  'fun visual() = BLUR_RADIUS',
  '',
].join('\n'));

/** host/feature-game/.../visual/GameVisualPhoto.kt:71 — la seconde. */
const PRIVEE_2 = f(`${APP}/src/main/java/com/d/GameVisualPhoto.kt`, [
  'package com.d',
  '',
  'private const val BLUR_RADIUS = 15',
  '',
  'fun photo() = BLUR_RADIUS',
  '',
].join('\n'));

/** Le fichier qui nomme la copie publique, et sait laquelle par son import. */
const LECTEUR = f(`${APP}/src/main/java/com/c/Reader.kt`, [
  'package com.c',
  '',
  'import com.a.BLUR_RADIUS',
  '',
  'fun read() = BLUR_RADIUS',
  '',
].join('\n'));

/** Une copie `internal` : visible dans tout le module, donc un vrai homonyme. */
const INTERNE = f(`${APP}/src/main/java/com/b/Internal.kt`, [
  'package com.b',
  '',
  'internal const val BLUR_RADIUS = 15',
  '',
].join('\n'));

/** Une seconde copie publique : ambiguite reelle. */
const PUBLIQUE_2 = f(`${APP}/src/main/java/com/b/Other.kt`, [
  'package com.b',
  '',
  'const val BLUR_RADIUS = 15',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!mod)('le detecteur juge bien ce corpus', () => {
  it('sans homonyme, la copie publique est jugee vivante', () => {
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Et la resolution par paquet marche DEJA dans l autre sens : quand la
   * mention vise l autre paquet, la copie publique sort `unreferenced`. Le
   * trou n est donc pas que la resolution manque, c est qu elle ne couvre pas
   * le cas ou la mention vise la copie SURVIVANTE.
   */
  it('quand la mention vise l autre paquet, la publique est deja rapportee', () => {
    const versB = f(`${APP}/src/main/java/com/c/Reader.kt`, [
      'package com.c',
      '',
      'import com.b.BLUR_RADIUS',
      '',
      'fun read() = BLUR_RADIUS',
      '',
    ].join('\n'));
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, versB, VIVANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!mod)('un prive n aveugle plus la copie publique', () => {
  /**
   * CORRIGÉ. F3 lit désormais `visibleNameCounts`, qui ne compte pas les
   * `private` de premier niveau en Kotlin : ils sont visibles dans leur
   * fichier et nulle part ailleurs, donc ils ne peuvent pas être ce qu'une
   * mention d'un autre fichier désigne. `topLevelNameCounts` reste la carte de
   * membership du corpus, que la marche des supertypes lit.
   */
  it('la publique reste jugee quand un prive apparait ailleurs', () => {
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  it('et le prive, lui, sort en F1, donc personne ne le juge non plus', () => {
    expect(verdict('ThematicPodcastVisual.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'F1:private' });
  });

  it('deux prives font le meme effet qu un seul, c est a dire aucun', () => {
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, PRIVEE_2, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });
});

describe.skipIf(!sweep)('F1 n est pas un trou : le balayage prend le relais', () => {
  /**
   * Verification faite avant d accuser F1. Les 1627 declarations privees sont
   * deleguees, pas perdues.
   */
  it('sweepFile rapporte les declarations privees mortes', () => {
    const texte = [
      'package com.x',
      '',
      'private fun deadHelper() = 1',
      '',
      'private const val DEAD_CONST = 2',
      '',
      'private fun usedHelper() = 3',
      '',
      'fun publicOne() = usedHelper()',
      '',
    ].join('\n');
    const noms = (sweep.sweepFile(texte, 'kotlin') as any[]).map((x: any) => x.name);
    expect(noms).toContain('deadHelper');
    expect(noms).toContain('DEAD_CONST');
    expect(noms).not.toContain('usedHelper');
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!mod)('un prive de premier niveau ne devrait pas compter comme homonyme', () => {
  it('la copie publique reste jugee malgre un prive ailleurs', () => {
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Celui la passe DEJA, et l avoir ecrit en `it.fails()` l a fait savoir tout
   * de suite : sans aucun lecteur, `unmentionedDuplicates` s applique et la
   * copie publique est rapportee. L echappatoire existante couvre donc le cas
   * ou PERSONNE ne nomme le nom. Le trou ne porte que sur le cas ou quelqu un
   * le nomme, et ou l import dit lequel.
   */
  it('sans aucun lecteur, l echappatoire existante la rapporte deja', () => {
    expect(morts(PUBLIQUE, PRIVEE, PRIVEE_2, VIVANT)).toContain('BLUR_RADIUS');
  });

  it('avec un lecteur qui l importe, elle reste jugeable', () => {
    const autre = { path: '/w/app/src/main/java/com/c/Other.kt', text: 'package com.c\n\nfun other() = 1\n' };
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PRIVEE, PRIVEE_2, LECTEUR, autre, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });

  /**
   * Le cas `CloseButton` du corpus : une classe scellee publique et six
   * composables prives du meme nom, chacun dans son fichier. Six fichiers
   * qui ne se voient pas ne creent aucune ambiguite.
   */
  it('six composables prives du meme nom n aveuglent pas la classe scellee', () => {
    const scellee = f(`${APP}/src/main/java/com/a/CloseButton.kt`, [
      'package com.a',
      '',
      'sealed class CloseButton {',
      '',
      '    object Cross : CloseButton()',
      '}',
      '',
    ].join('\n'));
    const composables = [1, 2, 3, 4, 5, 6].map(i => f(`${APP}/src/main/java/com/e${i}/Screen${i}.kt`, [
      `package com.e${i}`,
      '',
      'private fun CloseButton() = Unit',
      '',
      `fun screen${i}() = CloseButton()`,
      '',
    ].join('\n')));
    const lecteur = f(`${APP}/src/main/java/com/c/Uses.kt`, [
      'package com.c',
      '',
      'import com.a.CloseButton',
      '',
      'fun pick(): CloseButton? = null',
      '',
    ].join('\n'));
    expect(verdict('a/CloseButton.kt', 'CloseButton', scellee, ...composables, lecteur, VIVANT))
      .toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Gardes : les homonymes qui en sont vraiment ─────────────────────────────

describe.skipIf(!mod)('ce que la relache ne doit pas emporter', () => {
  // Le témoin ne peut plus être le cas privé, qui est corrigé. C'est
  // maintenant le cas public : deux copies visibles restent un homonyme.
  const temoin = () => expect(
    verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PUBLIQUE_2, LECTEUR, VIVANT),
  ).toMatchObject({ outcome: 'F3:duplicate-name' });

  /**
   * `internal` est visible dans tout le module de compilation. Une mention
   * venue d un autre fichier du meme module peut viser l une ou l autre : l
   * ambiguite est reelle et la garde doit tenir.
   */
  it('un homonyme internal reste un homonyme', () => {
    temoin();
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, INTERNE, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  it('un homonyme public aussi, evidemment', () => {
    expect(verdict('TransformationImageDelegate.kt', 'BLUR_RADIUS', PUBLIQUE, PUBLIQUE_2, LECTEUR, VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Et le piege : `private` ne veut pas dire la meme chose des deux cotes. En
   * Java, une classe sans modificateur est visible dans tout son PAQUET, donc
   * un autre fichier peut la nommer. La relache ne doit porter que sur le
   * `private` de premier niveau de Kotlin, qui est de portee FICHIER.
   */
  it('une classe Java sans modificateur reste un homonyme', () => {
    const publique = f(`${APP}/src/main/java/com/a/BlurHelper.java`, [
      'package com.a;',
      '',
      'public class BlurHelper {',
      '}',
      '',
    ].join('\n'));
    const paquet = f(`${APP}/src/main/java/com/b/BlurHelper.java`, [
      'package com.b;',
      '',
      'class BlurHelper {',
      '}',
      '',
    ].join('\n'));
    const usage = f(`${APP}/src/main/java/com/c/Use.java`, [
      'package com.c;',
      '',
      'import com.a.BlurHelper;',
      '',
      'public class Use {',
      '\tBlurHelper h;',
      '}',
      '',
    ].join('\n'));
    expect(verdict('a/BlurHelper.java', 'BlurHelper', publique, paquet, usage, VIVANT))
      .toMatchObject({ outcome: 'F3:duplicate-name' });
  });

  /**
   * Un prive du MEME fichier que la copie publique le voit, lui. Rien ne
   * change de ce cote, mais la garde le fixe pour que la relache ne soit pas
   * ecrite « tout prive s ignore ».
   */
  it('un prive du meme fichier ne rend pas la publique morte', () => {
    const ensemble = f(`${APP}/src/main/java/com/a/Both.kt`, [
      'package com.a',
      '',
      'const val BLUR_RADIUS = 130',
      '',
      'private fun helper() = BLUR_RADIUS',
      '',
    ].join('\n'));
    expect(morts(ensemble, LECTEUR, VIVANT)).not.toContain('BLUR_RADIUS');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [PUBLIQUE, PRIVEE, PRIVEE_2, VIVANT], testSourceSets: ['/src/test/'] };
    expect((mod.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
