import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G22 — une annotation de portee sert d ancre a ses voisins.
 *
 * G21 a montre qu une declaration ecartee par le filtre des supertypes (F7)
 * continue de NOMMER ses voisins, et les tient en vie aux yeux de la famille
 * des ilots. Ce fichier montre que le mecanisme ne tient pas au filtre : il
 * se reproduit a l identique avec F5, le filtre des ANNOTATIONS.
 *
 * ## Comment ce second cas a ete trouve
 *
 * En cherchant la bonne maille. L union-find sur les 7875 declarations ne
 * donne rien, les noms communs relient tout le corpus en une composante. Le
 * DOSSIER, lui, marche : pour chacun des 1098 dossiers portant au moins une
 * declaration, aucun de ses noms n est-il cite du dehors ?
 *
 *   1098 dossiers examines
 *     42 dont aucun nom n est cite du dehors
 *     40 sous un `src/debug/`, et ce sont des `@Preview` Compose
 *      2 sous `src/main`, et ce sont les deux seuls vrais
 *
 * Les 40 de debug sont correctement epargnes : `@Preview` sort en
 * `F5:@Preview`. Un test ci dessous le fixe, parce que c est la garde la plus
 * exposee de ce trou.
 *
 * Les deux vrais sont G21 et celui ci.
 *
 * ## Le cas reel
 *
 *   un dossier d aides a la numerotation de pages
 *
 * PageNumberCache @ScopeActivity, package-private
 * PageNumberHelper @ScopeActivity, package-private
 * PageNumberUtils final class, un seul champ statique
 *
 * Verifie un par un : aucun des trois noms n apparait hors du dossier. Ce que
 * l extension en dit :
 *
 *   PageNumberCache  -> F5:@ScopeActivity  (8 mentions)
 *   PageNumberHelper -> F5:@ScopeActivity  (2 mentions)
 *   PageNumberUtils  -> alive:main        (13 mentions)
 *   findUnusedSymbols -> rien
 *   findDeadIslands   -> 0 ilot, limite 8 comme limite 64
 *
 * ## Le meme malentendu, une annotation plus haut
 *
 * F5 ecarte une declaration annotee parce qu un cadre peut l instancier sans
 * que le corpus le montre. C est vrai d un `@Provides`, d un `@Preview`, d un
 * `@Test`. Pour `@ScopeActivity` pose sur une classe a constructeur `@Inject`,
 * ca l est a une condition : que QUELQU UN demande le type. Ici personne ne
 * le demande, et les deux classes sont de surcroit package-private, donc
 * personne hors du paquet ne le POURRAIT.
 *
 * Ecartees, elles restent des citantes. `PageNumberUtils` sort donc en
 * `alive:main`, tenu en vie par deux classes que personne n a jugees.
 *
 * ## Ce que ces tests demandent
 *
 * La meme chose que G21, et c est ce qui en fait une regle et non un cas :
 * qu une declaration ecartee par un filtre cesse de compter comme une preuve
 * de vie pour ses voisines. Un filtre dit « je ne sais pas », pas « elle
 * vit ». La difference se voit quand un groupe entier ne tient que sur ce
 * malentendu.
 */

const symb: any = await importOrNull('src/providers/unusedSymbols');
const iles: any = await importOrNull('src/providers/deadIslands');

const D = '/w/app/src/main/java/com/x/pagenumber';
const f = (nom: string, texte: string) => ({ path: `${D}/${nom}`, text: texte });

const morts = (sources: { path: string; text: string }[]) =>
  (symb.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[]).map(s => s.name);

const pourquoi = (nom: string, sources: { path: string; text: string }[]) =>
  (symb.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[]).find(s => s.name === nom);

const ilots = (sources: { path: string; text: string }[], maxIslandSize = 8) =>
  (iles.findDeadIslands({ sources, testSourceSets: ['/src/test/'], maxIslandSize }) as any[])
    .map((x: any) => (x.names ?? [x.name]).join('+'));

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** app/.../utils/pagenumber/PageNumberCache.java:10 */
const CACHE = f('PageNumberCache.java', [
  'package com.x.pagenumber;',
  '',
  'import javax.inject.Inject;',
  '',
  'import com.x.dagger.scope.ScopeActivity;',
  '',
  '@ScopeActivity',
  'class PageNumberCache {',
  '',
  '\t@Inject',
  '\tPageNumberCache() { }',
  '',
  '\tint get(int page) {',
  '\t\treturn PageNumberUtils.NULL_NUMERIC;',
  '\t}',
  '}',
  '',
].join('\n'));

