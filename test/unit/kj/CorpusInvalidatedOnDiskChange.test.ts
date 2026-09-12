import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

/**
 * Le corpus fait partie des caches qu'un changement sur DISQUE doit vider.
 *
 * Le rappel par fichier du veilleur vidait six caches et pas celui la. Le
 * corpus n'etait invalide qu'a la creation, la suppression, le renommage et la
 * SAUVEGARDE depuis l'editeur. Or `git checkout`, `stash pop` ou un formateur
 * lance au terminal touchent des fichiers que personne n'a ouverts : aucun
 * evenement de sauvegarde ne part, et le corpus servait pendant une minute des
 * offsets mesures sur l'ancien contenu.
 *
 * Un surlignage sur la mauvaise ligne est cosmetique. Une SUPPRESSION sur la
 * mauvaise ligne ne l'est pas, et deux commandes ecrivent dans des fichiers
 * que l'utilisateur n'ouvre jamais.
 *
 * Le test lit la source parce que c'est du cablage : la regle est « le corpus
 * est dans la meme liste que les autres caches », et elle ne se verifie qu'la.
 */

/**
 * Les DEUX points d'entree. Corriger l'un et laisser l'autre est la maniere
 * exacte dont un correctif part a moitie applique, et ce depot en a deja un
 * cas au journal.
 */
const ENTREES = [
  { fichier: 'src/extension.ts', corpus: 'resourceCorpus' },
  { fichier: 'src/extension.browser.ts', corpus: 'resourceCorpusWeb' },
];

function lire(fichier: string): string {
  return readFileSync(path.join(REPO_ROOT, fichier), 'utf8');
}

/** Le corps du rappel passe a `new FileWatcher(...)`, les deux chemins. */
function corpsDuVeilleur(fichier: string): string {
  const source = lire(fichier);
  const debut = source.indexOf('const watcher = new FileWatcher(');
  expect(debut, `le veilleur est construit dans ${fichier}`).toBeGreaterThan(0);
  const fin = source.indexOf('}, isExcludedPath);', debut);
  expect(fin, 'le veilleur se ferme sur isExcludedPath').toBeGreaterThan(debut);
  return source.slice(debut, fin);
}

describe('invalidation sur changement disque', () => {
  for (const { fichier, corpus } of ENTREES) {
    it(`${fichier} : le rappel du veilleur vide le corpus`, () => {
      expect(corpsDuVeilleur(fichier)).toContain(`${corpus}.invalidate()`);
    });

    it(`${fichier} : les DEUX chemins le vident, par fichier et par rafale`, () => {
      // La rafale est le chemin d un git checkout : c est precisement celui
      // qui comptait.
      const corps = corpsDuVeilleur(fichier);
      expect(corps.split(`${corpus}.invalidate()`).length - 1).toBeGreaterThanOrEqual(2);
    });

    it(`${fichier} : le corpus est declare AVANT le veilleur, sinon rien ne compile`, () => {
      const source = lire(fichier);
      expect(source.indexOf(`const ${corpus} = new ResourceCorpus();`))
        .toBeLessThan(source.indexOf('const watcher = new FileWatcher('));
    });

    it(`${fichier} : temoin, les autres caches du rappel sont toujours vides`, () => {
      const corps = corpsDuVeilleur(fichier);
      for (const cache of ['invalidateContentCache(', 'codeLens.evictFile(', '_semanticTokens?.invalidate(']) {
        expect(corps, cache).toContain(cache);
      }
    });
  }
});
