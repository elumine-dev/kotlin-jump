import { describe, it, expect } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { buildSymbolRemovalEdit } from '../../../src/providers/UnusedSymbolProvider';
import { planCascade } from '../../../src/providers/removalCascade';

/**
 * Un WorkspaceEdit qui SUPPRIME une URI et EDITE une plage dedans est rejete
 * par VS Code, en entier et sans un mot.
 *
 * La cascade de KJ-048 etait consultee APRES que l'appelant ait ecrit ses
 * plages, donc elle pouvait demander la suppression d'un fichier deja edite.
 * Le cas est atteignable des qu'une declaration vide son fichier alors que le
 * scan ne l'avait pas vu : c'est exactement ce que rend une trouvaille
 * testOnly, jamais comptee dans `removable`. Le retrait ne faisait alors
 * strictement rien, sans erreur.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/Widget.kt';
const TEXTE = ['package com.x', '', 'class Widget {', '    fun draw() = Unit', '}', ''].join('\n');

function document(text: string) {
  const lignes = text.split('\n');
  return {
    uri: vscodeMock.Uri.file(CHEMIN),
    getText: () => text,
    isDirty: false,
    positionAt: (offset: number) => {
      let reste = offset;
      for (let l = 0; l < lignes.length; l++) {
        if (reste <= lignes[l].length) return new vscodeMock.Position(l, reste);
        reste -= lignes[l].length + 1;
      }
      return new vscodeMock.Position(lignes.length - 1, 0);
    },
  } as any;
}

const trouvaille = {
  name: 'Widget', kind: 'class', verdict: 'unreferenced',
  path: CHEMIN, line: 2, character: 6,
  removeStart: TEXTE.indexOf('class Widget'), removeEnd: TEXTE.length,
  testMentions: 0, isDeprecated: false, isLibraryModule: false,
  staleImports: [],
  // Le scan n'a PAS vu que le fichier se vide. C'est le coeur du cas.
  fileBecomesEmpty: false,
} as any;

describe('KJ-048 — jamais une suppression et une edition sur la meme URI', () => {
  it('la cascade prend le fichier, et aucune plage n est ecrite dedans', async () => {
    const doc = document(TEXTE);
    const edit: any = await buildSymbolRemovalEdit([trouvaille], doc);
    const supprimes = edit._fileDeletes.map((d: any) => d.uri.fsPath);
    const edites = edit._entries.map((e: any) => e.uri.fsPath);
    expect(supprimes).toContain(CHEMIN);
    expect(edites).not.toContain(CHEMIN);
    // Et une seule suppression, pas deux.
    expect(supprimes.filter((p: string) => p === CHEMIN).length).toBe(1);
  });

  it('temoin : un fichier qui garde du code recoit sa plage et n est pas supprime', async () => {
    const texte = ['package com.x', '', 'class Widget', '', 'class Vivant', ''].join('\n');
    const t = {
      ...trouvaille,
      removeStart: texte.indexOf('class Widget'),
      removeEnd: texte.indexOf('class Vivant'),
    };
    const edit: any = await buildSymbolRemovalEdit([t], document(texte));
    expect(edit._fileDeletes.map((d: any) => d.uri.fsPath)).not.toContain(CHEMIN);
    expect(edit._entries.map((e: any) => e.uri.fsPath)).toContain(CHEMIN);
  });

  it('le planificateur ne rend jamais un fichier a la fois supprime et importe', () => {
    const plan = planCascade(
      new Map([[CHEMIN, [{ start: TEXTE.indexOf('class Widget'), end: TEXTE.length }]]]),
      new Map([[CHEMIN, TEXTE]]),
    );
    for (const p of plan.deleteFiles) expect(plan.imports.has(p)).toBe(false);
  });

  it('un fichier deja supprime par l appelant n est pas resupprime', () => {
    const plan = planCascade(
      new Map([[CHEMIN, [{ start: TEXTE.indexOf('class Widget'), end: TEXTE.length }]]]),
      new Map([[CHEMIN, TEXTE]]),
      new Set([CHEMIN]),
    );
    expect(plan.deleteFiles.size).toBe(0);
    expect(plan.imports.has(CHEMIN)).toBe(false);
  });
});
