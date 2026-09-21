import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G33 — une marche que seul un test effectue.
 *
 * Recensement de `scanEnums`, quatrieme famille, et la plus serree des quatre.
 *
 *   1303 entrees d enum examinees
 *    741 alive:main
 *    540 E1:walked-as-whole, sur 60 enums distincts
 *     12 E3 (@VisibleForTesting 6, @Parcelize 6)
 *      4 E5:annotated-entry
 *      2 E2:test-source-set
 *      3 unreferenced + 1 testOnly, soit les 4 trouvailles de la famille
 *
 * ## E1, et l unique incoherence trouvee
 *
 * E1 protege un enum qu on PARCOURT en entier : `values()`, `entries`, `::`,
 * une fonction reifiee, ou une deserialisation. Le raisonnement est solide :
 * la boucle atteint toutes les entrees sans en nommer aucune.
 *
 * Mais `findWalkedEnums` (unusedEnumEntries.ts:283) parcourt TOUTES les
 * sources sans distinguer les source sets. Une marche ecrite dans un test
 * protege donc les entrees en production, alors que la meme famille
 * distingue soigneusement `testOnly` partout ailleurs, et porte meme un
 * filtre `E2:test-source-set` pour les enums DECLARES dans un test.
 *
 * Mesure : sur les 60 enums en E1, **trois** ne sont parcourus que par un
 * test.
 *
 * DataDownloadStatus
 * FeedPostType
 * StoryModuleType
 *
 * ## Et pourquoi aucune des trois ne se recolte
 *
 * Six de leurs entrees ne sont nommees nulle part en production
 * (`CAROUSEL_POST`, `BANNER_POST`, `VISUAL_GRID_POST`, `BUTTON_V2`,
 * `POST_V3`, `PUBLICATION_DATE`). Elles sont pourtant bien vivantes, et la
 * raison est instructive : leurs entrees portent une CLE DE CHARGE UTILE.
 *
 *   enum class FeedPostType(override val kind: String) : IdentifiedWithKind {
 *       CAROUSEL_POST(MainApiProvider.CAROUSEL_POST_KIND),
 *
 * L entree est atteinte par la valeur de `kind`, jamais par son nom. Aucun
 * scan par identifiant ne peut la voir vivre, et la supprimer casserait le
 * decodage d une charge utile du serveur.
 *
 * C est exactement ce que E1 protege, et c est la garde principale de ce
 * fichier.
 *
 * ## Deux autres verifications, toutes deux a zero
 *
 * La regle `@TypeConverter` de `findDeserializedEnums` est un balayage au
 * niveau du FICHIER : tout enum dont le nom apparait dans un fichier portant
 * `@TypeConverter` est protege. Quinze fichiers du corpus en portent un, et
 * ils protegent **zero** enum. La sur largeur existe dans le texte, pas dans
 * les faits.
 *
 * Et les 13 enums en E1 pour lesquels la sonde n a trouve aucune marche
 * viennent tous de la voie deserialisation, qui est la voie fine.
 *
 * ## Ce que ces tests demandent
 *
 * Que `findWalkedEnums` ne compte pas une marche ecrite dans un source set de
 * test comme une preuve de vie en production, ou au minimum qu elle produise
 * `testOnly` plutot que E1. Le gain se mesure en zero entree sur ce corpus ;
 * ce qui se gagne, c est la coherence de la famille avec elle meme.
 */

const enums: any = await importOrNull('src/providers/unusedEnumEntries');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'] } as any);

const verdict = (nom: string, ...sources: { path: string; text: string }[]) =>
  (enums.explainEnumEntries(base(sources)) as any[]).find((e: any) => e.name === nom);

const trouves = (...sources: { path: string; text: string }[]) =>
  ((enums.scanEnums(base(sources)) as any).entries ?? []).map((e: any) => e.name);

// ── Le motif reel, reduit ───────────────────────────────────────────────────

const ENUM = f('Mode.kt', [
  'package com.x',
  '',
  'enum class Mode {',
  '    A,',
  '    B,',
  '    C',
  '}',
  '',
].join('\n'));

const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(Mode.A)\n}\n');

const MARCHE_PROD = f('Walk.kt', 'package com.x\n\nfun all() = Mode.values()\n');

const MARCHE_TEST = {
  path: '/w/app/src/test/java/com/x/ModeTest.kt',
  text: 'package com.x\n\nclass ModeTest {\n\n    fun t() = Mode.values()\n}\n',
};

/**
 * Chaque entree porte la cle que le serveur envoie. L entree est atteinte par
 * cette valeur, jamais par son nom.
 */
const A_CLE = f('FeedPostType.kt', [
  'package com.x',
  '',
  'enum class FeedPostType(val kind: String) {',
  '    AD_POST(AD_KIND),',
  '    CAROUSEL_POST(CAROUSEL_KIND)',
  '}',
  '',
].join('\n'));

const CLES = f('Kinds.kt', [
  'package com.x',
  '',
  'const val AD_KIND = "ad"',
  'const val CAROUSEL_KIND = "carousel"',
  '',
].join('\n'));

