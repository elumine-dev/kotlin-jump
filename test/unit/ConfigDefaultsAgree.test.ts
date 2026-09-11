/**
 * Le repli passe a `get(cle, repli)` doit valoir le defaut declare.
 *
 * `WorkspaceConfiguration.get(section, defaultValue)` ne rend ce repli que si
 * la cle n'est connue de personne. Une cle declaree dans `package.json` rend
 * TOUJOURS son defaut declare, donc un repli different n'est jamais vu en
 * production.
 *
 * En test, c'est l'inverse : le bouchon de `vscode` rend le repli tel quel.
 * Un desaccord entre les deux est donc exactement un test qui passe pour une
 * mauvaise raison, avec une valeur que l'utilisateur ne rencontre jamais.
 *
 * Trouve par ce gardien : `RoomMigrationProvider` lisait `maxIndexedFiles` avec
 * un repli de 3000 alors que `package.json` declare 10000. Le raisonnement
 * « 3558 fichiers Kotlin sur le vrai projet, donc au dela du plafond, donc la
 * derive des migrations Room ne dit jamais rien » etait faux pour cette raison,
 * et 56 fichiers y portent un marqueur Room.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const RACINE = path.resolve(__dirname, '..', '..');
const SRC = path.join(RACINE, 'src');

function defautsDeclares(): Map<string, unknown> {
  const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
  const conf = pkg.contributes.configuration;
  const out = new Map<string, unknown>();
  for (const bloc of Array.isArray(conf) ? conf : [conf]) {
    for (const [cle, spec] of Object.entries(bloc.properties ?? {})) {
      out.set(cle, (spec as { default?: unknown }).default);
    }
  }
  return out;
}

function fichiersTs(dossier: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiersTs(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const RE_APPEL_GET = /\.get<[^>]+>\(\s*'([\w.]+)'\s*,\s*([^),]+?)\s*\)/g;
const RE_PORTEE_CONFIG = /getConfiguration\(\s*'([\w.]+)'\s*\)/g;

/** Valeur JavaScript d'un litteral simple, ou undefined si c'est une expression. */
function litteral(brut: string): unknown {
  if (brut === 'true') return true;
  if (brut === 'false') return false;
  if (/^-?\d+$/.test(brut)) return Number(brut);
  if (/^'[^']*'$/.test(brut)) return brut.slice(1, -1);
  return undefined;
}

describe('Les replis de configuration suivent package.json', () => {
  const defauts = defautsDeclares();

  it('package.json declare bien des reglages', () => {
    expect(defauts.size).toBeGreaterThan(50);
  });

  it('aucun repli ne contredit le defaut declare', () => {
    const desaccords: string[] = [];
    let verifies = 0;

    for (const fichier of fichiersTs(SRC)) {
      const source = fs.readFileSync(fichier, 'utf8');
      // Positions des `getConfiguration('X')` pour retrouver la section en
      // portee : la forme chainee et la forme `const cfg = …` sont locales.
      const sections: { at: number; nom: string }[] = [];
      RE_PORTEE_CONFIG.lastIndex = 0;
      let s: RegExpExecArray | null;
      while ((s = RE_PORTEE_CONFIG.exec(source)) !== null) sections.push({ at: s.index, nom: s[1] });

      RE_APPEL_GET.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_APPEL_GET.exec(source)) !== null) {
        const valeur = litteral(m[2]);
        if (valeur === undefined) continue;      // expression, hors sujet
        const precedente = [...sections].reverse().find(x => x.at < m!.index);
        if (!precedente) continue;
        const pleine = `${precedente.nom}.${m[1]}`;
        if (!defauts.has(pleine)) continue;      // cle interne, non contribuee
        verifies++;
        if (defauts.get(pleine) !== valeur) {
          const ligne = source.slice(0, m.index).split(String.fromCharCode(10)).length;
          desaccords.push(
            `${path.relative(RACINE, fichier)}:${ligne}  ${pleine}  code=${m[2]}  package.json=${String(defauts.get(pleine))}`,
          );
        }
      }
    }

    expect(verifies, 'le gardien doit voir un nombre serieux d appels').toBeGreaterThan(100);
    expect(desaccords, desaccords.join(String.fromCharCode(10))).toEqual([]);
  });
});
