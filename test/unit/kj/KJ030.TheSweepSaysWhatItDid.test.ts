import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { cleanDeadCodeInWorkspaceCommand } from '../../../src/commands/DeadCodeSweep';

/**
 * Le balayage de l espace de travail dit ce qu il a fait.
 *
 * « Apply all » saute l apercu, par construction : le drapeau qui l ouvre est
 * celui qui laisse ses cases decochees. L edition partait donc sans un mot,
 * seule commande destructive de la famille a se taire. Le jumeau par fichier
 * peut se taire, lui, puisqu il passe toujours par l apercu.
 *
 * La 1.42.241 a rendu ce rapport veridique, en posant la regle dans un
 * commentaire du fichier : ce qui est APPLIQUE est ce qui doit etre RAPPORTE.
 * Elle a couvert le cas ou il ne reste rien et celui ou des fichiers ont bouge,
 * et laisse le cas ordinaire muet.
 */

const SOURCES = [
  { path: '/w/app/src/main/java/p/A.kt', text: 'package p\n\nclass A {\n    private val mort = 1\n    private fun mortAussi() = 2\n    fun vivant() = 3\n}\n' },
  { path: '/w/app/src/main/java/p/B.kt', text: 'package p\n\nclass B {\n    private val mortB = 1\n    fun vivantB() = 2\n}\n' },
];

afterEach(() => vi.restoreAllMocks());

async function lance(reponse: 'apply' | 'review' | 'cancel') {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockResolvedValue(
    SOURCES.map(s => vscodeMock.Uri.file(s.path)) as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => Buffer.from(
      SOURCES.find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  const editions: any[] = [];
  (vscodeMock.workspace as any).applyEdit = async (e: any) => { editions.push(e); return true; };
  const messages: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) return reponse === 'cancel' ? undefined : items[reponse === 'apply' ? 0 : 1];
    messages.push(m);
    return undefined;
  }) as any);
  await cleanDeadCodeInWorkspaceCommand();
  return {
    messages,
    operations: editions.reduce((n, e) => n + e._entries.length + e._fileDeletes.length, 0),
    editions: editions.length,
  };
}

describe('KJ-030 le balayage dit ce qu il a fait', () => {
  it('temoin : le decor produit bien une edition de trois operations', async () => {
    const r = await lance('apply');
    expect(r.operations).toBe(3);
  });

  it('apres Apply all, il annonce ce qui est parti', async () => {
    const r = await lance('apply');
    expect(r.messages.join(' | ')).toContain('3 dead declarations');
  });

  it('et dans combien de fichiers', async () => {
    expect((await lance('apply')).messages.join(' | ')).toContain('2 files');
  });

  it('si un fichier bouge entre la question et l application, il compte ce qui est parti', async () => {
    // Le decor : B.kt change apres la reponse, donc sa coupe est refusee a la
    // seconde construction. Le rapport doit lire les comptes APPLIQUES, pas
    // ceux de l apercu, ce que le fichier revendique lui-meme en commentaire.
    (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockResolvedValue(
      SOURCES.map(s => vscodeMock.Uri.file(s.path)) as any);
    let repondu = false;
    (vscodeMock.workspace as any).fs = {
      readFile: async (uri: any) => {
        const p = uri.fsPath ?? String(uri);
        const src = SOURCES.find(s => s.path === p)!;
        const texte = repondu && p.endsWith('B.kt')
          ? `// une ligne ajoutee entre temps\n${src.text}`
          : src.text;
        return Buffer.from(texte, 'utf8');
      },
    };
    (vscodeMock.workspace as any).applyEdit = async () => true;
    const messages: string[] = [];
    vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
      if (o?.modal) { repondu = true; return items[0]; }
      messages.push(m);
      return undefined;
    }) as any);
    await cleanDeadCodeInWorkspaceCommand();
    const dit = messages.join(' | ');
    expect(dit).toContain('2 dead declarations');
    expect(dit).not.toContain('3 dead declarations');
    expect(dit).toContain('1 file changed since the scan');
  });

  it('annuler n applique rien et ne raconte rien', async () => {
    const r = await lance('cancel');
    expect(r.editions).toBe(0);
    expect(r.messages).toEqual([]);
  });
});
