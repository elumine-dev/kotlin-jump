/**
 * KJ — l'oracle de bloc ajoute en v1.42.192 n'etait jamais rafraichi a la frappe.
 *
 * Le fournisseur est incrementiel : une frappe ne rescanne que les lignes
 * touchees. Il savait deja qu'une frontiere de chaine brute change tout le
 * reste du fichier, et forçait une reconstruction complete des qu'un `"""`
 * apparaissait dans le changement ou sur les lignes touchees.
 *
 * La v1.42.192 a ajoute un second etat multiligne, celui des blocs de
 * commentaire, sans etendre ce declencheur. Ouvrir un `/*` au-dessus d'une
 * ligne decoree ne reconstruisait donc rien : la decoration restait sur du
 * code desormais commente, jusqu'a ce qu'un autre evenement provoque un
 * balayage complet. Le symetrique vaut aussi : refermer un bloc ne rendait
 * pas ses decorations.
 *
 * C'est exactement le defaut que le declencheur existant evitait pour les
 * chaines brutes, reproduit sur l'etat voisin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';
import { makeChangeEvent } from './helpers';

const OUVRE = '/' + '*';
const FERME = '*' + '/';

function makeEditor(lines: string[]) {
  return {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    setDecorations: vi.fn(),
  } as any;
}

describe('NullAssertionProvider — invalidation sur frontiere de commentaire', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function monter(lines: string[]) {
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (_c: string, def: any) => def,
    } as any);
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([] as any);
    const provider = new NullAssertionProvider();
    const editor = makeEditor(lines);
    (provider as any)._editor = editor;
    (provider as any)._fullScan(editor);
    editor.setDecorations.mockClear();
    return { provider, editor };
  }

  /** Lignes decorees apres la frappe, une fois le flush passe. */
  function apresFrappe(
    avant: string[], apres: string[], ev: (doc: any) => any,
  ): number[] {
    const { provider, editor } = monter(avant);
    (provider as any)._applyChanges(ev(makeEditor(apres).document));
    vi.advanceTimersByTime(16);
    const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
  }

  it('ouvrir un bloc au dessus eteint la decoration', () => {
    expect(apresFrappe(
      ['val a = b!!'],
      [OUVRE, 'val a = b!!'],
      doc => makeChangeEvent(doc, 0, 0, 0, 0, OUVRE + String.fromCharCode(10)),
    )).toEqual([]);
  });

  it('refermer le bloc la rend', () => {
    expect(apresFrappe(
      [OUVRE, 'val a = b!!'],
      [OUVRE + ' ' + FERME, 'val a = b!!'],
      doc => makeChangeEvent(doc, 0, 2, 0, 2, ' ' + FERME),
    )).toEqual([1]);
  });

  it('fermer le bloc sur une ligne vierge la rend aussi', () => {
    // Seul `*/` est en jeu ici : la ligne tapee ne porte aucun autre
    // marqueur, donc la fermeture doit declencher a elle seule.
    expect(apresFrappe(
      [OUVRE, '', 'val a = b!!'],
      [OUVRE, FERME, 'val a = b!!'],
      doc => makeChangeEvent(doc, 1, 0, 1, 0, FERME),
    )).toEqual([2]);
  });

  it('SUPPRIMER la fermeture eteint ce qui suit', () => {
    // L evenement ne porte pas le texte retire et la ligne nouvelle n a
    // plus de marqueur : sans memoire de l etat precedent, rien ne
    // declenche et la decoration survit dans un bloc desormais ouvert.
    expect(apresFrappe(
      [OUVRE, FERME, 'val a = b!!'],
      [OUVRE, '', 'val a = b!!'],
      doc => makeChangeEvent(doc, 1, 0, 1, 2, ''),
    )).toEqual([]);
  });

  it('temoin : une frappe ordinaire garde le chemin incrementiel', () => {
    expect(apresFrappe(
      ['val a = b!!'],
      ['val a = bc!!'],
      doc => makeChangeEvent(doc, 0, 9, 0, 9, 'c'),
    )).toEqual([0]);
  });

  it('temoin : la frontiere de chaine brute declenche toujours', () => {
    expect(apresFrappe(
      ['val a = b!!'],
      ['val s = """', 'val a = b!!'],
      doc => makeChangeEvent(doc, 0, 0, 0, 0, 'val s = """' + String.fromCharCode(10)),
    )).toEqual([]);
  });
});
