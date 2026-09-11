/**
 * Liberer un cache ne sert a rien si le balayage en vol le repose juste apres.
 *
 * Les trois fournisseurs qui gardent le texte de tout le projet ont recu, au
 * fil des v1.42.180 a v1.42.183, une garde sur leur REGLAGE : rien n'est ecrit
 * si la fonctionnalite a ete coupee entre temps. La desactivation de
 * l'extension, elle, n'etait gardee nulle part. `dispose()` vidait le cache, le
 * balayage lance avant se terminait une ou deux secondes plus tard, et ses
 * megaoctets revenaient dans un fournisseur pourtant mort.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 40,8 Mo pour les correctifs
 * rapides, 40,8 Mo pour le badge de ressources, environ 17 Mo pour la carte
 * inverse des strings. Le balayage dure plusieurs secondes, un aller-retour par
 * fichier, donc fermer la fenetre pendant qu'il tourne est le cas courant, pas
 * le cas limite.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { DeadWeightActionProvider } from '../../src/providers/DeadWeightActionProvider';
import { ResourceUsageBadgeProvider } from '../../src/providers/ResourceUsageBadgeProvider';
import { StringXmlHoverProvider } from '../../src/providers/StringXmlHoverProvider';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => {
  vi.restoreAllMocks();
  (vscodeMock.window as any).activeTextEditor = undefined;
});

const VALUES = ['<resources>', '    <color name="c">#FF0000</color>', '</resources>'].join(NL);

/** Balayage suspendu : rend la fonction qui le laisse se terminer. */
function balayageSuspendu() {
  let relacher!: () => void;
  const barriere = new Promise<void>(r => { relacher = r; });
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
    .mockImplementation((() => ({ dispose: () => {} })) as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
    Array.from({ length: 3 }, (_, i) => ({
      toString: () => `file:///w/src/F${i}.kt`,
      fsPath: `/w/src/F${i}.kt`,
    }))
  )) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
    await barriere;
    return encode('val c = R.color.c');
  }) as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_cle: string, def: any) => def,
  } as any);
  return relacher;
}

describe('DeadWeightActionProvider — dispose pendant le balayage', () => {
  it('le listing en vol ne revient pas dans un fournisseur mort', async () => {
    const relacher = balayageSuspendu();
    const p = new DeadWeightActionProvider();
    await attendre();
    expect((p as any)._sources, 'le prechauffage est encore en vol').toBeUndefined();

    p.dispose();
    relacher();
    await attendre();

    expect((p as any)._sources, '40,8 Mo ne doivent pas revenir').toBeUndefined();
    expect((p as any)._imports).toBeUndefined();
  });
});

describe('ResourceUsageBadgeProvider — dispose pendant le balayage', () => {
  it('le listing en vol ne revient pas dans un fournisseur mort', async () => {
    const relacher = balayageSuspendu();
    (vscodeMock.window as any).activeTextEditor = {
      document: {
        uri: {
          fsPath: '/w/app/src/main/res/values/colors.xml',
          toString: () => 'file:///w/app/src/main/res/values/colors.xml',
        },
        getText: () => VALUES,
      },
      setDecorations: vi.fn(),
    };
    const p = new ResourceUsageBadgeProvider();
    await attendre();
    expect((p as any)._cache).toBeUndefined();

    p.dispose();
    relacher();
    await attendre();

    expect((p as any)._cache, '40,8 Mo ne doivent pas revenir').toBeUndefined();
  });
});

describe('StringXmlHoverProvider — dispose pendant le chargement', () => {
  it('le listing en vol ne revient pas dans un fournisseur mort', async () => {
    const relacher = balayageSuspendu();
    const p: any = new StringXmlHoverProvider();
    const charge = p._sources();
    await attendre();
    expect(p._cache).toBeUndefined();

    p.dispose();
    relacher();
    await charge;
    await attendre();

    expect(p._cache, 'environ 17 Mo ne doivent pas revenir').toBeUndefined();
    expect(p._loading).toBeUndefined();
  });
});
