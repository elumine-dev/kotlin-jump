import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Harnais des suites KJ — tests écrits AVANT l'implémentation.
 *
 * Chaque suite fixe le contrat du module de son ticket (voir l'annexe 2) et
 * s'auto-active : tant que le module n'existe pas, `importOrNull` retourne
 * null et la suite est skippée (npm test reste vert). Dès que l'agent crée
 * le module, la suite devient rouge/verte et sert de cahier des charges
 * exécutable. NE PAS transformer ces skips en .todo : les corps de tests
 * sont le contrat.
 */

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DEMO_ROOT = path.join(REPO_ROOT, 'test', 'kotlin-jump-demo');

export function fixture(relPath: string): string {
  return readFileSync(path.join(DEMO_ROOT, relPath), 'utf8');
}

export function fixtureExists(relPath: string): boolean {
  return existsSync(path.join(DEMO_ROOT, relPath));
}

export async function importOrNull(relFromRepoRoot: string): Promise<any | null> {
  try {
    return await import(path.join(REPO_ROOT, relFromRepoRoot));
  } catch {
    return null;
  }
}

/** Document mock minimal compatible avec les providers (languageId kotlin). */
export function makeDocument(text: string, languageId = 'kotlin') {
  const lines = text.split('\n');
  return {
    languageId,
    getText: () => text,
    lineAt: (i: number) => ({ text: lines[i] }),
    lineCount: lines.length,
    uri: { fsPath: '/virtual/Demo.kt', toString: () => 'file:///virtual/Demo.kt' },
  } as any;
}

/**
 * Le texte d'un source, blancs et retours a la ligne reduits a une espace,
 * avec de quoi remonter a la ligne d'origine.
 *
 * Les gardiens statiques de ce depot cherchaient leur motif LIGNE PAR LIGNE.
 * Une expression coupee en deux passe alors entiere, et c'est la coupure qu'un
 * formateur produit tout seul des que la ligne s'allonge :
 *
 *     this.collection.set(
 *       vscode.Uri.file(p),
 *       diags,
 *     );
 *
 * Aucune des lignes ne porte `.set(vscode.Uri.file(`. Deux gardiens sont
 * tombes sur cette forme, en v1.42.288 et v1.42.289 ; le motif se lit donc sur
 * l'EXPRESSION, et la ligne ne sert plus qu'a nommer le coupable.
 *
 * Un seul exemplaire ici plutot qu'une copie par suite : voir le gardien
 * NoStaleTestCopies, une regle recopiee derive en silence.
 */
export function aplatirSource(texte: string): { plat: string; ou: number[] } {
  let plat = '';
  const ou: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (/\s/.test(c)) {
      if (plat.endsWith(' ')) continue;
      plat += ' ';
    } else {
      plat += c;
    }
    ou.push(i);
  }
  return { plat, ou };
}

/** La ligne, en base 1, ou tombe l'offset aplati `i`. */
export function ligneDe(texte: string, ou: readonly number[], i: number): number {
  return texte.slice(0, ou[i]).split('\n').length;
}
