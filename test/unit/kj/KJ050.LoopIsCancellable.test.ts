import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { removeEverythingUnusedCommand, compteRendu } from '../../../src/commands/RemoveEverythingUnused';

/**
 * La boucle est la partie LONGUE, et elle tournait sans barre ni bouton.
 *
 * Une passe coute une vingtaine de secondes sur un projet de six mille
 * fichiers, et « Apply all » en enchaine jusqu'a huit : deux minutes et demie
 * pendant lesquelles l'indicateur du premier scan avait deja disparu et rien
 * ne bougeait plus. Elle vit maintenant dans sa propre barre, annulable entre
 * deux passes, c'est a dire au seul moment ou l'espace de travail est dans un
 * etat coherent.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';

const corpus: any = {
  invalidate: () => {},
  get: async () => ({
    sources: [
      { path: `${MAIN}/Mort.kt`, text: 'package com.x\n\nclass Mort\n' },
      { path: `${MAIN}/Main.kt`, text: 'package com.x\n\nfun main() { println(1) }\n' },
    ],
    moduleDirs: [], modulesWithCode: [], libraryModules: [],
    truncated: false, sourcesTruncated: false,
  }),
};

afterEach(() => vi.restoreAllMocks());

async function lancer(annuleLaBoucle: boolean, reponse = 'Apply all') {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);

  const titres: string[] = [];
  win.withProgress = (o: any, t: any) => {
    titres.push(o.title);
    // Le premier scan n'est jamais annule ; la BOUCLE l'est, si demande.
    const annule = annuleLaBoucle && titres.length > 1;
    return t({ report: () => {} }, { isCancellationRequested: annule });
  };
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) return reponse;
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async () => undefined;
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };

  await removeEverythingUnusedCommand(corpus);
  delete w.workspaceFolders; delete w.applyEdit; delete win.withProgress;
  // Une declaration seule dans son fichier fait DISPARAITRE le fichier : la
  // cascade emet un deleteFile, pas une edition de plage. Un temoin qui ne
  // regarderait que `_entries` ne prouverait rien.
  return {
    titres, messages,
    editions: editions.flatMap((e: any) => [...(e._entries ?? []), ...(e._fileDeletes ?? [])]),
  };
}

describe('Remove Everything Unused : la boucle a sa propre barre', () => {
  it('temoin : la boucle tourne et coupe', async () => {
    const { titres, editions } = await lancer(false);
    expect(titres.length).toBe(2);
    expect(editions.length).toBeGreaterThan(0);
  });

  it('la boucle a bien une barre a elle, distincte du scan', async () => {
    const { titres } = await lancer(false);
    expect(titres[0]).toContain('Looking for');
    expect(titres[1]).toContain('Removing');
  });

  it('annulee avant la premiere passe : rien n est applique, et c est dit', async () => {
    const { messages, editions } = await lancer(true);
    expect(editions.length).toBe(0);
    expect(messages.join(' ')).toContain('Stopped on request');
    // Et le message ne doit pas se contredire : annoncer « rien ne restait a
    // retirer » ET « relancez pour finir » dans la meme phrase, c'est deux
    // reponses opposees a la meme question.
    expect(messages.join(' ')).not.toContain('Nothing unused left to remove');
  });

  it('Cancel dans la boite : ni barre de boucle ni edition', async () => {
    const { titres, editions } = await lancer(false, 'Autre chose');
    expect(titres.length).toBe(1);
    expect(editions.length).toBe(0);
  });
});

/**
 * La phrase finale ne doit jamais donner deux reponses opposees.
 *
 * Coller un titre a une note produisait
 *   « Nothing unused left to remove. Stopped on request: run it again. »
 * et le test ecrit pour ce cas passait, parce qu'il ne cherchait que la
 * seconde moitie. Quand rien n'a ete retire, la RAISON est la reponse : il n'y
 * a pas de titre a mettre devant.
 */
describe('compteRendu', () => {
  const e = { verbe: 'Removed', queue: '.', annule: false, restait: false, bouges: '' };

  it('rien fait, annule : la raison suffit', () => {
    const m = compteRendu('', { ...e, annule: true });
    expect(m).toContain('Stopped on request');
    expect(m).not.toContain('Nothing unused left to remove');
  });

  it('rien fait, des fichiers ont bouge : ce n est pas « rien a retirer »', () => {
    const m = compteRendu('', { ...e, bouges: '2 files changed since the scan and were left alone.' });
    expect(m).toContain('2 files changed');
    expect(m).not.toContain('Nothing unused left to remove');
  });

  it('rien fait, rien trouve : la phrase d origine', () => {
    expect(compteRendu('', e)).toBe('Nothing unused left to remove.');
  });

  it('du travail fait, puis annule : les deux, dans cet ordre', () => {
    const m = compteRendu('3 declarations', { ...e, annule: true });
    expect(m).toBe('Removed 3 declarations. Stopped on request: run it again to finish.');
  });

  it('du travail fait, plafond atteint', () => {
    expect(compteRendu('3 declarations', { ...e, restait: true }))
      .toContain('still work left after the last round');
  });

  it('en relecture, le verbe et la queue changent', () => {
    expect(compteRendu('3 declarations', { ...e, verbe: 'Sent', queue: ' to the preview.' }))
      .toBe('Sent 3 declarations to the preview.');
  });
});

/**
 * Le plafond de passes est un chiffre MESURE, pas une intuition.
 *
 * Applique pour de vrai jusqu'au point fixe sur le projet de reference, 6329
 * sources, il faut DIX passes : la queue est une chaine de constantes dont
 * chacune n'etait vivante que pour la suivante. Le plafond etait a huit, donc
 * la commande s'arretait deux passes trop tot sur le projet meme pour lequel
 * elle existe.
 */
describe('le plafond de passes', () => {
  it('laisse de la marge au-dessus des dix passes mesurees', () => {
    const src = readFileSync(
      path.join(__dirname, '../../../src/commands/RemoveEverythingUnused.ts'), 'utf8');
    const m = /const PASSES_MAX = (\d+);/.exec(src);
    expect(m, 'le plafond doit etre une constante nommee').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(10);
  });
});
