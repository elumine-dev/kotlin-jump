import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G16 — un symbole cache par l homonyme d une bibliotheque.
 *
 * Voir doc/gaps-detection.md. C est G15 applique aux SYMBOLES au lieu des
 * entrees d enum, et le mecanisme y est encore plus net.
 *
 * ## Mesure honnete : zero trouvaille manquee sur le corpus aujourd hui
 *
 * Le corpus declare quatre classes dont le nom collide avec un type de
 * bibliotheque courant : `Event`, `Options` et `Size` (deux fois). Aucune
 * n est morte, donc aucune trouvaille n est perdue AUJOURD HUI.
 *
 * Mais la configuration a risque est bien la. Le nom simple `Size` est amene
 * par QUATRE imports differents dans le corpus :
 *
 *   android.util.Size
 *   androidx.compose.ui.geometry.Size
 *   coil.size.Size
 *   com.example.app.common.utils.Size   <- celui du projet
 *
 * Sur 99 mentions du nom, le detecteur ne sait pas lesquelles appartiennent a
 * la classe du projet, et les compte toutes. Celle ci est vivante, importee
 * par 14 fichiers ; le jour ou ces 14 imports disparaitraient, elle resterait
 * masquee par les 85 autres mentions.
 *
 * ## Le mecanisme, mesure en isolant
 *
 * Une classe `Result` du projet, seule dans son corpus, puis le meme corpus
 * avec un usage de `kotlin.Result` :
 *
 *   classe Result seule                    -> unreferenced, main = 1   rapportee
 *   + un Result<String> de kotlin.Result   -> alive:main,   main = 2   perdue
 *   + kotlin.Result pleinement qualifie    -> alive:main,   main = 3   perdue
 *   + import kotlin.Result explicite       -> alive:main,   main = 3   perdue
 *
 * Les deux dernieres lignes sont les plus nettes : le corpus dit SANS
 * AMBIGUITE qu il s agit d un autre type, en le qualifiant entierement ou en
 * l important nommement, et la mention compte quand meme.
 *
 * ## Ce que les tests demandent
 *
 * Un fichier qui importe `kotlin.Result` declare que son `Result` n est pas
 * celui du projet : ses mentions du nom simple devraient sortir du compte.
 * De meme, `kotlin.Result` ecrit en entier nomme son paquet ; il n y a rien a
 * deviner. C est le meme contrat que G15, un etage plus haut.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .map(x => x.name);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom);

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Une classe du projet dont le nom collide avec `kotlin.Result`. */
const CLASSE = f(`${MAIN}/Result.kt`, [
  'package com.x',
  '',
  'class Result(val ok: Boolean)',
  '',
].join('\n'));

/** Le canari : une classe morte dont le nom ne collide avec rien. */
const CANARI = f(`${MAIN}/CanaryGone.kt`, [
  'package com.x',
  '',
  'class CanaryGone',
  '',
].join('\n'));

const epargne = (trouves: string[], cible: string) => {
  expect(trouves).toContain('CanaryGone');
  expect(trouves).not.toContain(cible);
};

describe.skipIf(!mod)('G16 — le corpus de test est lisible', () => {
  it('rapporte une classe morte dont le nom ne collide avec rien', () => {
    expect(symboles(CANARI)).toContain('CanaryGone');
  });

  it('rapporte la classe Result quand rien ne la masque', () => {
    expect(symboles(CLASSE, CANARI)).toContain('Result');
  });

  /**
   * SENTINELLE. Elle fixe les trois formes mesurees, de la plus ambigue a la
   * moins : un usage nu, une qualification complete, un import nomme. Les
   * trois masquent aujourd hui. Si l une se met a echouer, la resolution
   * s est etendue et l entree G16 du document doit etre relue avec G15.
   */
  it('aujourd hui, trois formes d homonyme masquent la classe', () => {
    const nu = f(`${MAIN}/Api.kt`, [
      'package com.x', '', 'fun fetch(): Result<String> = runCatching { "x" }', '',
    ].join('\n'));
    const qualifie = f(`${MAIN}/Api2.kt`, [
      'package com.x', '', 'fun wrap(): kotlin.Result<String> = kotlin.Result.success("x")', '',
    ].join('\n'));
    const importe = f(`${MAIN}/Api3.kt`, [
      'package com.x', '', 'import kotlin.Result', '', 'fun wrap() = Result.success("x")', '',
    ].join('\n'));

    expect(pourquoi('Result', CLASSE, CANARI))
      .toMatchObject({ outcome: 'unreferenced', mainMentions: 1 });
    for (const forme of [nu, qualifie, importe]) {
      expect(pourquoi('Result', CLASSE, CANARI, forme)?.outcome).toBe('alive:main');
    }
  });
});

