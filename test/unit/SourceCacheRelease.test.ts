/**
 * Les listings de projet gardes en memoire doivent etre relaches.
 *
 * Trois fournisseurs gardent le TEXTE de tous les fichiers du projet pour
 * repondre vite. Depuis que le plafond est passe a 20000 (v1.42.178 et
 * v1.42.182) cela represente, sur /Users/kevin/Desktop/work/lapresse :
 *
 *   DeadWeightActionProvider   6278 fichiers, 40,8 Mo   (deja discipline)
 *   ResourceUsageBadgeProvider 6278 fichiers, 40,8 Mo
 *   StringXmlHoverProvider     5088 fichiers, environ 17 Mo
 *
 * Les deux derniers ne relachaient jamais rien : ni a la desactivation de
 * l'extension, ni quand leur reglage passait a false, ni quand un balayage
 * lance avant ce basculement se terminait apres. Le premier avait recu cette
 * discipline en v1.42.180 et v1.42.181 ; ce fichier l'etend aux deux autres.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from './__mocks__/vscode';
import { ResourceUsageBadgeProvider } from '../../src/providers/ResourceUsageBadgeProvider';
import { StringXmlHoverProvider } from '../../src/providers/StringXmlHoverProvider';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => vi.restoreAllMocks());

const VALUES = ['<resources>', '    <color name="c">#FF0000</color>', '</resources>'].join(NL);

function monter(actif: () => boolean, lecture?: () => Promise<Uint8Array>) {
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
    Array.from({ length: 3 }, (_, i) => ({
      toString: () => `file:///w/src/F${i}.kt`,
      fsPath: `/w/src/F${i}.kt`,
    }))
  )) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation(
    (lecture ?? (async () => encode('val c = R.color.c'))) as any,
  );
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (cle === 'resourceUsageBadges' ? actif() : def),
  } as any);
  const editor = {
    document: {
      uri: {
        fsPath: '/w/app/src/main/res/values/colors.xml',
        toString: () => 'file:///w/app/src/main/res/values/colors.xml',
      },
      getText: () => VALUES,
    },
    setDecorations: vi.fn(),
  } as any;
  (vscodeMock.window as any).activeTextEditor = editor;
  return editor;
}

describe('ResourceUsageBadgeProvider — le listing est rendu', () => {
  it('dispose relache les 40,8 Mo', async () => {
    monter(() => true);
    const p = new ResourceUsageBadgeProvider();
    await attendre();
    expect((p as any)._cache, 'le balayage a bien rempli le cache').toBeTruthy();
    p.dispose();
    expect((p as any)._cache, 'la desactivation doit tout rendre').toBeUndefined();
    (vscodeMock.window as any).activeTextEditor = undefined;
  });

  it('reglage coupe : le listing est rendu', async () => {
    let actif = true;
    let ecouteur: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation(((cb: any) => { ecouteur = cb; return { dispose: () => {} }; }) as any);
    monter(() => actif);
    const p = new ResourceUsageBadgeProvider();
    await attendre();
    expect((p as any)._cache).toBeTruthy();

    actif = false;
    ecouteur?.({ affectsConfiguration: (cle: string) => cle === 'kotlinJump.resourceUsageBadges' });
    await attendre();
    expect((p as any)._cache, 'plus de badges, plus de listing').toBeUndefined();
    p.dispose();
    (vscodeMock.window as any).activeTextEditor = undefined;
  });

  it('coupe PENDANT le balayage : le listing en vol n est pas garde', async () => {
    let actif = true;
    let ecouteur: ((e: any) => void) | undefined;
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation(((cb: any) => { ecouteur = cb; return { dispose: () => {} }; }) as any);
    monter(() => actif, async () => {
      await barriere;
      return encode('val c = R.color.c');
    });

    const p = new ResourceUsageBadgeProvider();
    await attendre();
    expect((p as any)._cache, 'le balayage est encore en vol').toBeUndefined();

    actif = false;
    ecouteur?.({ affectsConfiguration: (cle: string) => cle === 'kotlinJump.resourceUsageBadges' });
    relacher();
    await attendre();
    expect((p as any)._cache, 'un balayage en vol ne repeuple pas un cache coupe').toBeUndefined();
    p.dispose();
    (vscodeMock.window as any).activeTextEditor = undefined;
  });
  it('un listing sans garant ne donne ni chiffre ni grisage', async () => {
    // Sans garant, un zero calcule sur un listing que plus personne ne garde
    // griserait une ressource bien vivante : la pastille tombe sur « ? ».
    //
    // Le declencheur a change en v1.42.218. Cette fenetre etait ouverte en
    // coupant le reglage PENDANT le balayage, ce qui peignait des pastilles
    // que l utilisateur venait d eteindre ; la peinture est gardee maintenant
    // et ne dessine plus rien dans ce cas la, voir
    // `BadgePaintAfterSweep.test.ts`. Le vrai garant reste le plafond du
    // listing, pose ici directement.
    const editor = monter(() => true);
    const p: any = new ResourceUsageBadgeProvider();
    p._cache = {
      at: Date.now(),
      sources: [{ path: '/w/src/F0.kt', text: 'rien qui utilise la couleur' }],
      truncated: true,
    };
    editor.setDecorations.mockClear();
    await p._refresh();

    const calls = editor.setDecorations.mock.calls;
    const etiquettes = (calls[calls.length - 2]?.[1] ?? []).map((b: any) => b.renderOptions.after.contentText);
    const grises = (calls[calls.length - 1]?.[1] ?? []).length;
    expect(etiquettes, 'aucun chiffre ne peut etre affirme ici').toEqual(['? usages']);
    expect(grises, 'et surtout rien de grise').toBe(0);
    p.dispose();
    (vscodeMock.window as any).activeTextEditor = undefined;
  });

  it('temoin : avec un garant, le chiffre est affirme', async () => {
    // Sans ce temoin, le test d au dessus passerait aussi sur un rendu vide.
    const editor = monter(() => true);
    const p: any = new ResourceUsageBadgeProvider();
    p._cache = {
      at: Date.now(),
      sources: [{ path: '/w/src/F0.kt', text: 'val c = R.color.c' }],
      truncated: false,
    };
    editor.setDecorations.mockClear();
    await p._refresh();

    const calls = editor.setDecorations.mock.calls;
    const etiquettes = (calls[calls.length - 2]?.[1] ?? []).map((b: any) => b.renderOptions.after.contentText);
    expect(etiquettes).toEqual(['1 usage']);
    p.dispose();
    (vscodeMock.window as any).activeTextEditor = undefined;
  });
});

describe('StringXmlHoverProvider — le listing est rendu', () => {
  it('dispose relache les fichiers charges', async () => {
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
      [{ toString: () => 'file:///w/src/A.kt', fsPath: '/w/src/A.kt' }]
    )) as any);
    vi.spyOn(vscodeMock.workspace.fs as any, 'readFile')
      .mockImplementation((async () => encode('class A')) as any);
    const p: any = new StringXmlHoverProvider();
    await p._sources();
    expect(p._cache, 'le listing est charge').toBeTruthy();
    p.dispose();
    expect(p._cache, 'et rendu').toBeUndefined();
    expect(p._loading).toBeUndefined();
  });

  it('les deux points d entree le liberent', () => {
    // Construit en ligne dans registerHoverProvider, rien ne pouvait le rendre.
    for (const f of ['extension.ts', 'extension.browser.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', f), 'utf8');
      expect(src, `${f} : pas de construction en ligne`)
        .not.toMatch(/new StringXmlHoverProvider\(\)\s*\)/);
      expect(src, `${f} : la variable figure dans les subscriptions`)
        .toMatch(/\n\s*stringXmlHover,/);
    }
  });
});
