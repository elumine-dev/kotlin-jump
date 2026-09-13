import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { ResourceCorpus } from '../../../src/indexer/ResourceCorpus';

/**
 * Celui qui a demande le scan ne doit pas repartir avec le corpus d avant.
 *
 * `CorpusGenerationOutlivesAScan` prouve que le scan en vol ne repeuple pas le
 * cache qu on vient d invalider. Il ne regarde jamais ce que ce scan rend a
 * SON appelant, et c est la moitie dangereuse : l appelant, c est la commande
 * qui s apprete a supprimer.
 *
 * Le texte des fichiers est reverifie avant d ecrire, donc un fichier modifie
 * est saute. Le VERDICT ne l est jamais : si la modification ajoute AILLEURS
 * une utilisation du symbole, le fichier qui le declare n a pas bouge, sa
 * coupe passe la verification de texte, et on supprime quelque chose de
 * vivant.
 */

const A = '/w/app/src/main/kotlin/com/x/A.kt';

afterEach(() => vi.restoreAllMocks());

/**
 * Un disque en memoire qui SIGNALE le moment ou il a fige le contenu.
 *
 * Sans ce signal, le test change le disque avant que la lecture ait eu lieu et
 * ne reproduit rien du tout : le scan lit alors deja la nouvelle version. La
 * premiere version de ce fichier passait au vert pour cette raison.
 */
function disque(contenu: () => string, barriere?: Promise<void>) {
  const uri = vscodeMock.Uri.file(A);
  let lectures = 0;
  let signaler: (() => void) | undefined;
  const aFige = new Promise<void>(r => { signaler = r; });
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockResolvedValue([uri] as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  (vscodeMock.workspace as any).fs = {
    readFile: async () => {
      lectures++;
      const octets = Buffer.from(contenu(), 'utf8');
      signaler?.();
      if (barriere) await barriere;
      return octets;
    },
  };
  return { get lectures() { return lectures; }, aFige };
}

const texteDe = (c: any) => c.sources.find((s: any) => s.path.includes('A.kt'))?.text;

describe('le corpus rendu a l appelant', () => {
  it('n est pas celui d avant quand une invalidation tombe pendant le scan', async () => {
    let surLeDisque = 'val v = 1\n';
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });
    const d = disque(() => surLeDisque, barriere);

    const corpus = new ResourceCorpus();
    const enVol = corpus.get();
    // Attendre que le scan ait VRAIMENT fige 'val v = 1', sinon il lirait
    // deja la nouvelle version et le decor ne prouverait rien.
    await d.aFige;
    surLeDisque = 'val v = 2\n';
    corpus.invalidate();
    relacher();

    expect(texteDe(await enVol)).toBe('val v = 2\n');
  });

  it('temoin : sans invalidation, l appelant recoit ce qui a ete lu', async () => {
    disque(() => 'val v = 1\n');
    const corpus = new ResourceCorpus();
    expect(texteDe(await corpus.get())).toBe('val v = 1\n');
  });

  it('une annulation rend la main sans relire, meme si la generation a bouge', async () => {
    // Le cas qui compte : annule ET generation bougee. Sans annulation la
    // boucle relirait, et relire ce que l'utilisateur vient d'annuler est le
    // contraire de ce qu'il a demande.
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });
    const d = disque(() => 'val v = 1\n', barriere);
    const corpus = new ResourceCorpus();
    const jeton = { isCancellationRequested: false } as any;
    const enVol = corpus.get(jeton);
    await d.aFige;
    corpus.invalidate();
    jeton.isCancellationRequested = true;
    relacher();
    const c: any = await enVol;
    // `findFiles` est simule pour rendre la meme URI aux quatre appels, donc
    // un scan vaut deux lectures ici. Le seuil dit « un seul scan », pas
    // « une seule lecture ».
    expect(d.lectures).toBeLessThan(3);
    // Et ce qui revient est ce qui a ete LU, pas le corpus vide d'une
    // tentative suivante que le jeton a coupee avant sa premiere lecture. Un
    // corpus vide se lit comme un projet sans source, et c'est de la que
    // partent les verdicts d'absence.
    expect(c.sources.length).toBeGreaterThan(0);
  });

  it('ne boucle pas indefiniment si les invalidations ne s arretent jamais', async () => {
    let surLeDisque = 'val v = 1\n';
    const d = disque(() => { surLeDisque = `val v = ${surLeDisque.length}\n`; return surLeDisque; });
    const corpus = new ResourceCorpus();
    // Chaque lecture invalide : la condition n est jamais satisfaite.
    const vraiInvalide = corpus.invalidate.bind(corpus);
    const origine = (vscodeMock.workspace as any).fs.readFile;
    (vscodeMock.workspace as any).fs.readFile = async (...a: any[]) => {
      const r = await origine(...a);
      vraiInvalide();
      return r;
    };
    const avant = Date.now();
    const c = await corpus.get();
    expect(c).toBeDefined();
    expect(Date.now() - avant).toBeLessThan(5000);
    expect(d.lectures).toBeLessThan(20);
  });
});
