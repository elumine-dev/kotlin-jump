import { describe, it, expect } from 'vitest';
import { Position } from './__mocks__/vscode';
import { fingerprint } from '../../src/util/boundedCache';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { KotlinSemanticTokensProvider } from '../../src/providers/SemanticTokensProvider';
import { SealedWhenCoverageProvider } from '../../src/providers/SealedWhenCoverageProvider';
import { StateProvenanceProvider } from '../../src/providers/StateProvenanceProvider';
import { symbolsForDocument, forgetLiveSymbols } from '../../src/util/liveSymbols';

// Fermer un document le détruit : rouvrir le fichier en construit un nouveau
// dont la version repart à 1. L'URI, la version, l'état sale et même la
// longueur peuvent alors désigner deux textes différents. Reproduit : deux
// contenus de 64 caractères exactement, le second recevait les plis du premier.

const URI = 'file:///id/A.kt';
const P = (l: number, c: number) => new Position(l, c);
function doc(text: string, dirty = false, version = 1): any {
  const lines = text.split('\n');
  return {
    uri: { toString: () => URI, path: '/id/A.kt' },
    fileName: 'A.kt', languageId: 'kotlin', version, isDirty: dirty,
    getText: () => text, lineCount: lines.length,
    lineAt: (n: number) => { const t = lines[n] ?? ''; return { text: t, range: { start: P(n, 0), end: P(n, t.length) } }; },
  };
}

// Deux textes de longueur STRICTEMENT égale, dont la structure diffère.
const CORPS = [
  'sealed class S {',
  '  object O1 : S()',
  '  object O2 : S()',
  '}',
  'class VM {',
  '  private val _s = MutableStateFlow(0)',
  '  val s = _s.asStateFlow()',
  '  fun set(v: Int) { _s.value = v }',
  '}',
  'fun pick(x: S) = when (x) {',
  '  is S.O1 -> 1',
  '}',
].join('\n');
// Même longueur exacte, mêmes déclarations, décalées de deux lignes : les lens
// et les plis changent donc de ligne, ce qu'un cache qui ment ne verrait pas.
const A = `package p\n\n${CORPS}\n//pad\n//pad\n`;
const B = `package p\n\n//pad\n//pad\n${CORPS}\n`;

describe('Empreinte de contenu', () => {
  it('distingue deux textes de même longueur', () => {
    expect(A.length).toBe(B.length);
    expect(fingerprint(A)).not.toBe(fingerprint(B));
  });

  it('est stable et vaut la même chose pour un texte identique', () => {
    expect(fingerprint(A)).toBe(fingerprint(A.slice(0)));
    expect(fingerprint('')).toBe(fingerprint(''));
    expect(typeof fingerprint('x')).toBe('number');
  });

  it('sépare des textes voisins à un caractère près', () => {
    const seen = new Set<number>();
    for (let i = 0; i < A.length; i++) {
      const v = A.slice(0, i) + (A[i] === 'a' ? 'b' : 'a') + A.slice(i + 1);
      seen.add(fingerprint(v));
    }
    // Aucune collision entre les variantes d'un caractère.
    expect(seen.size).toBe(A.length);
  });
});

describe('Un document rouvert ne reçoit pas les réponses du précédent', () => {
  const ct = { isCancellationRequested: false } as any;
  const index = () => { const i = new SymbolIndex(); i.add(parse(URI, A)); i.finalize(); return i; };

  const cases: Array<[string, () => any, (p: any, d: any) => string]> = [
    ['pliage', () => new KotlinFoldingRangeProvider(index()), (p, d) => JSON.stringify(p.provideFoldingRanges(d, {}, ct).map((r: any) => [r.start, r.end]))],
    ['tokens sémantiques', () => new KotlinSemanticTokensProvider(index(), { tokenTypes: [], tokenModifiers: [] } as any), (p, d) => Array.from(p.provideDocumentSemanticTokens(d, ct).data ?? []).join(',')],
    ['couverture des when', () => new SealedWhenCoverageProvider(index()), (p, d) => JSON.stringify(p.provideCodeLenses(d, ct).map((l: any) => [l.range.start.line, l.command?.title ?? '']))],
    ['provenance d\'état', () => new StateProvenanceProvider(), (p, d) => JSON.stringify(p.provideCodeLenses(d, ct).map((l: any) => [l.range.start.line, l.command?.title ?? '']))],
  ];

  for (const [name, make, shot] of cases) {
    it(`${name} recalcule pour le nouveau contenu`, () => {
      const warm = make();
      const premier = shot(warm, doc(A));
      // Même URI, même version, même longueur, contenu différent.
      const chaud = shot(warm, doc(B));
      const froid = shot(make(), doc(B));
      // Sans ce garde le test serait vide : deux réponses identiquement
      // absentes satisferaient l'égalité quel que soit le code.
      expect(premier).not.toBe(froid);
      expect(chaud).toBe(froid);
    });
  }

  it('la mémo des symboles vivants aussi', () => {
    forgetLiveSymbols();
    const i = index();
    const first = symbolsForDocument(i, doc(A, true, 2));
    const second = symbolsForDocument(i, doc(B, true, 2));
    expect(second).not.toBe(first);
    expect(second.map(e => e.line)).not.toEqual(first.map(e => e.line));
  });

  it('un contenu inchangé reste servi par le cache', () => {
    const p = new KotlinFoldingRangeProvider(index());
    const d = doc(A);
    const a = p.provideFoldingRanges(d, {} as any, ct);
    const b = p.provideFoldingRanges(d, {} as any, ct);
    expect(b).toBe(a);
  });
});
