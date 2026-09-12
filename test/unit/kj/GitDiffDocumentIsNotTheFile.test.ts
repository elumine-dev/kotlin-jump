import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { stillTheMeasuredText, estLeFichier } from '../../../src/util/measuredText';

/**
 * Une vue de comparaison ouvre un document dont l'URI est `git:` et dont le
 * `fsPath` est celui du vrai fichier. Son contenu est celui de HEAD.
 *
 * Reconnaitre un document par son seul chemin revient donc a lire HEAD et a
 * ecrire dans l'arbre de travail : les offsets viennent d'un texte, l'edition
 * frappe l'autre. Trois appels de l'extension le faisaient.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';
const TRAVAIL = 'package com.x\n\nimport com.y.Z\n\nclass A\n\nclass Mort\n';
const TETE = 'package com.x\n\nclass A\n\nclass Mort\n';

const doc = (uri: any, text: string) => ({ uri, getText: () => text, isDirty: false }) as any;
const ouvre = (docs: any[]) =>
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(docs as any);

afterEach(() => vi.restoreAllMocks());

describe('un document git: n est pas le fichier', () => {
  it('estLeFichier refuse le document de comparaison', () => {
    const git = doc(vscodeMock.Uri.parse(`git:${CHEMIN}?%7B%22ref%22%3A%22%22%7D`), TETE);
    expect(git.uri.fsPath).toBe(CHEMIN);        // le piege, tel quel
    expect(estLeFichier(CHEMIN)(git)).toBe(false);
  });

  it('estLeFichier accepte le vrai document', () => {
    expect(estLeFichier(CHEMIN)(doc(vscodeMock.Uri.file(CHEMIN), TRAVAIL))).toBe(true);
  });

  it('une comparaison ouverte ne fait plus sauter le fichier', () => {
    ouvre([doc(vscodeMock.Uri.parse(`git:${CHEMIN}?x`), TETE)]);
    // Le fichier n'est pas reellement ouvert : le texte mesure reste valable.
    expect(stillTheMeasuredText(CHEMIN, TRAVAIL)).toBe(TRAVAIL);
  });

  it('le vrai document ouvert et different fait toujours sauter le fichier', () => {
    ouvre([doc(vscodeMock.Uri.file(CHEMIN), TETE)]);
    expect(stillTheMeasuredText(CHEMIN, TRAVAIL)).toBeUndefined();
  });
});
