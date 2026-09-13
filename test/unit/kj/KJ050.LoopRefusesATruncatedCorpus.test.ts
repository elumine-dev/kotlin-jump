import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Une ronde ne raisonne pas sur un corpus ampute.
 *
 * Le premier balayage refuse un corpus tronque, et rend la main : « The
 * workspace is too large to prove that nothing uses these declarations. » Les
 * rondes SUIVANTES le prenaient sans regarder. Or une passe qui raisonne sur
 * une liste de sources incomplete juge « non reference » un symbole que seul un
 * fichier non lu utilise, et cette commande APPLIQUE ce verdict.
 *
 * La commande se le declenche a elle meme : elle supprime des fichiers a chaque
 * ronde, 54 sur le projet de reference pour une seule cascade, et un fichier que
 * `findFiles` liste encore mais qui vient de partir fait echouer la lecture, ce
 * qui marque le corpus comme tronque. Le contrat du corpus est explicite : un
 * balayage incomplet ne peut pas prouver une absence.
 *
 * Le decor : la ronde 2 rend un corpus tronque ou le seul lecteur de `Garde` a
 * disparu. Sans garde, `Garde` est jugee morte et son fichier supprime.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });
const MORT = f('Mort.kt', 'package com.x\n\nclass Mort\n');
const GARDE = f('Garde.kt', 'package com.x\n\nclass Garde\n');
const USAGE = f('Usage.kt', 'package com.x\n\nfun main() {\n    println(Garde())\n}\n');

afterEach(() => vi.restoreAllMocks());

async function lancer(tronqueALaRonde2: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  // Un appel pour le balayage d avant la question, puis un par ronde : la
  // ronde 0 relit elle aussi depuis la 1.42.296.
  //   appel 0 : le balayage, appel 1 : ronde 0, appel 2 : ronde 1.
  // `Mort` part a la ronde 0 ; c est la ronde 1 qui recoit, selon le cas, un
  // corpus complet ou un corpus tronque d ou le seul lecteur de `Garde` a
  // disparu.
  const complet = { sources: [MORT, GARDE, USAGE], sourcesTruncated: false };
  const apres = { sources: [GARDE, USAGE], sourcesTruncated: false };
  const rondes = tronqueALaRonde2
    ? [complet, complet, { sources: [GARDE], sourcesTruncated: true }, apres]
    : [complet, complet, apres, apres];
  let n = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => {
      const r = rondes[Math.min(n++, rondes.length - 1)];
      return {
        sources: r.sources, moduleDirs: [], modulesWithCode: [], libraryModules: [],
        truncated: r.sourcesTruncated, sourcesTruncated: r.sourcesTruncated,
      };
    },
  };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) return 'Apply all';
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  await removeEverythingUnusedCommand(corpus);
  const cibles = editions.flatMap((e: any) =>
    [...e._fileDeletes.map((d: any) => String(d.uri?.fsPath ?? d.uri)),
      ...e.entries().map((x: any) => String(x.uri?.fsPath ?? x.uri))]);
  return { message: messages.join(' | '), editions: editions.length, cibles };
}

describe('KJ-050 la boucle refuse un corpus ampute', () => {
  it('temoin : corpus complet a la ronde 2, Garde est vivante et reste', async () => {
    const r = await lancer(false);
    expect(r.cibles.some(c => c.endsWith('Mort.kt'))).toBe(true);
    expect(r.cibles.some(c => c.endsWith('Garde.kt'))).toBe(false);
  });

  it('corpus tronque a la ronde 2 : la ronde ne part pas', async () => {
    const r = await lancer(true);
    expect(r.editions).toBe(1);
    expect(r.cibles.some(c => c.endsWith('Garde.kt'))).toBe(false);
  });

  it('et la commande le dit au lieu de se taire', async () => {
    const r = await lancer(true);
    expect(r.message).toMatch(/could not be read whole|too large to prove/);
  });
});
