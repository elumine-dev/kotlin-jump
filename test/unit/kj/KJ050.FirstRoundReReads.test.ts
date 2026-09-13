import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';

/**
 * La premiere ronde relit, elle aussi.
 *
 * Le balayage a lieu AVANT la boite modale, et la premiere ronde reutilisait
 * son instantane. Entre les deux il y a du temps humain : un `git pull`, un
 * collegue qui pousse, un fichier enregistre dans un autre editeur. Une
 * utilisation apparue pendant ce temps la n'existe pas dans l'instantane, donc
 * la declaration y est toujours morte, et la commande la supprime.
 *
 * La verification d'obsolescence ne rattrape pas ce cas : elle confronte le
 * texte MESURE aux documents OUVERTS, fichier par fichier. Le nouvel appel est
 * ailleurs, le fichier qui declare n'a pas bouge, sa coupe passe le controle.
 * `ResourceCorpus` nomme ce piege dans son propre code : « une sauvegarde qui
 * ajoute une utilisation AILLEURS laisse le fichier declarant intact, sa coupe
 * passe le controle du texte, et quelque chose de vivant part. »
 *
 * Le corpus rend son cache instantanement quand rien n'a bouge, et refait un
 * balayage complet quand quelque chose l'a invalide. Relire a la premiere
 * ronde ne coute donc rien dans le cas ordinaire, et tout le reste dans celui
 * qui compte.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });
const MORTE = f('Morte.kt', 'package com.x\n\nclass Morte\n');
const SANS_USAGE = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');
const AVEC_USAGE = f('Main.kt', 'package com.x\n\nfun main() {\n    println(Morte())\n}\n');

afterEach(() => vi.restoreAllMocks());

async function lancer(usageApparait: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  // Le premier appel sert le balayage d avant la question. Les suivants voient
  // l espace de travail tel qu il est APRES la reponse.
  let appels = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => {
      const premier = appels++ === 0;
      const sources = premier || !usageApparait ? [MORTE, SANS_USAGE] : [MORTE, AVEC_USAGE];
      return {
        sources, moduleDirs: [], modulesWithCode: [], libraryModules: [],
        truncated: false, sourcesTruncated: false,
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

describe('KJ-050 la premiere ronde relit le corpus', () => {
  it('temoin : rien n a change, la declaration morte part bien', async () => {
    const r = await lancer(false);
    expect(r.cibles.some(c => c.endsWith('Morte.kt'))).toBe(true);
  });

  it('un usage apparu pendant la question sauve la declaration', async () => {
    const r = await lancer(true);
    expect(r.cibles.some(c => c.endsWith('Morte.kt'))).toBe(false);
    expect(r.editions).toBe(0);
  });

  it('et la commande le dit plutot que de se taire', async () => {
    expect((await lancer(true)).message).toContain('Nothing unused left to remove.');
  });

  /**
   * Relire ne veut pas dire recompter. Le corpus rend l objet de son cache tel
   * quel tant que rien ne l a invalide, et la premiere ronde s en sert pour
   * savoir qu elle peut reprendre le plan deja fait. Sans cela, chaque
   * invocation paierait deux fois les vingt secondes de la passe.
   *
   * Mesure : `collecterUnePasse` lit `sources`, la construction des textes
   * aussi. Une ronde qui reprend le plan lit donc une fois, une ronde qui
   * recompte lit deux fois.
   */
  it('corpus inchange : la premiere ronde ne refait pas la passe', async () => {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
    vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
    const liste = [MORTE, SANS_USAGE];
    let lectures = 0;
    // Le MEME objet a chaque appel, comme le cache du corpus.
    const fige = {
      get sources() { lectures++; return liste; },
      moduleDirs: [], modulesWithCode: [], libraryModules: [],
      truncated: false, sourcesTruncated: false,
    };
    const corpus: any = { invalidate: () => {}, get: async () => fige };
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    win.showInformationMessage = async (m: string, ...rest: any[]) =>
      (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal ? 'Apply all' : undefined);
    win.showWarningMessage = async () => undefined;
    // Le compte est releve a la PREMIERE edition : au dela, la boucle tourne
    // sur un corpus fige qui ne reflete pas ses propres suppressions, ce qui
    // est un artefact du decor et non une mesure.
    let aLaPremiereEdition = -1;
    w.applyEdit = async () => { if (aLaPremiereEdition < 0) aLaPremiereEdition = lectures; return true; };
    await removeEverythingUnusedCommand(corpus);
    // 1 pour le balayage d avant la question, 1 pour les textes de la ronde 0.
    // Une troisieme voudrait dire que la ronde 0 a refait la passe pour rien.
    expect(aLaPremiereEdition).toBe(2);
  });
});
