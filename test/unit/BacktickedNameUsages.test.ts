/**
 * Find Usages et surlignage dans un nom Kotlin entre accents graves.
 *
 * Meme cause que 1.42.153 et 1.42.157 : le curseur pose dans
 * `fun \`nominal case GIVEN x THEN y\`()` n'y capte qu'un mot, et ces deux
 * surfaces cherchaient donc ce mot la.
 *
 * Mesure sur un projet reel, 37 noms echantillonnes parmi les 1095 :
 * Find Usages rendait 546 resultats dont 485 dans d'AUTRES fichiers, avec un
 * pic de 407 pour un seul nom ; le surlignage rendait 226 plages dont 226 ne
 * portaient pas sur le nom.
 *
 * Le nom accentue ne concerne que son propre fichier : 1086 des 1090 noms
 * distincts de ce projet n'existent que la, et les 4 restants sont des tests
 * homonymes de classes differentes, qu'il ne faut pas relier.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position, Uri } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinReferenceProvider } from '../../src/providers/ReferenceProvider';
import { KotlinDocumentHighlightProvider } from '../../src/providers/DocumentHighlightProvider';

const NL = String.fromCharCode(10);
const AG = String.fromCharCode(96);
afterEach(() => vi.restoreAllMocks());

const NOM = 'nominal case GIVEN given THEN ok';
const TEST_URI = 'file:///p/app/src/test/java/com/x/CasTest.kt';
const TEST_KT = [
  'package com.x', '',
  'class CasTest {',
  '    @Test fun ' + AG + NOM + AG + '() {',
  '        val given = 1',
  '        assertEquals(1, given)',
  '    }',
  '',
  '    fun relance(c: CasTest) = c.' + AG + NOM + AG + '()',
  '}',
].join(NL);

// Le piege : `given` est aussi un vrai symbole ailleurs.
const PROD_URI = 'file:///p/net/src/main/java/com/net/Builders.kt';
const PROD_KT = ['package com.net', '', 'fun given() {}', '', 'fun autre() { given() }'].join(NL);

function contexte() {
  const index = new SymbolIndex();
  index.add(parse(TEST_URI, TEST_KT));
  index.add(parse(PROD_URI, PROD_KT));
  index.finalize();
  const textes = new Map([[TEST_URI, TEST_KT], [PROD_URI, PROD_KT]]);
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
    update: async () => {},
  } as any);
  vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    const t = textes.get(uri);
    return t === undefined ? null : (mockDocument(uri, t) as any);
  });
  (workspace as any).findFiles = async () => [...textes.keys()].map(u => Uri.parse(u));
  (workspace as any).fs = {
    readFile: async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      const t = textes.get(uri);
      if (t === undefined) throw new Error('ENOENT');
      return new TextEncoder().encode(t);
    },
  };
  return index;
}

const LIGNE = 3;
const COL = TEST_KT.split(NL)[LIGNE].indexOf(NOM) + Math.floor(NOM.length / 2);
const texteDe = (r: any) => (TEST_KT.split(NL)[r.start.line] ?? '').slice(r.start.character, r.end.character);

describe('Find Usages dans un nom de test accentue', () => {
  it('ne sort pas du fichier et ne suit pas un mot du nom', async () => {
    const index = contexte();
    const refs = await new KotlinReferenceProvider(index).provideReferences(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE, COL) as any,
      { includeDeclaration: true } as any,
      { isCancellationRequested: false } as any,
    );
    expect(refs, 'des resultats sont attendus').toBeTruthy();
    expect([...new Set(refs!.map(l => String(l.uri)))], 'un seul fichier').toEqual([TEST_URI]);
    for (const l of refs!) expect(texteDe(l.range), 'chaque resultat porte sur le nom entier').toBe(NOM);
  });

  it('trouve la declaration ET l appel', async () => {
    const index = contexte();
    const refs = await new KotlinReferenceProvider(index).provideReferences(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE, COL) as any,
      { includeDeclaration: true } as any,
      { isCancellationRequested: false } as any,
    );
    expect(refs!.map(l => l.range.start.line).sort((a, b) => a - b)).toEqual([3, 8]);
  });
});

describe('surlignage dans un nom de test accentue', () => {
  it('surligne le nom entier, pas un de ses mots', () => {
    const index = contexte();
    const hl = new KotlinDocumentHighlightProvider(index).provideDocumentHighlights(
      mockDocument(TEST_URI, TEST_KT) as any, new Position(LIGNE, COL) as any, {} as any,
    );
    expect(hl, 'un surlignage est attendu').toBeTruthy();
    for (const h of hl!) expect(texteDe(h.range)).toBe(NOM);
    expect(hl!.map(h => h.range.start.line).sort((a, b) => a - b)).toEqual([3, 8]);
  });

  it('et le surlignage ordinaire d un mot reste intact', () => {
    const index = contexte();
    const ligne = TEST_KT.split(NL)[4];
    const hl = new KotlinDocumentHighlightProvider(index).provideDocumentHighlights(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(4, ligne.indexOf('given') + 1) as any, {} as any,
    );
    expect(hl!.length, 'les deux usages de la locale given').toBeGreaterThanOrEqual(2);
  });
});
