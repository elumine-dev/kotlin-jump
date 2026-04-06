/**
 * Tests adversaires pour KotlinSignatureHelpProvider
 *
 * BUG C — findTypeEnd traite `>` dans `->` comme crochet fermant → highlight tronqué
 * BUG F — Cache module-level sigCache brise l'isolation entre tests
 *
 * Note : chaque test utilise un nom de fonction UNIQUE pour éviter que BUG F
 * ne pollue les tests qui ne testent pas BUG F.
 *
 * Lancer :
 *   npm test -- test/unit/SignatureHelpProvider.adversarial.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
/** URI unique garantie : évite que BUG F pollue des tests non liés. */
function freshUri() { return `file:///SigAdv_${_id++}.kt`; }
/** Nom de fonction unique pour isoler le sigCache par FQN. */
function freshFn() { return `sigFn${_id++}`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const token = { isCancellationRequested: false } as any;

function ctx(triggerChar?: string): any {
  return { triggerKind: triggerChar ? 2 : 1, triggerCharacter: triggerChar, isRetrigger: false };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Dismiss sur `)` ──────────────────────────────────────────────────────────

describe('SignatureHelp — dismiss', () => {
  it('triggerCharacter ")" → retourne null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);

    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'foo()'),
      new Position(0, 5),
      token,
      ctx(')'),
    );
    expect(result).toBeNull();
  });
});

// ── activeParameter — comptage de virgules ────────────────────────────────────
// Chaque test utilise un nom de fonction différent pour éviter BUG F.

describe('SignatureHelp — activeParameter via position curseur', () => {
  it('curseur juste après `(` → activeParameter = 0', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(a: Int, b: Int, c: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, 2, 3)`;
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, fn.length + 1), // juste après `(`
      token, ctx('('),
    );
    expect(result?.activeParameter).toBe(0);
  });

  it('curseur avant le 2e arg → activeParameter = 1', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(a: Int, b: Int, c: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, 2, 3)`;
    const provider = new KotlinSignatureHelpProvider(index);
    // Position après la 1re virgule : `fn(1, ` → fn.length + 4
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, fn.length + 4),
      token, ctx(','),
    );
    expect(result?.activeParameter).toBe(1);
  });

  it('curseur avant le 3e arg → activeParameter = 2', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(a: Int, b: Int, c: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, 2, 3)`;
    const provider = new KotlinSignatureHelpProvider(index);
    // Position après la 2e virgule : `fn(1, 2, ` → fn.length + 7
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, fn.length + 7),
      token, ctx(','),
    );
    expect(result?.activeParameter).toBe(2);
  });

  it('activeParameter clampé si curseur au-delà du nb de params', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(a: Int, b: Int) {}`; // seulement 2 params
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, 2, 3, 4)`;
    const provider = new KotlinSignatureHelpProvider(index);
    // Curseur avant le 4e arg — activeParameter brut = 3, clampé à 1
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length - 2),
      token, ctx(','),
    );
    // BUG DÉCOUVERT : clamp ne fonctionne pas toujours → peut retourner > params.length-1
    expect(result?.activeParameter).toBeLessThanOrEqual(1);
  });

  it('appel imbriqué outer(inner(a, b), c) → activeParameter = 1 pour outer', async () => {
    const outerFn = freshFn();
    const innerFn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${outerFn}(x: Int, y: Int) {}\nfun ${innerFn}(a: Int, b: Int): Int = 0`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${outerFn}(${innerFn}(1, 2), 3)`;
    const provider = new KotlinSignatureHelpProvider(index);
    // Curseur avant le `3` de outer → après `inner(1, 2), `
    const cursorPos = callCode.indexOf(', 3)') + 2;
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, cursorPos),
      token, ctx(','),
    );
    // outer a 2 args, on est sur le 2e → activeParameter = 1
    expect(result?.activeParameter).toBe(1);
  });
});

// ── Hors contexte d'appel → null ─────────────────────────────────────────────

describe('SignatureHelp — hors contexte d\'appel', () => {
  it('curseur en dehors de tout appel → null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'val x = 42'),
      new Position(0, 5),
      token, ctx(),
    );
    expect(result).toBeNull();
  });

  it('keyword `if` → null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'if (condition) {}'),
      new Position(0, 4),
      token, ctx('('),
    );
    expect(result).toBeNull();
  });

  it('keyword `for` → null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'for (item in list) {}'),
      new Position(0, 5),
      token, ctx('('),
    );
    expect(result).toBeNull();
  });

  it('curseur à l\'intérieur d\'un lambda `{ }` → null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'items.forEach { item -> item.name }'),
      new Position(0, 20),
      token, ctx(),
    );
    expect(result).toBeNull();
  });

  it('function inconnue de l\'index → null', async () => {
    const index = new SymbolIndex();
    const provider = new KotlinSignatureHelpProvider(index);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(null as any);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), 'unknownFn(42)'),
      new Position(0, 10),
      token, ctx('('),
    );
    expect(result).toBeNull();
  });
});

// ── BUG C : highlight tronqué pour les types lambda ──────────────────────────

describe('BUG C — findTypeEnd tronque les types lambda avec `->`', () => {
  /**
   * Retourne le substring surligné pour le paramètre `paramIndex` dans la signature.
   * cursor est placé APRÈS le `(` de l'appel.
   */
  async function getHighlightedSlice(
    declCode: string,
    fnName: string,
    paramIndex: number,
  ): Promise<string | null> {
    const declUri = freshUri();
    const callUri = freshUri();
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const provider = new KotlinSignatureHelpProvider(index);
    const callCode = `${fnName}(`;  // curseur juste APRÈS le (
    const result = await provider.provideSignatureHelp(
      mockDocument(callUri, callCode),
      new Position(0, callCode.length), // après le (
      token,
      ctx('('),
    );

    if (!result) return null;
    const sig = result.signatures[0];
    if (!sig) return null;
    const param = sig.parameters[paramIndex];
    if (!param) return null;

    const label = param.label;
    if (Array.isArray(label)) {
      return sig.label.slice(label[0], label[1]);
    }
    return label as string;
  }

  it('() -> Unit : le highlight doit inclure `-> Unit`', async () => {
    const fn = freshFn();
    const decl = `fun ${fn}(block: () -> Unit) {}`;
    const slice = await getHighlightedSlice(decl, fn, 0);
    expect(slice).not.toBeNull();
    // BUG C — attend fix : findTypeEnd s'arrête à `>` de `->` → slice = "() -" ou "() ->"
    expect(slice).toContain('->');
    expect(slice).toContain('Unit');
  });

  it('@Composable () -> Unit : le highlight doit inclure `-> Unit`', async () => {
    const fn = freshFn();
    const decl = `fun ${fn}(content: @Composable () -> Unit) {}`;
    const slice = await getHighlightedSlice(decl, fn, 0);
    expect(slice).not.toBeNull();
    // BUG C — attend fix
    expect(slice).toContain('->');
    expect(slice).toContain('Unit');
  });

  it('(Int, String) -> Boolean : le highlight doit inclure `-> Boolean`', async () => {
    const fn = freshFn();
    const decl = `fun ${fn}(pred: (Int, String) -> Boolean) {}`;
    const slice = await getHighlightedSlice(decl, fn, 0);
    expect(slice).not.toBeNull();
    // BUG C — attend fix
    expect(slice).toContain('->');
    expect(slice).toContain('Boolean');
  });

  it('type simple List<String> : pas affecté par BUG C, highlight correct', async () => {
    const fn = freshFn();
    const decl = `fun ${fn}(items: List<String>) {}`;
    const slice = await getHighlightedSlice(decl, fn, 0);
    expect(slice).not.toBeNull();
    // ✓ List<String> n'a pas de `->` → doit fonctionner correctement
    expect(slice).toContain('List');
    expect(slice).toContain('String');
  });
});

// ── Structure correcte de la réponse ─────────────────────────────────────────

describe('SignatureHelp — structure de la réponse', () => {
  it('retourne une signature avec le bon label', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(name: String) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    expect(result!.signatures.length).toBe(1);
    expect(result!.signatures[0].label).toContain(fn);
    expect(result!.signatures[0].parameters.length).toBe(1);
  });

  it('la documentation KDoc est incluse quand disponible', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `/** Envie un message. @param text le contenu */\nfun ${fn}(text: String) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    expect(result!.signatures[0].documentation).toBeDefined();
  });

  it('paramètre simple : les offsets [start, end] pointent vers `name: Type`', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(myCount: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const paramLabel = result!.signatures[0].parameters[0].label;
    const sig = result!.signatures[0].label;
    const slice = Array.isArray(paramLabel)
      ? sig.slice((paramLabel as [number, number])[0], (paramLabel as [number, number])[1])
      : paramLabel as string;
    expect(slice).toContain('myCount');
  });
});

