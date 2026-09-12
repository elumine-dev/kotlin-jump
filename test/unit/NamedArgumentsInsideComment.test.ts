/**
 * « Add names to call arguments » etait offert dans de la PROSE.
 *
 * L action cherche un motif `nom(` sur la ligne du curseur et ecartait les
 * commentaires avec `isInsideCommentOrString`, qui ne lit qu UNE ligne. Le
 * corps d un KDoc, dont les lignes commencent par `*`, et le corps d une
 * chaine brute passaient donc pour du code.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 642 sites d appel lus dans
 * du commentaire ou de la chaine, 511 que l action reecrirait, et 118 dont le
 * nom est vraiment declare quelque part dans le projet, ce que le resolveur
 * exige pour offrir l action. Les appliquer reecrit la phrase :
 *
 *   « * taller (late reflow, slow assets). This compares … »
 *   deviendrait « * taller (p1 = late reflow, p2 = slow assets). This … »
 *
 * La ligne blanchie coute une passe par version du document, gardee en cache :
 * 3,3 ms sur le plus gros fichier de ce projet, trop pour la refaire a chaque
 * demande d ampoule.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position, Range } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { NamedArgumentsActionProvider } from '../../src/providers/NamedArgumentsActionProvider';

const NL = String.fromCharCode(10);
const TRIPLE = '"' + '"' + '"';
const OUVRE = '/' + '*';
const FERME = '*' + '/';
afterEach(() => vi.restoreAllMocks());

const resolveur = (_c: string, arity: number) => ({
  params: Array.from({ length: Math.max(arity, 1) }, (_, i) => ({ name: 'p' + (i + 1) })),
});

function actions(lignes: string[], ligne: number, aiguille: string) {
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, d: any) => d, update: async () => {},
  } as any);
  const col = lignes[ligne].indexOf(aiguille) + aiguille.length;
  return new NamedArgumentsActionProvider(resolveur).provideCodeActions(
    mockDocument('file:///p/app/src/main/java/com/x/A.kt', lignes.join(NL)) as any,
    new Range(new Position(ligne, col) as any, new Position(ligne, col) as any) as any,
    {} as any, {} as any,
  );
}

describe('l action ne vise pas de la prose', () => {
  it('le corps d un KDoc n est pas du code', async () => {
    expect(await actions([
      '/**',
      ' * taller (late reflow, slow assets). This compares the applied height.',
      ' */',
      'class A',
    ], 1, 'taller (')).toEqual([]);
  });

  it('le corps d un bloc de commentaire non plus', async () => {
    expect(await actions([
      OUVRE,
      ' Copyright (c) 2014, Nexage, Inc.',
      FERME,
      'class A',
    ], 1, 'Copyright (')).toEqual([]);
  });

  it('le corps d une chaine brute non plus', async () => {
    expect(await actions([
      `val gabarit = ${TRIPLE}`,
      '  appelle(a, b) dans du texte',
      `${TRIPLE}`,
    ], 1, 'appelle(')).toEqual([]);
  });

  it('temoin : un vrai appel garde son action', async () => {
    const a = await actions(['class A {', '    fun f() { appelle(a, b) }', '}'], 1, 'appelle(');
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe(NamedArgumentsActionProvider.ACTION_TITLE);
  });

  it('temoin : un appel APRES la fin du bloc de commentaire garde son action', async () => {
    // La ligne porte les deux : la garde doit blanchir le commentaire sans
    // toucher au code qui le suit.
    const a = await actions([
      'class A {',
      `    ${OUVRE} note (x, y) ${FERME} fun f() { appelle(a, b) }`,
      '}',
    ], 1, 'appelle(');
    expect(a).toHaveLength(1);
  });

  it('temoin : un appel dans un gabarit de chaine reste du code', async () => {
    // `${'$'}{...}` porte du vrai code, blanchir la chaine ne doit pas l effacer.
    const a = await actions([
      'class A {',
      '    val s = "valeur ${appelle(a, b)}"',
      '}',
    ], 1, 'appelle(');
    expect(a).toHaveLength(1);
  });

  it('temoin : un commentaire de fin de ligne reste ecarte', async () => {
    expect(await actions([
      'class A {',
      '    val x = 1  // voir appelle(a, b) plus bas',
      '}',
    ], 1, 'appelle(')).toEqual([]);
  });
});