/** app/.../utils/pagenumber/PageNumberHelper.java:17 */
const AIDE = f('PageNumberHelper.java', [
  'package com.x.pagenumber;',
  '',
  'import javax.inject.Inject;',
  '',
  'import com.x.dagger.scope.ScopeActivity;',
  '',
  '@ScopeActivity',
  'class PageNumberHelper {',
  '',
  '\tprivate final PageNumberCache cache;',
  '',
  '\t@Inject',
  '\tPageNumberHelper(PageNumberCache cache) {',
  '\t\tthis.cache = cache;',
  '\t}',
  '',
  '\tint numberFor(int page) {',
  '\t\treturn cache.get(page) == PageNumberUtils.NULL_NUMERIC ? 0 : page;',
  '\t}',
  '}',
  '',
].join('\n'));

/** app/.../utils/pagenumber/PageNumberUtils.java:3 */
const UTILS = f('PageNumberUtils.java', [
  'package com.x.pagenumber;',
  '',
  'final class PageNumberUtils {',
  '',
  '\tstatic int NULL_NUMERIC = -1;',
  '',
  '\tprivate PageNumberUtils() {',
  '\t}',
  '}',
  '',
].join('\n'));

const VIVANT = { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nfun main() {\n    println(1)\n}\n' };

/** Le dossier entier, comme il est sur le disque. */
const DOSSIER = [CACHE, AIDE, UTILS, VIVANT];

/** Le dossier sans ses deux classes annotees : ce qui reste est jugeable. */
const SANS_ANCRES = [UTILS, VIVANT];

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!symb)('le detecteur sait juger ce dossier', () => {
  it('rapporte la classe ordinaire des que les deux annotees ne sont plus la', () => {
    expect(morts(SANS_ANCRES)).toContain('PageNumberUtils');
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!symb)('aujourd hui, deux annotations suffisent a tout cacher', () => {
  it('rien n est rapporte sur le dossier entier', () => {
    expect(morts(DOSSIER)).toEqual([]);
  });

  it('les deux annotees sortent en F5, pas en vivantes prouvees', () => {
    expect(pourquoi('PageNumberCache', DOSSIER)).toMatchObject({ outcome: 'F5:@ScopeActivity' });
    expect(pourquoi('PageNumberHelper', DOSSIER)).toMatchObject({ outcome: 'F5:@ScopeActivity' });
  });

  /**
   * La ligne qui resume le trou, et la meme que dans G21 a un filtre pres :
   * la troisieme classe passe de `alive:main` a `unreferenced` selon que les
   * deux ancres sont la ou non.
   */
  it('la vie de la troisieme tient aux deux ancres, et a rien d autre', () => {
    expect(pourquoi('PageNumberUtils', DOSSIER)).toMatchObject({ outcome: 'alive:main' });
    expect(pourquoi('PageNumberUtils', SANS_ANCRES)).toMatchObject({ outcome: 'unreferenced' });
  });

  it('et la famille des ilots ne voit rien, meme a la limite soixante quatre', () => {
    expect(ilots(DOSSIER)).toEqual([]);
    expect(ilots(DOSSIER, 64)).toEqual([]);
  });

  it('le circuit complet ne declenche aucune ronde', () => {
    const r = collecterUnePasse(DOSSIER, ['/src/test/']);
    const combien = [...r.parFichier.values()].reduce((a, v) => a + v.length, 0) + r.fichiersMorts.size;
    expect(combien).toBe(0);
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!symb)('un dossier que rien ne nomme devrait etre rapporte', () => {
  it.fails('la classe annotee que personne n injecte devrait partir', () => {
    expect(morts(DOSSIER)).toContain('PageNumberHelper');
  });

  it.fails('celle qui ne sert qu a elle devrait partir aussi', () => {
    expect(morts(DOSSIER)).toContain('PageNumberCache');
  });

  it.fails('et la troisieme avec elles, puisque rien ne la nomme plus', () => {
    expect(morts(DOSSIER)).toContain('PageNumberUtils');
  });

  it.fails('la famille des ilots devrait voir le groupe malgre les annotations', () => {
    expect(ilots(DOSSIER, 64)).toHaveLength(1);
  });
});

// ── Gardes : ce qui ne doit PAS etre rapporte ───────────────────────────────

describe.skipIf(!symb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(morts(SANS_ANCRES)).toContain('PageNumberUtils');

  /**
   * La garde la plus exposee de ce trou. Quarante des quarante deux dossiers
   * fermes du corpus sont des `@Preview` Compose sous un `src/debug/` : rien
   * du code ne les appelle, et c est normal, l outil de rendu les lit. Elles
   * doivent rester epargnees.
   */
  it('un @Preview Compose, que seul l outil de rendu appelle', () => {
    const apercu = {
      path: '/w/app/src/debug/java/com/x/AdVignettePreview.kt',
      text: [
        'package com.x',
        '',
        'import androidx.compose.runtime.Composable',
        'import androidx.compose.ui.tooling.preview.Preview',
        '',
        '@Preview',
        '@Composable',
        'fun AdVignettePreview() {',
        '    Text("hi")',
        '}',
        '',
      ].join('\n'),
    };
    expect(pourquoi('AdVignettePreview', [apercu, VIVANT])).toMatchObject({ outcome: 'F5:@Preview' });
    expect(morts([apercu, VIVANT])).not.toContain('AdVignettePreview');
  });

  /**
   * Une classe annotee que quelqu un demande VRAIMENT reste, avec tout ce
   * qu elle nomme. C est le cas ordinaire, et de loin le plus frequent : 438
   * declarations sortent en F5 sur le corpus de reference.
   */
  it('une classe injectee que quelqu un demande', () => {
    temoin();
    const consommateur = {
      path: '/w/app/src/main/java/com/x/Reader.java',
      text: [
        'package com.x;',
        '',
        'import com.x.pagenumber.PageNumberHelper;',
        '',
        'public class Reader {',
        '',
        '\tprivate final PageNumberHelper helper;',
        '',
        '\tpublic Reader(PageNumberHelper helper) {',
        '\t\tthis.helper = helper;',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    const entree = {
      path: '/w/app/src/main/java/com/x/Main.kt',
      text: 'package com.x\n\nfun main() {\n    Reader(null)\n}\n',
    };
    const noms = morts([CACHE, AIDE, UTILS, consommateur, entree]);
    expect(noms).not.toContain('PageNumberHelper');
  });

  /**
   * Un `@Provides` nomme le type dans un module : c est une demande, pas une
   * simple mention. La relache ne doit pas confondre les deux, meme si les
   * deux passent par le meme sac de jetons.
   */
  it('un type fourni par un module Dagger', () => {
    temoin();
    const module = {
      path: '/w/app/src/main/java/com/x/PageModule.java',
      text: [
        'package com.x;',
        '',
        'import dagger.Module;',
        'import dagger.Provides;',
        'import com.x.pagenumber.PageNumberCache;',
        '',
        '@Module',
        'public class PageModule {',
        '',
        '\t@Provides',
        '\tPageNumberCache provideCache() {',
        '\t\treturn new PageNumberCache();',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    const entree = {
      path: '/w/app/src/main/java/com/x/Main.kt',
      text: 'package com.x\n\nfun main() {\n    PageModule().provideCache()\n}\n',
    };
    expect(morts([CACHE, AIDE, UTILS, module, entree])).not.toContain('PageNumberCache');
  });

  it('une classe annotee nommee par un test seulement reste hors des morts', () => {
    const test = {
      path: '/w/app/src/test/java/com/x/PageNumberHelperTest.java',
      text: [
        'package com.x;',
        '',
        'public class PageNumberHelperTest {',
        '',
        '\tvoid t() { new PageNumberHelper(null); }',
        '}',
        '',
      ].join('\n'),
    };
    expect(morts([...DOSSIER, test])).not.toContain('PageNumberHelperTest');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: SANS_ANCRES, testSourceSets: ['/src/test/'] };
    expect((symb.findUnusedSymbols(entier) as any[]).length).toBeGreaterThan(0);
    expect(symb.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});
