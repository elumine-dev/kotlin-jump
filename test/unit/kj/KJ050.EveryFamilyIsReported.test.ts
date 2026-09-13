import { describe, it, expect } from 'vitest';
import {
  collecterUnePasse, resumeDesFamilles, libelleDeLaDemande,
} from '../../../src/commands/RemoveEverythingUnused';

/**
 * Le compte rendu nomme TOUTES les familles que la passe sait compter.
 *
 * Trois copies de la meme liste vivent dans ce fichier : celle que
 * `collecterUnePasse` initialise, celle que la commande cumule, et celle que
 * `resumeDesFamilles` enumere. Une famille ajoutee a la premiere entre dans le
 * total du dialogue et dans le cumul, et disparait du rapport final sans un
 * mot : la commande annoncerait « Removed 12 » puis n en nommerait que huit.
 *
 * `resumeDesFamilles` a justement ete extraite parce que, inline, un mot faux
 * y etait invisible de tous les tests. L extraire ne suffit pas ; c est la
 * LISTE qu il faut tenir, et la tenir contre la source, pas contre une
 * quatrieme copie ecrite ici.
 *
 * Ce depot a deja paye un compte affiche et une liste qui ne venaient pas du
 * meme endroit.
 */

const SEGS = ['/src/test/', '/src/androidTest/'];
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const SOURCES = [
  { path: '/w/app/src/main/java/p/Morte.kt', text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' },
  { path: '/w/app/src/main/java/q/Vivant.kt', text: 'package q\n\nfun point() = 2\n' },
  GRADLE,
];

/** Les familles, lues de la passe elle meme et jamais recopiees ici. */
const familles = (): string[] => Object.keys(collecterUnePasse([GRADLE], SEGS).tally);

describe('KJ-050 le rapport nomme toutes les familles de la passe', () => {
  it('temoin : la passe declare bien une poignee de familles', () => {
    expect(familles().length).toBeGreaterThanOrEqual(6);
  });

  it('chacune apparait dans le compte rendu quand elle est non nulle', () => {
    const muettes = familles().filter(f => {
      const seule: any = Object.fromEntries(familles().map(k => [k, 0]));
      seule[f] = 3;
      return resumeDesFamilles(seule) === '';
    });
    expect(muettes, 'familles comptees par la passe et absentes du rapport').toEqual([]);
  });

  it('toutes ensemble, le rapport en fait autant de clauses', () => {
    const toutes: any = Object.fromEntries(familles().map(k => [k, 3]));
    expect(resumeDesFamilles(toutes).split(', ').length).toBe(familles().length);
  });

  it('a zero partout, il ne dit rien', () => {
    expect(resumeDesFamilles(Object.fromEntries(familles().map(k => [k, 0])) as any)).toBe('');
  });

  it('le total du dialogue est la somme des familles de la passe', () => {
    const { parFichier, tally } = collecterUnePasse(SOURCES, SEGS);
    const total = [...parFichier.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBeGreaterThan(0);
    // `imports` et `fichiers` viennent de la cascade, apres la passe.
    const dePasse = familles().filter(f => f !== 'imports' && f !== 'fichiers');
    expect(dePasse.reduce((n, f) => n + (tally[f] ?? 0), 0)).toBe(total);
  });

  it('temoin : le titre compte ce qui part, le detail dit la portee', () => {
    const { parFichier, tally } = collecterUnePasse(SOURCES, SEGS);
    const total = [...parFichier.values()].reduce((n, l) => n + l.length, 0);
    const renommages = tally.renommages ?? 0;
    const d = libelleDeLaDemande(total, renommages, parFichier.size);
    // Le compte vit dans le titre, une seule fois : le detail dit la portee,
    // parce que l edition se construit APRES le clic et qu un nombre
    // d operations promis ici ne serait pas tenu.
    expect(d.titre).toContain(`${total - renommages}`);
    expect(d.detail).toContain(`Across ${parFichier.size} file`);
    expect(d.detail).not.toMatch(/\d+ change/);
  });
});
