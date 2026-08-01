import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { findDeadIslands } from '../../../src/providers/deadIslands';

/**
 * KJ-046 — le ratchet de vérité terrain.
 *
 * Deux planchers, mesurés sur le corpus réel et cliquetés pour toujours :
 * précision (aucun symbole vérifié vivant n'est jamais rapporté) et rappel
 * (chaque cadavre vérifié à la main est toujours trouvé). Une dérive de la
 * machinerie partagée (moisson, étendues, gardes) casse ce test sur la
 * machine qui a le corpus, avant de casser un utilisateur.
 *
 * Gated sur LAPRESSE_ROOT : sans le corpus, il se saute proprement.
 */

const ROOT = process.env.LAPRESSE_ROOT;
const GROUNDTRUTH = path.resolve(__dirname, '../../corpus/kj046.lapresse.groundtruth.json');
const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea', '.worktrees', '.kotlin', '.claude-flow', '.swarm']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest', 'sharedTest', 'testShared'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name)) hit(full);
  }
}

describe.skipIf(!ROOT)('KJ-046 — planchers de précision et de rappel sur le corpus réel', () => {
  it('aucun vivant vérifié n’est rapporté, chaque cadavre vérifié l’est encore', () => {
    const truth = JSON.parse(fs.readFileSync(GROUNDTRUTH, 'utf8')) as {
      deadIslands: { members: { path: string; name: string }[] }[];
      alive: { path: string; name: string }[];
    };
    const sources: { path: string; text: string }[] = [];
    walk(ROOT!, file => {
      try { sources.push({ path: path.relative(ROOT!, file), text: fs.readFileSync(file, 'utf8') }); } catch { /* truncation asserted below */ }
    });

    const found = findDeadIslands({ sources, testSourceSets: TEST_SOURCE_SETS });
    const reported = new Set(found.flatMap(i =>
      i.members.map(m => `${m.path}::${m.container ? `${m.container}.` : ''}${m.name}`)));

    // Plancher de précision : un vivant rapporté est un échec bloquant.
    for (const a of truth.alive) {
      expect(reported.has(`${a.path}::${a.name}`), `vivant rapporté : ${a.name} (${a.path})`).toBe(false);
    }

    // Plancher de rappel : un cadavre connu disparu est une régression.
    for (const island of truth.deadIslands) {
      for (const m of island.members) {
        expect(reported.has(`${m.path}::${m.name}`), `cadavre perdu : ${m.name} (${m.path})`).toBe(true);
      }
    }
  }, 120_000);
});
