/**
 * KJ — le surlignage de `!!` marquait de la prose de KDoc.
 *
 * Le fournisseur porte deja un oracle multiligne pour les chaines brutes
 * (`_rawState`), parce que la garde par ligne ne voit pas les `"""` ouverts
 * plus haut. Le meme raisonnement vaut pour `/* … *​/` et il n'etait pas fait :
 * a l'interieur d'un bloc, `isInsideCommentOrString` ne voit rien sur sa ligne
 * et rend faux, donc les `!!` de la documentation recevaient la decoration
 * d'assertion non nulle.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 2 occurrences, toutes deux
 * dans de la prose de KDoc.
 *   « * |!!| Needs [clearCache] to be called otherwise a memory leak … »
 *   « * NB: This implementation is temporary!! »
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';

afterEach(() => vi.restoreAllMocks());

function setupMocks() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

function lignesDecorees(lines: string[]): number[] {
  setupMocks();
  const provider = new NullAssertionProvider();
  const editor = {
    document: { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) },
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  provider.invalidateAll();
  const decs = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
  return [...new Set(decs.map(d => d.range.start.line))].sort((a, b) => a - b);
}

const OUVRE = '/' + '*';
const FERME = '*' + '/';

describe('NullAssertionProvider — les blocs de commentaire', () => {
  it('la prose d un KDoc n est pas decoree', () => {
    expect(lignesDecorees([
      '/**',
      ' * NB: this implementation is temporary!!',
      ' ' + FERME,
      'val x = foo!!',
    ])).toEqual([3]);
  });

  it('un bloc ordinaire non plus', () => {
    expect(lignesDecorees([
      OUVRE,
      '   ancien code : val y = bar!!',
      FERME,
      'val z = baz!!',
    ])).toEqual([3]);
  });

  it('temoin : le commentaire de ligne restait deja hors jeu', () => {
    expect(lignesDecorees([
      '// pas ici!!',
      'val a = b!!',
    ])).toEqual([1]);
  });

  it('la partie APRES la fermeture du bloc est bien decoree', () => {
    expect(lignesDecorees([
      OUVRE,
      ' * doc',
      ' ' + FERME + ' val c = d!!',
    ])).toEqual([2]);
  });

  it('temoin : un ouvre-bloc cite dans une chaine n ouvre rien', () => {
    // Sans la garde de chaine, `"/*"` ouvrirait un bloc imaginaire et
    // eteindrait la decoration sur tout le reste du fichier.
    expect(lignesDecorees([
      'val motif = "' + OUVRE + '"',
      'val h = i!!',
    ])).toEqual([1]);
  });

  it('temoin : une chaine brute multiligne protege toujours son contenu', () => {
    expect(lignesDecorees([
      'val sql = """',
      '    pas une assertion!!',
      '"""',
      'val e = f!!',
    ])).toEqual([3]);
  });

  it('un bloc referme puis rouvert sur la meme ligne reste ouvert', () => {
    // `*​/ /*` : la fermeture ne suffit pas, ce qui suit rouvre. Sans relire la
    // fin de la ligne, la suite du fichier repasserait pour du code.
    expect(lignesDecorees([
      OUVRE,
      ' texte',
      ' ' + FERME + ' ' + OUVRE,
      'val a = b!!',
      ' ' + FERME + ' val c = d!!',
    ])).toEqual([4]);
  });

  it('un ouvre bloc cite dans un commentaire de ligne n ouvre rien', () => {
    // Zero occurrence sur le projet reel, mais la garde existe : sans elle un
    // `/*` mentionne apres un `//` eteindrait tout le reste du fichier.
    expect(lignesDecorees([
      'val a = b!!  // voir ' + OUVRE + ' plus bas',
      'val c = d!!',
    ])).toEqual([0, 1]);
  });

  it('la fermeture est masquee, pas seulement son etoile', () => {
    // Le masque couvre les DEUX caracteres de `*​/`. En laisser un seul
    // recolle un `//` avec le slash qui suit, et la ligne passe pour un
    // commentaire de ligne alors qu elle porte du code.
    expect(lignesDecorees([
      OUVRE,
      ' texte',
      ' *' + '/' + '/ val x = a!!',
    ])).toEqual([2]);
  });

  it('temoin : deux assertions sur une ligne de code en donnent deux', () => {
    setupMocks();
    const provider = new NullAssertionProvider();
    const lines = ['val g = a!!.b!!'];
    const editor = {
      document: { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) },
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    provider.invalidateAll();
    expect((editor.setDecorations.mock.lastCall?.[1] ?? []).length).toBe(2);
  });
});
