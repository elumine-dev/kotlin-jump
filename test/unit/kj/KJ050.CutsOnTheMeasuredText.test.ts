import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { plagesDuFichier, coupesRetenues } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Un offset n'est valide que contre le texte sur lequel il a ete mesure, et la
 * commande la plus recente ne portait pas cette regle.
 *
 * L'instantane du corpus vit une minute, et son propre controle de fraicheur
 * ne regarde que les documents SALES. Un fichier ouvert et PROPRE mais
 * recharge dessous, par un checkout ou un autre outil, passe ce controle avec
 * un contenu different : les bornes visent alors les mauvaises lignes. C'est
 * exactement la distinction pour laquelle `stillTheMeasuredText` existe, et
 * les quatre autres commandes en masse la tiennent.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';
const MESURE = 'package com.x\n\nclass Mort\n\nclass Vivante\n';
const coupes = [{ start: MESURE.indexOf('class Mort'), end: MESURE.indexOf('class Vivante'), texte: '', famille: 'symboles', quoi: 'Mort' }];

const doc = (text: string, isDirty: boolean) => ({
  uri: vscodeMock.Uri.file(CHEMIN), isDirty, getText: () => text,
} as any);
const ouvre = (docs: any[]) =>
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(docs as any);

afterEach(() => vi.restoreAllMocks());

describe('plagesDuFichier', () => {
  it('temoin : rien d ouvert, les plages sont rendues', () => {
    ouvre([]);
    const r = plagesDuFichier(CHEMIN, MESURE, coupes);
    expect(r).toBeDefined();
    expect(r![0].start.line).toBe(2);
    expect(r![0].end.line).toBe(4);
  });

  it('temoin : ouvert et identique, les plages sont rendues', () => {
    ouvre([doc(MESURE, false)]);
    expect(plagesDuFichier(CHEMIN, MESURE, coupes)).toBeDefined();
  });

  it('ouvert, PROPRE, mais recharge different : rien n est rendu', () => {
    ouvre([doc('package com.x\n\nimport com.y.Z\n\nclass Mort\n\nclass Vivante\n', false)]);
    expect(plagesDuFichier(CHEMIN, MESURE, coupes)).toBeUndefined();
  });

  it('ouvert et sale : rien n est rendu', () => {
    ouvre([doc(MESURE + 'class C\n', true)]);
    expect(plagesDuFichier(CHEMIN, MESURE, coupes)).toBeUndefined();
  });

  it('le degat evite : les memes bornes sur le tampon designent une autre classe', () => {
    const decale = 'package com.x\n\nimport com.y.Z\n\nclass Mort\n\nclass Vivante\n';
    // Sur le texte decale, les bornes mesurees sur MESURE tombent sur la ligne
    // de l'import, pas sur `class Mort`.
    expect(decale.slice(coupes[0].start, coupes[0].end)).toContain('import');
    ouvre([doc(decale, false)]);
    expect(plagesDuFichier(CHEMIN, MESURE, coupes)).toBeUndefined();
  });
});

/**
 * L'ORDRE compte : la cascade doit etre planifiee sur les coupes qui seront
 * REELLEMENT envoyees, pas sur toutes.
 *
 * Elle croit son appelant sur parole, elle ne verifie rien. Lui annoncer la
 * suppression d'une declaration qu'on n'a finalement pas retiree lui fait
 * supprimer l'import de cette declaration ailleurs, et le module ne compile
 * plus. C'est le defaut qu'introduit une garde posee APRES le plan.
 */
describe('coupesRetenues', () => {
  const AUTRE = '/w/app/src/main/kotlin/com/x/B.kt';
  const TEXTE_B = 'package com.x\n\nclass Autre\n';
  const coupesB = [{ start: 15, end: 27, texte: '', famille: 'symboles', quoi: 'Autre' }];

  it('un fichier qui a bouge ne figure pas dans ce qui sera envoye', () => {
    ouvre([doc('package com.x\n\nimport com.y.Z\n\nclass Mort\n\nclass Vivante\n', false)]);
    const { retenu, bouges } = coupesRetenues(
      new Map([[CHEMIN, coupes], [AUTRE, coupesB]]),
      new Map([[CHEMIN, MESURE], [AUTRE, TEXTE_B]]),
    );
    // Les CHEMINS ecartes, pas leur nombre : l'appelant boucle et doit pouvoir
    // reconnaitre le meme fichier d'une ronde a l'autre.
    expect(bouges).toEqual([CHEMIN]);
    expect(retenu.has(CHEMIN)).toBe(false);
    expect(retenu.has(AUTRE)).toBe(true);
  });

  it('temoin : rien n a bouge, tout est retenu', () => {
    ouvre([]);
    const { retenu, bouges } = coupesRetenues(
      new Map([[CHEMIN, coupes], [AUTRE, coupesB]]),
      new Map([[CHEMIN, MESURE], [AUTRE, TEXTE_B]]),
    );
    expect(bouges).toEqual([]);
    expect(retenu.size).toBe(2);
  });

  it('un fichier sans texte mesure n est ni retenu ni compte comme bouge', () => {
    ouvre([]);
    const { retenu, bouges } = coupesRetenues(new Map([[CHEMIN, coupes]]), new Map());
    expect(bouges).toEqual([]);
    expect(retenu.size).toBe(0);
  });
});
