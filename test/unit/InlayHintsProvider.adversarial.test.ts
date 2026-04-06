/**
 * Tests adversaires pour KotlinInlayHintsProvider
 *
 * BUG D — Déclarations avec modificateurs (private/suspend/override/…) reçoivent des hints
 * BUG E — Arg nommé commençant par majuscule n'est pas détecté → hint affiché à tort
 * BUG F — Cache module-level brise l'isolation entre tests
 *
 * Lancer :
 *   npm test -- test/unit/InlayHintsProvider.adversarial.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function freshUri() { return `file:///Adv_${_id++}.kt`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function makeRange(code: string): Range {
  const lines = code.split('\n');
  return new Range(
    new Position(0, 0),
    new Position(lines.length - 1, lines[lines.length - 1].length),
  );
}

const token = { isCancellationRequested: false } as any;
const cancelledToken = { isCancellationRequested: true } as any;

// ── Setup / teardown ──────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Comportements corrects ────────────────────────────────────────────────────

describe('InlayHints — comportements corrects attendus', () => {
  it('appel simple 1 param → 1 hint', async () => {
    const declUri  = freshUri();
    const declCode = 'fun greet(name: String) {}';
    const callUri  = freshUri();
    const callCode = 'greet("Alice")';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(1);
    const label = hints[0].label as vscodeMock.InlayHintLabelPart[];
    expect(label[0].value).toBe('name:');
  });

  it('appel 2 params → 2 hints dans le bon ordre', async () => {
    const declUri  = freshUri();
    const declCode = 'fun add(x: Int, y: Int): Int = x + y';
    const callUri  = freshUri();
    const callCode = 'add(1, 2)';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(2);
    const names = hints.map(h => (h.label as vscodeMock.InlayHintLabelPart[])[0].value);
    expect(names).toEqual(['x:', 'y:']);
  });

  it('appel sans args → 0 hints', async () => {
    const declUri  = freshUri();
    const declCode = 'fun noParams() {}';
    const callUri  = freshUri();
    const callCode = 'noParams()';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(0);
  });

  it('arg nommé en minuscule → hint skippé', async () => {
    const declUri  = freshUri();
    const declCode = 'fun send(message: String) {}';
    const callUri  = freshUri();
    const callCode = 'send(message = "hello")';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(0);
  });

  it('token annulé → retourne immédiatement []', async () => {
    const declUri  = freshUri();
    const declCode = 'fun foo(x: Int) {}';
    const callUri  = freshUri();
    const callCode = 'foo(1)';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      cancelledToken,
    );

    expect(hints).toEqual([]);
  });

  it('déclaration `fun foo(x: Int)` sans modificateur → aucun hint', async () => {
    const uri  = freshUri();
    const code = 'fun foo(x: Int) {}';

    const index = new SymbolIndex();
    addFile(index, uri, code);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(uri, code) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(uri, code),
      makeRange(code),
      token,
    );

    // La ligne `fun foo(x: Int)` est une déclaration → 0 hints
    expect(hints.length).toBe(0);
  });

  it('appel hors du range → 0 hints', async () => {
    const declUri  = freshUri();
    const declCode = 'fun bar(n: Int) {}';
    const callUri  = freshUri();
    // L'appel est à la ligne 5, le range ne couvre que la ligne 0
    const callCode = '\n\n\n\n\nbar(42)';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      new Range(new Position(0, 0), new Position(0, 0)), // range = ligne 0 seulement
      token,
    );

    expect(hints.length).toBe(0);
  });
});

// ── BUG D : déclarations avec modificateurs ──────────────────────────────────

describe('BUG D — déclarations avec modificateurs ne doivent pas recevoir de hints', () => {
  async function hintsForDecl(declLine: string): Promise<number> {
    const declUri = freshUri();
    const code = `${declLine}\n    println("body")`;

    const index = new SymbolIndex();
    addFile(index, declUri, code);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, code) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(declUri, code),
      // Range couvre uniquement la ligne de déclaration (ligne 0)
      new Range(new Position(0, 0), new Position(0, declLine.length)),
      token,
    );
    return hints.length;
  }

  it('private fun foo(x: Int) → aucun hint sur la déclaration', async () => {
    // BUG D — attend fix : CALL_RE matche foo( et retourne des hints
    expect(await hintsForDecl('private fun foo(x: Int)')).toBe(0);
  });

  it('internal suspend fun bar(x: String) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('internal suspend fun bar(x: String)')).toBe(0);
  });

  it('override fun baz(x: Int) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('override fun baz(x: Int)')).toBe(0);
  });

  it('protected open fun qux(x: Int) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('protected open fun qux(x: Int)')).toBe(0);
  });

  it('abstract fun method(x: Int) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('abstract fun method(x: Int)')).toBe(0);
  });

  it('inline fun transform(x: Int) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('inline fun transform(x: Int)')).toBe(0);
  });

  it('operator fun plus(other: Int) → aucun hint', async () => {
    // BUG D — attend fix
    expect(await hintsForDecl('operator fun plus(other: Int)')).toBe(0);
  });
});

// ── BUG E : arg nommé avec majuscule ─────────────────────────────────────────

describe('BUG E — arg nommé commençant par majuscule doit supprimer le hint', () => {
  it('foo(MyArg = value) → 0 hints car arg déjà nommé', async () => {
    const declUri  = freshUri();
    const declCode = 'fun foo(MyArg: String) {}';
    const callUri  = freshUri();
    const callCode = 'foo(MyArg = "hello")';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    // BUG E — attend fix : isNamedArg n'accepte que [a-z_] en initiale,
    // donc 'MyArg = "hello"' → false → hint affiché à tort
    expect(hints.length).toBe(0);
  });

  it('foo(Value = 42) → 0 hints', async () => {
    const declUri  = freshUri();
    const declCode = 'fun foo(Value: Int) {}';
    const callUri  = freshUri();
    const callCode = 'foo(Value = 42)';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    // BUG E — attend fix
    expect(hints.length).toBe(0);
  });

  it('arg nommé minuscule reste correctement détecté', async () => {
    // ✓ comportement non-régressif : minuscule continue de fonctionner
    const declUri  = freshUri();
    const declCode = 'fun foo(myArg: String) {}';
    const callUri  = freshUri();
    const callCode = 'foo(myArg = "hello")';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(0); // déjà nommé correctement → skip ✓
  });
});

// ── BUG F : isolation des tests (cache module-level) ─────────────────────────

describe('BUG F — cache module-level brise l\'isolation des tests', () => {
  it('même FQN, déclarations différentes → les params du 2e test ne sont pas stales', async () => {
    // On utilise le MÊME URI (donc même FQN) pour deux déclarations différentes
    const SAME_URI = 'file:///CachePollution.kt';

    // Premier appel : foo(x: Int)
    const declCode1 = 'fun foo(x: Int) {}';
    const callCode  = 'foo(42)';
    const callUri   = freshUri();

    const index1 = new SymbolIndex();
    addFile(index1, SAME_URI, declCode1);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(SAME_URI, declCode1) as any);

    const provider1 = new KotlinInlayHintsProvider(index1);
    const hints1 = await provider1.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );
    expect(hints1.length).toBe(1);
    vi.restoreAllMocks();

    // Deuxième appel : même FQN mais signature différente foo(y: String)
    const declCode2 = 'fun foo(y: String) {}';
    const index2 = new SymbolIndex();
    addFile(index2, SAME_URI, declCode2);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(SAME_URI, declCode2) as any);

    const provider2 = new KotlinInlayHintsProvider(index2);
    const hints2 = await provider2.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    // BUG F — attend fix : le cache contient encore "x" du premier appel
    // Le hint devrait afficher "y:" mais affiche "x:" (données stales)
    expect(hints2.length).toBe(1);
    const label = (hints2[0].label as vscodeMock.InlayHintLabelPart[])[0].value;
    expect(label).toBe('y:'); // stale → affiche encore "x:"
  });
});

// ── Cas limites visuels ───────────────────────────────────────────────────────

describe('InlayHints — cas limites visuels', () => {
  it('argument lambda trailing { } → seul le param avant la lambda reçoit un hint', async () => {
    const declUri  = freshUri();
    // Kotlin : Column(modifier: Modifier, content: @Composable () -> Unit)
    const declCode = 'fun Column(modifier: String, content: () -> Unit) {}';
    const callUri  = freshUri();
    // L'appel a le modifier comme arg positionnel et le content comme trailing lambda
    const callCode = 'Column("fill") {\n    Text("hi")\n}';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    // Le trailing lambda `{ }` n'est pas dans les parens → 1 seul hint pour `modifier`
    expect(hints.length).toBe(1);
    const name = (hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value;
    expect(name).toBe('modifier:');
  });

  it('appel multi-ligne → hints positionnés sur la bonne ligne de chaque arg', async () => {
    const declUri  = freshUri();
    const declCode = 'fun launch(title: String, message: String) {}';
    const callUri  = freshUri();
    const callCode = 'launch(\n    "Title",\n    "Body"\n)';

    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(2);
    // Premier arg "Title" est à la ligne 1
    expect(hints[0].position.line).toBe(1);
    // Deuxième arg "Body" est à la ligne 2
    expect(hints[1].position.line).toBe(2);
  });

  it('function inconnue du l\'index → 0 hints', async () => {
    const callUri  = freshUri();
    const callCode = 'unknownFunction(42)';
    const index = new SymbolIndex(); // index vide

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(null as any);

    const provider = new KotlinInlayHintsProvider(index);
    const hints = await provider.provideInlayHints(
      mockDocument(callUri, callCode),
      makeRange(callCode),
      token,
    );

    expect(hints.length).toBe(0);
  });
});
