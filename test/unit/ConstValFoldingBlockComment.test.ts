/**
 * KJ-010 — un nom de constante DANS un bloc de commentaire etait replie.
 *
 * Le repli remplace visuellement `TIMEOUT_MS` par sa valeur. La garde qui
 * l'empeche dans un commentaire, `isInsideCommentOrString`, ne regarde qu'UNE
 * ligne : elle voit `//` et elle voit `/*` sur la meme ligne, mais elle ne sait
 * rien d'un bloc ouvert plus haut. Les lignes interieures d'un KDoc etaient
 * donc traitees comme du code, et le texte de la documentation se faisait
 * reecrire sous les yeux du lecteur.
 *
 * Le fichier savait deja porter un etat multiligne, il le faisait pour les
 * chaines brutes (`inRawString`), pas pour les commentaires.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 120 `const val` a valeur
 * litterale non ambigue, et 3 occurrences a l'interieur d'un bloc de
 * commentaire, toutes dans des KDoc :
 *   « * - [DEEPLINK]: the edition was opened from a deep link »
 *   « * USER_INTERFACE_IS_UNSPECIFIED is returned when the api is too low »
 *   « * @param duration ... (default: …) »
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ConstValFoldingProvider } from '../../src/providers/ConstValFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

const INDEX = {
  lookup: (name: string) =>
    (name === 'TIMEOUT_MS' ? [{ name, isConst: true, constValue: '5000' }] : []),
};

/** Lignes portant une decoration de repli. */
function lignesRepliees(lines: string[]): number[] {
  setup();
  const editor = {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    selections: [],
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ConstValFoldingProvider(INDEX as any);
  const opts = (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
  return [...new Set(opts.map(o => o.range.start.line))].sort((a, b) => a - b);
}

describe('ConstValFoldingProvider — les commentaires multilignes', () => {
  it('une ligne interieure de KDoc n est pas repliee', () => {
    expect(lignesRepliees([
      '/**',
      ' * TIMEOUT_MS is returned when the call gives up.',
      ' */',
      'val a = TIMEOUT_MS',
    ])).toEqual([3]);
  });

  it('un bloc /* */ ordinaire non plus', () => {
    expect(lignesRepliees([
      '/*',
      '   ancien code : val x = TIMEOUT_MS',
      '*/',
      'val b = TIMEOUT_MS',
    ])).toEqual([3]);
  });

  it('temoin : le commentaire de ligne restait deja hors jeu', () => {
    expect(lignesRepliees([
      '// TIMEOUT_MS ici ne compte pas',
      'val c = TIMEOUT_MS',
    ])).toEqual([1]);
  });

  it('la partie APRES la fermeture du bloc est bien repliee', () => {
    expect(lignesRepliees([
      '/*',
      ' * doc',
      ' */ val d = TIMEOUT_MS',
    ])).toEqual([2]);
  });

  it('un triple guillemet cite dans un commentaire ne fausse plus l etat', () => {
    // La parite des `"""` etait comptee sur la ligne BRUTE : un exemple de
    // chaine brute dans un KDoc faisait croire a une chaine ouverte, et tout
    // le reste du fichier cessait d etre replie.
    //
    // Le compte doit etre IMPAIR pour que le test prouve quelque chose. Avec
    // un exemple ferme, `"""texte"""`, la parite est la meme des deux cotes
    // et la version fautive passait aussi.
    expect(lignesRepliees([
      '/**',
      ' * exemple : val s = """',
      ' */',
      'val e = TIMEOUT_MS',
    ])).toEqual([3]);
  });

  it('un exemple ferme cite dans un commentaire ne fausse rien non plus', () => {
    expect(lignesRepliees([
      '/**',
      ' * exemple : val s = """texte""" + "autre',
      ' */',
      'val e = TIMEOUT_MS',
    ])).toEqual([3]);
  });

  it('deux triples impairs dans deux commentaires ne s annulent pas', () => {
    // Deux erreurs de parite se compensent : compter sur le texte brut
    // rouvrirait puis refermerait la fausse chaine, et le fichier redeviendrait
    // replie par accident. Il faut une ligne de code ENTRE les deux.
    expect(lignesRepliees([
      '/**',
      ' * premier exemple : """',
      ' */',
      'val a = TIMEOUT_MS',
      '/**',
      ' * second exemple : """',
      ' */',
      'val b = TIMEOUT_MS',
    ])).toEqual([3, 7]);
  });

  it('une ligne de declaration ne se fait pas replier', () => {
    // `const val X = Y` : la ligne entiere est mise de cote, sinon la valeur
    // lue a droite du signe egal se ferait remplacer sous les yeux de celui
    // qui lit la declaration.
    expect(lignesRepliees([
      'const val AUTRE = TIMEOUT_MS',
      'val e = TIMEOUT_MS',
    ])).toEqual([1]);
  });

  it('temoin : une interpolation dans une chaine reste repliee', () => {
    // Le contenu des chaines doit rester lisible par le scan : seuls les
    // commentaires sont neutralises. Neutraliser aussi les chaines ferait
    // disparaitre ce repli la, que la fonctionnalite offre volontairement.
    expect(lignesRepliees([
      'val url = "delay=${TIMEOUT_MS}"',
    ])).toEqual([0]);
  });

  it('temoin : une vraie chaine brute multiligne protege toujours son contenu', () => {
    expect(lignesRepliees([
      'val sql = """',
      '    TIMEOUT_MS',
      '"""',
      'val f = TIMEOUT_MS',
    ])).toEqual([3]);
  });
});
