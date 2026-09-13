import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';

/**
 * L apercu se reconstruit apres le clic, lui aussi.
 *
 * « Apply all » reconstruit son edition apres la reponse, depuis la 1.42.240 :
 * la boite modale laisse a l espace de travail tout le temps de bouger et un
 * offset ne vaut que contre le texte sur lequel il a ete mesure. « Review one
 * by one » ne reconstruit pas : il envoie a l apercu les plages mesurees AVANT
 * la question.
 *
 * Deux lignes ajoutees en tete du fichier pendant la question, et les plages
 * designent deux lignes trop haut. L apercu affiche la mauvaise coupe, et le
 * lecteur qui la valide coupe du code vivant.
 *
 * Le decor mesure la chose directement : la ligne visee par l edition doit etre
 * celle de la classe morte dans le texte TEL QU IL EST au moment de l envoi.
 */

const MAIN = '/w/app/src/main/java/p';
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const AVANT = { path: `${MAIN}/Morte.kt`, text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n\nclass Garde {\n    fun g() = 2\n}\n' };
// Deux lignes de plus en tete : tout ce qui suit descend de deux.
const APRES = { path: `${MAIN}/Morte.kt`, text: '// entete ajoute\n// pendant la question\npackage p\n\nclass Morte {\n    fun f() = 1\n}\n\nclass Garde {\n    fun g() = 2\n}\n' };
const UTILISE = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Garde().g())\n}\n' };

afterEach(() => vi.restoreAllMocks());

async function lancer(reponse: 'Apply all' | 'Review one by one') {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const maintenant = () => [repondu ? APRES : AVANT, UTILISE, GRADLE];
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
  win.showInformationMessage = async (_m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return reponse; }
    return undefined;
  };
  win.showWarningMessage = async () => undefined;
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
  const lignes = editions.flatMap((e: any) => e.entries()
    .filter((x: any) => String(x.uri?.fsPath ?? x.uri).endsWith('Morte.kt'))
    .map((x: any) => x.range.start.line));
  const drapeaux = editions.flatMap((e: any) => e.entries().map((x: any) => x.metadata?.needsConfirmation));
  return { lignes, drapeaux };
}

describe('les plages envoyees a l apercu sont mesurees sur le texte du moment', () => {
  it('temoin : Apply all vise la classe morte dans le texte d apres', async () => {
    const { lignes } = await lancer('Apply all');
    expect(lignes.length).toBe(1);
    expect(APRES.text.split('\n')[lignes[0]]).toContain('class Morte');
  });

  it('Review one by one vise la meme ligne, pas celle d avant', async () => {
    const { lignes } = await lancer('Review one by one');
    expect(lignes.length).toBe(1);
    expect(APRES.text.split('\n')[lignes[0]]).toContain('class Morte');
  });
});

/**
 * Et le drapeau qui decide de l apercu suit la reponse.
 *
 * C est la meme expression que celle reconstruite ci dessus, donc la meme
 * ligne peut se tromper de sens. Le gardien voisin, `BulkFlagReachesEveryEntry`,
 * eprouve le constructeur avec un drapeau donne ; personne ne verifiait que la
 * COMMANDE lui donne le bon.
 */
describe('le drapeau de l apercu suit la reponse', () => {
  it('Review one by one : chaque entree attend son clic', async () => {
    const { drapeaux } = await lancer('Review one by one');
    expect(drapeaux.length).toBeGreaterThan(0);
    expect(drapeaux.every(d => d === true)).toBe(true);
  });

  it('Apply all : aucune entree ne reste decochee', async () => {
    const { drapeaux } = await lancer('Apply all');
    expect(drapeaux.length).toBeGreaterThan(0);
    expect(drapeaux.every(d => d === false)).toBe(true);
  });
});
