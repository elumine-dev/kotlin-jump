/**
 * KJ - une pastille peinte une ligne trop haut apres un simple retour ligne.
 *
 * Les deux fournisseurs incrementaux gardent leurs decorations dans une Map
 * indexee par ligne, et la reindexent quand une frappe ajoute ou retire une
 * ligne. Ce que VS Code peint, lui, c est le `Range` porte par chaque option,
 * et ce Range restait sur l ancienne ligne. La cle bougeait, la peinture non.
 *
 * Le test existant (GUARD-INC-C) ne regardait que la cle de la Map, donc il
 * passait alors que l affichage etait faux.
 *
 * Consequence pour le lecteur : apres une Entree, chaque pastille de couleur
 * et chaque `!!` surligne sous le curseur se dessine une ligne trop haut, sur
 * du code qui n a rien a voir, jusqu a ce qu un autre evenement force un
 * balayage complet. Mesure sur /Users/kevin/Desktop/work/lapresse : 882
 * pastilles dans 138 fichiers et 283 assertions dans 108 fichiers, et dans
 * chacun de ces fichiers la derniere decoration est sous la premiere ligne,
 * donc joignable par une seule frappe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';
import { makeChangeEvent } from './helpers';
import { shiftLineState } from '../../src/util/decorationShift';

const NL = String.fromCharCode(10);
const OUVRE = '/' + '*';
const FERME = '*' + '/';

function makeEditor(lines: string[]) {
  return {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] ?? '' }),
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

/** Les lignes REELLEMENT peintes, lues dans les Range remis a VS Code. */
function lignesPeintes(editor: any): number[] {
  const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
  return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
}

describe('Decorations incrementales - la ligne peinte suit la frappe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('pastille de couleur : une Entree au dessus repeint une ligne plus bas', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0xFF7F52FF',
      'val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val a = 0xFF7F52FF', '', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 18, 0, 18, NL));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 2]);
  });

  it('pastille de couleur : un retour arriere repeint une ligne plus haut', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0xFF7F52FF',
      '',
      'val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val a = 0xFF7F52FF', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 18, 1, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 1]);
  });

  it('la colonne de la pastille est conservee par le decalage', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0',
      '    val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val a = 0', '', '    val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 9, 0, 9, NL));
    vi.advanceTimersByTime(16);
    const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    expect(decs.map(d => [d.range.start.line, d.range.start.character])).toEqual([[2, 12]]);
  });

  it('la pastille garde sa couleur en changeant de ligne', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0',
      'val b = 0xFF001122',
    ]);
    const avant = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    const apres = makeEditor(['val a = 0', '', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 9, 0, 9, NL));
    vi.advanceTimersByTime(16);
    const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    expect(decs).toHaveLength(1);
    expect(decs[0].renderOptions?.before?.backgroundColor).toBeTruthy();
    expect(avant).toBeDefined();
  });

  it('assertion non nulle : une Entree au dessus repeint une ligne plus bas', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = b!!',
      'val c = d!!',
    ]);
    const apres = makeEditor(['val a = b!!', '', 'val c = d!!']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 11, 0, 11, NL));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 2]);
  });

  it('temoin : une frappe sans changement de ligne ne deplace rien', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0',
      'val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val a = 0x', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 0, 9, 0, 9, 'x'));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([1]);
  });
});

describe('shiftLineState', () => {
  it('une ligne inseree herite de la ligne coupee', () => {
    expect(shiftLineState([false, true, true, false], 2, 1))
      .toEqual([false, true, true, true, false]);
  });

  it('une ligne supprimee disparait de l etat', () => {
    expect(shiftLineState([false, true, true, false], 2, -1))
      .toEqual([false, true, false]);
  });

  it('un collage de trois lignes en herite aussi', () => {
    expect(shiftLineState([false, true, false], 2, 3))
      .toEqual([false, true, true, true, true, false]);
  });

  it('temoin : un delta nul rend la meme chose', () => {
    expect(shiftLineState([false, true, false], 2, 0)).toEqual([false, true, false]);
  });

  it('temoin : un etat jamais construit reste vide', () => {
    expect(shiftLineState([], 1, 1)).toEqual([]);
  });
});

