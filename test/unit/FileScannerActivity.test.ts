/**
 * Le compteur d'activite de FileScanner.
 *
 * `busy()` et `whenIdle()` existent pour que le veilleur rejoue la suppression
 * d'un dossier une fois le balayage fini. Si le compteur se desequilibre,
 * `busy()` reste vrai pour toujours, `whenIdle()` ne se resout jamais, et ce
 * rejeu s'arrete SANS BRUIT : aucun test ne tombe, puisque tous les vecteurs du
 * veilleur passent par un bouchon qui fournit son propre `busy`.
 *
 * Verifie donc ici sur le vrai scanner, y compris sur les sorties qui ne sont
 * pas le succes : lecture impossible, fichier trop gros, balayage annule par un
 * suivant.
 */
import { describe, it, expect } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { FileScanner } from '../../src/indexer/FileScanner';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

const NL = String.fromCharCode(10);
const JOURNAL = { info() {}, debug() {}, warn() {}, error() {} } as any;

function neuf(): { scanner: FileScanner; index: SymbolIndex } {
  const index = new SymbolIndex();
  return { scanner: new FileScanner(index, JOURNAL, new Map()), index };
}

/** Resolue seulement si le scanner se declare au repos, sinon rend le drapeau. */
async function repos(scanner: FileScanner): Promise<string> {
  return Promise.race([
    scanner.whenIdle().then(() => 'au repos'),
    new Promise<string>(r => setTimeout(() => r('JAMAIS AU REPOS'), 1500)),
  ]);
}

const uri = (n: string) => vscodeMock.Uri.parse('file:///a/' + n) as any;

async function avecLecture<T>(lire: (u: any) => Promise<Uint8Array>, corps: () => Promise<T>): Promise<T> {
  const orig = (vscodeMock.workspace.fs as any).readFile;
  (vscodeMock.workspace.fs as any).readFile = lire;
  try { return await corps(); } finally { (vscodeMock.workspace.fs as any).readFile = orig; }
}

const SOURCE = new TextEncoder().encode('package p;' + NL + 'public class A {}' + NL);

describe('FileScanner — le compteur d activite revient toujours a zero', () => {
  it('apres un scan qui reussit', async () => {
    const { scanner, index } = neuf();
    await avecLecture(async () => SOURCE, () => scanner.scanFile(uri('A.java')));
    index.finalize();
    expect(index.lookup('A'), 'le scan a bien indexe').toHaveLength(1);
    expect(scanner.busy(), 'plus rien ne tourne').toBe(false);
    expect(await repos(scanner)).toBe('au repos');
    await scanner.destroy();
  });

  it('apres un scan dont la lecture echoue', async () => {
    const { scanner } = neuf();
    await avecLecture(async () => { throw new Error('ENOENT'); }, () => scanner.scanFile(uri('B.java')));
    expect(scanner.busy(), 'une lecture impossible ne doit pas laisser le compteur en l air').toBe(false);
    expect(await repos(scanner)).toBe('au repos');
    await scanner.destroy();
  });

  it('apres un lot, dont un fichier illisible', async () => {
    const { scanner, index } = neuf();
    await avecLecture(
      async (u: any) => { if (String(u).includes('Casse')) throw new Error('ENOENT'); return SOURCE; },
      () => scanner.scanFiles([uri('C.java'), uri('Casse.java'), uri('D.java')]),
    );
    index.finalize();
    expect(index.stats().files, 'les deux lisibles sont indexes').toBe(2);
    expect(scanner.busy()).toBe(false);
    expect(await repos(scanner)).toBe('au repos');
    await scanner.destroy();
  });

  it('quand un balayage en annule un autre', async () => {
    const { scanner } = neuf();
    await avecLecture(async () => SOURCE, async () => {
      const uris = Array.from({ length: 40 }, (_, i) => uri('E' + i + '.java'));
      // `rescan` prend un jeton neuf, ce qui annule le balayage precedent en
      // plein vol : sa sortie anticipee doit quand meme rendre le compteur.
      const premier = scanner.rescan(uris);
      const second  = scanner.rescan(uris);
      await Promise.all([premier, second]);
    });
    expect(scanner.busy(), 'une annulation ne doit pas laisser le compteur en l air').toBe(false);
    expect(await repos(scanner)).toBe('au repos');
    await scanner.destroy();
  });

  it('whenIdle attend vraiment la fin, il ne rend pas la main tout de suite', async () => {
    const { scanner } = neuf();
    let relache!: () => void;
    const barriere = new Promise<void>(r => { relache = r; });
    const scan = avecLecture(
      async () => { await barriere; return SOURCE; },
      () => scanner.scanFile(uri('F.java')),
    );
    // Le scan est en vol : whenIdle ne doit pas se resoudre.
    expect(scanner.busy(), 'un scan tourne').toBe(true);
    let resolu = false;
    void scanner.whenIdle().then(() => { resolu = true; });
    await new Promise<void>(r => setTimeout(r, 50));
    expect(resolu, 'whenIdle ne doit pas se resoudre pendant le scan').toBe(false);

    relache();
    await scan;
    expect(await repos(scanner)).toBe('au repos');
    await scanner.destroy();
  });
});
