import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Audit 47 : un test qui recopie une constante du code livré valide sa copie.
// `RE_GRADLE_RESULT` avait été élargi dans le module pour accepter les noms de
// test en backticks, et deux fichiers de test ont gardé l'ancienne forme
// pendant des mois, dont un qui affirmait la limitation disparue comme un
// comportement attendu. Rien ne l'a signalé. Ce gardien le signalera.

const RACINE = join(__dirname, '..', '..');

function fichiers(dir: string, ext: string, out: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) fichiers(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

const DECL = /^(?:export )?(?:const|let) (\w+)\s*=\s*(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+\/[a-z]*)/gm;

describe('Aucune copie périmée d\'une expression du code livré', () => {
  it('une regex portant le nom d\'une regex de src/ en a le corps exact', () => {
    const parNom = new Map<string, Set<string>>();
    for (const f of fichiers(join(RACINE, 'src'), '.ts')) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(DECL)) {
        if (!parNom.has(m[1])) parNom.set(m[1], new Set());
        parNom.get(m[1])!.add(m[2]);
      }
    }

    const divergentes: string[] = [];
    for (const f of fichiers(join(RACINE, 'test'), '.test.ts')) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(DECL)) {
        const corpsSrc = parNom.get(m[1]);
        if (!corpsSrc || corpsSrc.has(m[2])) continue;
        divergentes.push(
          `${f.slice(RACINE.length + 1)} :: ${m[1]}\n      test : ${m[2]}\n      src  : ${[...corpsSrc].join(' | ')}`,
        );
      }
    }

    // Une copie qui diverge ne teste plus rien : le module peut régresser sans
    // qu'un seul test bronche. Importer l'original plutôt que le recopier.
    expect(divergentes.join('\n')).toBe('');
  });
});
