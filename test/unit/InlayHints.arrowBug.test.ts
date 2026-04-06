/**
 * BUG L — Conséquences sur InlayHintsProvider
 *
 * Quand parseParams retourne N params au lieu de M (N < M) à cause de BUG L,
 * InlayHintsProvider émet seulement N hints pour M arguments :
 *
 *   Math.min(argPositions.length, params.length) = Math.min(M, N) = N
 *
 * → Les derniers arguments (après le lambda) n'ont aucun hint.
 * → Le hint affiché pour le lambda a un tooltip avec un type erroné
 *   (inclut les noms des params suivants dans le type).
 *
 * Lancer : npm test -- test/unit/InlayHints.arrowBug.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

let _id = 0;
function freshUri() { return `file:///IHArrow_${_id++}.kt`; }
function freshFn()  { return `ihafn${_id++}`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const token = { isCancellationRequested: false } as any;

afterEach(() => vi.restoreAllMocks());

// ── BUG L : hints manquants après un lambda param ────────────────────────────

describe('BUG L — InlayHints : hints manquants après un paramètre lambda', () => {
  it('foo(block: () -> Unit, count: Int) — 2 args, devrait avoir 2 hints', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: () -> Unit, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    // Appel avec 2 arguments positionnels
    const callCode = `${fn}({}, 42)`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // BUG L — parseParams retourne 1 param au lieu de 2
    // → Math.min(2, 1) = 1 hint au lieu de 2
    // Comportement attendu après fix : 2 hints (block: et count:)
    expect(hints.length).toBe(2);
  });

  it('foo(pred: (Int, String) -> Boolean, count: Int) — lambda paramétré + int', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(pred: (Int, String) -> Boolean, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}({ a, b -> a > b }, 5)`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // BUG L — count absorbé dans le type de pred → 1 hint au lieu de 2
    expect(hints.length).toBe(2);
  });

  it('foo(a: Int, block: () -> Unit, b: Int) — lambda au milieu → 3 hints', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(a: Int, block: () -> Unit, b: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(1, {}, 2)`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // BUG L — `b` absorbé dans le type de block → 2 hints au lieu de 3
    expect(hints.length).toBe(3);
  });

  it('foo(a: () -> Int, b: () -> String) — deux lambdas → 2 hints', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(a: () -> Int, b: () -> String) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}({ 1 }, { "x" })`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // BUG L — b absorbé dans le type de a → 1 hint au lieu de 2
    expect(hints.length).toBe(2);
  });
});

// ── BUG L : tooltip incorrect sur le paramètre lambda ────────────────────────

describe('BUG L — InlayHints : tooltip erroné (type inclut les params suivants)', () => {
  it('tooltip du param lambda contient un type correct (pas "() -> Unit, count: Int")', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(block: () -> Unit, count: Int) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}({}, 42)`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    if (hints.length > 0) {
      const firstHint = hints[0];
      const labelPart = Array.isArray(firstHint.label) ? firstHint.label[0] : firstHint.label;
      const tooltip = typeof labelPart === 'object' ? labelPart.tooltip : undefined;

      if (tooltip) {
        const tooltipStr = typeof tooltip === 'string' ? tooltip : tooltip.value;
        // BUG L — le tooltip contient "() -> Unit, count: Int" au lieu de "() -> Unit"
        expect(tooltipStr).not.toContain('count: Int');
        expect(tooltipStr).toContain('() -> Unit');
      }
    }
  });
});

// ── Comportements corrects — lambda EN DERNIER ────────────────────────────────

describe('InlayHints — lambda EN DERNIER : comportement correct', () => {
  it('foo(x: Int, block: () -> Unit) — lambda en dernier → 2 hints ✓', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(x: Int, block: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(42, {})`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // ✓ Pas de BUG L quand le lambda est en dernier
    expect(hints.length).toBe(2);
  });

  it('foo(modifier: Modifier, content: @Composable () -> Unit) — pattern Compose ✓', async () => {
    const fn = freshFn();
    const declUri = freshUri();
    const declCode = `fun ${fn}(modifier: Modifier, content: () -> Unit) {}`;
    const index = new SymbolIndex();
    addFile(index, declUri, declCode);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, declCode) as any);

    const callCode = `${fn}(Modifier, {})`;
    const doc = mockDocument(freshUri(), callCode);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));
    const hints = await new KotlinInlayHintsProvider(index).provideInlayHints(doc, range, token);

    // ✓ Pattern Compose le plus courant fonctionne correctement
    expect(hints.length).toBe(2);
  });
});
