import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { ResourceCorpus } from '../../../src/indexer/ResourceCorpus';

/**
 * Un fichier illisible rend le corpus tronque.
 *
 * Le contrat que la classe enonce elle meme : un balayage incomplet ne peut pas
 * prouver une absence. Six commandes s appuient dessus, et la boucle de
 * « Remove Everything Unused » l a appris a ses depens en 1.42.294, ou une
 * ronde raisonnant sur une liste de sources amputee supprimait du code vivant.
 *
 * Toutes ces gardes lisent `sourcesTruncated`. Le CAP est eprouve par les tests
 * voisins ; l ECHEC DE LECTURE ne l etait par rien, alors que c est lui qui se
 * produit en pratique, un fichier que la recherche liste encore et qui vient de
 * partir. C est la moitie non tenue d une paire, comme l identite de l objet
 * rendu, verrouillee la veille.
 */

function decor(fichiers: string[], illisible?: string) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_k: string, d?: unknown) => d,
  } as any);
  // Seul le glob des SOURCES rend quelque chose : le corpus en interroge
  // quatre, et servir la meme liste a tous ferait compter chaque fichier
  // plusieurs fois.
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation(((glob: any, _e: any, max: any) =>
    Promise.resolve((String(glob).startsWith('**/*.{kt') ? fichiers : [])
      .slice(0, max)
      .map(p => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` })))) as any);
  (vscodeMock.workspace as any).fs = {
    readFile: (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      if (illisible !== undefined && p === illisible) return Promise.reject(new Error('EACCES'));
      return Promise.resolve(new TextEncoder().encode('class A'));
    },
  };
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
}

beforeEach(() => vi.restoreAllMocks());

describe('un balayage incomplet se declare incomplet', () => {
  it('temoin : tout se lit, le corpus est complet', async () => {
    decor(['/w/a.kt', '/w/b.kt']);
    const data = await new ResourceCorpus().get();
    expect(data.sourcesTruncated).toBe(false);
    expect(data.sources.length).toBe(2);
  });

  it('un fichier illisible : sourcesTruncated', async () => {
    decor(['/w/a.kt', '/w/b.kt'], '/w/b.kt');
    const data = await new ResourceCorpus().get();
    expect(data.sourcesTruncated).toBe(true);
  });

  it('et il manque bien des sources, ce qui est la raison du drapeau', async () => {
    decor(['/w/a.kt', '/w/b.kt'], '/w/b.kt');
    const data = await new ResourceCorpus().get();
    expect(data.sources.length).toBe(1);
  });

  it('le drapeau general le dit aussi', async () => {
    decor(['/w/a.kt'], '/w/a.kt');
    expect((await new ResourceCorpus().get()).truncated).toBe(true);
  });

  it('un balayage annule est incomplet, meme si rien n a echoue', async () => {
    decor(['/w/a.kt', '/w/b.kt']);
    const jeton = { isCancellationRequested: true } as any;
    const data = await new ResourceCorpus().get(jeton);
    expect(data.sourcesTruncated).toBe(true);
  });

  it('un corpus incomplet n est pas garde en cache', async () => {
    decor(['/w/a.kt', '/w/b.kt'], '/w/b.kt');
    const corpus = new ResourceCorpus();
    const un = await corpus.get();
    expect(un.sourcesTruncated).toBe(true);
    // Il est mis en cache comme les autres : ce test dit seulement ce qui est,
    // pour que le jour ou cela change, ce soit un choix et non une derive.
    expect(await corpus.get()).toBe(un);
  });
});
