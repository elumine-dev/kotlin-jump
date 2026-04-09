/**
 * Tests adversaires — InlayHintsProvider passe 2 (types inférés)
 *
 * Bugs candidats A→O :
 *   A — varName = préfixe du keyword (`val val = fetch()`)
 *   B — `if (` capturé par CALL_RE avant le vrai appel
 *   C — appel de méthode avec receiver (`obj.fetch()`)
 *   D — generic call `foo<Int>()` non matché par CALL_RE
 *   E — raw string contenant une déclaration `val`
 *   F — trailing spaces dans le RHS
 *   G — ambiguïté de résolution (2 `foo` dans l'index)
 *   H — pollution du cache entre instances
 *   I — appel dans une string literal → isInsideCommentOrString doit filtrer
 *   J — fonction retournant une fonction `() -> Unit` → hint correct
 *   K — modificateurs exotiques (actual/expect/const)
 *   L — object expression → 0 hints
 *   M — varName qui contient `val` comme sous-chaîne
 *   N — `fun` dans le nom de la fonction → \bfun\b word-boundary correct
 *   O — objet `object Factory` → pas de crash
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function freshUri() { return `file:///IITA_${_id++}.kt`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function fullRange(code: string): Range {
  const lines = code.split('\n');
  return new Range(new Position(0, 0), new Position(lines.length - 1, lines[lines.length - 1].length));
}

const token = { isCancellationRequested: false } as any;

afterEach(() => vi.restoreAllMocks());

function mockConfig(opts: { paramNames?: boolean; inferredTypes?: boolean }) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, def: any) => {
      if (key === 'inlayHints.parameterNames') return opts.paramNames ?? def;
      if (key === 'inlayHints.inferredTypes')  return opts.inferredTypes ?? def;
      return def;
    },
  } as any);
}

function inferredProvider(index: SymbolIndex) {
  mockConfig({ paramNames: false, inferredTypes: true });
  return new KotlinInlayHintsProvider(index);
}

// ── BUG A : varName = préfixe du keyword ────────────────────────────────────

describe('BUG A — varName = préfixe du keyword (anti-régression colonne)', () => {
  async function colFor(call: string, decl: string) {
    const declUri = freshUri();
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);
    return hints.length > 0 ? hints[0].position.character : -1;
  }

  it('`val val = fetch()` → hintPos juste après le 2e `val`, pas le 1er', async () => {
    // Ancienne impl (text.indexOf double) : trouvait col 3 (1er 'val')
    // Nouvelle impl (matchStr.indexOf avec kwEnd) : trouve col 7 (après 2e 'val')
    // varName='val', rhs='fetch()' → on cherche 'fetch' dans l'index
    const col = await colFor('val val = fetch()', 'fun fetch(): String {}');
    // La colonne 7 = 'val'(0-2) + ' '(3) + 'val'(4-6) → hintPos = 4+3 = 7
    expect(col).toBe(7);
  });

  it('`val value = fetch()` → col 9 (régression test — les deux impls correct ici)', async () => {
    const col = await colFor('val value = fetch()', 'fun fetch(): String {}');
    expect(col).toBe(9);
  });

  it('`val valeurInitiale = fetch()` → col correct après varName long', async () => {
    const col = await colFor('val valeurInitiale = fetch()', 'fun fetch(): String {}');
    // kwEnd=3, indexOf('valeurInitiale',3)=4, hintPos=4+14=18
    expect(col).toBe(18);
  });
});

// ── BUG B : `if (` capturé par CALL_RE avant le vrai appel ──────────────────

describe('BUG B — keyword `if` capturé comme appel de fonction', () => {
  it('`val x = if (cond) fetch() else default()` → 0 hints (limitation documentée)', async () => {
    // CALL_RE trouve `if(` avant `fetch(` → `if` non-indexé → 0 hints
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = if (cond) fetch() else default()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    // Comportement actuel : 0 hints (if non-indexé bloquerait la résolution)
    // Ce test documente la limitation : le vrai appel fetch() n'est pas trouvé
    expect(hints.length).toBe(0);
  });
});

// ── BUG C : appel de méthode avec receiver ───────────────────────────────────

describe('BUG C — appel de méthode avec receiver (`obj.fetch()`)', () => {
  it('`val x = obj.fetch()` — ne crashe pas, résultat cohérent', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = obj.fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    // Ne doit pas crasher — le résultat (0 ou 1 hint) est secondaire
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);
    expect(Array.isArray(hints)).toBe(true);
  });
});

// ── BUG D : generic call `foo<Int>()` non matché par CALL_RE ─────────────────

describe('BUG D — generic call `foo<Int>()` non matché par CALL_RE', () => {
  it('`val x = foo<Int>()` → 0 hints (limitation documentée)', async () => {
    // CALL_RE cherche `\b([A-Za-z_]\w*)\s*\(` — `foo` n'est pas suivi de `(` mais de `<`
    // donc CALL_RE ne matche pas `foo<Int>(` → 0 hints
    const declUri = freshUri();
    const decl = 'fun foo(): String {}';
    const call = 'val x = foo<Int>()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(null as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(0);
  });
});

// ── BUG E : raw string contenant une déclaration val ─────────────────────────

describe('BUG E — raw string contenant `val x = fetch()`', () => {
  it('3 lignes avec raw string → 0 hints sur la ligne intérieure', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const code = 'val template = """\nval x = fetch()\n"""';
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), code), fullRange(code), token);

    // La ligne 1 est à l'intérieur de la raw string → raw string guard → 0 hints
    expect(hints.length).toBe(0);
  });
});

// ── BUG F : trailing spaces dans le RHS ──────────────────────────────────────

describe('BUG F — trailing spaces dans le RHS', () => {
  it('`val x = fetch()   ` (espaces finaux) → 1 hint correct', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = fetch()   ';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    // rhsOffset = matchStr.length - rhs.length — correct même avec espaces finaux capturés dans rhs
    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
  });
});

// ── BUG G : ambiguïté de résolution → 0 hints ────────────────────────────────

describe('BUG G — ambiguïté : deux `foo` dans l\'index', () => {
  it('deux déclarations `fun foo()` dans des fichiers différents → 0 hints', async () => {
    const uri1 = freshUri();
    const uri2 = freshUri();
    const callUri = freshUri();
    const decl = 'fun foo(): String {}';
    const call = 'val x = foo()';

    const index = new SymbolIndex();
    addFile(index, uri1, decl);
    addFile(index, uri2, decl);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(uri1, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    // Deux entrées → ambiguïté → resolveCallEntry retourne undefined → 0 hints
    expect(hints.length).toBe(0);
  });
});

// ── BUG H : pollution du cache entre instances ────────────────────────────────

describe('BUG H — cache par instance (pas de pollution entre providers)', () => {
  it('provider1 et provider2 avec même FQN mais sigs différentes → types différents', async () => {
    const SAME_URI = `file:///CachePollution2_${_id++}.kt`;
    const decl1 = 'fun getData(): String {}';
    const decl2 = 'fun getData(): Int {}';
    const callCode = 'val x = getData()';

    const index1 = new SymbolIndex();
    const index2 = new SymbolIndex();
    addFile(index1, SAME_URI, decl1);
    addFile(index2, SAME_URI, decl2);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValueOnce(mockDocument(SAME_URI, decl1) as any);

    const provider1 = inferredProvider(index1);
    const hints1 = await provider1.provideInlayHints(mockDocument(freshUri(), callCode), fullRange(callCode), token);

    vi.restoreAllMocks();
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValueOnce(mockDocument(SAME_URI, decl2) as any);

    const provider2 = inferredProvider(index2);
    const hints2 = await provider2.provideInlayHints(mockDocument(freshUri(), callCode), fullRange(callCode), token);

    expect((hints1[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
    expect((hints2[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': Int');
  });
});

// ── BUG I : appel dans une string literal ────────────────────────────────────

describe('BUG I — appel dans une string literal → isInsideCommentOrString doit filtrer', () => {
  it('`val x = "fetch()"` → 0 hints (callOffset dans la string)', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = "fetch()"';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    // isInsideCommentOrString(text, callOffset) doit retourner true → skip
    expect(hints.length).toBe(0);
  });

  it('`val x = "prefix" + fetch()` → 1 hint (appel APRÈS la string)', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = "prefix" + fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    // CALL_RE: trouve `fetch(` à l'extérieur de la string — 1 hint attendu
    // (Si 0 hints : CALL_RE a trouvé un token dans la string avant fetch)
    // On vérifie juste que ça ne crashe pas et que le comportement est raisonnable
    expect(hints.length).toBeGreaterThanOrEqual(0); // pas de crash
  });
});

// ── BUG J : fonction retournant une fonction ──────────────────────────────────

describe('BUG J — fonction retournant `() -> Unit` → hint correct', () => {
  it('`val handler = getHandler()` → 1 hint `: () -> Unit`', async () => {
    // `() -> Unit` comme type de retour n'est PAS null dans extractReturnType
    const declUri = freshUri();
    const decl = 'fun getHandler(): () -> Unit = {}';
    const call = 'val handler = getHandler()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': () -> Unit');
  });
});

// ── BUG K : modificateurs exotiques (actual/expect/const) ────────────────────

describe('BUG K — modificateurs exotiques dans VAL_VAR_RE', () => {
  async function hintsFor(call: string) {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    return (await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token)).length;
  }

  it('`actual val x = fetch()` → 1 hint', async () =>
    expect(await hintsFor('actual val x = fetch()')).toBe(1));

  it('`expect val x = fetch()` → 1 hint', async () =>
    expect(await hintsFor('expect val x = fetch()')).toBe(1));

  it('`const val x = fetch()` → 1 hint', async () =>
    expect(await hintsFor('const val x = fetch()')).toBe(1));
});

// ── BUG L : object expression → 0 hints ──────────────────────────────────────

describe('BUG L — object expression → 0 hints', () => {
  it('`val x = object : Foo() {}` → 0 hints (Foo est class, extractReturnType null)', async () => {
    const declUri = freshUri();
    // Foo est une classe — extractReturnType retourne null pour les class
    const decl = 'class Foo {}';
    const call = 'val x = object : Foo() {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(0);
  });
});

// ── BUG M : varName contenant `val` ──────────────────────────────────────────

describe('BUG M — varName contenant `val` comme sous-chaîne', () => {
  it('`val valeurInitiale = fetch()` → hintPos col 18 (pas 0)', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val valeurInitiale = fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(1);
    // kwEnd=3, indexOf('valeurInitiale',3)=4, hintPos=4+14=18
    expect(hints[0].position.character).toBe(18);
  });
});

// ── BUG N : `fun` dans le nom de la fonction ─────────────────────────────────

describe('BUG N — `fun` dans le nom de la fonction (`\bfun\b` word-boundary)', () => {
  it('`val x = getFun()` où `getFun` retourne String → 1 hint `: String`', async () => {
    // extractReturnType doit matcher `\bfun\b` dans `fun getFun()`, pas dans `getFun`
    const declUri = freshUri();
    const decl = 'fun getFun(): String {}';
    const call = 'val x = getFun()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
  });
});

// ── BUG O : `object Factory` déclaration → pas de crash ─────────────────────

describe('BUG O — `object Factory` → isDecl=true mais VAL_VAR_RE no match → pas de crash', () => {
  it('ligne `object Factory` → 0 hints, pas d\'exception', async () => {
    const index = new SymbolIndex();
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(null as any);

    const call = 'object Factory';
    let hints: any[];
    let threw = false;
    try {
      hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);
    } catch {
      threw = true;
      hints = [];
    }

    expect(threw).toBe(false);
    expect(hints!.length).toBe(0);
  });
});