const MARCHE_TEST_CLE = {
  path: '/w/app/src/test/java/com/x/FeedTest.kt',
  text: 'package com.x\n\nclass FeedTest {\n\n    fun t() = FeedPostType.values()\n}\n',
};

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!enums)('la famille juge bien ce corpus', () => {
  it('sans marche, les entrees que rien ne nomme sont rapportees', () => {
    expect(trouves(ENUM, APPELANT).sort()).toEqual(['B', 'C']);
  });

  it('et celle qui est nommee ne l est pas', () => {
    expect(verdict('A', ENUM, APPELANT)).toMatchObject({ outcome: 'alive:main' });
  });
});

// ── Sentinelles : l etat mesure aujourd hui ─────────────────────────────────

describe.skipIf(!enums)('aujourd hui, une marche de test vaut une marche de prod', () => {
  it('une marche en production protege les trois entrees', () => {
    expect(trouves(ENUM, MARCHE_PROD, APPELANT)).toEqual([]);
    expect(verdict('B', ENUM, MARCHE_PROD, APPELANT)).toMatchObject({ outcome: 'E1:walked-as-whole' });
  });

  /**
   * Le meme verdict, mot pour mot, quand la marche vit dans un source set de
   * test. C est l incoherence : la famille porte par ailleurs un filtre
   * `E2:test-source-set` pour les enums DECLARES dans un test, et un verdict
   * `testOnly` pour les entrees que seul un test nomme.
   */
  it('une marche dans un test donne exactement le meme verdict', () => {
    expect(trouves(ENUM, MARCHE_TEST, APPELANT)).toEqual([]);
    expect(verdict('B', ENUM, MARCHE_TEST, APPELANT)).toMatchObject({ outcome: 'E1:walked-as-whole' });
  });

  it('alors que sans elle, les deux entrees sortent', () => {
    expect(trouves(ENUM, APPELANT).sort()).toEqual(['B', 'C']);
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!enums)('une marche de test ne prouve pas la vie en production', () => {
  it.fails('les entrees que seul un test atteint devraient etre rapportees', () => {
    expect(trouves(ENUM, MARCHE_TEST, APPELANT).sort()).toEqual(['B', 'C']);
  });

  it.fails('ou au minimum sortir en testOnly, pas en E1', () => {
    expect(verdict('B', ENUM, MARCHE_TEST, APPELANT)).toMatchObject({ outcome: 'testOnly' });
  });

  /**
   * Et le verdict ne doit pas dependre de la forme de la marche : `entries`,
   * `values()` et `::` passent par la meme regle.
   */
  it.fails('quelle que soit la forme de la marche', () => {
    const parEntries = {
      path: '/w/app/src/test/java/com/x/ModeTest.kt',
      text: 'package com.x\n\nclass ModeTest {\n\n    fun t() = Mode.entries\n}\n',
    };
    expect(trouves(ENUM, parEntries, APPELANT).sort()).toEqual(['B', 'C']);
  });
});

// ── Gardes : ce que la relache ne doit surtout pas emporter ────────────────

describe.skipIf(!enums)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => expect(trouves(ENUM, APPELANT).sort()).toEqual(['B', 'C']);

  /**
   * LA garde de ce fichier, et la raison pour laquelle les trois enums du
   * corpus ne se recoltent pas. Chaque entree porte la cle que le serveur
   * envoie ; elle est atteinte par cette valeur, jamais par son nom. Aucun
   * scan par identifiant ne peut la voir vivre, et la supprimer casserait le
   * decodage d une charge utile.
   *
 * Motif reel:.
   */
  it('un enum dont les entrees portent une cle de charge utile', () => {
    temoin();
    expect(trouves(A_CLE, CLES, MARCHE_TEST_CLE, APPELANT)).toEqual([]);
  });

  it('une marche en production, evidemment', () => {
    temoin();
    expect(trouves(ENUM, MARCHE_PROD, APPELANT)).toEqual([]);
  });

  /**
   * Une marche en production ET une marche de test : la premiere suffit, et la
   * relache ne doit pas se laisser tromper par la seconde.
   */
  it('les deux marches a la fois', () => {
    temoin();
    expect(trouves(ENUM, MARCHE_PROD, MARCHE_TEST, APPELANT)).toEqual([]);
  });

  /**
   * Un enum lu depuis un champ de DTO revient du JSON par son nom, sans qu
   * aucune entree n apparaisse dans le code. C est la voie fine de
   * `findDeserializedEnums`, a ne pas confondre avec la marche.
   */
  it('un enum type d un champ de DTO', () => {
    temoin();
    const dto = f('PostDTO.kt', [
      'package com.x',
      '',
      'data class PostDTO(',
      '    val mode: Mode,',
      ')',
      '',
    ].join('\n'));
    expect(trouves(ENUM, dto, APPELANT)).toEqual([]);
  });

  /**
   * `@Parcelize` et `@VisibleForTesting` couvrent douze entrees du corpus.
   * Elles restent des gardes de l enum entier.
   */
  it('un enum @Parcelize', () => {
    temoin();
    const parcelable = f('Mode.kt', [
      'package com.x',
      '',
      '@Parcelize',
      'enum class Mode {',
      '    A,',
      '    B,',
      '    C',
      '}',
      '',
    ].join('\n'));
    expect(trouves(parcelable, APPELANT)).toEqual([]);
  });

  it('un enum declare dans un source set de test', () => {
    temoin();
    const dansTest = {
      path: '/w/app/src/test/java/com/x/Mode.kt',
      text: 'package com.x\n\nenum class Mode {\n    A,\n    B\n}\n',
    };
    expect(trouves(dansTest, APPELANT)).toEqual([]);
  });
});
