import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { stillTheMeasuredText } from '../../../src/util/measuredText';
import { makeSelfOnlyPrivateCommand } from '../../../src/commands/MakeSelfOnlyPrivate';

/**
 * La regle est partagee par les deux commandes qui ecrivent dans des fichiers
 * fermes, parce que deux copies de la meme condition, c'est une copie qui
 * derive. Ici la copie avait deja derive : la commande de masse ne consultait
 * meme pas les documents ouverts.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';
const MESURE = 'package com.x\n\nclass A {\n    fun draw() = Unit\n}\n';

const doc = (text: string, isDirty = false) => ({
  uri: vscodeMock.Uri.file(CHEMIN), isDirty, getText: () => text,
} as any);
const ouvre = (docs: any[]) =>
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(docs as any);

afterEach(() => vi.restoreAllMocks());

describe('stillTheMeasuredText', () => {
  it('rien d ouvert : la copie mesuree fait foi', () => {
    ouvre([]);
    expect(stillTheMeasuredText(CHEMIN, MESURE)).toBe(MESURE);
  });

  it('ouvert et identique : la copie mesuree fait foi', () => {
    ouvre([doc(MESURE)]);
    expect(stillTheMeasuredText(CHEMIN, MESURE)).toBe(MESURE);
  });

  it('ouvert, PROPRE, mais different : on saute', () => {
    ouvre([doc('package com.x\n\nclass A\n', false)]);
    expect(stillTheMeasuredText(CHEMIN, MESURE)).toBeUndefined();
  });

  it('ouvert et sale : on saute', () => {
    ouvre([doc(MESURE + 'class B\n', true)]);
    expect(stillTheMeasuredText(CHEMIN, MESURE)).toBeUndefined();
  });

  it('rien de mesure : on saute', () => {
    ouvre([]);
    expect(stillTheMeasuredText(CHEMIN, undefined)).toBeUndefined();
  });
});

describe('makeSelfOnlyPrivateCommand — n ecrit pas dans un fichier qui a bouge', () => {
  const corpus: any = {
    get: async () => ({
      sources: [
        {
          path: CHEMIN,
          text: ['package com.x', '', 'class A {', '    fun draw() = Unit', '    fun caller() { draw() }', '}', ''].join('\n'),
        },
        // Sans ce vivant, la CLASSE elle meme est morte et son membre est
        // ecarte : un membre d une classe deja signalee entiere n est pas
        // re-signale.
        {
          path: '/w/app/src/main/kotlin/com/x/Vivant.kt',
          text: ['package com.x', '', 'class Vivant {', '    fun go(a: A) = a.caller()', '}', ''].join('\n'),
        },
      ],
      moduleDirs: [], modulesWithCode: [], libraryModules: [],
      truncated: false, sourcesTruncated: false,
    }),
  };

  async function lancer(docsOuverts: any[]) {
    const w = vscodeMock.workspace as any;
    const win = vscodeMock.window as any;
    w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w') }];
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
    win.showInformationMessage = async () => undefined;
    win.showWarningMessage = async () => undefined;
    ouvre(docsOuverts);
    const vues: any[] = [];
    w.applyEdit = async (e: any) => { vues.push(e); return true; };
    await makeSelfOnlyPrivateCommand(corpus);
    delete w.workspaceFolders;
    delete w.applyEdit;
    delete win.withProgress;
    return vues;
  }

  it('le fichier a bouge dans l editeur : aucune edition n est appliquee', async () => {
    const vues = await lancer([doc('package com.x\n\nclass A\n', false)]);
    const edits = vues.flatMap((e: any) => e._entries ?? []);
    expect(edits.length).toBe(0);
  });

  it('temoin : rien d ouvert, la commande ecrit bien', async () => {
    const vues = await lancer([]);
    const edits = vues.flatMap((e: any) => e._entries ?? []);
    expect(edits.length).toBeGreaterThan(0);
  });
});
