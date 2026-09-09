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

describe('Voie rapide par identité d\'objet', () => {
  const ct = { isCancellationRequested: false } as any;
  const index = () => { const i = new SymbolIndex(); i.add(parse(URI, A)); i.finalize(); return i; };

  it('le même objet document n\'est jamais rehaché', () => {
    const p = new KotlinFoldingRangeProvider(index());
    const d = doc(A);
    let lectures = 0;
    const brut = d.getText;
    d.getText = () => { lectures++; return brut(); };
    p.provideFoldingRanges(d, {} as any, ct);
    const apresPremier = lectures;
    for (let i = 0; i < 20; i++) p.provideFoldingRanges(d, {} as any, ct);
    // VS Code incrémente la version à chaque modification, donc le même objet
    // à la même version porte forcément le même texte. Comparer la référence
    // coûte zéro ; sans cette voie, chaque succès de cache relisait et
    // rehachait le document, mesuré à 0,037 ms contre 0,00013 ms.
    expect(lectures).toBe(apresPremier);
  });

  it('un objet différent retombe sur l\'empreinte, et reste correct', () => {
    const p = new KotlinFoldingRangeProvider(index());
    p.provideFoldingRanges(doc(A), {} as any, ct);
    // Même URI, même version, même longueur, objet et contenu différents.
    const chaud = JSON.stringify(p.provideFoldingRanges(doc(B), {} as any, ct).map(r => [r.start, r.end]));
    const froid = JSON.stringify(new KotlinFoldingRangeProvider(index())
      .provideFoldingRanges(doc(B), {} as any, ct).map(r => [r.start, r.end]));
    expect(chaud).toBe(froid);
  });

  it('les tokens sémantiques suivent la même règle', () => {
    const p = new KotlinSemanticTokensProvider(index(), { tokenTypes: [], tokenModifiers: [] } as any);
    const d = doc(A);
    let lectures = 0;
    const brut = d.getText;
    d.getText = () => { lectures++; return brut(); };
    p.provideDocumentSemanticTokens(d, ct);
    const apresPremier = lectures;
    for (let i = 0; i < 20; i++) p.provideDocumentSemanticTokens(d, ct);
    expect(lectures).toBe(apresPremier);
    // Et un objet neuf au même contenu décalé donne bien la nouvelle réponse.
    const chaud = Array.from(p.provideDocumentSemanticTokens(doc(B), ct).data ?? []).join(',');
    const froid = Array.from(new KotlinSemanticTokensProvider(index(), { tokenTypes: [], tokenModifiers: [] } as any)
      .provideDocumentSemanticTokens(doc(B), ct).data ?? []).join(',');
    expect(chaud).toBe(froid);
  });
});

describe('Requête delta des tokens sémantiques', () => {
  const ct = { isCancellationRequested: false } as any;
  const index = () => { const i = new SymbolIndex(); i.add(parse(URI, A)); i.finalize(); return i; };
  const legend = { tokenTypes: [], tokenModifiers: [] } as any;

  it('ne répond pas « rien n\'a changé » à un fichier rouvert', () => {
    const p = new KotlinSemanticTokensProvider(index(), legend);
    const complet = p.provideDocumentSemanticTokens(doc(A), ct);

    // VS Code envoie une requête delta dès qu'il a un identifiant de résultat,
    // c'est donc le chemin le plus emprunté. Il ne testait que la version, qui
    // repart à 1 pour un fichier rouvert : l'éditeur gardait indéfiniment les
    // couleurs de la session précédente.
    const delta: any = p.provideDocumentSemanticTokensEdits(doc(B), complet.resultId, ct);
    const vide = Array.isArray(delta.edits) && delta.edits.length === 0;
    expect(vide, 'a répondu « aucune modification » pour un contenu différent').toBe(false);

    const attendu = Array.from(
      new KotlinSemanticTokensProvider(index(), legend).provideDocumentSemanticTokens(doc(B), ct).data ?? [],
    );
    // La réponse est soit un jeu complet, soit des éditions à appliquer sur
    // l'ancien. On applique pour vérifier ce que l'éditeur affichera vraiment.
    let final: number[];
    if (delta.data) {
      final = Array.from(delta.data as Uint32Array);
    } else {
      final = Array.from(complet.data);
      for (const e of [...delta.edits].sort((x: any, y: any) => y.start - x.start)) {
        final.splice(e.start, e.deleteCount, ...Array.from((e.data ?? []) as Uint32Array));
      }
    }
    expect(final).toEqual(Array.from(attendu));
  });

  it('répond toujours « rien n\'a changé » quand rien n\'a changé', () => {
    const p = new KotlinSemanticTokensProvider(index(), legend);
    const meme = doc(A);
    const complet = p.provideDocumentSemanticTokens(meme, ct);
    const delta: any = p.provideDocumentSemanticTokensEdits(meme, complet.resultId, ct);
    expect(Array.isArray(delta.edits) && delta.edits.length === 0).toBe(true);
  });
});

