/**
 * Le motif d'exclusion passe a `findFiles`.
 *
 * L'extension a DEUX chemins d'exclusion pour le meme reglage
 * `kotlinJump.excludePatterns` : le balayage initial, qui doit tout tenir
 * dans UN seul motif pour `findFiles`, et le veilleur, qui compile chaque
 * motif separement dans `makeExclusionMatcher`. Ils se contredisaient sur
 * deux points, chacun verifie sur les deux moteurs de reference.
 *
 *  1. `{a}` n'est pas un groupe : une liste d'un seul motif n'excluait rien.
 *  2. Dans un groupe, picomatch, le moteur du veilleur, perd le cas
 *     « zero dossier » de `**​/` : la configuration PAR DEFAUT n'excluait pas
 *     un `build/` a la racine du projet.
 *
 * Le moteur de VS Code n'est joignable depuis aucun test unitaire, donc on
 * juge sur minimatch et picomatch, et surtout sur l'accord avec le veilleur,
 * qui est un invariant interne verifiable ici.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import minimatchMod from 'minimatch';
import { excludeGlob, makeExclusionMatcher } from '../../src/util/pathExclusion';

// minimatch 3 exporte la fonction elle meme, minimatch 9 l'exporte nommee.
const minimatch: (c: string, m: string, o?: unknown) => boolean =
  typeof minimatchMod === 'function' ? (minimatchMod as any) : (minimatchMod as any).minimatch;

/** Ce que voit `findFiles` : des chemins relatifs a la racine du projet. */
const CORPUS = [
  'app/src/main/java/com/x/Ecran.kt',
  'app/src/main/java/com/x/build/Batisseur.kt', // paquet nomme build, pas un dossier de sortie
  'app/build/generated/source/BuildConfig.java',
  'app/build/tmp/kapt3/Hilt.kt',
  'build/reports/A.kt',                          // module unique : le build est A LA RACINE
  '.gradle/cache/Z.kt',
  'core/.gradle/cache/B.kt',
  'core/src/test/java/Test.java',
  'node_modules/paquet/index.kt',
  'buildSrc/src/main/kotlin/Plugin.kt',
  'out/O.kt',
];

const MOTEURS: Array<{ nom: string; exclut(motif: string, chemin: string): boolean }> = [
  { nom: 'picomatch', exclut: (m, c) => picomatch(m, { dot: true })(c) },
  { nom: 'minimatch', exclut: (m, c) => minimatch(c, m, { dot: true }) },
];

function exclusPar(motif: string | undefined, moteur: typeof MOTEURS[number]): string[] {
  if (motif === undefined) return [];
  return CORPUS.filter(c => moteur.exclut(motif, c));
}

describe('excludeGlob — les deux fautes de construction', () => {
  it('une liste d un seul motif exclut vraiment', () => {
    const motif = excludeGlob(['**/build/**']);
    for (const moteur of MOTEURS) {
      expect(exclusPar(motif, moteur), 'moteur ' + moteur.nom).toContain(
        'app/build/generated/source/BuildConfig.java',
      );
    }
  });

  it('la configuration par defaut exclut un build/ a la racine', () => {
    // C'est le cas qui manquait : `{**​/build/**,**​/.gradle/**}` laissait
    // passer `build/reports/A.kt` sous picomatch, donc un projet Gradle a un
    // seul module voyait tout son dossier de sortie indexe.
    const motif = excludeGlob(['**/build/**', '**/.gradle/**']);
    for (const moteur of MOTEURS) {
      const exclus = exclusPar(motif, moteur);
      expect(exclus, 'build a la racine, moteur ' + moteur.nom).toContain('build/reports/A.kt');
      expect(exclus, 'gradle a la racine, moteur ' + moteur.nom).toContain('.gradle/cache/Z.kt');
      expect(exclus, 'et le cas imbrique reste exclu, moteur ' + moteur.nom).toContain(
        'app/build/generated/source/BuildConfig.java',
      );
    }
  });

  it('n exclut jamais plus que ce qui a ete demande', () => {
    const motif = excludeGlob(['**/build/**', '**/.gradle/**']);
    for (const moteur of MOTEURS) {
      const exclus = exclusPar(motif, moteur);
      // `buildSrc` commence par « build » sans etre un dossier de sortie, et
      // un paquet Kotlin peut s'appeler `build`.
      expect(exclus, 'moteur ' + moteur.nom).not.toContain('buildSrc/src/main/kotlin/Plugin.kt');
      expect(exclus, 'moteur ' + moteur.nom).not.toContain('app/src/main/java/com/x/Ecran.kt');
    }
  });

  it('une liste vide ne donne pas `{}`, elle ne donne rien', () => {
    // `{}` partait vers findFiles et n'excluait rien, mais ce n'est pas la
    // meme chose que ne rien envoyer : `undefined` laisse VS Code appliquer
    // ses propres exclusions (files.exclude, search.exclude).
    expect(excludeGlob([])).toBeUndefined();
  });
});

describe('excludeGlob — le balayage et le veilleur doivent voir pareil', () => {
  const LISTES = [
    [],
    ['**/build/**'],
    ['**/.gradle/**'],
    ['**/build/**', '**/.gradle/**'],
    ['**/build/**', '**/.gradle/**', '**/node_modules/**'],
    ['**/generated/**'],
    ['buildSrc/**'],
    ['**/build/**', 'buildSrc/**'],
    ['out/**', '**/node_modules/**'],
  ];

  for (const liste of LISTES) {
    for (const moteur of MOTEURS) {
      it('accord sur [' + liste.join(' ') + '] via ' + moteur.nom, () => {
        const parLeBalayage = exclusPar(excludeGlob(liste), moteur).sort();
        const veilleur = makeExclusionMatcher(liste);
        const parLeVeilleur = CORPUS.filter(c => veilleur(c)).sort();
        expect(parLeBalayage).toEqual(parLeVeilleur);
      });
    }
  }
});

describe('excludeGlob — personne ne rebricole les accolades a la main', () => {
  it('aucun source ne construit son propre groupe d exclusion', () => {
    const racine = path.resolve(__dirname, '..', '..', 'src');
    const fautifs: string[] = [];
    const parcourir = (dossier: string) => {
      for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        const p = path.join(dossier, e.name);
        if (e.isDirectory()) { parcourir(p); continue; }
        if (!e.name.endsWith('.ts')) continue;
        fs.readFileSync(p, 'utf8').split(String.fromCharCode(10)).forEach((ligne, i) => {
          if (/\{\$\{[^}]*\.join\(','\)\}\}/.test(ligne)) {
            fautifs.push(path.relative(racine, p) + ':' + (i + 1));
          }
        });
      }
    };
    parcourir(racine);
    // Seul le helper pose les accolades, et lui seul sait quand il ne faut
    // pas les poser.
    expect(fautifs.map(f => f.split(':')[0]), 'passer par excludeGlob()').toEqual([
      'util/pathExclusion.ts',
    ]);
  });
});
