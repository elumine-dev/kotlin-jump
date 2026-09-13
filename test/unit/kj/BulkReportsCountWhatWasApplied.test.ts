import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedResourceKeysCommand } from '../../../src/commands/FindUnusedResourceKeys';
import { UnusedResourceKeyProvider } from '../../../src/providers/UnusedResourceKeyProvider';

/**
 * Le compte rendu compte ce qui est PARTI, pas ce qui avait ete trouve.
 *
 * Les rapports ajoutes hier a trois commandes lisaient le compte du scan et le
 * nombre de fichiers de la construction dans la meme phrase. Or ces deux
 * commandes rescannent avant d ecrire, et sautent ce qui a bouge : le
 * constructeur des cles de ressources le dit lui-meme, « the key moved or went
 * away since the scan ».
 *
 * Mesure : deux cles mortes dans deux fichiers, l un change apres la reponse.
 * L edition porte un seul remplacement, et le rapport annoncait
 * « Removed 2 unused resource keys in 1 file. »
 *
 * C est la troisieme fois cette semaine que la meme confusion revient, et la
 * premiere ou je l ai ecrite moi-meme en corrigeant autre chose.
 */

const A = '/w/app/src/main/res/values/strings.xml';
const B = '/w/app/src/main/res/values/extra.xml';
const SOURCES = [
  { path: A, text: '<resources>\n    <string name="morte_a">A</string>\n</resources>\n' },
  { path: B, text: '<resources>\n    <string name="morte_b">B</string>\n</resources>\n' },
  { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(1)\n}\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
];

afterEach(() => vi.restoreAllMocks());

async function lance(bougeB: boolean) {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      const src = SOURCES.find(s => s.path === p);
      if (!src) return Buffer.from('', 'utf8');
      const texte = bougeB && repondu && p === B ? '<resources>\n</resources>\n' : src.text;
      return Buffer.from(texte, 'utf8');
    },
  };
  const editions: any[] = [];
  (vscodeMock.workspace as any).applyEdit = async (e: any) => { editions.push(e); return true; };
  const messages: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) { repondu = true; return items[0]; }
    messages.push(m);
    return undefined;
  }) as any);
  const corpus: any = {
    get: async () => ({
      sources: SOURCES, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  await removeAllUnusedResourceKeysCommand(corpus, new UnusedResourceKeyProvider());
  const e = editions[0];
  return { messages: messages.join(' | '), remplacements: e ? e._entries.length : 0 };
}

describe('le rapport compte ce qui est parti', () => {
  it('temoin : rien ne bouge, les deux cles partent et sont annoncees', async () => {
    const r = await lance(false);
    expect(r.remplacements).toBe(2);
    expect(r.messages).toContain('2 unused resource keys');
  });

  it('une cle sautee parce que son fichier a bouge ne figure plus au rapport', async () => {
    const r = await lance(true);
    expect(r.remplacements).toBe(1);
    expect(r.messages).toContain('1 unused resource key');
    expect(r.messages).not.toContain('2 unused resource keys');
  });
});
