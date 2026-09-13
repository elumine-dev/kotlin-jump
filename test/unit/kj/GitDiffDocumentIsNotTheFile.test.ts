import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { stillTheMeasuredText, estLeFichier } from '../../../src/util/measuredText';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

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

/**
 * Gardien : plus aucune comparaison de chemin nue dans src/.
 *
 * Ce defaut a ete corrige TROIS fois, en 1.42.238 pour trois sites puis a
 * nouveau pour les deux qui avaient ete oublies dans le meme fichier. Une
 * regle qu'on reapplique a la main se reouvre ; celle ci se defend seule.
 */
describe('aucun `uri.fsPath ===` nu dans src', () => {
  const RACINE = path.resolve(__dirname, '../../../src');

  const fichiers = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) out.push(...fichiers(p));
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  };

  it('chaque comparaison passe par estLeFichier ou porte sa garde de schema', () => {
    const coupables: string[] = [];
    for (const f of fichiers(RACINE)) {
      const lignes = readFileSync(f, 'utf8').split('\n');
      lignes.forEach((l, i) => {
        if (!/uri\.fsPath\s*===/.test(l)) return;
        if (/scheme\s*===\s*'file'/.test(l)) return;      // la garde est sur la ligne
        if (/estLeFichier/.test(l)) return;                  // ou deleguee
        coupables.push(`${path.relative(RACINE, f)}:${i + 1} ${l.trim().slice(0, 70)}`);
      });
    }
    expect(coupables, 'un document git: porte le fsPath du vrai fichier').toEqual([]);
  });
});
