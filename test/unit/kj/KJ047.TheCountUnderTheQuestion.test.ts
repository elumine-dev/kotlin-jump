import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeTestOnlyCodeCommand } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Le nombre annonce avant la question doit etre celui de l edition envoyee.
 *
 * Il additionnait des comptes du PLAN, les declarations offertes et les
 * fonctions de test, a des comptes de la CONSTRUCTION, les imports et fichiers
 * balayes par la cascade. Quand un fichier de test part en entier, ses
 * fonctions ne produisent aucune edition a elles seules, et le plan les compte
 * quand meme.
 *
 * Mesure de bout en bout sur le cas le plus simple qui existe, une classe
 * utilisee par ses deux seuls tests : le dialogue annoncait
 * « 4 changes in 2 files » pour une edition qui portait deux operations, deux
 * suppressions de fichier et pas un seul remplacement.
 *
 * Ce fichier dit lui-meme, a propos du compte rendu final, que ce qui est
 * APPLIQUE est ce qui doit etre rapporte. La question posee avant n y etait
 * pas tenue.
 */

const SOURCES = [
  {
    path: '/w/app/src/main/java/p/Sujet.kt',
    text: 'package p\n\nclass Sujet {\n    fun utilise() = 1\n}\n',
  },
  {
    path: '/w/app/src/test/java/p/SujetTest.kt',
    text: 'package p\n\nimport org.junit.Test\n\nclass SujetTest {\n    @Test\n    fun premier() {\n        Sujet().utilise()\n    }\n\n    @Test\n    fun second() {\n        Sujet().utilise()\n    }\n}\n',
  },
];

afterEach(() => vi.restoreAllMocks());

async function lance(sources: typeof SOURCES) {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => Buffer.from(
      sources.find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  (vscodeMock.workspace as any)._editsAppliquees = [];

  let detail = '';
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (_m: string, o?: any, ...items: string[]) => {
    if (o?.detail !== undefined && detail === '') detail = o.detail;
    return items[0];          // « Apply all »
  }) as any);

  const corpus: any = {
    get: async () => ({
      sources, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  await removeTestOnlyCodeCommand(corpus);
  const edit = (vscodeMock.workspace as any)._editsAppliquees[0];
  return {
    detail,
    operations: edit ? edit._entries.length + edit._fileDeletes.length : 0,
    remplacements: edit ? edit._entries.length : 0,
    suppressions: edit ? edit._fileDeletes.length : 0,
  };
}

describe('KJ-047 le compte sous la question', () => {
  it('temoin : le decor produit bien une suppression de fichiers entiers', async () => {
    const r = await lance(SOURCES);
    expect(r.suppressions).toBe(2);
    expect(r.remplacements).toBe(0);
  });

  it('annonce le nombre d operations que l edition porte vraiment', async () => {
    const r = await lance(SOURCES);
    expect(r.detail).toContain(`${r.operations} change`);
  });

  it('et ne parle pas de quatre changements pour deux operations', async () => {
    const r = await lance(SOURCES);
    expect(r.detail).not.toContain('4 changes');
  });

  it('dit toujours combien de fichiers partent en entier', async () => {
    const r = await lance(SOURCES);
    expect(r.detail).toContain('2 files deleted outright.');
  });
});
