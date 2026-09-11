/**
 * KJ-021 — le badge d'usage des ressources lisait 4000 fichiers sur 6278.
 *
 * La v1.42.178 a mis les trois balayages de projet sur une constante commune.
 * Deux sites ont ete oublies, et celui-ci est le plus visible de tous : il
 * badge CHAQUE cle d'un fichier de ressources avec son nombre d'usages, et grise la
 * ligne quand ce nombre est zero. Il n'avait meme aucune garde de troncature.
 *
 * Mesure par la fonction de production `countAllResourceUsages` sur
 * /Users/kevin/Desktop/work/lapresse, 229 fichiers values, 2007 cles badgees,
 * 6278 fichiers de projet :
 *
 *   avec tous les fichiers        : 130 cles reellement a 0 usage
 *   plafond 4000, ordre de find   : 578 cles affichees « 0 usages » a tort
 *   plafond 4000, alphabetique    : 756
 *   plafond 4000, ordre inverse   : 419
 *
 * Soit trois a six fois plus de fausses ressources mortes que de vraies, et la
 * liste change avec l'ordre de parcours des fichiers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { MAX_SWEEP_FILES } from '../../src/util/sweepLimit';
import { ResourceUsageBadgeProvider } from '../../src/providers/ResourceUsageBadgeProvider';
import { StringXmlHoverProvider } from '../../src/providers/StringXmlHoverProvider';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => vi.restoreAllMocks());

const VALUES = [
  '<resources>',
  '    <color name="utilisee">#FF0000</color>',
  '    <color name="morte">#00FF00</color>',
  '</resources>',
].join(NL);

/** Monte le fournisseur sur un values/colors.xml et rend badges et grisages. */
async function badges(nbSources: number, grisageKj031: boolean) {
  const uris = Array.from({ length: nbSources }, (_, i) => ({
    toString: () => `file:///w/src/F${i}.kt`,
    fsPath: `/w/src/F${i}.kt`,
  }));
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => uris) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation(
    (async () => encode('val c = R.color.utilisee')) as any,
  );
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (cle === 'unusedResourceKeys' ? grisageKj031 : def),
  } as any);

  const editor = {
    document: {
      uri: { fsPath: '/w/app/src/main/res/values/colors.xml', toString: () => 'file:///w/app/src/main/res/values/colors.xml' },
      getText: () => VALUES,
    },
    setDecorations: vi.fn(),
  } as any;
  (vscodeMock.window as any).activeTextEditor = editor;
  const p = new ResourceUsageBadgeProvider();
  await attendre();
  p.dispose();
  (vscodeMock.window as any).activeTextEditor = undefined;

  const calls = editor.setDecorations.mock.calls;
  return {
    etiquettes: (calls[calls.length - 2]?.[1] ?? []).map((b: any) => b.renderOptions.after.contentText),
    grises: (calls[calls.length - 1]?.[1] ?? []).length,
  };
}

describe('ResourceUsageBadgeProvider — le balayage sous le plafond', () => {
  it('compte pour de vrai et grise la cle morte', async () => {
    const { etiquettes, grises } = await badges(3, false);
    expect(etiquettes).toEqual(['3 usages', '0 usages']);
    expect(grises, 'une seule ligne grisee, la morte').toBe(1);
  });

  it('KJ-031 actif : le compte reste, le grisage lui revient', async () => {
    const { etiquettes, grises } = await badges(3, true);
    expect(etiquettes).toEqual(['3 usages', '0 usages']);
    expect(grises, 'pas deux grisages empiles').toBe(0);
  });

  it('au plafond : point d interrogation, et surtout aucun grisage', async () => {
    const { etiquettes, grises } = await badges(MAX_SWEEP_FILES, false);
    expect(etiquettes).toEqual(['? usages', '? usages']);
    expect(grises, 'on ne declare pas une ressource morte sur un listing tronque').toBe(0);
  });

  it('demande le plafond partage a findFiles', async () => {
    await badges(3, false);
    const appel = (vscodeMock.workspace.findFiles as any).mock.calls
      .find((c: any[]) => String(c[0]).includes('kt,java,xml'));
    expect(appel?.[2]).toBe(MAX_SWEEP_FILES);
  });
});

describe('StringXmlHoverProvider — meme plafond', () => {
  it('demande le plafond partage a findFiles', async () => {
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => []) as any);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (_c: string, def: any) => def,
    } as any);
    const p: any = new StringXmlHoverProvider();
    await p._sources();
    const appel = (vscodeMock.workspace.findFiles as any).mock.calls
      .find((c: any[]) => String(c[0]).includes('kt,java'));
    expect(appel?.[2]).toBe(MAX_SWEEP_FILES);
  });
});
