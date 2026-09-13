import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { estLeFichier, stillTheMeasuredText } from '../../../src/util/measuredText';
import { rememberCorpusUri } from '../../../src/util/corpusUri';

/**
 * Sur vscode.dev un fichier n est pas un `file:`.
 *
 * `estLeFichier` n acceptait que le schema `file`, pour ecarter la vue de
 * comparaison `git:` dont le `fsPath` est celui du vrai fichier et dont le
 * contenu est celui de HEAD. La liste blanche ecarte du meme coup
 * `vscode-vfs://github/owner/repo/...`, qui EST le fichier sur l hote
 * navigateur.
 *
 * Ce qui en decoule echoue en s ouvrant, ce qui est le mauvais sens pour un
 * garde-fou : `stillTheMeasuredText` conclut « rien n est ouvert », rend le
 * texte mesure sans le confronter a quoi que ce soit, et les offsets d un
 * scan d il y a une minute s appliquent a un document que l utilisateur vient
 * d editer. Les deux fournisseurs qui preferent le texte de l editeur a celui
 * du disque lisent le disque a la place.
 *
 * Trois commandes de suppression en masse viennent d arriver sur cet hote, et
 * `removeAllUnusedResourceKeys` y tournait deja.
 */

const CHEMIN = '/owner/repo/A.kt';

const doc = (uri: any, texte: string) => ({ uri, getText: () => texte }) as any;

afterEach(() => vi.restoreAllMocks());

describe('le document qui EST le fichier, sur l hote navigateur', () => {
  it('un document vscode-vfs du corpus est reconnu', () => {
    const uri = vscodeMock.Uri.parse(`vscode-vfs://github${CHEMIN}`);
    rememberCorpusUri(uri);
    expect(estLeFichier(CHEMIN)(doc(uri, 'x'))).toBe(true);
  });

  it('une vue git: du meme chemin ne l est pas', () => {
    rememberCorpusUri(vscodeMock.Uri.parse(`vscode-vfs://github${CHEMIN}`));
    expect(estLeFichier(CHEMIN)(doc(vscodeMock.Uri.parse(`git:${CHEMIN}`), 'HEAD'))).toBe(false);
  });

  it('temoin : sur disque, un file: reste reconnu et git: reste ecarte', () => {
    const p = '/w/B.kt';
    rememberCorpusUri(vscodeMock.Uri.file(p));
    expect(estLeFichier(p)(doc(vscodeMock.Uri.file(p), 'x'))).toBe(true);
    expect(estLeFichier(p)(doc(vscodeMock.Uri.parse(`git:${p}`), 'HEAD'))).toBe(false);
  });

  it('temoin : un chemin que le corpus n a jamais vu se juge comme avant', () => {
    const p = '/jamais/vu/C.kt';
    expect(estLeFichier(p)(doc(vscodeMock.Uri.file(p), 'x'))).toBe(true);
    expect(estLeFichier(p)(doc(vscodeMock.Uri.parse(`git:${p}`), 'x'))).toBe(false);
  });

  it('le garde-fou de peremption voit le document edite au lieu de se taire', () => {
    const uri = vscodeMock.Uri.parse(`vscode-vfs://github${CHEMIN}`);
    rememberCorpusUri(uri);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get')
      .mockReturnValue([doc(uri, 'val v = 2\n')] as any);
    // Mesure d il y a une minute contre ce que l editeur tient maintenant.
    expect(stillTheMeasuredText(CHEMIN, 'val v = 1\n')).toBeUndefined();
    expect(stillTheMeasuredText(CHEMIN, 'val v = 2\n')).toBe('val v = 2\n');
  });
});