describe.skipIf(!mod)('G16 — le symbole que la collision fait disparaitre', () => {
  it.fails('rapporte Result malgre un import explicite de kotlin.Result', () => {
    // La forme la moins ambigue : le fichier DECLARE d ou vient son `Result`.
    const importe = f(`${MAIN}/Api3.kt`, [
      'package com.x',
      '',
      'import kotlin.Result',
      '',
      'fun wrap() = Result.success("x")',
      '',
    ].join('\n'));
    expect(symboles(CLASSE, CANARI, importe)).toContain('Result');
  });

  it.fails('rapporte Result malgre une qualification complete', () => {
    const qualifie = f(`${MAIN}/Api2.kt`, [
      'package com.x',
      '',
      'fun wrap(): kotlin.Result<String> = kotlin.Result.success("x")',
      '',
    ].join('\n'));
    expect(symboles(CLASSE, CANARI, qualifie)).toContain('Result');
  });

  it.fails('rapporte une classe masquee par QUATRE homonymes importes', () => {
    // La configuration reelle du nom `Size` sur le corpus de reference.
    const taille = f(`${MAIN}/Size.kt`, [
      'package com.x',
      '',
      'class Size {',
      '    var width: Int = 0',
      '}',
      '',
    ].join('\n'));
    const ailleurs = ['android.util', 'androidx.compose.ui.geometry', 'coil.size']
      .map((paquet, i) => f(`${MAIN}/User${i}.kt`, [
        'package com.x',
        '',
        `import ${paquet}.Size`,
        '',
        `fun use${i}(s: Size) = s`,
        '',
      ].join('\n')));
    expect(symboles(taille, CANARI, ...ailleurs)).toContain('Size');
  });

  it.fails('rapporte une fonction de haut niveau masquee de la meme facon', () => {
    // Le trou ne concerne pas que les classes.
    const fonction = f(`${MAIN}/Ext.kt`, [
      'package com.x',
      '',
      'fun runCatching(): Int = 1',
      '',
    ].join('\n'));
    const usage = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go() = kotlin.runCatching { 1 }',
      '',
    ].join('\n'));
    expect(symboles(fonction, CANARI, usage)).toContain('runCatching');
  });
});

describe.skipIf(!mod)('G16 — les gardes, qui passent des maintenant', () => {
  /**
   * Ces gardes tiennent aujourd hui et doivent tenir apres. Resserrer la
   * resolution ne doit pas faire disparaitre une mention legitime : ce serait
   * couper une classe vivante, l erreur la plus couteuse de tout ce dossier.
   */

  it('ne touche pas une classe utilisee sans qualification, meme nom simple', () => {
    const usage = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go(r: Result) = r.ok',
      '',
    ].join('\n'));
    epargne(symboles(CLASSE, CANARI, usage), 'Result');
  });

  it('ne touche pas une classe qu un autre paquet importe NOMMEMENT', () => {
    // `import com.x.Result` designe bien celle du projet.
    const usage = f('/w/app/src/main/java/com/y/Caller.kt', [
      'package com.y',
      '',
      'import com.x.Result',
      '',
      'fun go(r: Result) = r.ok',
      '',
    ].join('\n'));
    epargne(symboles(CLASSE, CANARI, usage), 'Result');
  });

  it('ne touche pas une classe qualifiee par SON propre paquet', () => {
    const usage = f(`${MAIN}/Caller.kt`, [
      'package com.x',
      '',
      'fun go(r: com.x.Result) = r.ok',
      '',
    ].join('\n'));
    epargne(symboles(CLASSE, CANARI, usage), 'Result');
  });

  it('ne touche pas une classe dont seul un test se sert', () => {
    const test = f('/w/app/src/test/java/com/x/ResultTest.kt', [
      'package com.x',
      '',
      'class ResultTest {',
      '    fun check(r: Result) = r.ok',
      '}',
      '',
    ].join('\n'));
    const trouve = (mod.findUnusedSymbols({
      sources: [CLASSE, CANARI, test], testSourceSets: ['/src/test/'],
    }) as any[]).find(s => s.name === 'Result');
    expect(trouve?.verdict).not.toBe('unreferenced');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(mod.findUnusedSymbols({
      sources: [CLASSE, CANARI], testSourceSets: ['/src/test/'], truncated: true,
    })).toHaveLength(0);
  });
});