// ── BUG F : isolation cache ───────────────────────────────────────────────────

describe('BUG F — sigCache module-level brise l\'isolation des tests', () => {
  it('même FQN (même URI), signature différente → le 2e test reçoit des données stales', async () => {
    // On utilise le MÊME URI pour forcer le même FQN dans les deux appels
    const SAME_URI  = 'file:///BugFSig_collision.kt';
    const callUri   = freshUri();

    // ──────── Premier appel : funcBugF(x: Int) ────────
    const declCode1 = 'fun funcBugF(x: Int) {}';
    const index1 = new SymbolIndex();
    addFile(index1, SAME_URI, declCode1);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(SAME_URI, declCode1) as any);

    const provider1 = new KotlinSignatureHelpProvider(index1);
    const result1 = await provider1.provideSignatureHelp(
      mockDocument(callUri, 'funcBugF('),
      new Position(0, 9),
      token, ctx('('),
    );
    expect(result1).not.toBeNull();
    const sig1 = result1!.signatures[0].label;
    expect(sig1).toContain('x');
    vi.restoreAllMocks();

    // ──────── Deuxième appel : même FQN mais signature différente funcBugF(y: String) ────────
    const declCode2 = 'fun funcBugF(y: String) {}';
    const index2 = new SymbolIndex();
    addFile(index2, SAME_URI, declCode2);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(SAME_URI, declCode2) as any);

    const provider2 = new KotlinSignatureHelpProvider(index2);
    const result2 = await provider2.provideSignatureHelp(
      mockDocument(callUri, 'funcBugF('),
      new Position(0, 9),
      token, ctx('('),
    );

    expect(result2).not.toBeNull();
    // BUG F — attend fix : le cache retourne encore sig1 (avec `x`) au lieu de sig2 (avec `y`)
    const sig2 = result2!.signatures[0].label;
    expect(sig2).toContain('y');
    expect(sig2).not.toContain('x: Int');
  });
});

// ── Parens dans les strings ───────────────────────────────────────────────────

describe('SignatureHelp — parens dans les strings', () => {
  it('string "()" balancées → activeParameter correct', async () => {
    const fn = freshFn();
    const declUri  = freshUri();
    const declCode = `fun ${fn}(msg: String, n: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Curseur avant `42` → après la virgule
    const callCode = `${fn}("()", `;
    const provider = new KotlinSignatureHelpProvider(index);
    const result = await provider.provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx(','),
    );
    // Les parens dans "()" s'annulent → activeParameter = 1 pour `n`
    expect(result?.activeParameter).toBe(1);
  });
});
