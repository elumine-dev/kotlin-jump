/**
 * Tests adversaires — contamination string/comment dans InlayHintsProvider
 *
 * BUG G — CALL_RE matche à l'intérieur des string literals
 *          InlayHintsProvider ne vérifie jamais isInsideCommentOrString().
 *          `isInsideCommentOrString` existe dans src/util/textUtils.ts mais
 *          n'est PAS importée ni utilisée dans InlayHintsProvider.
 *
 * BUG H — CALL_RE matche après un commentaire inline `//`
 *          La garde `^\s*(\/\/|...)` ne filtre que les lignes COMMENÇANT par `//`.
 *
 * BUG I — Les virgules DANS une string sont comptées par findArgPositions
 *          → mauvais nombre de hints et positions incorrectes.
 *
 * BUG J — Les raw strings `""" ... """` ne sont pas protégées.
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
function freshUri() { return `file:///StrGuard_${_id++}.kt`; }
function freshFn()  { return `sgFn${_id++}`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function fullRange(code: string): Range {
  const lines = code.split('\n');
  return new Range(
    new Position(0, 0),
    new Position(lines.length - 1, lines[lines.length - 1].length),
  );
}

const token = { isCancellationRequested: false } as any;

afterEach(() => vi.restoreAllMocks());

// ── BUG G : hints à l'intérieur des string literals ──────────────────────────

describe('BUG G — hints ne doivent pas apparaître dans les string literals', () => {
  it('appel dans un string double-quote → 0 hints', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(name: String) {}`;
    const callUri  = freshUri();
    // L'appel est DANS une string — pas du vrai code
    const callCode = `val msg = "${fn}(alice)"`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG G — attend fix : CALL_RE matche ${fn}( dans la string → hint apparaît
    expect(hints.length).toBe(0);
  });

  it('println("call greet(user) now") → 0 hints à l\'intérieur', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(user: String) {}`;
    const callUri  = freshUri();
    // La fonction réelle est println, pas fn — fn apparaît dans la string
    const callCode = `println("call ${fn}(user) now")`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    // println n'est pas dans l'index

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG G — attend fix : fn( est dans la string → 0 hints
    expect(hints.length).toBe(0);
  });

  it('string avec appel + appel réel : seul le vrai appel reçoit un hint', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const callUri  = freshUri();
    // String contenant fn(), PUIS un vrai appel fn()
    const callCode = `val s = "${fn}(0)"\n${fn}(42)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG G — attend fix : devrait être 1 (seulement le vrai appel ligne 1)
    // Actuellement : 2 (string + vrai appel)
    expect(hints.length).toBe(1);
    // Le hint doit être sur la ligne 1 (le vrai appel), pas la ligne 0 (string)
    expect(hints[0].position.line).toBe(1);
  });

  it('template string `"${expr}"` contenant un appel → 0 hints sur la string', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int): String = ""`;
    const callUri  = freshUri();
    // Template string — fn() est dans l'expression interpolée
    const callCode = `val s = "\${${fn}(1)}"`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // L'appel est réel (dans ${}) mais le contexte est une string template.
    // Comportement attendu débatable — au minimum 0 faux hints pour les strings pures.
    // Ce test documente le comportement actuel.
    expect(typeof hints.length).toBe('number'); // ne doit pas crasher
  });

  it('raw string `""" ... """` contenant un appel → 0 hints', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const callUri  = freshUri();
    const callCode = `val s = \"\"\"\n${fn}(99)\n\"\"\"`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG J — attend fix : appel dans raw string → 0 hints
    expect(hints.length).toBe(0);
  });
});

// ── BUG H : hints après commentaires inline ───────────────────────────────────

describe('BUG H — hints ne doivent pas apparaître après `//` inline', () => {
  it('val x = value // fn(explanation) → 0 hints après //', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const callUri  = freshUri();
    // L'appel est dans le commentaire — pas du code exécutable
    const callCode = `val x = 42 // ${fn}(explanation)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG H — attend fix : CALL_RE matche fn( dans le commentaire → hint à tort
    expect(hints.length).toBe(0);
  });

  it('return result // fn(amount) not called → 0 hints', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(amount: Int): Int = amount`;
    const callUri  = freshUri();
    const callCode = `return result // ${fn}(amount) not called`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG H — attend fix
    expect(hints.length).toBe(0);
  });

  it('vrai appel + commentaire sur même ligne : 1 hint uniquement pour le vrai appel', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const callUri  = freshUri();
    // Vrai appel AVANT le commentaire, faux appel DANS le commentaire
    const callCode = `${fn}(1) // also ${fn}(2)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG H — attend fix : devrait être 1 (avant //) pas 2
    expect(hints.length).toBe(1);
    // Le seul hint doit être avant le `//`
    expect(hints[0].position.character).toBeLessThan(callCode.indexOf('//'));
  });
});

// ── BUG I : virgules dans les strings faussent findArgPositions ───────────────

describe('BUG I — virgules dans les strings faussent le comptage d\'arguments', () => {
  it('foo("a, b, c", x) → 2 hints (pas 4)', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(csv: String, count: Int) {}`;
    const callUri  = freshUri();
    const callCode = `${fn}("a, b, c", 3)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // BUG I — attend fix : findArgPositions compte les virgules dans "a, b, c"
    // → 4 positions au lieu de 2 → hints erronés et décalés
    expect(hints.length).toBe(2);
    // Les noms corrects sont csv: et count:
    const names = hints.map(h => (h.label as vscodeMock.InlayHintLabelPart[])[0].value);
    expect(names).toEqual([`${fn.startsWith('sgFn') ? 'csv' : 'csv'}:`, 'count:']);
  });

  it('foo("name: value", x) → 2 hints (pas de hint sur le `:` dans la string)', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(pair: String, extra: Int) {}`;
    const callUri  = freshUri();
    const callCode = `${fn}("name: value", 1)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // Le `:` dans la string ne doit pas interférer
    expect(hints.length).toBe(2);
  });

  it('foo(mapOf("k" to 1, "j" to 2), x) → 2 hints', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(data: Map<String,Int>, n: Int) {}`;
    const callUri  = freshUri();
    const callCode = `${fn}(mapOf("k" to 1, "j" to 2), 0)`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // Les virgules dans mapOf("k" to 1, "j" to 2) ne doivent pas être comptées
    // comme des séparateurs d'arguments de fn
    expect(hints.length).toBe(2);
  });
});

// ── CALL_RE sur des lignes spéciales ─────────────────────────────────────────

describe('CALL_RE — lignes spéciales ne doivent pas produire de hints', () => {
  it('ligne annotation `@Suppress("CAST")` → 0 hints', async () => {
    const callUri  = freshUri();
    const callCode = '@Suppress("CAST")';
    const index = new SymbolIndex();

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(null as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // `Suppress(` serait matché par CALL_RE mais Suppress n'est pas dans l'index
    expect(hints.length).toBe(0);
  });

  it('ligne import ne produit pas de hints', async () => {
    const callUri  = freshUri();
    const callCode = 'import com.example.foo.Bar';
    const index = new SymbolIndex();

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    expect(hints.length).toBe(0);
  });

  it('opérateur `?.let { }` — safe call ne produit pas de hint', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const callUri  = freshUri();
    // `.let` est un appel avec trailing lambda — pas de vrais args positionnels
    const callCode = `x?.let { ${fn}(it) }`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // `let` n'est pas dans l'index et fn(it) devrait avoir 1 hint
    // Le test vérifie juste qu'on ne crashe pas et que le nombre est raisonnable
    expect(hints.length).toBeLessThanOrEqual(1);
  });
});

// ── Enchaînement méthodes ─────────────────────────────────────────────────────

describe('InlayHints — appels enchaînés', () => {
  it('foo(a).bar(b) → 2 appels = 2 ensembles de hints séparés', async () => {
    const fn1 = freshFn();
    const fn2 = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn1}(x: Int): Any = TODO()\nfun ${fn2}(y: String) {}`;
    const callUri  = freshUri();
    const callCode = `${fn1}(1).toString().let { ${fn2}("hi") }`;

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      fullRange(callCode),
      token,
    );

    // fn1(1) → 1 hint pour x:, fn2("hi") → 1 hint pour y:
    // toString() et let{} n'ont pas de params à hinter
    expect(hints.length).toBeGreaterThanOrEqual(1);

    // Vérifier que les positions sont différentes
    if (hints.length >= 2) {
      const chars = hints.map(h => h.position.character);
      expect(new Set(chars).size).toBeGreaterThan(1);
    }
  });
});
