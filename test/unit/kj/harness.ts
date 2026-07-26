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
