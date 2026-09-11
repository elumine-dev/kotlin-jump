/**
 * « Add names to call arguments » ne doit pas viser une DECLARATION.
 *
 * L'action cherche, sur la ligne du curseur, un motif `nom(` dont le nom se
 * resout a une fonction ou une classe connue. Une declaration en porte un :
 * `override fun buildsAdMediaUri(adTagUrl: String)` ressemble exactement a un
 * appel, et le nom se resout evidemment, puisque c'est la declaration elle
 * meme. L'action la reecrivait en
 * `buildsAdMediaUri(adTagUrl = adTagUrl: String)`, qui ne compile pas.
 *
 * Mesure sur un projet reel, avec le resolveur de production : sur 2991
 * actions offertes, 975 visaient une declaration de fonction, 110 une
 * declaration de classe et 27 une autre forme de declaration, soit 37 %. Un
 * cas prenait meme le nom de parametre d'un homonyme, `init(photoModuleModel =
 * onFullscreenRequested: ...)`.
 *
 * Un appel de constructeur de supertype, `class A : B(x)`, reste une vraie
 * position d'appel et doit continuer d'etre offert.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position, Range } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { NamedArgumentsActionProvider } from '../../src/providers/NamedArgumentsActionProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

/** Resolveur permissif : tout nom resout, comme la declaration elle meme le ferait. */
const resolveur = (_c: string, arity: number) => ({
  params: Array.from({ length: Math.max(arity, 1) }, (_, i) => ({ name: 'p' + (i + 1) })),
});

function actions(lignes: string[], ligne: number, aiguille: string) {
  const src = lignes.join(NL);
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, d: any) => d, update: async () => {},
  } as any);
  const col = lignes[ligne].indexOf(aiguille) + aiguille.length;
  return new NamedArgumentsActionProvider(resolveur).provideCodeActions(
    mockDocument('file:///p/app/src/main/java/com/x/A.kt', src) as any,
    new Range(new Position(ligne, col) as any, new Position(ligne, col) as any) as any,
    {} as any, {} as any,
  );
}

describe('une declaration n est pas un appel', () => {
  it('une fonction simple', async () => {
    expect(await actions(['class A {', '    fun calcule(valeur: Int) {}', '}'], 1, 'calcule(')).toEqual([]);
  });

  it('une fonction avec modificateurs et generiques', async () => {
    expect(await actions(['class A {', '    private inline fun <T> mappe(source: T) {}', '}'], 1, 'mappe(')).toEqual([]);
  });

  it('une fonction generique dont le parametre de type a une borne', async () => {
    // `<T : ViewModel>` porte un deux points, qui ne doit pas couper le lien
    // entre `fun` et le nom.
    expect(await actions(['class A {', '    override fun <T : ViewModel> cree(classe: Class<T>): T {}', '}'], 1, 'cree(')).toEqual([]);
  });

  it('une fonction generique a bornes imbriquees', async () => {
    expect(await actions(['fun <T : List<String>> trie(source: T) {}'], 0, 'trie(')).toEqual([]);
  });

  it('une fonction avec recepteur', async () => {
    expect(await actions(['fun String.decore(prefixe: String) {}'], 0, 'decore(')).toEqual([]);
  });

  it('une classe et son constructeur primaire', async () => {
    expect(await actions(['data class Point(abscisse: Int, ordonnee: Int)'], 0, 'Point(')).toEqual([]);
  });

  it('une declaration imbriquee dans un corps de classe', async () => {
    expect(await actions(['class A : B() {', '    fun calcule(valeur: Int) {}', '}'], 1, 'calcule(')).toEqual([]);
  });
});

describe('mais un vrai appel reste offert', () => {
  it('un appel ordinaire', async () => {
    const r = await actions(['fun go() {', '    calcule(12)', '}'], 1, 'calcule(');
    expect(r).toHaveLength(1);
    expect(String(r[0].edit.entries()[0].newText)).toBe('calcule(p1 = 12)');
  });

  it('un appel de constructeur de supertype', async () => {
    const r = await actions(['class A : B(12)'], 0, 'B(');
    expect(r, 'la position d appel d un supertype reste offerte').toHaveLength(1);
    expect(String(r[0].edit.entries()[0].newText)).toBe('B(p1 = 12)');
  });

  it('un appel dans le corps d une fonction declaree sur la meme ligne', async () => {
    const r = await actions(['fun go() = calcule(12)'], 0, 'calcule(');
    expect(r).toHaveLength(1);
  });
});
