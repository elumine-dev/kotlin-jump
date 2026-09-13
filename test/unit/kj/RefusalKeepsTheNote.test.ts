import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { cleanDeadCodeInWorkspaceCommand } from '../../../src/commands/DeadCodeSweep';
import { removeAllUnusedRemoteConfigKeysCommand } from '../../../src/commands/FindUnusedRemoteConfigKeys';
import { UnusedRemoteConfigKeyProvider } from '../../../src/providers/UnusedRemoteConfigKeyProvider';

/**
 * Une edition refusee ne fait pas disparaitre ce qui a bouge.
 *
 * La 1.42.286 a appris a quatre commandes a lire le retour de `applyEdit` et a
 * dire « Nothing was applied. » plutot que d annoncer une suppression qui n a
 * pas eu lieu. Deux d entre elles portaient dans le meme message une seconde
 * information, qui ne parle pas du tout de la meme chose : des fichiers ont
 * change depuis le balayage et ont ete laisses de cote, relancez la commande.
 *
 * Le retour anticipe l a emportee avec le reste. Or elle reste vraie quand
 * l edition est refusee, et c est la seule qui dise au lecteur quoi faire
 * ensuite. Une fausse nouvelle contre un silence : la 1.42.286 avait choisi le
 * bon cote, mais elle a jete une phrase au passage.
 */

afterEach(() => vi.restoreAllMocks());

const SOURCES = [
  { path: '/w/app/src/main/java/p/A.kt', text: 'package p\n\nclass A {\n    private val mort = 1\n    fun vivant() = 3\n}\n' },
  { path: '/w/app/src/main/java/p/B.kt', text: 'package p\n\nclass B {\n    private val mortB = 1\n    fun vivantB() = 2\n}\n' },
];

/** Le balayage, avec B.kt qui bouge apres la reponse et une edition refusee. */
async function balayage(accepte: boolean) {
  const w = vscodeMock.workspace as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockResolvedValue(
    SOURCES.map(s => vscodeMock.Uri.file(s.path)) as any);
  let repondu = false;
  w.fs = {
    readFile: async (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      const src = SOURCES.find(s => s.path === p)!;
      const texte = repondu && p.endsWith('B.kt') ? `// une ligne ajoutee entre temps\n${src.text}` : src.text;
      return Buffer.from(texte, 'utf8');
    },
  };
  w.applyEdit = async () => accepte;
  const dits: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) { repondu = true; return items[0]; }
    dits.push(m);
    return undefined;
  }) as any);
  vi.spyOn(vscodeMock.window, 'showWarningMessage').mockImplementation((async (m: string) => { dits.push(m); return undefined; }) as any);
  await cleanDeadCodeInWorkspaceCommand();
  return dits.join(' | ');
}

const CLE = (k: string) => ['    <entry>', `        <key>${k}</key>`, '        <value>v</value>', '    </entry>'];
const XML = (k: string) => ['<?xml version="1.0" encoding="UTF-8"?>', '<defaults>', ...CLE(k), '</defaults>', ''].join('\n');
const A = '/w/app/src/main/res/xml/a.xml';
const B = '/w/app/src/main/res/xml/b.xml';

/** Remote Config, avec b.xml qui bouge apres la reponse. */
async function remoteConfig(accepte: boolean) {
  const w = vscodeMock.workspace as any;
  const textes = new Map([[A, XML('morte_a')], [B, XML('morte_b')]]);
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  w.fs = {
    readFile: async (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      const t = repondu && p === B ? `<!-- bouge -->\n${textes.get(p)}` : textes.get(p) ?? '';
      return Buffer.from(t, 'utf8');
    },
  };
  w.applyEdit = async () => accepte;
  const dits: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) { repondu = true; return items[0]; }
    dits.push(m);
    return undefined;
  }) as any);
  vi.spyOn(vscodeMock.window, 'showWarningMessage').mockImplementation((async (m: string) => { dits.push(m); return undefined; }) as any);
  const corpus: any = {
    get: async () => ({
      sources: [...textes].map(([path, text]) => ({ path, text })),
      index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  await removeAllUnusedRemoteConfigKeysCommand(corpus, new UnusedRemoteConfigKeyProvider());
  return dits.join(' | ');
}

describe('une edition refusee garde la note sur ce qui a bouge', () => {
  it('temoin : acceptee, le balayage dit ce qui est parti ET ce qui a bouge', async () => {
    const dit = await balayage(true);
    expect(dit).toContain('dead declaration');
    expect(dit).toContain('1 file changed since the scan');
  });

  it('refusee, le balayage ne dit plus Removed mais garde la note', async () => {
    const dit = await balayage(false);
    expect(dit).not.toContain('Removed');
    expect(dit).toContain('Nothing was applied.');
    expect(dit).toContain('1 file changed since the scan');
  });

  it('temoin : acceptee, Remote Config dit ce qui est parti ET ce qui a bouge', async () => {
    const dit = await remoteConfig(true);
    expect(dit).toContain('unread Remote Config key');
    expect(dit).toContain('1 file changed since the scan');
  });

  it('refusee, Remote Config ne dit plus Removed mais garde la note', async () => {
    const dit = await remoteConfig(false);
    expect(dit).not.toContain('Removed');
    expect(dit).toContain('Nothing was applied.');
    expect(dit).toContain('1 file changed since the scan');
  });
});
