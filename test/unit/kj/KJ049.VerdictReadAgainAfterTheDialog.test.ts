import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { makeSelfOnlyPrivateCommand } from '../../../src/commands/MakeSelfOnlyPrivate';

/**
 * Rendre un membre prive relit son verdict apres la question.
 *
 * Meme forme que les 1.42.296, .297 et .298. Ici le verdict est « ce membre
 * n est utilise que dans sa propre classe », qui se juge sur TOUT l espace de
 * travail. Un appel venu d ailleurs pendant le temps de reflexion ne touche pas
 * le fichier qui declare, donc la relecture de texte le laisse passer, et le
 * `private` ecrit fait cesser de compiler le fichier appelant.
 *
 * C est la seule des trois qui n efface rien et casse quand meme la
 * compilation.
 */

const MAIN = '/w/app/src/main/java/p';
const BOITE = {
  path: `${MAIN}/Boite.kt`,
  text: 'package p\n\nclass Boite {\n    fun aide() = 1\n\n    fun interne() = aide()\n}\n',
};
const SANS = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne())\n}\n' };
const AVEC = {
  path: `${MAIN}/Main.kt`,
  text: 'package p\n\nfun main() {\n    println(Boite().interne() + Boite().aide())\n}\n',
};
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

afterEach(() => vi.restoreAllMocks());

async function lancer(appelApparait: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  let repondu = false;
  const maintenant = () => [BOITE, repondu && appelApparait ? AVEC : SANS, GRADLE];
  w.fs = {
    readFile: async (uri: any) => Buffer.from(
      maintenant().find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  const corpus: any = {
    invalidate: () => {},
    get: async () => ({
      sources: maintenant(), index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
  };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return rest.slice(1)[0]; }
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  await makeSelfOnlyPrivateCommand(corpus);
  const ecrits = editions.flatMap((e: any) => e.entries().map((x: any) => String(x.newText)));
  return { messages: messages.join(' | '), ecrits };
}

describe('KJ-049 le verdict est relu apres la question', () => {
  it('temoin : rien ne change, le membre devient prive', async () => {
    const r = await lancer(false);
    expect(r.ecrits.some(t => t.includes('private'))).toBe(true);
  });

  it('un appel venu d ailleurs pendant la question empeche le private', async () => {
    const r = await lancer(true);
    expect(r.ecrits.some(t => t.includes('private'))).toBe(false);
  });

  it('et la commande le dit', async () => {
    expect((await lancer(true)).messages).toMatch(/changed while the question was open|No member|Nothing/i);
  });

  /**
   * Le cas ou il reste du travail : un seul des deux membres recoit un appel de
   * l exterieur. Quand la relecture vide entierement la liste, la commande rend
   * la main avant de s en servir, et un mutant qui reprend l ancienne liste
   * survit.
   */
  it('un seul des deux appele de l exterieur : l autre devient prive', async () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const DEUX = { path: `${MAIN}/Boite.kt`, text:
      'package p\n\nclass Boite {\n    fun aideA() = 1\n\n    fun aideB() = 2\n\n    fun interne() = aideA() + aideB()\n}\n' };
    const SANS2 = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne())\n}\n' };
    const AVEC_A = { path: `${MAIN}/Main.kt`, text:
      'package p\n\nfun main() {\n    println(Boite().interne() + Boite().aideA())\n}\n' };
    let repondu = false;
    const maintenant = () => [DEUX, repondu ? AVEC_A : SANS2, GRADLE];
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    w.fs = { readFile: async (uri: any) => Buffer.from(
      maintenant().find(x => x.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
    const corpus: any = { invalidate: () => {}, get: async () => ({
      sources: maintenant(), index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] }) };
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    win.showInformationMessage = async (_m: string, ...rest: any[]) => {
      if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return rest.slice(1)[0]; }
      return undefined;
    };
    win.showWarningMessage = async () => undefined;
    const editions: any[] = [];
    w.applyEdit = async (e: any) => { editions.push(e); return true; };
    await makeSelfOnlyPrivateCommand(corpus);
    // Une seule insertion, et sur la ligne de `aideB`.
    const lignes = editions.flatMap((e: any) => e.entries().map((x: any) => x.range.start.line));
    expect(lignes.length).toBe(1);
    const texte = DEUX.text.split('\n');
    expect(texte[lignes[0]]).toContain('aideB');
  });
});
