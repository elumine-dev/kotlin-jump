import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand, libelleDeLaDemande } from '../../../src/commands/RemoveEverythingUnused';

/**
 * La ligne de detail ne doit pas annoncer un nombre de CHANGEMENTS que
 * l edition ne portera pas.
 *
 * Ce nombre venait du plan. L edition, elle, se construit apres la question :
 * un fichier vide de tout part en entier, ce qui remplace ses coupes par une
 * seule suppression, et la cascade ajoute des operations que le plan ignore.
 * Sur le projet de reference la cascade pese 100 coupes d imports et 54
 * fichiers, donc l ecart n a rien de marginal.
 *
 * Mesure de bout en bout sur trois fichiers dont un import orpheline :
 * le dialogue disait « 4 changes in 3 files », l edition portait trois
 * operations, trois suppressions de fichier et aucun remplacement.
 *
 * Et le nombre exact n est pas connaissable avant la question : c est la
 * boucle, APRES le clic, qui ecarte les fichiers ayant bouge depuis le scan.
 * Precalculer pour l affichage et reutiliser rouvrirait ce trou. La ligne dit
 * donc ce qu elle sait, ce qui a ete TROUVE, et laisse le compte rendu final
 * dire ce qui a ete fait.
 */

const SOURCES = [
  { path: '/w/app/src/main/java/p/Morte.kt', text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' },
  { path: '/w/app/src/main/java/q/Consommateur.kt', text: 'package q\n\nimport p.Morte\n\nclass Consommateur {\n    fun g() = 2\n}\n' },
  { path: '/w/app/src/main/java/q/Vivant.kt', text: 'package q\n\nfun point(c: Consommateur) = c.g()\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
];

afterEach(() => vi.restoreAllMocks());

async function lance() {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => Buffer.from(
      SOURCES.find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  const editions: any[] = [];
  const vraiApply = (vscodeMock.workspace as any).applyEdit;
  (vscodeMock.workspace as any).applyEdit = async (e: any) => {
    editions.push(e);
    return editions.length === 1;      // une seule passe, puis on rend la main
  };
  let detail = '';
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (_m: string, o?: any, ...items: string[]) => {
    if (o?.detail !== undefined && detail === '') detail = o.detail;
    return items[0];
  }) as any);
  const corpus: any = {
    get: async () => ({
      sources: SOURCES, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  try {
    await removeEverythingUnusedCommand(corpus);
  } finally {
    (vscodeMock.workspace as any).applyEdit = vraiApply;
  }
  const e = editions[0];
  return { detail, operations: e ? e._entries.length + e._fileDeletes.length : 0 };
}

describe('KJ-050 ce qui est annonce et ce qui est envoye', () => {
  it('temoin : le decor produit bien une edition faite de suppressions', async () => {
    const r = await lance();
    expect(r.operations).toBe(3);
  });

  it('si la ligne annonce des changements, leur nombre est celui de l edition', async () => {
    const r = await lance();
    const m = /(\d+) changes? in /.exec(r.detail);
    if (m) expect(Number(m[1])).toBe(r.operations);
  });

  it('elle n annonce plus quatre changements pour trois operations', async () => {
    expect((await lance()).detail).not.toContain('4 changes');
  });

  it('elle dit toujours ce qui a ete trouve et dans combien de fichiers', async () => {
    const d = libelleDeLaDemande(4, 0, 3).detail;
    expect(d).toContain('4');
    expect(d).toContain('3 files');
  });

  it('elle dit toujours ce que chaque bouton fait', async () => {
    const d = libelleDeLaDemande(4, 0, 3).detail;
    expect(d).toContain('Apply all skips the preview');
    expect(d).toContain('nothing ticked');
    expect(d).toContain('Apply all repeats until nothing is left');
  });

  it('et garde la note des renommages quand il y en a', () => {
    expect(libelleDeLaDemande(10, 3, 4).detail).toContain('3 unused names renamed to `_`');
  });
});
