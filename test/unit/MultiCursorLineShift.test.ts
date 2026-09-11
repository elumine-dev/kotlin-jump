/**
 * KJ - un multi curseur qui ajoute une ligne deplaçait deux fois ce qui suit.
 *
 * Un evenement de changement peut porter plusieurs modifications, toutes en
 * coordonnees du document d AVANT, livrees du bas vers le haut. Le document
 * remis au fournisseur, lui, les porte deja TOUTES.
 *
 * Le chemin incrementiel melangeait les deux espaces : il rebalayait la fenetre
 * de chaque changement en lisant le document final, ce qui place bien les
 * decorations, puis il appliquait le decalage du changement suivant, plus haut,
 * a ces memes decorations deja finales. Le bas du fichier partait une ligne trop
 * bas par curseur ajoute au dessus.
 *
 * Le geste : deux curseurs, Entree. Le test existant GUARD-INC-F couvrait deja
 * deux changements dans un evenement, mais aucun des deux ne changeait le nombre
 * de lignes, donc les deux espaces coincidaient et il ne prouvait rien la dessus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';

function makeEditor(lines: string[]) {
  return {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => {
        if (i < 0 || i >= lines.length) throw new Error('hors bornes: ' + i);
        return { text: lines[i] };
      },
    },
    setDecorations: vi.fn(),
  } as any;
}

function monter(Provider: any, lines: string[]) {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, def: any) => def,
  } as any);
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([] as any);
  const provider = new Provider();
  const editor = makeEditor(lines);
  (provider as any)._editor = editor;
  (provider as any)._fullScan(editor);
  editor.setDecorations.mockClear();
  return { provider, editor };
}

function lignesPeintes(editor: any): number[] {
  const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
  return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
}

/** Les changements tels que l editeur les livre : du bas vers le haut. */
function evenement(doc: any, changements: [number, number, number, number, string][]) {
  return {
    document: doc,
    reason: undefined,
    contentChanges: changements.map(([sl, sc, el, ec, text]) => ({
      range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
      text, rangeOffset: 0, rangeLength: 0,
    })),
  };
}

/** Ce qu un balayage complet du meme texte donnerait : la reference. */
function reference(Provider: any, lines: string[]): number[] {
  const provider = new Provider();
  const editor = makeEditor(lines);
  (provider as any)._editor = editor;
  (provider as any)._fullScan(editor);
  return lignesPeintes(editor);
}

const NL = String.fromCharCode(10);

describe('Multi curseur qui change le nombre de lignes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('assertion : deux Entrees en un evenement', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = b!!',
      'x',
      'val c = d!!',
    ]);
    const apres = ['val a = b!!', '', 'x', 'val c = d!!', ''];
    const doc = makeEditor(apres).document;
    (provider as any)._applyChanges(evenement(doc, [
      [2, 11, 2, 11, NL],
      [0, 11, 0, 11, NL],
    ]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 3]);
  });

  it('pastille : deux Entrees en un evenement', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0xFF112233',
      'x',
      'val c = 0xFF445566',
    ]);
    const apres = ['val a = 0xFF112233', '', 'x', 'val c = 0xFF445566', ''];
    const doc = makeEditor(apres).document;
    (provider as any)._applyChanges(evenement(doc, [
      [2, 18, 2, 18, NL],
      [0, 18, 0, 18, NL],
    ]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 3]);
  });

  it('trois curseurs, dont une suppression de ligne', () => {
    const avant = [
      'val a = b!!',
      'jetable',
      'val c = d!!',
      'val e = f!!',
    ];
    const { provider, editor } = monter(NullAssertionProvider, avant);
    const apres = ['val a = b!!', '', 'val c = d!!', '', 'val e = f!!'];
    const doc = makeEditor(apres).document;
    (provider as any)._applyChanges(evenement(doc, [
      [2, 11, 2, 11, NL],        // Entree apres `val c = d!!`
      [1, 0, 2, 0, ''],          // la ligne `jetable` disparait
      [0, 11, 0, 11, NL],        // Entree apres `val a = b!!`
    ]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual(reference(NullAssertionProvider, apres));
  });

  it('un seul des changements bouge les lignes, comme un correctif rapide', () => {
    // Une action de code qui ajoute une ligne en haut et retouche une ligne
    // plus bas livre un evenement aux deltas melanges. Il suffit d un seul
    // changement decalant pour que les coordonnees cessent de coincider.
    const { provider, editor } = monter(NullAssertionProvider, [
      'package p',
      'val a = 0',
      'val c = 0',
    ]);
    const apres = ['package p', 'import q', 'val a = 0', 'val c = d!!'];
    const doc = makeEditor(apres).document;
    (provider as any)._applyChanges(evenement(doc, [
      [2, 8, 2, 9, 'd!!'],       // meme ligne, aucun decalage
      [0, 9, 0, 9, NL + 'import q'],
    ]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual(reference(NullAssertionProvider, apres));
  });

  it('temoin : plusieurs curseurs sans changement de ligne restent incrementaux', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = 0',
      'val c = 0',
    ]);
    const doc = makeEditor(['val a = b!!', 'val c = d!!']).document;
    (provider as any)._applyChanges(evenement(doc, [
      [1, 8, 1, 9, 'd!!'],
      [0, 8, 0, 9, 'b!!'],
    ]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 1]);
  });

  it('temoin : un seul changement garde le chemin rapide', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = b!!',
      'val c = d!!',
    ]);
    const doc = makeEditor(['val a = b!!', '', 'val c = d!!']).document;
    (provider as any)._applyChanges(evenement(doc, [[0, 11, 0, 11, NL]]));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 2]);
  });
});
