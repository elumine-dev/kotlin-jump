import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';
import { removeAllUnusedResourceKeysCommand } from '../../../src/commands/FindUnusedResourceKeys';
import { UnusedResourceKeyProvider } from '../../../src/providers/UnusedResourceKeyProvider';
import { removeAllUnusedRemoteConfigKeysCommand } from '../../../src/commands/FindUnusedRemoteConfigKeys';
import { UnusedRemoteConfigKeyProvider } from '../../../src/providers/UnusedRemoteConfigKeyProvider';
import { removeTestOnlyCodeCommand } from '../../../src/commands/RemoveTestOnlyCode';
import { makeSelfOnlyPrivateCommand } from '../../../src/commands/MakeSelfOnlyPrivate';

/**
 * La relecture du verdict peut retirer de la liste, jamais y ajouter.
 *
 * Les 1.42.296 a .300 font rejuger l espace de travail apres le clic, ce qui
 * sauve une declaration rappelee a la vie pendant la question. Mais rejuger
 * marche dans les deux sens : si le changement TUE quelque chose d autre, par
 * exemple parce qu il retire le dernier appel a une seconde classe, la liste
 * relue est plus GRANDE que celle annoncee.
 *
 * Le dialogue a demande « Remove 1 unreferenced declaration? » et deux
 * partent. L utilisateur a consenti a un ensemble, pas a une intention. Ce
 * depot tient a ce que le compte annonce soit le compte applique, et il a paye
 * quatre versions pour ca en 1.42.277 a .280.
 *
 * La regle : la relecture est une INTERSECTION avec ce qui a ete annonce.
 */

const MAIN = '/w/app/src/main/java/p';
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const MORTE = { path: `${MAIN}/Morte.kt`, text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' };
const AUTRE = { path: `${MAIN}/Autre.kt`, text: 'package p\n\nclass Autre {\n    fun g() = 2\n}\n' };
// Avant : `Autre` est vivante, appelee depuis Main. Apres : l appel a disparu.
const AVEC_APPEL = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Autre().g())\n}\n' };
const SANS_APPEL = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };

afterEach(() => vi.restoreAllMocks());

