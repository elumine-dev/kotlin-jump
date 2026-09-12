import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { UnusedMemberProvider } from '../../../src/providers/UnusedMemberProvider';
import { UnusedEnumEntryProvider } from '../../../src/providers/UnusedEnumEntryProvider';

/**
 * La regle de 1.42.225 tenait a UN de ses quatre points d'appel.
 *
 * « Un WorkspaceEdit qui supprime une URI et edite une plage dedans est rejete
 * en entier et en silence » : le temoin d'alors n'exercait que le retrait des
 * symboles. En retirant la garde de l'ampoule des membres, les 7484 tests
 * restaient verts. L'ampoule des entrees d'enum, elle, avait carrement garde
 * l'ancien ordre.
 *
 * Le test ici ne verifie pas un correctif, il verifie une REGLE, chez chacun
 * de ceux qui doivent la tenir.
 */

/** Aucune URI ne recoit a la fois une suppression de fichier et une plage. */
function laRegleTient(edit: any): boolean {
  const supprimes = new Set((edit._fileDeletes ?? []).map((d: any) => String(d.uri.fsPath ?? d.uri)));
  const edites = new Set((edit._entries ?? []).map((e: any) => String(e.uri.fsPath ?? e.uri)));
  for (const p of supprimes) if (edites.has(p)) return false;
  return true;
}

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';

function document(text: string) {
  const lignes = text.split('\n');
  return {
    uri: vscodeMock.Uri.file(CHEMIN),
    getText: () => text,
    isDirty: false,
    lineAt: (l: number) => ({ text: lignes[l] ?? '' }),
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

afterEach(() => vi.restoreAllMocks());

describe('la regle tient chez chaque producteur d edition', () => {
  it('ampoule membre : le fichier que la cascade emporte ne recoit pas de plage', () => {
    // Un membre dont le retrait ne laisse que la ligne de paquet.
    const texte = 'package com.x\n\nclass A {\n    fun draw() = Unit\n}\n';
    const provider = new UnusedMemberProvider();
    vi.spyOn(UnusedMemberProvider, 'isEnabled').mockReturnValue(true);
    provider.setFindings([{
      name: 'draw', container: 'A', verdict: 'unreferenced', kind: 'fun',
      path: CHEMIN, line: 3, character: 8,
      removeStart: texte.indexOf('class A'), removeEnd: texte.length,
      testMentions: 0,
    } as any]);
    const actions = provider.provideCodeActions(document(texte), new vscodeMock.Range(3, 8, 3, 12) as any);
    const edit: any = actions[0]?.edit;
    expect(edit, 'une action de suppression est offerte').toBeDefined();
    expect(laRegleTient(edit), 'suppression ET plage sur la meme URI').toBe(true);
    expect((edit._fileDeletes ?? []).length).toBe(1);
    provider.dispose();
  });

  it('temoin membre : un fichier qui garde du code recoit sa plage', () => {
    const texte = 'package com.x\n\nclass A {\n    fun draw() = Unit\n}\n\nclass Vivant\n';
    const provider = new UnusedMemberProvider();
    vi.spyOn(UnusedMemberProvider, 'isEnabled').mockReturnValue(true);
    provider.setFindings([{
      name: 'draw', container: 'A', verdict: 'unreferenced', kind: 'fun',
      path: CHEMIN, line: 3, character: 8,
      removeStart: texte.indexOf('    fun draw'), removeEnd: texte.indexOf('}\n\nclass Vivant'),
      testMentions: 0,
    } as any]);
    const edit: any = provider.provideCodeActions(document(texte), new vscodeMock.Range(3, 8, 3, 12) as any)[0]?.edit;
    expect(edit).toBeDefined();
    expect(laRegleTient(edit)).toBe(true);
    expect((edit._entries ?? []).length).toBeGreaterThan(0);
    expect((edit._fileDeletes ?? []).length).toBe(0);
    provider.dispose();
  });

  it('ampoule entree d enum : la regle tient aussi', () => {
    const texte = 'package com.x\n\nenum class K {\n    MORTE,\n    VIVE,\n}\n';
    const provider = new UnusedEnumEntryProvider();
    vi.spyOn(UnusedEnumEntryProvider, 'isEnabled').mockReturnValue(true);
    provider.setFindings([{
      name: 'MORTE', enumName: 'K', verdict: 'unreferenced',
      path: CHEMIN, line: 3, character: 4,
      removeStart: texte.indexOf('    MORTE,'), removeEnd: texte.indexOf('    VIVE,'),
      testMentions: 0,
    } as any]);
    const edit: any = provider.provideCodeActions(document(texte), new vscodeMock.Range(3, 4, 3, 9) as any)[0]?.edit;
    expect(edit, 'une action de suppression est offerte').toBeDefined();
    expect(laRegleTient(edit)).toBe(true);
    provider.dispose();
  });
});
