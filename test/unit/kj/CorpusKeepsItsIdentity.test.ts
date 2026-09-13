import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { ResourceCorpus } from '../../../src/indexer/ResourceCorpus';

/**
 * Le corpus rend le MEME objet tant que rien ne l a invalide.
 *
 * Six commandes de masse rejugent l espace de travail apres la question et
 * comparent l IDENTITE de l objet rendu pour savoir si le verdict a vieilli
 * (1.42.296 a .300). Rien ne bouge, meme objet, on garde le verdict deja
 * calcule ; quelque chose bouge, objet different, on rejuge.
 *
 * Cette identite est la moitie non ecrite d une paire : les commandes s y
 * appuient, personne ne la garantissait. Un rafraichissement qui rendrait une
 * COPIE ferait rejuger a chaque invocation, soit une vingtaine de secondes de
 * plus sur six mille fichiers, et aucun test ne le dirait. Le bench du depot ne
 * peut pas le voir non plus, il n a pas de scenario de commande.
 */

function decor(fichiers: string[]) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_k: string, d?: unknown) => d,
  } as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation(((glob: any, _e: any, max: any) =>
    Promise.resolve((String(glob).includes('build.gradle') ? [] : fichiers)
      .slice(0, max)
      .map(p => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` })))) as any);
  (vscodeMock.workspace as any).fs = {
    readFile: () => Promise.resolve(new TextEncoder().encode('class A')),
  };
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
}

beforeEach(() => vi.restoreAllMocks());

describe('identite de l objet rendu par le corpus', () => {
  it('deux lectures de suite, sans rien changer, rendent le meme objet', async () => {
    decor(['/w/a.kt', '/w/b.kt']);
    const corpus = new ResourceCorpus();
    const un = await corpus.get();
    const deux = await corpus.get();
    expect(deux).toBe(un);
  });

  it('apres une invalidation, l objet est un autre', async () => {
    decor(['/w/a.kt']);
    const corpus = new ResourceCorpus();
    const un = await corpus.get();
    corpus.invalidate();
    const deux = await corpus.get();
    expect(deux).not.toBe(un);
  });

  it('temoin : le contenu reste lisible des deux cotes', async () => {
    decor(['/w/a.kt']);
    const corpus = new ResourceCorpus();
    const un = await corpus.get();
    expect(un.sources.length).toBeGreaterThan(0);
    corpus.invalidate();
    expect((await corpus.get()).sources.length).toBe(un.sources.length);
  });

  it('trois lectures de suite : toujours le meme, pas seulement les deux premieres', async () => {
    decor(['/w/a.kt', '/w/b.kt', '/w/c.kt']);
    const corpus = new ResourceCorpus();
    const un = await corpus.get();
    expect(await corpus.get()).toBe(un);
    expect(await corpus.get()).toBe(un);
  });
});