/**
 * Le meme oubli que v1.42.193 a corrige pour les assertions non nulles, reste
 * entier chez son jumeau : effacer un `"""` ne se lit nulle part apres coup,
 * l evenement ne portant pas le texte retire. Sans memoire de la ligne d avant,
 * rien ne declenche la reconstruction et les pastilles restent peintes dans une
 * chaine brute desormais ouverte.
 */
describe('HexColorFoldingProvider - la frontiere de chaine brute effacee', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('supprimer le """ fermant eteint les pastilles qui suivent', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val s = """',
      'texte',
      '"""',
      'val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val s = """', 'texte', '', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 2, 0, 2, 3, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([]);
  });

  it('temoin : tant que le """ fermant est la, la pastille reste', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val s = """',
      'texte',
      '"""',
      'val b = 0xFF001122',
    ]);
    const apres = makeEditor(['val s = """', 'texte ', '"""', 'val b = 0xFF001122']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 5, 1, 5, ' '));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([3]);
  });
});

/**
 * Un decalage d une seule ligne reste invisible : les indices qui changent de
 * sens tombent alors pile sur les lignes qui portent un `"""`, et celles la
 * declenchent deja une reconstruction. Un collage de plusieurs lignes casse
 * cette coincidence, et l oracle non decale rend une pastille a un litteral
 * qui vit dans une chaine brute.
 */
describe('HexColorFoldingProvider - un collage multiligne decale l oracle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  const CORPS = [
    'val a = 0',
    'val s = """',
    'body1',
    'body2',
    'body3',
    '0xFF001122',
    '"""',
    'val b = 0',
  ];

  it('l assertion du bloc de commentaire non plus', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = 0',
      OUVRE,
      'body1',
      'body2',
      'body3',
      ' pas une assertion!!',
      FERME,
      'val b = 0',
    ]);
    const lignes = [
      'val a = 0', 'x', 'y', 'z',
      OUVRE, 'body1', 'body2', 'body3', ' pas une assertion!!', FERME, 'val b = 0',
    ];
    (provider as any)._applyChanges(
      makeChangeEvent(makeEditor(lignes).document, 0, 9, 0, 9, NL + 'x' + NL + 'y' + NL + 'z'),
    );
    vi.advanceTimersByTime(16);

    const encore = [...lignes];
    encore[8] = ' pas une assertion!! ';
    (provider as any)._applyChanges(makeChangeEvent(makeEditor(encore).document, 8, 20, 8, 20, ' '));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([]);
  });

  it('l assertion de la chaine brute reste sans surlignage apres le collage', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = 0',
      'val s = """',
      'body1',
      'body2',
      'body3',
      'pas une assertion!!',
      '"""',
      'val b = 0',
    ]);
    const apres = makeEditor([
      'val a = 0', 'x', 'y', 'z',
      'val s = """', 'body1', 'body2', 'body3', 'pas une assertion!!', '"""', 'val b = 0',
    ]).document;
    (provider as any)._applyChanges(
      makeChangeEvent(apres, 0, 9, 0, 9, NL + 'x' + NL + 'y' + NL + 'z'),
    );
    vi.advanceTimersByTime(16);

    const encore = makeEditor([
      'val a = 0', 'x', 'y', 'z',
      'val s = """', 'body1', 'body2', 'body3', 'pas une assertion!! ', '"""', 'val b = 0',
    ]).document;
    (provider as any)._applyChanges(makeChangeEvent(encore, 8, 19, 8, 19, ' '));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([]);
  });

  it('le litteral de la chaine brute reste sans pastille apres le collage', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, CORPS);
    const apres = makeEditor([
      'val a = 0', 'x', 'y', 'z',
      'val s = """', 'body1', 'body2', 'body3', '0xFF001122', '"""', 'val b = 0',
    ]).document;
    (provider as any)._applyChanges(
      makeChangeEvent(apres, 0, 9, 0, 9, NL + 'x' + NL + 'y' + NL + 'z'),
    );
    vi.advanceTimersByTime(16);

    // Une frappe ordinaire sur le litteral : il est dans la chaine brute.
    const encore = makeEditor([
      'val a = 0', 'x', 'y', 'z',
      'val s = """', 'body1', 'body2', 'body3', '0xFF001122 ', '"""', 'val b = 0',
    ]).document;
    (provider as any)._applyChanges(makeChangeEvent(encore, 8, 10, 8, 10, ' '));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([]);
  });
});
