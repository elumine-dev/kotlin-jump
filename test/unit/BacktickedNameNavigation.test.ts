/**
 * Ctrl+clic et hierarchie d'appels dans un nom Kotlin entre accents graves.
 *
 * Le curseur pose dans `fun \`given a TextDO then it maps\`()` n'y capte qu'UN
 * mot. Traite comme un symbole ordinaire, ce mot envoyait ailleurs : cliquer
 * au milieu du nom d'un test ouvrait `TextDO.kt` dans un autre module, et la
 * hierarchie d'appels s'ouvrait sur une fonction `values` sans rapport.
 *
 * Mesure sur un projet reel, 1095 noms de ce genre, curseur au milieu du nom :
 * 312 cibles fausses pour Ctrl+clic et 305 racines fausses pour la hierarchie
 * d'appels. Le renommage avait recu le meme correctif en 1.42.153 ; la regle
 * vit desormais dans `util/backtickName`, en un seul exemplaire.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';

const NL = String.fromCharCode(10);
const AG = String.fromCharCode(96);
const posDe = (r: any) => (r?.start ? r.start : r);
afterEach(() => vi.restoreAllMocks());

const NOM = 'given a TextDO then it maps';
const TEST_URI = 'file:///p/app/src/test/java/com/x/MapperTest.kt';
const TEST_KT = [
  'package com.x', '',
  'class MapperTest {',
  '    @Test fun ' + AG + NOM + AG + '() {',
  '        val t = build()',
  '    }',
  '}',
].join(NL);

// Le piege : un vrai symbole de production porte l'un des mots du nom de test.
const PROD_URI = 'file:///p/net/src/main/java/com/net/TextDO.kt';
const PROD_KT = ['package com.net', '', 'class TextDO', '', 'fun given() {}', '', 'fun build() {}'].join(NL);

function contexte(...fichiers: Array<[string, string]>) {
  const index = new SymbolIndex();
  for (const [u, c] of fichiers) index.add(parse(u, c));
  index.finalize();
  const textes = new Map(fichiers);
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
    update: async () => {},
  } as any);
  vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    const t = textes.get(uri);
    return t === undefined ? null : (mockDocument(uri, t) as any);
  });
  return index;
}

/** Le curseur au MILIEU du nom accentue, la ou l'utilisateur clique. */
const LIGNE = 3;
const COL_MILIEU = TEST_KT.split(NL)[LIGNE].indexOf(NOM) + Math.floor(NOM.length / 2);

describe('Ctrl+clic dans un nom de test accentue', () => {
  it('ne part pas vers un symbole qui porte seulement un de ses mots', async () => {
    const index = contexte([TEST_URI, TEST_KT], [PROD_URI, PROD_KT]);
    const r: any = await new KotlinDefinitionProvider(index).provideDefinition(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE, COL_MILIEU) as any,
      { isCancellationRequested: false } as any,
    );
    const cibles = (Array.isArray(r) ? r : r ? [r] : []).map((l: any) => String(l.uri));
    expect(cibles, 'aucune cible hors du fichier du test').not.toContain(PROD_URI);
  });

  it('mais un APPEL de ce test mene bien a sa declaration', async () => {
    const APPELANT = 'file:///p/app/src/test/java/com/x/Suite.kt';
    const APPELANT_KT = [
      'package com.x', '',
      'fun tout(m: MapperTest) {',
      '    m.' + AG + NOM + AG + '()',
      '}',
    ].join(NL);
    const index = contexte([TEST_URI, TEST_KT], [PROD_URI, PROD_KT], [APPELANT, APPELANT_KT]);
    const ligne = APPELANT_KT.split(NL)[3];
    const col = ligne.indexOf(NOM) + Math.floor(NOM.length / 2);
    const r: any = await new KotlinDefinitionProvider(index).provideDefinition(
      mockDocument(APPELANT, APPELANT_KT) as any,
      new Position(3, col) as any,
      { isCancellationRequested: false } as any,
    );
    const loc = Array.isArray(r) ? r[0] : r;
    expect(loc, 'une cible est attendue').toBeTruthy();
    expect(String(loc.uri)).toBe(TEST_URI);
    expect(posDe(loc.range).line).toBe(LIGNE);
  });
});

describe('hierarchie d appels dans un nom de test accentue', () => {
  it('la racine est le test, pas un homonyme d un de ses mots', () => {
    const index = contexte([TEST_URI, TEST_KT], [PROD_URI, PROD_KT]);
    const items = new KotlinCallHierarchyProvider(index).prepareCallHierarchy(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE, COL_MILIEU) as any,
    );
    expect(items, 'une racine est attendue').toBeTruthy();
    expect(items!.map(i => String(i.name))).toEqual([NOM]);
    expect(String(items![0].uri)).toBe(TEST_URI);
  });

  /**
   * Le meme nom de test dans deux classes differentes : rien ne les relie, et
   * c'est la LIGNE du curseur qui doit trancher. Mesure sur un projet reel :
   * 4 des 1090 noms accentues distincts apparaissent dans plusieurs fichiers,
   * `nominal case` dans cinq.
   */
  it('deux tests homonymes : la racine est celui du curseur', () => {
    const CAS = 'cas nominal';
    const A_URI = 'file:///p/app/src/test/java/com/x/ATest.kt';
    const B_URI = 'file:///p/app/src/test/java/com/x/BTest.kt';
    const A = ['package com.x', '', 'class ATest {', '    @Test fun ' + AG + CAS + AG + '() {}', '}'].join(NL);
    const B = ['package com.x', '', 'class BTest {', '    @Test fun ' + AG + CAS + AG + '() {}', '}'].join(NL);
    const index = contexte([A_URI, A], [B_URI, B]);
    const col = A.split(NL)[3].indexOf(CAS) + Math.floor(CAS.length / 2);
    const items = new KotlinCallHierarchyProvider(index).prepareCallHierarchy(
      mockDocument(B_URI, B) as any, new Position(3, col) as any,
    );
    expect(items!.map(i => String(i.uri))).toEqual([B_URI]);
  });

  it('et un nom accentue qui est un identifiant reste un cas ordinaire', () => {
    const URI = 'file:///p/app/src/main/java/com/x/A.kt';
    const SRC = ['package com.x', '', 'class A {', '    fun ' + AG + 'aide' + AG + '() {}', '}'].join(NL);
    const index = contexte([URI, SRC]);
    const col = SRC.split(NL)[3].indexOf('aide') + 1;
    const items = new KotlinCallHierarchyProvider(index).prepareCallHierarchy(
      mockDocument(URI, SRC) as any, new Position(3, col) as any,
    );
    expect(items!.map(i => String(i.name))).toEqual(['aide']);
  });
});