async function lancer() {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const avant = [MORTE, AUTRE, AVEC_APPEL, GRADLE];
  const apres = [MORTE, AUTRE, SANS_APPEL, GRADLE];
  const maintenant = () => (repondu ? apres : avant);
  w.fs = { readFile: async (uri: any) => Buffer.from(
    maintenant().find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
  let listeServie: unknown; let objetServi: any;
  const corpus: any = { invalidate: () => {}, get: async () => {
    const src = maintenant();
    if (listeServie !== src) {
      listeServie = src;
      objetServi = { sources: src, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
        truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] };
    }
    return objetServi;
  } };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  let demande = '';
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { demande = m; repondu = true; return rest.slice(1)[0]; }
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
  return { demande, messages: messages.join(' | '), cibles };
}

describe('la relecture n ajoute rien a ce qui a ete demande', () => {
  it('temoin : le dialogue n annonce qu une seule declaration', async () => {
    expect((await lancer()).demande).toContain('Remove 1 unreferenced declaration');
  });

  it('ce qui meurt pendant la question ne part pas sans avoir ete annonce', async () => {
    const r = await lancer();
    expect(r.cibles.some(c => c.endsWith('Morte.kt'))).toBe(true);
    expect(r.cibles.some(c => c.endsWith('Autre.kt'))).toBe(false);
  });
});

/** Le meme decor, generique : le corpus bascule des que la question est posee. */
function poser(avant: { path: string; text: string }[], apres: { path: string; text: string }[]) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const maintenant = () => (repondu ? apres : avant);
  w.fs = { readFile: async (uri: any) => Buffer.from(
    maintenant().find(s2 => s2.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
  let listeServie: unknown; let objetServi: any;
  const corpus: any = { invalidate: () => {}, get: async () => {
    const src = maintenant();
    if (listeServie !== src) {
      listeServie = src;
      objetServi = { sources: src, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
        truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] };
    }
    return objetServi;
  } };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  let demande = '';
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { demande = m; repondu = true; return rest.slice(1)[0]; }
    return undefined;
  };
  win.showWarningMessage = async () => undefined;
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  const emporte = (source: string) => editions.flatMap((e: any) => e.entries()
    // Borne EXCLUSIVE : `expandToWholeLines` termine au debut de la ligne
    // suivante, donc `end.line + 1` emportait une ligne de trop et le test
    // aurait pu passer, ou echouer, pour une raison qui n est pas la sienne.
    .map((x: any) => source.split('\n')
      .slice(x.range.start.line, x.range.end.character === 0 ? x.range.end.line : x.range.end.line + 1)
      .join('\n'))).join('\n');
  return { corpus, emporte, demandeDe: () => demande };
}

const XML = '/w/app/src/main/res/values/strings.xml';
const RES = { path: XML, text:
  '<resources>\n    <string name="morte">M</string>\n    <string name="vivante">V</string>\n</resources>\n' };
const LIT_VIVANTE = { path: `${MAIN}/Lecteur.kt`, text: 'package p\n\nfun lire() = R.string.vivante\n' };
const NE_LIT_PLUS = { path: `${MAIN}/Lecteur.kt`, text: 'package p\n\nfun lire() = 1\n' };

describe('cles de ressources : la relecture n ajoute rien non plus', () => {
  it('temoin : une seule cle annoncee', async () => {
    const d = poser([RES, LIT_VIVANTE, GRADLE], [RES, NE_LIT_PLUS, GRADLE]);
    await removeAllUnusedResourceKeysCommand(d.corpus, new UnusedResourceKeyProvider());
    expect(d.demandeDe()).toContain('Remove 1 unused resource key');
  });

  it('la cle morte pendant la question ne part pas', async () => {
    const d = poser([RES, LIT_VIVANTE, GRADLE], [RES, NE_LIT_PLUS, GRADLE]);
    await removeAllUnusedResourceKeysCommand(d.corpus, new UnusedResourceKeyProvider());
    expect(d.emporte(RES.text)).toContain('morte');
    expect(d.emporte(RES.text)).not.toContain('vivante');
  });
});

const CLE = (k: string) => ['    <entry>', `        <key>${k}</key>`, '        <value>v</value>', '    </entry>'];
const RC = { path: '/w/app/src/main/res/xml/remote_config_defaults.xml', text:
  ['<?xml version="1.0" encoding="UTF-8"?>', '<defaults>', ...CLE('rc_morte'), ...CLE('rc_vivante'), '</defaults>', ''].join('\n') };
const RC_LIT = { path: `${MAIN}/Conf.kt`, text: 'package p\n\nfun lire(c: Config) = c.getString("rc_vivante")\n' };
const RC_NE_LIT_PLUS = { path: `${MAIN}/Conf.kt`, text: 'package p\n\nfun lire() = 1\n' };

describe('cles de Remote Config : la relecture n ajoute rien non plus', () => {
  it('la cle morte pendant la question ne part pas', async () => {
    const d = poser([RC, RC_LIT, GRADLE], [RC, RC_NE_LIT_PLUS, GRADLE]);
    await removeAllUnusedRemoteConfigKeysCommand(d.corpus, new UnusedRemoteConfigKeyProvider());
    expect(d.emporte(RC.text)).toContain('rc_morte');
    expect(d.emporte(RC.text)).not.toContain('rc_vivante');
  });
});

/** Les cibles d une edition, chemins de suppression et de remplacement. */
const ciblesDe = (editions: any[]) => editions.flatMap((e: any) =>
  [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
    ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);

const SUJET_A = { path: `${MAIN}/SujetA.kt`, text: 'package p\n\nclass SujetA {\n    fun a() = 1\n}\n' };
const SUJET_B = { path: `${MAIN}/SujetB.kt`, text: 'package p\n\nclass SujetB {\n    fun b() = 2\n}\n' };
const TA = { path: '/w/app/src/test/java/p/SujetATest.kt', text:
  'package p\n\nimport org.junit.Test\n\nclass SujetATest {\n    @Test\n    fun a() {\n        SujetA().a()\n    }\n}\n' };
const TB = { path: '/w/app/src/test/java/p/SujetBTest.kt', text:
  'package p\n\nimport org.junit.Test\n\nclass SujetBTest {\n    @Test\n    fun b() {\n        SujetB().b()\n    }\n}\n' };
// Avant : la production utilise SujetB, donc seul SujetA est « garde en vie par
// ses tests ». Apres : cet appel disparait et SujetB le devient aussi.
const PROD_AVEC_B = { path: `${MAIN}/Prod.kt`, text: 'package p\n\nfun main() {\n    println(SujetB().b())\n}\n' };
const PROD_SANS_B = { path: `${MAIN}/Prod.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };

describe('co-suppression : la relecture n ajoute rien non plus', () => {
  it('ce qui devient testOnly pendant la question ne part pas', async () => {
    const w = vscodeMock.workspace as any;
    const d = poser([SUJET_A, SUJET_B, PROD_AVEC_B, GRADLE, TA, TB], [SUJET_A, SUJET_B, PROD_SANS_B, GRADLE, TA, TB]);
    const editions: any[] = [];
    w.applyEdit = async (e: any) => { editions.push(e); return true; };
    await removeTestOnlyCodeCommand(d.corpus);
    const cibles = ciblesDe(editions);
    expect(cibles.some(c => c.endsWith('SujetATest.kt'))).toBe(true);
    expect(cibles.some(c => c.endsWith('SujetBTest.kt'))).toBe(false);
    expect(cibles.some(c => c.endsWith('SujetB.kt'))).toBe(false);
  });
});

const BOITE = { path: `${MAIN}/Boite.kt`, text:
  'package p\n\nclass Boite {\n    fun aideA() = 1\n\n    fun aideB() = 2\n\n    fun interne() = aideA() + aideB()\n}\n' };
const APPELLE_B = { path: `${MAIN}/Appel.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne() + Boite().aideB())\n}\n' };
const N_APPELLE_PLUS = { path: `${MAIN}/Appel.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne())\n}\n' };

describe('rendre prive : la relecture n ajoute rien non plus', () => {
  it('le membre devenu interne pendant la question n est pas narrowed', async () => {
    const w = vscodeMock.workspace as any;
    const d = poser([BOITE, APPELLE_B, GRADLE], [BOITE, N_APPELLE_PLUS, GRADLE]);
    const editions: any[] = [];
    w.applyEdit = async (e: any) => { editions.push(e); return true; };
    await makeSelfOnlyPrivateCommand(d.corpus);
    const lignes = editions.flatMap((e: any) => e.entries().map((x: any) => x.range.start.line));
    expect(lignes.length).toBe(1);
    expect(BOITE.text.split('\n')[lignes[0]]).toContain('aideA');
  });
});
