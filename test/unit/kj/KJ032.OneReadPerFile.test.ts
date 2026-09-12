import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { buildSymbolRemovalEdit } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Le texte d'un fichier ferme est lu UNE fois par construction de l'edition.
 *
 * Deux raisons, et la seconde n'est pas une question de vitesse. La
 * restructuration de 1.42.225 a ajoute une passe qui calcule les plages avant
 * d'ecrire quoi que ce soit, et cette passe relisait le fichier : les offsets
 * etaient donc calcules sur une lecture et appliques sur une AUTRE. Entre les
 * deux `await`, le fichier peut avoir change, et la suppression tombe alors a
 * cote. C'est le risque contre lequel tout ce fichier est commente.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/Widget.kt';
const TEXTE = ['package com.x', '', 'class Widget', '', 'class Vivant', ''].join('\n');

const trouvaille = {
  name: 'Widget', kind: 'class', verdict: 'unreferenced',
  path: CHEMIN, line: 2, character: 6,
  removeStart: TEXTE.indexOf('class Widget'), removeEnd: TEXTE.indexOf('class Vivant'),
  testMentions: 0, isDeprecated: false, isLibraryModule: false,
  staleImports: [], fileBecomesEmpty: false,
} as any;

afterEach(() => vi.restoreAllMocks());

describe('buildSymbolRemovalEdit — une lecture par fichier', () => {
  it('un fichier ferme est lu exactement une fois', async () => {
    const lire = vi.spyOn(vscodeMock.workspace.fs, 'readFile')
      .mockResolvedValue(Buffer.from(TEXTE) as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    await buildSymbolRemovalEdit([trouvaille]);
    const pourCeFichier = lire.mock.calls.filter(c => String((c[0] as any)?.fsPath ?? c[0]).includes('Widget.kt'));
    expect(pourCeFichier.length).toBe(1);
  });

  it('un fichier importe par plusieurs symboles morts est lu une seule fois', async () => {
    const IMPORTEUR = '/w/app/src/main/kotlin/com/x/User.kt';
    const lire = vi.spyOn(vscodeMock.workspace.fs, 'readFile')
      .mockImplementation(async (uri: any) => Buffer.from(
        String(uri?.fsPath ?? uri).includes('User.kt') ? 'package com.x\n\nimport com.x.Widget\nimport com.x.Autre\n' : TEXTE,
      ) as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    const a = { ...trouvaille, staleImports: [{ path: IMPORTEUR, line: 2 }] };
    const b = {
      ...trouvaille, name: 'Autre',
      removeStart: TEXTE.indexOf('class Vivant'), removeEnd: TEXTE.length,
      line: 4, staleImports: [{ path: IMPORTEUR, line: 3 }],
    };
    await buildSymbolRemovalEdit([a, b]);
    const pourImporteur = lire.mock.calls.filter(c => String((c[0] as any)?.fsPath ?? c[0]).includes('User.kt'));
    expect(pourImporteur.length).toBe(1);
  });
});
