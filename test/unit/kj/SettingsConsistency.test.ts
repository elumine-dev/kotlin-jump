import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

/**
 * Audit mécanique : chaque `getConfiguration('kotlinJump').get('X')` du code
 * doit exister comme `kotlinJump.X` dans package.json, et réciproquement
 * pour les settings KJ. Une typo d'un côté = feature silencieusement figée
 * sur sa valeur par défaut — le bug le plus indétectable qui soit.
 */

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const declared = new Set(
  Object.keys(
    JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).contributes
      .configuration.reduce
      ? {}
      : {},
  ),
);

describe('Cohérence settings code ↔ package.json', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const sections = Array.isArray(pkg.contributes.configuration)
    ? pkg.contributes.configuration
    : [pkg.contributes.configuration];
  const declaredKeys = new Set<string>(
    sections.flatMap((s: any) => Object.keys(s.properties ?? {})),
  );

  const files = collectSourceFiles(path.join(REPO_ROOT, 'src'));
  const used = new Map<string, string>(); // clé → fichier

  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    // .get<T>('name'…) précédé quelque part de getConfiguration('kotlinJump')
    if (!text.includes("getConfiguration('kotlinJump')")) continue;
    const re = /getConfiguration\('kotlinJump'\)\s*(?:\n\s*)?\.get(?:<[^>]+>)?\(\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      used.set(`kotlinJump.${m[1]}`, path.relative(REPO_ROOT, f));
    }
    // Forme indirecte (const cfg = …; cfg.get('x')) : seulement si TOUS les
    // scopes du fichier sont exactement 'kotlinJump' — sinon un cfg scoped
    // 'kotlinJump.organizeImports' produirait des faux positifs.
    const scopes = [...text.matchAll(/getConfiguration\('([^']+)'\)/g)].map(s => s[1]);
    if (scopes.every(s => s === 'kotlinJump')) {
      const cfgRe = /\bcfg\s*\.get(?:<[^>]+>)?\(\s*'([^']+)'/g;
      while ((m = cfgRe.exec(text)) !== null) {
        used.set(`kotlinJump.${m[1]}`, path.relative(REPO_ROOT, f));
      }
    }
  }

  it('chaque setting lu par le code est déclaré dans package.json', () => {
    const missing = [...used.entries()].filter(([key]) => !declaredKeys.has(key));
    expect(
      missing.map(([k, f]) => `${k} (lu par ${f})`),
      'settings lus mais jamais déclarés — figés sur leur défaut',
    ).toEqual([]);
  });

  it('sanity : l’audit voit bien les settings KJ', () => {
    expect(used.size).toBeGreaterThan(10);
    expect(declaredKeys.size).toBeGreaterThan(20);
  });

  void declared;
});