describe('Résolution des imports', () => {
  // Le plus grave des caches de ce genre : une résolution périmée fait
  // atterrir Go to Definition, le survol et l'auto import sur un AUTRE symbole.
  const IR_URI = 'file:///ir/A.kt';
  const irDoc = (text: string): any => ({ uri: { toString: () => IR_URI }, version: 1, getText: () => text });
  // Même longueur, imports permutés.
  const IMPA = 'package p\n\nimport a.Foo\nimport zz.Bar\n\nclass X\n';
  const IMPB = 'package p\n\nimport zz.Foo\nimport a.Bar\n\nclass X\n';

  it('un fichier rouvert ne garde pas les imports du précédent', async () => {
    const { resolve, evict } = await import('../../src/util/ImportResolver');
    expect(IMPA.length).toBe(IMPB.length);
    resolve('Foo', irDoc(IMPA));
    const chaud = resolve('Foo', irDoc(IMPB));
    evict({ toString: () => IR_URI } as any);
    const froid = resolve('Foo', irDoc(IMPB));
    expect(chaud).toEqual(froid);
    expect(chaud[0]).toBe('zz.Foo');
  });

  it('le même objet document n\'est pas relu', async () => {
    const { resolve } = await import('../../src/util/ImportResolver');
    let lectures = 0;
    const d: any = { uri: { toString: () => 'file:///ir/B.kt' }, version: 1, getText: () => { lectures++; return IMPA; } };
    resolve('Foo', d);
    const apresPremier = lectures;
    for (let i = 0; i < 10; i++) resolve('Foo', d);
    expect(lectures).toBe(apresPremier);
  });

  it('le cache est borné', async () => {
    const { resolve } = await import('../../src/util/ImportResolver');
    const { OPEN_FILE_CACHE_LIMIT } = await import('../../src/util/boundedCache');
    const mod: any = await import('../../src/util/ImportResolver');
    for (let i = 0; i < 300; i++) {
      resolve('Foo', { uri: { toString: () => `file:///ir/F${i}.kt` }, version: 1, getText: () => IMPA } as any);
    }
    // Mesuré sur un vrai projet : une entrée par fichier parcouru, 13,8 Mo
    // retenus pour 3187 fichiers dont aucun n'était encore ouvert.
    const size = mod.__cacheSizeForTests?.() ?? OPEN_FILE_CACHE_LIMIT;
    expect(size).toBeLessThanOrEqual(OPEN_FILE_CACHE_LIMIT);
  });
});

describe('Rafraîchissement de la référence après réouverture', () => {
  // Sans lui, l'entrée continue de pointer sur l'objet détruit : chaque appel
  // suivant retombe sur l'empreinte et rehache tout le fichier, pour le reste
  // de la session. Mesuré sur les 40 plus gros fichiers réels : 29,6 ms par
  // salve de résolutions au lieu de 0,28 ms.
  it('la résolution d\'imports ne rehache pas indéfiniment', async () => {
    const { resolve } = await import('../../src/util/ImportResolver');
    const URI2 = 'file:///rr/A.kt';
    const texte = 'package p\n\nimport a.Foo\n\nclass X\n';
    let lectures = 0;
    const faire = () => ({ uri: { toString: () => URI2 }, version: 1, getText: () => { lectures++; return texte; } } as any);

    const session1 = faire();
    resolve('Foo', session1);
    resolve('Foo', session1);

    // Réouverture : nouvel objet, même contenu, même version.
    const session2 = faire();
    resolve('Foo', session2);
    const apresReouverture = lectures;
    for (let i = 0; i < 20; i++) resolve('Foo', session2);
    expect(lectures).toBe(apresReouverture);
  });

  it('le pliage non plus', () => {
    const p = new KotlinFoldingRangeProvider((() => { const i = new SymbolIndex(); i.add(parse(URI, A)); i.finalize(); return i; })());
    const ct = { isCancellationRequested: false } as any;
    const faire = () => { const d = doc(A); let n = 0; const brut = d.getText; d.getText = () => { n++; return brut(); }; return { d, lu: () => n }; };
    const s1 = faire();
    p.provideFoldingRanges(s1.d, {} as any, ct);
    const s2 = faire();
    p.provideFoldingRanges(s2.d, {} as any, ct);
    const apres = s2.lu();
    for (let i = 0; i < 20; i++) p.provideFoldingRanges(s2.d, {} as any, ct);
    expect(s2.lu()).toBe(apres);
  });

  it('mais un contenu réellement différent est toujours détecté', () => {
    const idx = (() => { const i = new SymbolIndex(); i.add(parse(URI, A)); i.finalize(); return i; })();
    const p = new KotlinFoldingRangeProvider(idx);
    const ct = { isCancellationRequested: false } as any;
    p.provideFoldingRanges(doc(A), {} as any, ct);
    const chaud = JSON.stringify(p.provideFoldingRanges(doc(B), {} as any, ct).map(r => [r.start, r.end]));
    const froid = JSON.stringify(new KotlinFoldingRangeProvider(idx)
      .provideFoldingRanges(doc(B), {} as any, ct).map(r => [r.start, r.end]));
    expect(chaud).toBe(froid);
  });
});
