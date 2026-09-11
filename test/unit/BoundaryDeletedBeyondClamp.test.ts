/**
 * KJ - une frontiere supprimee au dela du plafond du declencheur.
 *
 * La memoire par ligne ajoutee en v1.42.193 (`_boundary`) rend visible un `*​/`
 * ou un `"""` efface : l evenement ne porte jamais le texte retire, donc sans
 * elle rien ne declenche la reconstruction. Elle est lue dans la meme boucle
 * que le texte des lignes touchees, et cette boucle est plafonnee par
 * `doc.lineCount - 1` du NOUVEAU document.
 *
 * Ce plafond existe pour proteger `doc.lineAt(i)`. Applique aussi a la lecture
 * du tableau, il tronque la verification : effacer trois lignes ou plus qui
 * contiennent la fermeture d un bloc, assez pres de la fin du fichier pour que
 * le document raccourci passe sous `end.line`, laisse la frontiere hors du
 * balayage. Aucune reconstruction, l etat decale ment sur la derniere ligne
 * survivante, et la decoration y reste peinte dans du texte devenu commentaire.
 *
 * Geste reel : selectionner un bloc de commentaire de trois lignes pres du bas
 * d un fichier et appuyer sur Supprimer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';
import { makeChangeEvent } from './helpers';

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

/** `TextDocument.lineAt` leve hors bornes chez VS Code ; la doublure est plus
 *  clemente, donc une garde de plafond ne serait prouvee par rien sans ceci. */
function docStrict(lignes: string[]) {
  return {
    languageId: 'kotlin',
    lineCount: lignes.length,
    lineAt: (i: number) => {
      if (i < 0 || i >= lignes.length) throw new Error('Illegal value for line: ' + i);
      return { text: lignes[i] };
    },
  } as any;
}

function lignesPeintes(editor: any): number[] {
  const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
  return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
}

describe('Une frontiere effacee sous le plafond du declencheur', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('assertion : effacer la fin du bloc eteint tout ce qui suit', () => {
    const { provider, editor } = monter(NullAssertionProvider, [
      OUVRE,
      'x',
      'y',
      FERME,
      'val c = d!!',
      'val e = f!!',
    ]);
    const apres = makeEditor([OUVRE, 'val c = d!!', 'val e = f!!']).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 0, 4, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor), 'le bloc reste ouvert jusqu a la fin du fichier').toEqual([]);
  });

  it('pastille : effacer la fin de la chaine brute eteint tout ce qui suit', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val s = """',
      'x',
      'y',
      '"""',
      'val c = 0xFF001122',
      'val d = 0xFF334455',
    ]);

    const apres = makeEditor([
      'val s = """', 'val c = 0xFF001122', 'val d = 0xFF334455',
    ]).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 0, 4, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor), 'la chaine brute reste ouverte jusqu a la fin').toEqual([]);
  });

  it('temoin : le meme geste loin de la fin declenche deja', () => {
    // Ici le document raccourci reste plus long que `end.line`, donc la
    // frontiere effacee tombe dans la partie balayee et le declencheur la voit.
    const { provider, editor } = monter(NullAssertionProvider, [
      OUVRE,
      'x',
      'y',
      FERME,
      'val c = d!!',
      'val e = f!!',
      'val g = h!!',
      'val i = j!!',
      'val k = l!!',
    ]);
    const apres = makeEditor([
      OUVRE, 'val c = d!!', 'val e = f!!', 'val g = h!!', 'val i = j!!', 'val k = l!!',
    ]).document;
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 0, 4, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([]);
  });

  it('temoin : effacer du code ordinaire pres de la fin garde les decorations', () => {
    // Aucune frontiere ici, donc la memoire ne court circuite rien : le
    // declencheur va jusqu a lire le texte, et le document strict prouve qu il
    // ne sort pas du nouveau document en le faisant.
    const { provider, editor } = monter(NullAssertionProvider, [
      'val a = b!!',
      'x',
      'y',
      'z',
      'val c = d!!',
      'val e = f!!',
    ]);
    const apres = docStrict(['val a = b!!', 'val c = d!!', 'val e = f!!']);
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 0, 4, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 1, 2]);
  });

  it('temoin : pastille, meme garde sur le document raccourci', () => {
    const { provider, editor } = monter(HexColorFoldingProvider, [
      'val a = 0xFF001122',
      'x',
      'y',
      'z',
      'val c = 0xFF334455',
      'val d = 0xFF556677',
    ]);
    const apres = docStrict(['val a = 0xFF001122', 'val c = 0xFF334455', 'val d = 0xFF556677']);
    (provider as any)._applyChanges(makeChangeEvent(apres, 1, 0, 4, 0, ''));
    vi.advanceTimersByTime(16);
    expect(lignesPeintes(editor)).toEqual([0, 1, 2]);
  });
});
