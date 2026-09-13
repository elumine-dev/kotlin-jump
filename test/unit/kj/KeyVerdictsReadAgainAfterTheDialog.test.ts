import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedResourceKeysCommand } from '../../../src/commands/FindUnusedResourceKeys';
import { UnusedResourceKeyProvider } from '../../../src/providers/UnusedResourceKeyProvider';
import { removeAllUnusedRemoteConfigKeysCommand } from '../../../src/commands/FindUnusedRemoteConfigKeys';
import { UnusedRemoteConfigKeyProvider } from '../../../src/providers/UnusedRemoteConfigKeyProvider';

/**
 * Les deux dernieres commandes de la famille relisent leur verdict.
 *
 * Meme forme que les 1.42.296 a .299 : le balayage a lieu AVANT la boite
 * modale, la construction de l edition APRES le clic relit le TEXTE du fichier
 * a couper, jamais la RAISON de le couper. « Cette cle n est lue nulle part »
 * se juge sur tout l espace de travail : la lecture apparue pendant le temps de
 * reflexion est dans un autre fichier, celui qui declare la cle n a pas bouge,
 * la coupe passe.
 *
 * Une cle de ressource retiree alors qu un `R.string.x` vient d apparaitre et
 * le projet ne compile plus ; une cle de Remote Config retiree et c est une
 * valeur par defaut qui manque a l execution.
 *
 * Les deux cas exercent la LISTE relue, pas seulement le retour anticipe : une
 * des deux cles ressuscite, l autre non.
 */

afterEach(() => vi.restoreAllMocks());

const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

/** Le decor commun : le corpus bascule sur `apres` des que la question est posee. */
function poser(avant: { path: string; text: string }[], apres: { path: string; text: string }[]) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const maintenant = () => (repondu ? apres : avant);
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
  /** Le texte que les coupes emportent, lu sur le fichier d origine. */
  const emporte = (source: string) => editions.flatMap((e: any) => e.entries()
    // Borne EXCLUSIVE : `expandToWholeLines` termine au debut de la ligne
    // suivante, donc `end.line + 1` emportait une ligne de trop et le test
    // aurait pu passer, ou echouer, pour une raison qui n est pas la sienne.
    .map((x: any) => source.split('\n')
      .slice(x.range.start.line, x.range.end.character === 0 ? x.range.end.line : x.range.end.line + 1)
      .join('\n'))).join('\n');
  return { corpus, messages, editions, emporte };
}

const XML = '/w/app/src/main/res/values/strings.xml';
const RES = {
  path: XML,
  text: '<resources>\n    <string name="morte_a">A</string>\n    <string name="morte_b">B</string>\n</resources>\n',
};
const SANS = { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
const AVEC_A = { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(R.string.morte_a)\n}\n' };

describe('les cles de ressources relisent leur verdict', () => {
  it('temoin : rien ne change, les deux cles mortes partent', async () => {
    const d = poser([RES, SANS, GRADLE], [RES, SANS, GRADLE]);
    await removeAllUnusedResourceKeysCommand(d.corpus, new UnusedResourceKeyProvider());
    expect(d.emporte(RES.text)).toContain('morte_a');
    expect(d.emporte(RES.text)).toContain('morte_b');
  });

  it('une lecture apparue pendant la question sauve sa cle, pas l autre', async () => {
    const d = poser([RES, SANS, GRADLE], [RES, AVEC_A, GRADLE]);
    await removeAllUnusedResourceKeysCommand(d.corpus, new UnusedResourceKeyProvider());
    expect(d.emporte(RES.text)).not.toContain('morte_a');
    expect(d.emporte(RES.text)).toContain('morte_b');
  });
});

const CLE = (k: string) => ['    <entry>', `        <key>${k}</key>`, '        <value>v</value>', '    </entry>'];
const RC = {
  path: '/w/app/src/main/res/xml/remote_config_defaults.xml',
  text: ['<?xml version="1.0" encoding="UTF-8"?>', '<defaults>', ...CLE('rc_a'), ...CLE('rc_b'), '</defaults>', ''].join('\n'),
};
const RC_SANS = { path: '/w/app/src/main/java/p/Conf.kt', text: 'package p\n\nfun lire() = 1\n' };
const RC_AVEC_A = { path: '/w/app/src/main/java/p/Conf.kt', text: 'package p\n\nfun lire(c: Config) = c.getString("rc_a")\n' };

describe('les cles de Remote Config relisent leur verdict', () => {
  it('temoin : rien ne change, les deux cles mortes partent', async () => {
    const d = poser([RC, RC_SANS, GRADLE], [RC, RC_SANS, GRADLE]);
    await removeAllUnusedRemoteConfigKeysCommand(d.corpus, new UnusedRemoteConfigKeyProvider());
    expect(d.emporte(RC.text)).toContain('rc_a');
    expect(d.emporte(RC.text)).toContain('rc_b');
  });

  it('une lecture apparue pendant la question sauve sa cle, pas l autre', async () => {
    const d = poser([RC, RC_SANS, GRADLE], [RC, RC_AVEC_A, GRADLE]);
    await removeAllUnusedRemoteConfigKeysCommand(d.corpus, new UnusedRemoteConfigKeyProvider());
    expect(d.emporte(RC.text)).not.toContain('rc_a');
    expect(d.emporte(RC.text)).toContain('rc_b');
  });
});
