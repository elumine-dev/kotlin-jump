import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { cleanDeadCodeInWorkspaceCommand } from '../../../src/commands/DeadCodeSweep';

/**
 * Le compte annonce et l'edition appliquee doivent venir du MEME appel.
 *
 * Depuis 1.42.240 la commande construit l'edition deux fois : une premiere
 * pour connaitre les comptes et poser la question, une seconde avec le
 * drapeau inverse quand l'utilisateur repond « Apply all ». Le compte rendu
 * lisait pourtant la PREMIERE. Si un fichier bouge pendant que la boite
 * modale est ouverte, la seconde le saute, et l'utilisateur recoit une
 * edition vide sans un mot d'explication : le message « N fichiers ont change
 * depuis le balayage » se calculait sur un tirage ou rien n'avait change.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';
const TEXTE = 'package com.x\n\nimport com.y.Unused\n\nclass A\n';

afterEach(() => vi.restoreAllMocks());

async function lancer(bougePendantLaQuestion: boolean) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  const uri = vscodeMock.Uri.file(CHEMIN);

  let repondu = false;
  const doc = {
    uri,
    isDirty: false,
    getText: () => (repondu && bougePendantLaQuestion ? 'package com.x\n\nclass A\n' : TEXTE),
  };

  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(w, 'findFiles').mockResolvedValue([uri] as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([doc] as any);
  w.fs = { readFile: async () => Buffer.from(TEXTE, 'utf8') };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });

  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) {
      repondu = true;
      return 'Apply all';
    }
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async () => undefined;

  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };

  await cleanDeadCodeInWorkspaceCommand();

  delete w.workspaceFolders;
  delete w.applyEdit;
  delete win.withProgress;
  return { editions, messages };
}

describe('Clean Dead Code in Workspace : ce qui est dit est ce qui est fait', () => {
  it('temoin : rien ne bouge, l import mort est bien retire', async () => {
    const { editions } = await lancer(false);
    const entries = editions.flatMap((e: any) => e._entries ?? []);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e: any) => e.metadata?.needsConfirmation === false)).toBe(true);
  });

  it('le fichier bouge pendant la question : rien n est applique EN SILENCE', async () => {
    const { editions, messages } = await lancer(true);
    const entries = editions.flatMap((e: any) => e._entries ?? []);
    expect(entries.length).toBe(0);
    expect(messages.join(' ')).toContain('changed since the scan');
  });
});
