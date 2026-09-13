import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { ResourceCorpus } from '../../../src/indexer/ResourceCorpus';

/**
 * `invalidate()` pendant un scan EN VOL ne doit pas etre efface par ce scan.
 *
 * Vider le cache ne suffisait pas : le scan deja lance ecrit son resultat en
 * se terminant, et ce resultat a ete lu AVANT le changement. L'ecriture
 * annulait donc l'invalidation et reposait un horodatage neuf, de sorte que
 * le corpus d'avant etait servi pendant une minute de plus sans une seule
 * lecture disque. La fenetre, c'est toute la duree du scan, et chaque
 * commande de code mort l'ouvre.
 *
 * Ce qui en sort n'est pas cosmetique : un verdict calcule la annonce morte
 * une cle vivante, et « Remove All » applique la suppression. Les offsets sont
 * reverifies avant d'ecrire, le VERDICT ne l'est jamais.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';

afterEach(() => vi.restoreAllMocks());

/** Un disque en memoire dont la lecture peut etre retenue a la demande. */
function disque(contenu: () => string, barriere?: Promise<void>) {
  const uri = vscodeMock.Uri.file(CHEMIN);
  let lectures = 0;
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockResolvedValue([uri] as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  (vscodeMock.workspace as any).fs = {
    readFile: async () => {
      lectures++;
      const octets = Buffer.from(contenu(), 'utf8');
      if (barriere) await barriere;
      return octets;
    },
  };
  return { get lectures() { return lectures; } };
}

const texteDe = (c: any) => c.sources.find((s: any) => s.path.includes('A.kt'))?.text;

describe('ResourceCorpus et l invalidation pendant un scan', () => {
  it('le scan en vol ne repeuple pas le cache que l on vient d invalider', async () => {
    let surLeDisque = 'val v = 1\n';
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });
    const d = disque(() => surLeDisque, barriere);

    const corpus = new ResourceCorpus();
    const enVol = corpus.get();
    // Le scan a capture "val v = 1". Le disque change, le veilleur invalide.
    await Promise.resolve();
    surLeDisque = 'val v = 2\n';
    corpus.invalidate();
    relacher();
    await enVol;

    const lecturesAvant = d.lectures;
    const suivant = await corpus.get();
    expect(texteDe(suivant)).toBe('val v = 2\n');
    expect(d.lectures).toBeGreaterThan(lecturesAvant);
  });

  it('temoin : sans invalidation, le cache sert et ne relit pas', async () => {
    const d = disque(() => 'val v = 1\n');
    const corpus = new ResourceCorpus();
    await corpus.get();
    const lecturesAvant = d.lectures;
    const second = await corpus.get();
    expect(texteDe(second)).toBe('val v = 1\n');
    expect(d.lectures).toBe(lecturesAvant);
  });

  it('temoin : une invalidation HORS scan force bien une relecture', async () => {
    let surLeDisque = 'val v = 1\n';
    const d = disque(() => surLeDisque);
    const corpus = new ResourceCorpus();
    await corpus.get();
    surLeDisque = 'val v = 3\n';
    corpus.invalidate();
    const lecturesAvant = d.lectures;
    expect(texteDe(await corpus.get())).toBe('val v = 3\n');
    expect(d.lectures).toBeGreaterThan(lecturesAvant);
  });
});
