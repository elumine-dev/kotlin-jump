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

const RE_APPEL_GET = /\.get<[^>]+>\(\s*'([\w.]+)'\s*,\s*((?:\[[^\]]*\]|[^),]+?))\s*\)/g;
/**
 * `get<T>('cle') ?? repli`, l'autre facon d'ecrire la meme chose. Quinze sites
 * l'emploient et le gardien n'en voyait aucun : il annoncait une propriete
 * qu'il ne verifiait que sur une moitie du code.
 *
 * Un repli en minuscules est une valeur locale deja validee plus haut dans la
 * meme fonction (`?? excludeList`, `?? maxFiles`) : la chaine se termine sur un
 * site que ce gardien controle par ailleurs.
 */
const RE_APPEL_NULLISH = /\.get<[^>]+>\(\s*'([\w.]+)'\s*\)\s*\?\?\s*((?:\[[^\]]*\]|[A-Za-z0-9_'.-]+))/g;
const RE_PORTEE_CONFIG = /getConfiguration\(\s*'([\w.]+)'\s*\)/g;

/** `const NOM = […];` ou `const NOM = 20;` declares dans src/, pour resoudre un repli nomme. */
function constantesNommees(fichiers: string[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const tableau = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(\[[^\]]*\])/g;
  const scalaire = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*(-?[\d_]+|true|false|'[^']*')\s*;/g;
  for (const f of fichiers) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of [tableau, scalaire]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (m[2].startsWith('[')) {
          out.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]));
        } else if (m[2] === 'true' || m[2] === 'false') {
          out.set(m[1], m[2] === 'true');
        } else if (m[2].startsWith("'")) {
          out.set(m[1], m[2].slice(1, -1));
        } else {
          out.set(m[1], Number(m[2].replace(/_/g, '')));
        }
      }
    }
  }
  return out;
}

/**
 * Valeur JavaScript d'un repli, ou undefined si elle n'est pas decidable.
 *
 * Les tableaux comptent autant que les scalaires : `testSourceSets` declare
 * cinq segments et six appels passaient `[]`, dont un derriere une constante
 * nommee DEFAULT_TEST_SEGMENTS qui valait elle meme `[]`. Sous bouchon, le
 * filtre des sources de test ne filtrait donc rien, et 29 cas de
 * OverrideGutterProvider passaient sans jamais l'exercer.
 */
function litteral(brut: string, constantes: Map<string, unknown>): unknown {
  if (brut === 'true') return true;
  if (brut === 'false') return false;
  if (/^-?[\d_]+$/.test(brut)) return Number(brut.replace(/_/g, ''));
  if (/^'[^']*'$/.test(brut)) return brut.slice(1, -1);
  if (/^\[[^\]]*\]$/.test(brut)) return [...brut.matchAll(/'([^']*)'/g)].map(x => x[1]);
  return constantes.get(brut);
}

/** Egalite structurelle suffisante pour des scalaires et des tableaux de chaines. */
function memeValeur(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/** Analyse une source et rend les desaccords trouves, plus le compte verifie. */
export function analyser(
  source: string,
  constantes: Map<string, unknown>,
  defauts: Map<string, unknown>,
  etiquette = 'source',
): { verifies: number; desaccords: string[] } {
  const desaccords: string[] = [];
  let verifies = 0;
  const sections: { at: number; nom: string }[] = [];
  RE_PORTEE_CONFIG.lastIndex = 0;
  let s: RegExpExecArray | null;
  while ((s = RE_PORTEE_CONFIG.exec(source)) !== null) sections.push({ at: s.index, nom: s[1] });

  for (const re of [RE_APPEL_GET, RE_APPEL_NULLISH]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const valeur = litteral(m[2], constantes);
      if (valeur === undefined && /^[a-z][A-Za-z0-9_]*$/.test(m[2])) continue;
      if (valeur === undefined && /[(.]/.test(m[2])) continue;
      const precedente = [...sections].reverse().find(x => x.at < m!.index);
      if (!precedente) continue;
      const pleine = `${precedente.nom}.${m[1]}`;
      if (!defauts.has(pleine)) continue;
      verifies++;
      const ligne = source.slice(0, m.index).split(String.fromCharCode(10)).length;
      if (valeur === undefined) {
        desaccords.push(`${etiquette}:${ligne}  ${pleine}  repli illisible: ${m[2]}`);
      } else if (!memeValeur(defauts.get(pleine), valeur)) {
        desaccords.push(
          `${etiquette}:${ligne}  ${pleine}  code=${m[2]}  package.json=${JSON.stringify(defauts.get(pleine))}`,
        );
      }
    }
  }
  return { verifies, desaccords };
}

describe('Les replis de configuration suivent package.json', () => {
  const defauts = defautsDeclares();

  it('package.json declare bien des reglages', () => {
    expect(defauts.size).toBeGreaterThan(50);
  });

  it('aucun repli ne contredit le defaut declare', () => {
    const tous = fichiersTs(SRC);
    const constantes = constantesNommees(tous);
    const desaccords: string[] = [];
    let verifies = 0;
    for (const fichier of tous) {
      const r = analyser(
        fs.readFileSync(fichier, 'utf8'), constantes, defauts, path.relative(RACINE, fichier),
      );
      verifies += r.verifies;
      desaccords.push(...r.desaccords);
    }
    expect(verifies, 'le gardien doit voir un nombre serieux d appels').toBeGreaterThan(180);
    expect(desaccords, desaccords.join(String.fromCharCode(10))).toEqual([]);
  });

  it('la forme `?? repli` est bien couverte', () => {
    const r = analyser(
      "const cfg = vscode.workspace.getConfiguration('kotlinJump');" +
      String.fromCharCode(10) +
      "const x = cfg.get<number>('maxIndexedFiles') ?? 3000;",
      new Map(), defauts,
    );
    expect(r.verifies).toBe(1);
    expect(r.desaccords).toHaveLength(1);
  });

  it('un repli illisible est signale, pas saute', () => {
    const r = analyser(
      "const cfg = vscode.workspace.getConfiguration('kotlinJump');" +
      String.fromCharCode(10) +
      "const x = cfg.get<number>('maxIndexedFiles', PLAFOND_MYSTERE);",
      new Map(), defauts,
    );
    expect(r.desaccords.join(''), 'un repli que le gardien ne sait pas lire n est pas sur')
      .toContain('repli illisible');
  });

  it('un repli calcule est accepte tel quel', () => {
    const r = analyser(
      "const cfg = vscode.workspace.getConfiguration('kotlinJump');" +
      String.fromCharCode(10) +
      "const x = cfg.get<number>('parserWorkers') ?? Math.max(2, 8);",
      new Map(), defauts,
    );
    expect(r.desaccords).toEqual([]);
  });
});

