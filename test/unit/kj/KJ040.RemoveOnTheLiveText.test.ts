import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedRemoteConfigKeysCommand } from '../../../src/commands/FindUnusedRemoteConfigKeys';

/**
 * Un offset n'est valide que contre le texte ou l'edition va tomber.
 *
 * Cette commande lisait le DISQUE pour verifier ses offsets, puis convertissait
 * ces memes offsets en positions via `openTextDocument`, qui rend le TAMPON
 * quand le fichier est ouvert et non enregistre. Deux textes, un seul jeu de
 * bornes : une ligne ajoutee au dessus et la suppression tombe une entree plus
 * bas.
 *
 * 1.42.240 a elargi la faille sans la creer : la boite modale ajoutee entre la
 * verification et l'application transforme une fenetre de quelques
 * millisecondes en temps de reflexion humain.
 */

const CHEMIN = '/w/app/src/main/res/xml/remote_config_defaults.xml';
const entree = (k: string) => ['    <entry>', `        <key>${k}</key>`, '        <value>v</value>', '    </entry>'];
const DISQUE = ['<?xml version="1.0" encoding="UTF-8"?>', '<defaults>',
  ...entree('morte'), ...entree('vivante'), '</defaults>', ''].join('\n');
// Le tampon porte un commentaire de plus EN TETE : tous les offsets glissent.
const TAMPON = ['<?xml version="1.0" encoding="UTF-8"?>', '<!-- brouillon -->', '<defaults>',
  ...entree('morte'), ...entree('vivante'), '</defaults>', ''].join('\n');

const LECTEUR = {
  path: '/w/app/src/main/kotlin/com/x/A.kt',
  text: 'package com.x\n\nfun lire(c: Config) = c.getString("vivante")\n',
};

afterEach(() => vi.restoreAllMocks());

async function lancer(tamponOuvert: string | undefined) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  const uri = vscodeMock.Uri.file(CHEMIN);

  const lignesDe = (t: string) => {
    const starts = [0];
    for (let i = 0; i < t.length; i++) if (t[i] === '\n') starts.push(i + 1);
    return starts;
  };
  const positionAt = (t: string) => (offset: number) => {
    const starts = lignesDe(t);
    let l = 0;
    while (l + 1 < starts.length && starts[l + 1] <= offset) l++;
    return new vscodeMock.Position(l, offset - starts[l]);
  };
  const doc = {
    uri, isDirty: tamponOuvert !== undefined,
    getText: () => tamponOuvert ?? DISQUE,
    positionAt: positionAt(tamponOuvert ?? DISQUE),
  };

  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get')
    .mockReturnValue((tamponOuvert === undefined ? [] : [doc]) as any);
  w.fs = { readFile: async () => Buffer.from(DISQUE, 'utf8') };
  w.openTextDocument = async () => doc;
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  win.showInformationMessage = async (_m: string, ...rest: any[]) =>
    (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) ? 'Apply all' : undefined;
  win.showWarningMessage = async () => undefined;

  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };

  const corpus: any = {
    get: async () => ({
      sources: [{ path: CHEMIN, text: DISQUE }, LECTEUR],
      moduleDirs: [], modulesWithCode: [], libraryModules: [],
      truncated: false, sourcesTruncated: false,
    }),
  };
  await removeAllUnusedRemoteConfigKeysCommand(corpus, { setFindings: () => {} } as any);

  delete w.workspaceFolders;
  delete w.applyEdit;
  delete w.openTextDocument;
  delete win.withProgress;
  return editions.flatMap((e: any) => e._entries ?? []);
}

describe('Remove Unread Remote Config Keys : couper la ou on a mesure', () => {
  it('temoin : rien d ouvert, la cle morte est retiree a sa place', async () => {
    const entries = await lancer(undefined);
    expect(entries.length).toBe(1);
    // `morte` occupe les lignes 2 a 5 du fichier disque.
    expect(entries[0].range.start.line).toBe(2);
  });

  it('le tampon a glisse : aucune suppression plutot qu une au mauvais endroit', async () => {
    const entries = await lancer(TAMPON);
    expect(entries.length).toBe(0);
  });
});
