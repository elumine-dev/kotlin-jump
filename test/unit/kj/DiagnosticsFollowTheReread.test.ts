import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Les diagnostics suivent le verdict relu.
 *
 * La commande publie ses trouvailles au fournisseur AVANT la question, puis,
 * depuis la 1.42.297, rejuge l espace de travail apres le clic. Une classe
 * rappelee a la vie pendant la question est donc epargnee par l edition, ce
 * qui est le but, mais son avertissement « unreferenced » reste affiche
 * dessus : le panneau Problemes designe du code vivant, et le correctif rapide
 * de la pastille propose encore de le supprimer.
 *
 * Avant le rejugement, les deux etaient d accord par construction, puisque la
 * commande retirait exactement ce qui avait ete publie. Le rejugement a defait
 * cet accord sans le dire.
 */

const MAIN = '/w/app/src/main/java/p';
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const MORTE = { path: `${MAIN}/Morte.kt`, text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' };
const AUTRE = { path: `${MAIN}/Autre.kt`, text: 'package p\n\nclass Autre {\n    fun g() = 2\n}\n' };
const SANS = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(1)\n}\n' };
// Couverte par un test et rien d autre : le verdict est `testOnly`, donc elle
// n est jamais retiree. Elle doit rester publiee, sans quoi sa pastille
// disparait sans que rien ne l ait retiree.
const COUVERTE = { path: `${MAIN}/Couverte.kt`, text: 'package p\n\nclass Couverte {\n    fun h() = 3\n}\n' };
const TEST = { path: '/w/app/src/test/java/p/CouverteTest.kt',
  text: 'package p\n\nimport org.junit.Test\n\nclass CouverteTest {\n    @Test\n    fun t() {\n        Couverte().h()\n    }\n}\n' };
const AVEC = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Autre().g())\n}\n' };

afterEach(() => vi.restoreAllMocks());

async function lancer() {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const maintenant = () => [MORTE, AUTRE, COUVERTE, TEST, repondu ? AVEC : SANS, GRADLE];
  w.fs = { readFile: async (uri: any) => Buffer.from(
    maintenant().find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8') };
  let servie: unknown; let objet: any;
  const corpus: any = { invalidate: () => {}, get: async () => {
    const src = maintenant();
    if (servie !== src) {
      servie = src;
      objet = { sources: src, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
        truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] };
    }
    return objet;
  } };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  win.showInformationMessage = async (_m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return 'Apply all'; }
    return undefined;
  };
  win.showWarningMessage = async () => undefined;
  w.applyEdit = async () => true;
  const provider = new UnusedSymbolProvider();
  const publies: string[][] = [];
  const vrai = provider.setFindings.bind(provider);
  vi.spyOn(provider, 'setFindings').mockImplementation((f: any) => {
    publies.push(f.map((x: any) => x.name));
    return vrai(f);
  });
  await removeAllUnusedSymbolsCommand(corpus, provider);
  return { publies };
}

describe('les diagnostics suivent le verdict relu', () => {
  it('temoin : les deux classes sont publiees au depart', async () => {
    const { publies } = await lancer();
    expect(publies[0]).toEqual(expect.arrayContaining(['Morte', 'Autre']));
  });

  it('la classe rappelee a la vie ne reste pas signalee', async () => {
    const { publies } = await lancer();
    const dernier = publies[publies.length - 1];
    expect(dernier).toContain('Morte');
    expect(dernier).not.toContain('Autre');
  });

  it('et le verdict republie est le verdict ENTIER, pas ce qui va partir', async () => {
    const { publies } = await lancer();
    const dernier = publies[publies.length - 1];
    // `Couverte` n est pas retirable, elle est couverte par un test. Publier
    // seulement ce que l edition emporte ferait disparaitre sa pastille.
    expect(dernier).toContain('Couverte');
  });
});
