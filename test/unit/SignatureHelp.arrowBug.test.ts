/**
 * BUG C — findTypeEnd s'arrête au `>` de `->` (même cause racine que BUG L)
 *
 * Dans SignatureHelpProvider.findTypeEnd, `>` est traité comme bracket fermant.
 * Pour un type lambda `() -> Unit`, après `()`, depth=0, puis `>` de `->`
 * déclenche `if (depth === 0) return i` → retour immédiat à la position de `>`.
 *
 * Résultat visuel : dans le popup SignatureHelp, le paramètre `block: () -> Unit`
 * est surligné comme `block: () -` seulement (le `> Unit` est exclu du highlight).
 *
 * BUG L aggrave le problème : parseParams retourne un mauvais nombre de params
 * → activeParameter est clamped à 0 même quand le curseur est devant un autre param.
 *
 * Lancer : npm test -- test/unit/SignatureHelp.arrowBug.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

let _id = 0;
function freshUri() { return `file:///SHArrowBug_${_id++}.kt`; }
function freshFn()  { return `shaBugFn${_id++}`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const token = { isCancellationRequested: false } as any;
function ctx(ch?: string): any {
  return { triggerKind: ch ? 2 : 1, triggerCharacter: ch, isRetrigger: false };
}

afterEach(() => vi.restoreAllMocks());

/** Extracts the highlighted text from a ParameterInformation label */
function getHighlight(sig: string, label: string | [number, number]): string {
  if (typeof label === 'string') return label;
  return sig.slice(label[0], label[1]);
}

// ── BUG C : highlight tronqué pour les types lambda ──────────────────────────

describe('BUG C — findTypeEnd : highlight tronqué pour `->` dans les types lambda', () => {
  it('fun foo(block: () -> Unit) — highlight doit inclure "-> Unit"', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];
    expect(sigInfo.parameters).toHaveLength(1);

    const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[0].label as string | [number, number]);
    // BUG C — s'arrête à `>` → highlight = "block: () -" au lieu de "block: () -> Unit"
    expect(highlighted).toContain('-> Unit');
  });

  it('fun foo(pred: (Int, String) -> Boolean) — lambda avec params', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(pred: (Int, String) -> Boolean) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];
    if (sigInfo.parameters.length >= 1) {
      const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[0].label as string | [number, number]);
      // BUG C — highlight s'arrête à `>` du `(Int, String) ->` ou du `-> Boolean`
      expect(highlighted).toContain('-> Boolean');
    }
  });

  it('fun foo(x: Int, block: () -> Unit) — highlight du 2e param lambda', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(x: Int, block: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, `;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx(','),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];

    if (sigInfo.parameters.length >= 2) {
      const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[1].label as string | [number, number]);
      // BUG C — highlight de `block: () -> Unit` tronqué à `block: () -`
      expect(highlighted).toContain('-> Unit');
    }
  });

  it('fun foo(block: suspend () -> Unit) — suspend lambda', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: suspend () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];
    if (sigInfo.parameters.length >= 1) {
      const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[0].label as string | [number, number]);
      // BUG C — même bug pour `suspend () -> Unit`
      expect(highlighted).toContain('-> Unit');
    }
  });

  it('fun foo(x: Int) — type simple : highlight correct (contrôle)', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(x: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];
    expect(sigInfo.parameters).toHaveLength(1);
    const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[0].label as string | [number, number]);
    // ✓ `Int` n'a pas de `->` → highlight correct
    expect(highlighted).toContain('Int');
  });

  it('fun foo(x: List<String>) — type générique : highlight correct (contrôle)', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(x: List<String>) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];
    if (sigInfo.parameters.length >= 1) {
      const highlighted = getHighlight(sigInfo.label, sigInfo.parameters[0].label as string | [number, number]);
      // ✓ List<String> — le `>` ferme `<String>` à depth=1→0 → highlight correct
      expect(highlighted).toContain('List<String>');
    }
  });
});

// ── BUG L + BUG C : activeParameter clamping avec params lambda ───────────────

describe('BUG L + BUG C — activeParameter incorrect avec lambda params', () => {
  it('foo(block: () -> Unit, count: Int) — curseur avant count → activeParameter devrait être 1', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: () -> Unit, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Curseur après la virgule → activeParameter = 1 dans findCallContext
    const callCode = `${fn}({}, `;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx(','),
    );

    expect(result).not.toBeNull();
    // BUG L : parseParams retourne 1 param (block seul)
    // → Math.min(1, max(0, 1-1)) = Math.min(1, 0) = 0
    // Correct : activeParameter = 1
    expect(result!.activeParameter).toBe(1);
  });

  it('foo(a: Int, block: () -> Unit, b: Int) — curseur avant b → activeParameter = 2', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(a: Int, block: () -> Unit, b: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, {}, `;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx(','),
    );

    expect(result).not.toBeNull();
    // BUG L : parseParams retourne 2 params (a, block avec type erroné)
    // → activeParameter clamped à 1 au lieu de 2
    expect(result!.activeParameter).toBe(2);
  });

  it('foo(x: Int, block: () -> Unit) — curseur avant block → activeParameter = 1 ✓', async () => {
    // ✓ Pas de BUG L (lambda en dernier) → activeParameter correct
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(x: Int, block: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, `;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx(','),
    );

    expect(result).not.toBeNull();
    // ✓ 2 params correctement parsés → activeParameter = 1
    expect(result!.activeParameter).toBe(1);
  });
});

// ── BUG C : vérification de la structure de la signature ─────────────────────

describe('BUG C — structure des ParameterInformation avec lambda', () => {
  it('fun foo(block: () -> Unit) — paramètres correctement parsés', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(`;
    const result = await new KotlinSignatureHelpProvider(index).provideSignatureHelp(
      mockDocument(freshUri(), callCode),
      new Position(0, callCode.length),
      token, ctx('('),
    );

    expect(result).not.toBeNull();
    const sigInfo = result!.signatures[0];

    // ✓ Un seul param (lambda seul fonctionne)
    expect(sigInfo.parameters).toHaveLength(1);

    // BUG C : le label [start, end] doit pointer sur "block: () -> Unit"
    const label = sigInfo.parameters[0].label;
    if (Array.isArray(label)) {
      const [start, end] = label;
      const covered = sigInfo.label.slice(start, end);
      // BUG C — end s'arrête au `>` de `->`
      expect(covered).toContain('block:');
      expect(covered).toContain('->');
      expect(covered).toContain('Unit');
    }
  });
});
