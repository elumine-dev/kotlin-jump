/**
 * Les deux fournisseurs freres peignaient encore apres le balayage.
 *
 * La v1.42.211 avait corrige ce defaut dans le badge de dependances : la
 * paire de gardes « reglage coupe ou fournisseur detruit » etait posee sur
 * l ecriture du CACHE et pas sur la PEINTURE, la moitie que l utilisateur
 * voit. Les deux autres fournisseurs de badges ont exactement la meme forme
 * et n avaient pas ete regardes.
 *
 *   `_refresh()` : lit le reglage, puis `await` un balayage de tout le projet
 *   qui dure plusieurs secondes, puis peint.
 *
 * Couper le badge pendant ce balayage le rallumait donc tout seul quelques
 * secondes plus tard, et un balayage qui atterrit apres `dispose()` ecrit a
 * travers un type de decoration deja detruit. `ManifestNecessityProvider` n
 * avait meme pas de drapeau de destruction.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ResourceUsageBadgeProvider } from '../../src/providers/ResourceUsageBadgeProvider';
import { ManifestNecessityProvider } from '../../src/providers/ManifestNecessityProvider';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => {
  vi.restoreAllMocks();
  (vscodeMock.window as any).activeTextEditor = undefined;
});

/** Ouvre un fichier et suspend le balayage projet jusqu au relachement. */
function balayageSuspendu(chemin: string, contenu: string, reglage: { actif: boolean }, cle: string) {
  let relacher!: () => void;
  const barriere = new Promise<void>(r => { relacher = r; });
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: () => {} } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: () => {} } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: () => {} } as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => ([
    { toString: () => 'file:///w/src/Ecran.kt', fsPath: '/w/src/Ecran.kt' },
  ])) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
    await barriere;
    return encode('package a' + NL + 'class Ecran { val x = R.string.titre }');
  }) as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (c: string, def: any) => (c === cle ? reglage.actif : def),
  } as any);
  const editeur = {
    document: {
      uri: { fsPath: chemin, toString: () => 'file://' + chemin },
      languageId: 'xml',
      lineCount: contenu.split(NL).length,
      lineAt: (i: number) => ({ text: contenu.split(NL)[i] }),
      getText: () => contenu,
    },
    setDecorations: vi.fn(),
  };
  (vscodeMock.window as any).activeTextEditor = editeur;
  return { relacher, editeur };
}

const peints = (editeur: any) =>
  editeur.setDecorations.mock.calls.filter((c: any[]) => (c[1] ?? []).length > 0).length;

const VALEURS = '/w/app/src/main/res/values/strings.xml';
const XML = ['<resources>', '  <string name="titre">Bonjour</string>', '</resources>'].join(NL);
const MANIFESTE = '/w/app/src/main/AndroidManifest.xml';
const MANIFESTE_XML = [
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
  '  <uses-permission android:name="android.permission.CAMERA" />',
  '  <application>',
  '    <activity android:name="a.Absente" />',
  '  </application>',
  '</manifest>',
].join(NL);

describe('ResourceUsageBadgeProvider - la peinture apres le balayage', () => {
  it('temoin : un balayage qui aboutit dessine bien un badge', async () => {
    const { relacher, editeur } = balayageSuspendu(VALEURS, XML, { actif: true }, 'resourceUsageBadges');
    const p: any = new ResourceUsageBadgeProvider();
    relacher();
    await attendre();
    expect(peints(editeur), 'sans badge les deux tests suivants ne prouveraient rien').toBeGreaterThan(0);
    p.dispose();
  });

  it('couper le reglage pendant le balayage ne rallume pas les badges', async () => {
    const reglage = { actif: true };
    const { relacher, editeur } = balayageSuspendu(VALEURS, XML, reglage, 'resourceUsageBadges');
    const p: any = new ResourceUsageBadgeProvider();
    await attendre();
    reglage.actif = false;
    relacher();
    await attendre();
    expect(peints(editeur), 'le badge coupe ne doit pas revenir tout seul').toBe(0);
    p.dispose();
  });

  it('un fournisseur detruit ne peint plus rien', async () => {
    const { relacher, editeur } = balayageSuspendu(VALEURS, XML, { actif: true }, 'resourceUsageBadges');
    const p: any = new ResourceUsageBadgeProvider();
    await attendre();
    const avant = editeur.setDecorations.mock.calls.length;
    p.dispose();
    relacher();
    await attendre();
    expect(editeur.setDecorations.mock.calls.length,
      'ecrire a travers un type de decoration detruit').toBe(avant);
  });
});

describe('ManifestNecessityProvider - la peinture apres le balayage', () => {
  it('temoin : un balayage qui aboutit dessine bien un badge', async () => {
    const { relacher, editeur } = balayageSuspendu(MANIFESTE, MANIFESTE_XML, { actif: true }, 'manifestNecessityBadges');
    const p: any = new ManifestNecessityProvider();
    relacher();
    await attendre();
    expect(peints(editeur), 'sans badge les deux tests suivants ne prouveraient rien').toBeGreaterThan(0);
    p.dispose();
  });

  it('couper le reglage pendant le balayage ne rallume pas les badges', async () => {
    const reglage = { actif: true };
    const { relacher, editeur } = balayageSuspendu(MANIFESTE, MANIFESTE_XML, reglage, 'manifestNecessityBadges');
    const p: any = new ManifestNecessityProvider();
    await attendre();
    reglage.actif = false;
    relacher();
    await attendre();
    expect(peints(editeur), 'le badge coupe ne doit pas revenir tout seul').toBe(0);
    p.dispose();
  });

  it('un fournisseur detruit ne peint plus rien', async () => {
    const { relacher, editeur } = balayageSuspendu(MANIFESTE, MANIFESTE_XML, { actif: true }, 'manifestNecessityBadges');
    const p: any = new ManifestNecessityProvider();
    await attendre();
    const avant = editeur.setDecorations.mock.calls.length;
    p.dispose();
    relacher();
    await attendre();
    expect(editeur.setDecorations.mock.calls.length,
      'ecrire a travers un type de decoration detruit').toBe(avant);
  });
});
