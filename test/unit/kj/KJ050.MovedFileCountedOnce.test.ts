import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeEverythingUnusedCommand } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Un fichier qui a bouge est UN fichier, meme sur seize passes.
 *
 * La boucle du point fixe additionne le compte rendu par `coupesRetenues` a
 * chaque ronde. Ce compte est un nombre de FICHIERS ecartes pendant CETTE
 * ronde, et un fichier qui diverge de son document ouvert diverge encore a la
 * ronde suivante : il est reporte a neuf, puis a dix, puis a onze.
 *
 * Le cas se produit exactement dans la situation pour laquelle cette
 * verification existe : un fichier ouvert et propre dont le contenu a change
 * sur le disque, ce que fait un `git checkout` ou un formateur lance au
 * terminal. Le corpus relit le disque, l editeur montre encore l ancien texte,
 * et la divergence tient d une ronde a l autre.
 *
 * « 4 files changed since the scan and were left alone. » pour un seul
 * fichier, dans le rapport de la commande qui supprime du code.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });

const UN = f('Un.kt', 'package com.x\n\nclass Un\n');
const DEUX = f('Deux.kt', 'package com.x\n\nclass Deux {\n    fun f(): Un = Un()\n}\n');
const TROIS = f('Trois.kt', 'package com.x\n\nclass Trois {\n    fun g(): Deux = Deux()\n}\n');
// Celui qui bouge : mort, donc toujours dans le plan, et divergent a chaque ronde.
const BOUGE = f('Bouge.kt', 'package com.x\n\nclass Bouge\n');
const BOUGE_OUVERT = 'package com.x\n\n// touche au terminal entre temps\nclass Bouge\n';

// La chaine se defait une declaration par ronde : Trois, puis Deux, puis Un.
const RONDES = [
  [UN, DEUX, TROIS, BOUGE],
  [UN, DEUX, BOUGE],
  [UN, BOUGE],
  [BOUGE],
  [BOUGE],
];

afterEach(() => vi.restoreAllMocks());

async function lancer() {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);

  const ouvert = {
    uri: vscodeMock.Uri.file(BOUGE.path),
    isDirty: false,
    getText: () => BOUGE_OUVERT,
  };
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([ouvert] as any);

  let appels = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => {
      const sources = RONDES[Math.min(appels++, RONDES.length - 1)];
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
  w.applyEdit = async () => true;

  await removeEverythingUnusedCommand(corpus);
  return { message: messages.join(' | '), rondes: appels };
}

describe('KJ-050 le fichier qui bouge ne se multiplie pas', () => {
  it('temoin : la chaine occupe bien plusieurs rondes', async () => {
    expect((await lancer()).rondes).toBeGreaterThanOrEqual(3);
  });

  it('temoin : le rapport parle bien de ce qui a bouge', async () => {
    expect((await lancer()).message).toContain('changed since the scan');
  });

  it('un seul fichier ecarte, compte une seule fois', async () => {
    const { message } = await lancer();
    expect(message).toContain('1 file changed since the scan and was left alone.');
    expect(message).not.toMatch(/[2-9] files changed since the scan/);
  });
});
