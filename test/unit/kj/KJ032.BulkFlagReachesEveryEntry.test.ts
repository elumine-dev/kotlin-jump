import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { buildSymbolRemovalEdit } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Le drapeau de confirmation doit atteindre CHAQUE entree.
 *
 * 1.42.240 a pose la question une fois pour quatre commandes de masse et en a
 * oublie deux : « Remove All Unreferenced Symbols », qui produit 98 trouvailles
 * sur un vrai projet, et « Remove Unused Resource Keys ». Elles reclamaient
 * donc encore un clic par fichier dans l'apercu, ce que l'utilisateur avait
 * justement signale comme impraticable.
 *
 * Une entree qui garde `needsConfirmation: true` alors que les autres sont a
 * false suffit a rouvrir l'apercu avec cette seule case decochee : le drapeau
 * ne vaut que s'il passe partout, la suppression comme l'import devenu mort.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/Widget.kt';
const IMPORTEUR = '/w/app/src/main/kotlin/com/x/User.kt';
const TEXTE = ['package com.x', '', 'class Widget', '', 'class Vivant', ''].join('\n');
const TEXTE_IMPORTEUR = ['package com.x', '', 'import com.x.Widget', '', 'class User', ''].join('\n');

const trouvaille = {
  name: 'Widget', kind: 'class', verdict: 'unreferenced',
  path: CHEMIN, line: 2, character: 6,
  removeStart: TEXTE.indexOf('class Widget'), removeEnd: TEXTE.indexOf('class Vivant'),
  testMentions: 0, isDeprecated: false, isLibraryModule: false,
  staleImports: [{ path: IMPORTEUR, line: 2 }], fileBecomesEmpty: false,
} as any;

const parChemin: Record<string, string> = { [CHEMIN]: TEXTE, [IMPORTEUR]: TEXTE_IMPORTEUR };

afterEach(() => vi.restoreAllMocks());

const construire = async (confirm?: boolean) => {
  vi.spyOn(vscodeMock.workspace.fs, 'readFile').mockImplementation((async (u: any) => {
    const p = String(u?.fsPath ?? u);
    return Buffer.from(parChemin[p] ?? '') as any;
  }) as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  return confirm === undefined
    ? await buildSymbolRemovalEdit([trouvaille])
    : await buildSymbolRemovalEdit([trouvaille], undefined, confirm);
};

describe('buildSymbolRemovalEdit et le drapeau de confirmation', () => {
  it('par defaut, chaque entree attend son clic', async () => {
    const { edit } = await construire();
    const entries = (edit as any)._entries;
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((e: any) => e.metadata?.needsConfirmation === true)).toBe(true);
  });

  it('confirm=false : AUCUNE entree ne reste decochee, import mort compris', async () => {
    const { edit } = await construire(false);
    const entries = (edit as any)._entries;
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((e: any) => e.metadata?.needsConfirmation === false)).toBe(true);
  });

  it('les comptes rendus decrivent l edition, fichiers touches compris', async () => {
    const r = await construire(false);
    const entries = (r.edit as any)._entries;
    expect(r.edits).toBe(entries.length);
    expect(r.files).toBe(new Set(entries.map((e: any) => String(e.uri.fsPath))).size);
  });
});
