import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeTestOnlyCodeCommand } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * La co-suppression relit son verdict apres la question.
 *
 * Meme forme que la 1.42.296 et la 1.42.297 : le balayage a lieu AVANT la boite
 * modale, la construction de l edition APRES le clic relit le TEXTE des
 * fichiers a couper, jamais la RAISON de les couper. Une utilisation apparue
 * pendant le temps de reflexion est dans un autre fichier, celui qui declare
 * n a pas bouge, sa coupe passe.
 *
 * Celle ci supprime des fichiers de test en entier, ce qui en fait la plus
 * couteuse des trois a se tromper : la declaration part, et le test qui la
 * couvrait avec elle.
 */

const MAIN = '/w/app/src/main/java/p';
const SUJET = {
  path: `${MAIN}/Sujet.kt`,
  text: 'package p\n\nclass Sujet {\n    fun utilise() = 1\n}\n\nclass Garde {\n    fun g() = 1\n}\n',
};
const PRINCIPAL = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Garde().g())\n}\n' };
const PRINCIPAL_QUI_UTILISE = {
  path: `${MAIN}/Main.kt`,
  text: 'package p\n\nfun main() {\n    println(Garde().g() + Sujet().utilise())\n}\n',
};
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const TEST = {
  path: '/w/app/src/test/java/p/SujetTest.kt',
  text: 'package p\n\nimport org.junit.Test\n\nclass SujetTest {\n    @Test\n    fun premier() {\n        Sujet().utilise()\n    }\n}\n',
};

afterEach(() => vi.restoreAllMocks());

async function lancer(usageApparait: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  let repondu = false;
  const maintenant = () => [SUJET, repondu && usageApparait ? PRINCIPAL_QUI_UTILISE : PRINCIPAL, GRADLE, TEST];
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
  await removeTestOnlyCodeCommand(corpus);
  const cibles = editions.flatMap((e: any) =>
    [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
      ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);
  return { messages: messages.join(' | '), cibles };
}

describe('KJ-047 le verdict est relu apres la question', () => {
  it('temoin : rien ne change, le sujet et son test partent', async () => {
    const r = await lancer(false);
    expect(r.cibles.some(c => c.endsWith('SujetTest.kt'))).toBe(true);
    expect(r.cibles.some(c => c.endsWith('Sujet.kt'))).toBe(true);
  });

  it('un usage de production apparu pendant la question sauve les deux', async () => {
    const r = await lancer(true);
    expect(r.cibles.some(c => c.endsWith('SujetTest.kt'))).toBe(false);
    expect(r.cibles.some(c => c.endsWith('Sujet.kt'))).toBe(false);
  });

  it('et la commande le dit', async () => {
    expect((await lancer(true)).messages).toMatch(/changed while the question was open|Nothing/i);
  });

  /**
   * Le cas ou il reste du travail. Quand la relecture ne trouve plus rien, la
   * commande rend la main avant de s en servir : c est une seule des deux
   * ressuscitees qui exerce le SCAN relu.
   */
  it('une seule des deux ressuscite : l autre part avec son test', async () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    const A = { path: `${MAIN}/SujetA.kt`, text: 'package p\n\nclass SujetA {\n    fun a() = 1\n}\n' };
    const B = { path: `${MAIN}/SujetB.kt`, text: 'package p\n\nclass SujetB {\n    fun b() = 2\n}\n' };
    const SANS = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
    const AVEC_A = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(SujetA().a())\n}\n' };
    const TA = { path: '/w/app/src/test/java/p/SujetATest.kt',
      text: 'package p\n\nimport org.junit.Test\n\nclass SujetATest {\n    @Test\n    fun a() {\n        SujetA().a()\n    }\n}\n' };
    const TB = { path: '/w/app/src/test/java/p/SujetBTest.kt',
      text: 'package p\n\nimport org.junit.Test\n\nclass SujetBTest {\n    @Test\n    fun b() {\n        SujetB().b()\n    }\n}\n' };
    let repondu = false;
    const maintenant = () => [A, B, repondu ? AVEC_A : SANS, GRADLE, TA, TB];
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
    await removeTestOnlyCodeCommand(corpus);
    const cibles = editions.flatMap((e: any) =>
      [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
        ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);
    expect(cibles.some(c => c.endsWith('SujetBTest.kt'))).toBe(true);
    expect(cibles.some(c => c.endsWith('SujetATest.kt'))).toBe(false);
    expect(cibles.some(c => c.endsWith('SujetA.kt'))).toBe(false);
  });
});
