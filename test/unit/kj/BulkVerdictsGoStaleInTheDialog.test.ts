import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Un verdict fige avant la question ne survit pas a ce qui arrive pendant.
 *
 * La 1.42.296 a corrige ce defaut dans la commande qui retire tout : le
 * balayage a lieu AVANT la boite modale, et une utilisation apparue pendant le
 * temps de reflexion, un `git pull` ou une sauvegarde ailleurs, laisse la
 * declaration morte dans l instantane. Elle part.
 *
 * Le controle qui reste ne couvre pas ce cas : il relit le texte du fichier
 * DECLARANT et refuse la coupe si ce fichier a bouge. Le nouvel appel est dans
 * un autre fichier, celui qui declare est intact, la coupe passe.
 *
 * Cinq autres commandes de la famille reconstruisent leur edition apres le
 * clic mais gardent le verdict du balayage. Celle ci supprime des fichiers
 * quand ils se vident, ce qui en fait la plus couteuse a se tromper.
 */

const APP = '/w/app/src/main/java/p';
const MORTE = { path: `${APP}/Morte.kt`, text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' };
const SANS = { path: `${APP}/Main.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
const AVEC = { path: `${APP}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Morte().f())\n}\n' };
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

afterEach(() => vi.restoreAllMocks());

async function lancer(usageApparait: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  let repondu = false;
  const sourcesMaintenant = () => [MORTE, repondu && usageApparait ? AVEC : SANS, GRADLE];
  w.fs = {
    readFile: async (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      return Buffer.from(sourcesMaintenant().find(s => s.path === p)?.text ?? '', 'utf8');
    },
  };
  let appels = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => {
      appels++;
      return {
        sources: sourcesMaintenant(), index: null, modulesWithCode: ['/w/app'], libraryModules: [],
        truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
      };
    },
  };
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return rest.slice(1)[0]; }
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
  const cibles = editions.flatMap((e: any) =>
    [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
      ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);
  return { messages: messages.join(' | '), cibles, appels };
}

describe('le verdict est relu apres la question', () => {
  it('temoin : rien ne change, la classe morte part', async () => {
    const r = await lancer(false);
    expect(r.cibles.some(c => c.endsWith('Morte.kt'))).toBe(true);
  });

  it('un usage apparu pendant la question sauve la classe', async () => {
    const r = await lancer(true);
    expect(r.cibles.some(c => c.endsWith('Morte.kt'))).toBe(false);
  });

  it('et la commande le dit', async () => {
    expect((await lancer(true)).messages).toMatch(/Nothing to remove|Nothing was applied|no longer/i);
  });

  /**
   * Le cas ou il reste du travail : une des deux mortes ressuscite pendant la
   * question, l autre non. C est celui la qui exerce la LISTE relue ; quand
   * elle se vide entierement, la commande rend la main avant de s en servir.
   */
  it('une seule des deux ressuscite : l autre part quand meme', async () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const A = { path: `${APP}/MorteA.kt`, text: 'package p\n\nclass MorteA {\n    fun f() = 1\n}\n' };
    const B = { path: `${APP}/MorteB.kt`, text: 'package p\n\nclass MorteB {\n    fun g() = 2\n}\n' };
    const SANS2 = { path: `${APP}/Main.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
    const AVEC_A = { path: `${APP}/Main.kt`, text: 'package p\n\nfun main() {\n    println(MorteA().f())\n}\n' };
    let repondu = false;
    const maintenant = () => [A, B, repondu ? AVEC_A : SANS2, GRADLE];
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    w.fs = { readFile: async (uri: any) => Buffer.from(
      maintenant().find(x => x.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
    const corpus: any = { invalidate: () => {}, get: async () => ({
      sources: maintenant(), index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] }) };
    win.showInformationMessage = async (_m: string, ...rest: any[]) => {
      if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return rest.slice(1)[0]; }
      return undefined;
    };
    win.showWarningMessage = async () => undefined;
    const editions: any[] = [];
    w.applyEdit = async (e: any) => { editions.push(e); return true; };
    await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
    const cibles = editions.flatMap((e: any) =>
      [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
        ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);
    expect(cibles.some(c => c.endsWith('MorteB.kt'))).toBe(true);
    expect(cibles.some(c => c.endsWith('MorteA.kt'))).toBe(false);
  });

  /**
   * Relire ne veut pas dire rebalayer. Le corpus rend l objet de son cache tel
   * quel tant que rien ne l a invalide, et la commande s en sert pour savoir
   * qu elle peut garder le verdict deja calcule.
   */
  it('corpus inchange : le verdict n est pas recalcule', async () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    const liste = [MORTE, SANS, GRADLE];
    w.fs = { readFile: async (uri: any) => Buffer.from(
      liste.find(x => x.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
    let lectures = 0;
    const fige = {
      get sources() { lectures++; return liste; },
      index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    };
    const corpus: any = { invalidate: () => {}, get: async () => fige };
    win.showInformationMessage = async (_m: string, ...rest: any[]) =>
      (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal ? rest.slice(1)[0] : undefined);
    win.showWarningMessage = async () => undefined;
    let aLEdition = -1;
    w.applyEdit = async () => { if (aLEdition < 0) aLEdition = lectures; return true; };
    await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
    // Un seul balayage en fait trois : les modules publies, le detecteur, et
    // le compte de fichiers rendu par `scan`. Un second en ajouterait deux.
    expect(aLEdition).toBe(3);
  });
});
