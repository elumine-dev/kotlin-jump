import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Le rapport compte ce qui est PARTI, pas ce que le balayage avait trouve.
 *
 * La commande ecarte les fichiers qui ont bouge depuis le balayage, puis
 * construit son edition sur ce qui reste. Le cumul, lui, additionnait le
 * decompte du BALAYAGE, donc les coupes des fichiers ecartes y figuraient
 * comme retirees. Mesure sur deux fichiers d une declaration morte chacun,
 * dont un ecarte :
 *
 *   Removed 2 declarations, 1 emptied file. 1 file changed since the scan and
 *   was left alone.
 *
 * L edition ne portait qu une operation. La phrase se contredit d ailleurs
 * elle meme : elle annonce deux declarations puis dit qu un des deux fichiers
 * a ete laisse de cote.
 *
 * Quatre commandes de la famille ont recu ce correctif entre la 1.42.277 et la
 * 1.42.280. Celle qui supprime le plus n en faisait pas partie.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });
const MORT = f('Mort.kt', 'package com.x\n\nclass Mort\n');
const BOUGE = f('Bouge.kt', 'package com.x\n\nclass Bouge\n');
const BOUGE_OUVERT = 'package com.x\n\n// touche au terminal entre temps\nclass Bouge\n';

afterEach(() => vi.restoreAllMocks());

async function lancer(bougeOuvert: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(
    (bougeOuvert ? [{ uri: vscodeMock.Uri.file(BOUGE.path), isDirty: false, getText: () => BOUGE_OUVERT }] : []) as any);

  // Le corpus se vide au fil des rondes, comme le ferait un vrai apres coup.
  // Un appel pour le balayage d avant la question, puis un par ronde : la
  // ronde 0 relit elle aussi depuis la 1.42.296.
  const rondes = bougeOuvert
    ? [[MORT, BOUGE], [MORT, BOUGE], [BOUGE], [BOUGE]]
    : [[MORT, BOUGE], [MORT, BOUGE], [], []];
  let n = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => ({
      sources: rondes[Math.min(n++, rondes.length - 1)], moduleDirs: [], modulesWithCode: [],
      libraryModules: [], truncated: false, sourcesTruncated: false,
    }),
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
  return {
    message: messages.join(' | '),
    operations: editions.reduce((t, e) => t + e._entries.length + e._fileDeletes.length, 0),
  };
}

describe('KJ-050 le rapport compte ce qui est parti', () => {
  it('temoin : rien n a bouge, les deux declarations partent et sont annoncees', async () => {
    const r = await lancer(false);
    expect(r.operations).toBe(2);
    expect(r.message).toContain('2 declarations');
  });

  it('un fichier ecarte ne figure pas parmi les declarations retirees', async () => {
    const r = await lancer(true);
    expect(r.operations).toBe(1);
    expect(r.message).toContain('1 declaration,');
    expect(r.message).not.toContain('2 declarations');
  });

  it('et la phrase sur ce qui a bouge reste, elle', async () => {
    expect((await lancer(true)).message).toContain('1 file changed since the scan and was left alone.');
  });
});
