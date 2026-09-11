/**
 * KJ - les oracles multilignes ne suivaient pas le decalage des lignes.
 *
 * Le chemin incrementiel deplace deja les decorations quand une frappe ajoute
 * ou retire une ligne (`_shiftDecos`). Les trois etats par ligne qui decident
 * du sens du texte, `_rawState`, `_blockState` et le `_boundary` ajoute en
 * v1.42.193, ne bougeaient pas avec elles. Un seul retour a la ligne au dessus
 * d un bloc suffisait donc a decaler la memoire d une ligne, et le declencheur
 * de reconstruction lisait alors la mauvaise case.
 *
 * Le scenario tient en deux frappes ordinaires :
 *   1. Entree au dessus d un bloc `/* ... *​/` deja ferme,
 *   2. suppression du `*​/`.
 * Apres la seconde, le bloc reste ouvert jusqu a la fin du fichier, mais
 * `_boundary` pointait encore sur l ancienne ligne : aucune reconstruction, et
 * le `!!` qui suit gardait sa decoration dans du texte devenu commentaire.
 *
 * C est le defaut meme que v1.42.193 corrigeait, rendu de nouveau atteignable
 * par la premiere frappe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';
import { makeChangeEvent } from './helpers';

const OUVRE = '/' + '*';
const FERME = '*' + '/';
const NL = String.fromCharCode(10);

/** Un editeur dont le document suit les lignes qu on lui donne. */
function monter(lignes: string[]) {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, def: any) => def,
  } as any);
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([] as any);

  const etat = { lignes: [...lignes] };
  const editor = {
    document: {
      languageId: 'kotlin',
      get lineCount() { return etat.lignes.length; },
      lineAt: (i: number) => ({ text: etat.lignes[i] ?? '' }),
    },
    setDecorations: vi.fn(),
  } as any;

  const provider = new NullAssertionProvider();
  (provider as any)._editor = editor;
  (provider as any)._fullScan(editor);

  /** Remplace le texte, puis rejoue la frappe qui l a produit. */
  const frapper = (apres: string[], sl: number, sc: number, el: number, ec: number, texte: string) => {
    etat.lignes = [...apres];
    editor.setDecorations.mockClear();
    (provider as any)._applyChanges(makeChangeEvent(editor.document, sl, sc, el, ec, texte));
    vi.advanceTimersByTime(16);
  };

  const decorees = (): number[] => {
    const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
    return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
  };

  return { frapper, decorees };
}

describe('NullAssertionProvider - les oracles suivent le decalage des lignes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('une entree au dessus du bloc ne desarme pas le declencheur de fermeture', () => {
    const { frapper, decorees } = monter([
      'val a = b!!',
      OUVRE,
      FERME,
      'val c = d!!',
    ]);

    // 1. Entree en fin de ligne 0 : rien de structurel, chemin incrementiel.
    frapper(['val a = b!!', '', OUVRE, FERME, 'val c = d!!'], 0, 11, 0, 11, NL);
    expect(decorees(), 'les deux assertions restent, decalees d une ligne').toEqual([0, 4]);

    // 2. Suppression du `*/` : le bloc reste ouvert jusqu a la fin du fichier.
    frapper(['val a = b!!', '', OUVRE, '', 'val c = d!!'], 3, 0, 3, 2, '');
    expect(decorees(), 'la ligne 4 est desormais dans un commentaire').toEqual([0]);
  });

  it('une entree au dessus du bloc ne fait pas non plus deborder le masque', () => {
    const { frapper, decorees } = monter([
      'val a = b!!',
      OUVRE,
      ' doc!!',
      FERME,
      'val c = d!!',
    ]);

    frapper(['val a = b!!', '', OUVRE, ' doc!!', FERME, 'val c = d!!'], 0, 11, 0, 11, NL);
    expect(decorees(), 'la prose du bloc reste hors jeu, le code garde la sienne').toEqual([0, 5]);

    // Une frappe ordinaire dans le code qui suit le bloc doit rester juste.
    frapper(['val a = b!!', '', OUVRE, ' doc!!', FERME, 'val c = de!!'], 5, 10, 5, 10, 'e');
    expect(decorees()).toEqual([0, 5]);
  });

  it('temoin : une suppression de ligne decale aussi les oracles', () => {
    const { frapper, decorees } = monter([
      '',
      'val a = b!!',
      OUVRE,
      FERME,
      'val c = d!!',
    ]);

    // Retour arriere sur la ligne 0 vide : tout remonte d un cran.
    frapper(['val a = b!!', OUVRE, FERME, 'val c = d!!'], 0, 0, 1, 0, '');
    expect(decorees()).toEqual([0, 3]);

    frapper(['val a = b!!', OUVRE, '', 'val c = d!!'], 2, 0, 2, 2, '');
    expect(decorees(), 'le bloc ouvert avale la fin du fichier').toEqual([0]);
  });

  it('temoin : sans bloc ni chaine brute, le decalage ne change rien', () => {
    const { frapper, decorees } = monter(['val a = b!!', 'val c = d!!']);
    frapper(['val a = b!!', '', 'val c = d!!'], 0, 11, 0, 11, NL);
    expect(decorees()).toEqual([0, 2]);
  });
});
