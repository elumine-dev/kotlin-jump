import { describe, it, expect } from 'vitest';
import { capMap, OPEN_FILE_CACHE_LIMIT } from '../../src/util/boundedCache';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { KotlinSemanticTokensProvider } from '../../src/providers/SemanticTokensProvider';
import { SealedWhenCoverageProvider } from '../../src/providers/SealedWhenCoverageProvider';

// Les caches par fichier des fournisseurs répondent pour l'éditeur que
// l'utilisateur regarde, mais rien n'en retirait jamais rien. Mesuré sur un
// vrai projet de 5088 fichiers : 5088 entrées de pliage et 44 058 plages,
// 5088 entrées de tokens et 3,4 Mo de données, 3187 entrées de couverture.

describe('capMap', () => {
  it('retire les plus anciennes, garde les dernières', () => {
    const m = new Map<number, string>();
    for (let i = 0; i < 10; i++) m.set(i, `v${i}`);
    capMap(m, 4);
    expect(m.size).toBe(4);
    expect([...m.keys()]).toEqual([6, 7, 8, 9]);
  });

  it('ne touche à rien sous le plafond, et supporte le vide', () => {
    const m = new Map([[1, 'a'], [2, 'b']]);
    capMap(m, 5);
    expect(m.size).toBe(2);
    const empty = new Map();
    capMap(empty, 0);
    expect(empty.size).toBe(0);
  });

  it('un plafond de zéro vide tout sans boucler', () => {
    const m = new Map([[1, 'a'], [2, 'b']]);
    capMap(m, 0);
    expect(m.size).toBe(0);
  });
});

const P = (l: number, c: number) => new Position(l, c);
function doc(uri: string, text: string): any {
  const lines = text.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    fileName: uri, languageId: 'kotlin', version: 1, isDirty: false,
    getText: () => text,
    lineAt: (n: number) => { const t = lines[n] ?? ''; return { text: t, range: { start: P(n, 0), end: P(n, t.length) } }; },
    lineCount: lines.length,
  };
}
const body = (i: number) => [
  'package p', '', `import a.B${i}`, `import a.C${i}`, '',
  `sealed class S${i}`, `class A${i} : S${i}()`, '',
  `class Type${i} {`, `    fun one(): Int {`, `        return ${i}`, `    }`, '}',
].join('\n');

function corpus(n: number) {
  const index = new SymbolIndex();
  const docs: any[] = [];
  for (let i = 0; i < n; i++) {
    const uri = `file:///cap/F${i}.kt`;
    index.add(parse(uri, body(i)));
    docs.push(doc(uri, body(i)));
  }
  index.finalize();
  return { index, docs };
}

describe('Caches par fichier bornés', () => {
  const ct = { isCancellationRequested: false } as any;

  it('le pliage ne garde pas une entrée par fichier parcouru', () => {
    const { index, docs } = corpus(200);
    const p = new KotlinFoldingRangeProvider(index);
    for (const d of docs) p.provideFoldingRanges(d, {} as any, ct);
    expect(((p as any).cache as Map<string, unknown>).size).toBeLessThanOrEqual(OPEN_FILE_CACHE_LIMIT);
  });

  it('les tokens sémantiques non plus', () => {
    const { index, docs } = corpus(200);
    const p = new KotlinSemanticTokensProvider(index, { tokenTypes: [], tokenModifiers: [] } as any);
    for (const d of docs) p.provideDocumentSemanticTokens(d, ct);
    expect(((p as any).cache as Map<string, unknown>).size).toBeLessThanOrEqual(OPEN_FILE_CACHE_LIMIT);
  });

  it('la couverture des when scellés non plus', () => {
    const { index, docs } = corpus(200);
    const p = new SealedWhenCoverageProvider(index);
    for (const d of docs) p.provideCodeLenses(d, ct);
    expect(((p as any)._cache as Map<string, unknown>).size).toBeLessThanOrEqual(OPEN_FILE_CACHE_LIMIT);
  });

  it('un ensemble d\'onglets réaliste reste entièrement en cache', () => {
    // Le plafond ne doit rien coûter dans l'usage courant : personne ne garde
    // soixante-quatre onglets ouverts.
    const { index, docs } = corpus(12);
    const fold = new KotlinFoldingRangeProvider(index);
    const first = docs.map(d => fold.provideFoldingRanges(d, {} as any, ct));
    const second = docs.map(d => fold.provideFoldingRanges(d, {} as any, ct));
    for (let i = 0; i < docs.length; i++) expect(second[i]).toBe(first[i]);
  });

  it('le contenu rendu ne change pas quand une entrée a été évincée', () => {
    const { index, docs } = corpus(200);
    const p = new KotlinFoldingRangeProvider(index);
    const before = p.provideFoldingRanges(docs[0], {} as any, ct).map(r => [r.start, r.end]);
    for (const d of docs) p.provideFoldingRanges(d, {} as any, ct);
    // docs[0] a forcément été évincé : le recalcul doit donner le même résultat.
    const after = p.provideFoldingRanges(docs[0], {} as any, ct).map(r => [r.start, r.end]);
    expect(after).toEqual(before);
  });
});
