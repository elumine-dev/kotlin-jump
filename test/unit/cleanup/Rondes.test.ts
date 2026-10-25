import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { executerLesRondes } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Campagne de nettoyage, T5 : la boucle reelle, filtree par les cles d un lot.
 *
 * « Apply a Cleanup Batch » n a pas sa propre facon de couper : c est la
 * boucle de Remove Everything Unused, offsets frais a chaque ronde, cascade
 * reelle, garde des fichiers qui ont bouge, avec un filtre en plus. Ce que le
 * filtre ne nomme pas reste en place, et la boucle s arrete quand plus rien
 * de nomme n apparait, meme si d autres coupes se presentent.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const MORT_A = { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass MortA\n' };
const MORT_B = { path: `${MAIN}/B.kt`, text: 'package com.x\n\nclass MortB\n' };
const RACINE = { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun main() {\n    println(1)\n}\n' };
const CLE_A = `symboles\t${MORT_A.path}\tMortA`;

afterEach(() => vi.restoreAllMocks());

async function lancer(filtre: ReadonlySet<string> | undefined) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  // Le corpus se vide au fil des rondes, comme le ferait un vrai apres coup :
  // A part a la ronde 1 quand le filtre le nomme, et B reste tant qu il est tu.
  const rondes = filtre?.has(CLE_A) ? [[MORT_A, MORT_B, RACINE], [MORT_B, RACINE], [MORT_B, RACINE]]
    : filtre ? [[MORT_A, MORT_B, RACINE], [MORT_A, MORT_B, RACINE]]
      : [[MORT_A, MORT_B, RACINE], [RACINE], [RACINE]];
  let n = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => ({
      sources: rondes[Math.min(n++, rondes.length - 1)], moduleDirs: ['/w/app'], modulesWithCode: ['/w/app'],
      libraryModules: [], truncated: false, sourcesTruncated: false,
    }),
  };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  const bilan = await executerLesRondes({ corpus, segs: ['/src/test/'], reglages: {}, choix: 'apply', filtre });
  const supprimes = editions.flatMap(e => e._fileDeletes.map((d: any) => d.uri?.path ?? d.uri?.fsPath ?? String(d.uri)));
  return { bilan, editions, supprimes, lectures: n };
}

describe('T5, executerLesRondes filtre par les cles du lot', () => {
  it('sans filtre, tout part comme avant', async () => {
    const r = await lancer(undefined);
    expect(r.supprimes.sort()).toEqual([MORT_A.path, MORT_B.path]);
    // Les fichiers que la cascade vide comptent parmi ce qui a ete applique :
    // le plan les promet, le bilan doit pouvoir les retrouver.
    expect(r.bilan.appliquees).toEqual(new Set([
      CLE_A, `symboles\t${MORT_B.path}\tMortB`, `fichiers\t${MORT_A.path}\tfile`, `fichiers\t${MORT_B.path}\tfile`,
    ]));
  });

  it('avec le filtre, seule la coupe nommee part, et la boucle s arrete quand plus rien de nomme n apparait', async () => {
    const r = await lancer(new Set([CLE_A]));
    expect(r.supprimes).toEqual([MORT_A.path]);
    expect(r.bilan.appliquees).toEqual(new Set([CLE_A, `fichiers\t${MORT_A.path}\tfile`]));
    // Ronde 1 applique A ; la ronde 2 voit encore B, tu par le filtre, et s arrete : deux lectures apres le balayage.
    expect(r.editions).toHaveLength(1);
    expect(r.bilan.restait).toBe(false);
  });

  it('une cle que le plan promettait et que la passe ne trouve plus n est pas appliquee : rien dans appliquees', async () => {
    const r = await lancer(new Set([`symboles\t${MAIN}/Parti.kt\tParti`]));
    expect(r.editions).toHaveLength(0);
    expect(r.bilan.appliquees.size).toBe(0);
  });
});
