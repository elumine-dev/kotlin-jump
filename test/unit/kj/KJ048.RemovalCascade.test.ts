import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-048 — ce qu'une suppression laisse derriere elle.
 *
 * Supprimer une fonction emporte son corps, jamais les imports dont ce corps
 * etait le seul utilisateur. `DeadCodeSweep` l'ecrit noir sur blanc
 * (« Cascades are NOT resolved »), et la mesure sur
 * /Users/kevin/Desktop/work/lapresse le chiffre : appliquer toutes les
 * suppressions offertes par l'extension laissait 100 imports morts de plus
 * dans 36 fichiers, plus des coquilles qui ne contenaient plus que leur
 * ligne de paquet.
 *
 * La retenue qui compte : un import DEJA mort avant la coupe n'est pas
 * ramasse ici. C'est la trouvaille de KJ-009, elle porte sa propre ampoule, et
 * l'inclure elargirait en silence un correctif demande pour autre chose.
 */

const mod: any = await importOrNull('src/providers/removalCascade');

const NL = '\n';
function cascade(path: string, text: string, cuts: { start: number; end: number }[]) {
  return mod.cascadeAfterRemoval(new Map([[path, cuts]]), new Map([[path, text]]));
}
/** Extent of the whole declaration named, found by its first and last line. */
function extentOf(text: string, from: string, to: string) {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  return { start, end };
}

describe.skipIf(!mod)('cascadeAfterRemoval', () => {
  const FICHIER = [
    'package com.x',
    '',
    'import java.io.File',
    'import java.util.UUID',
    '',
    'fun garde(): String = UUID.randomUUID().toString()',
    '',
    'fun morte(f: File) = f.name',
  ].join(NL);

  it('un import que seule la fonction supprimee utilisait est emporte', () => {
    const c = cascade('a/A.kt', FICHIER, [extentOf(FICHIER, 'fun morte', 'f.name')]);
    const extents = c.imports.get('a/A.kt') ?? [];
    const coupes = extents.map((e: any) => FICHIER.slice(e.start, e.end).trim());
    expect(coupes).toEqual(['import java.io.File']);
  });

  it('un import encore utilise ailleurs reste', () => {
    const c = cascade('a/A.kt', FICHIER, [extentOf(FICHIER, 'fun morte', 'f.name')]);
    const coupes = (c.imports.get('a/A.kt') ?? []).map((e: any) => FICHIER.slice(e.start, e.end).trim());
    expect(coupes).not.toContain('import java.util.UUID');
  });

  it('un import DEJA mort avant la coupe n est pas ramasse', () => {
    const texte = [
      'package com.x',
      '',
      'import java.io.File',
      'import java.util.UUID',
      '',
      'fun morte(f: File) = f.name',
    ].join(NL);
    // UUID ne sert nulle part : c est la trouvaille de KJ-009, pas la notre.
    const c = cascade('a/A.kt', texte, [extentOf(texte, 'fun morte', 'f.name')]);
    const coupes = (c.imports.get('a/A.kt') ?? []).map((e: any) => texte.slice(e.start, e.end).trim());
    expect(coupes).toEqual(['import java.io.File']);
  });

  it('un fichier qui ne garde que son paquet et ses imports est signale vide', () => {
    const texte = ['package com.x', '', 'import java.io.File', '', 'fun seule(f: File) = f.name'].join(NL);
    const c = cascade('a/A.kt', texte, [extentOf(texte, 'fun seule', 'f.name')]);
    expect(c.emptyFiles).toEqual(['a/A.kt']);
  });

  it('temoin : un fichier qui garde du code n est pas signale vide', () => {
    const c = cascade('a/A.kt', FICHIER, [extentOf(FICHIER, 'fun morte', 'f.name')]);
    expect(c.emptyFiles).toEqual([]);
  });

  it('temoin : sans coupe, rien ne bouge', () => {
    const c = cascade('a/A.kt', FICHIER, []);
    expect(c.imports.size).toBe(0);
    expect(c.emptyFiles).toEqual([]);
  });

  it('temoin : un fichier Java est laisse tranquille', () => {
    const texte = ['package com.x;', '', 'import java.io.File;', '', 'class A { File f; }'].join(NL);
    const c = cascade('a/A.java', texte, [{ start: texte.indexOf('class A'), end: texte.length }]);
    expect(c.imports.size).toBe(0);
  });

  it('les extents rendus sont des lignes entieres du texte D ORIGINE', () => {
    const c = cascade('a/A.kt', FICHIER, [extentOf(FICHIER, 'fun morte', 'f.name')]);
    const e = (c.imports.get('a/A.kt') ?? [])[0];
    expect(FICHIER[e.start - 1] ?? '\n').toBe('\n');
    expect(FICHIER[e.end - 1]).toBe('\n');
    expect(FICHIER.slice(e.start, e.end)).toBe('import java.io.File\n');
  });
  it('un import declare deux fois donne deux extents distincts', () => {
    // Les deux orphelins etaient mappes sur la PREMIERE ligne correspondante :
    // le plan demandait deux fois la meme coupe et laissait le doublon debout.
    const texte = ['package a', 'import java.io.File', 'import java.io.File', '', 'fun morte(f: File) = f.name'].join(NL);
    const c = cascade('a/A.kt', texte, [extentOf(texte, 'fun morte', 'f.name')]);
    const extents = (c.imports.get('a/A.kt') ?? []) as any[];
    expect(extents.length).toBe(2);
    expect(new Set(extents.map(e => `${e.start}:${e.end}`)).size).toBe(2);
    for (const e of extents) expect(texte.slice(e.start, e.end)).toBe('import java.io.File' + NL);
  });
  it('un fichier JAVA vide par une coupe est signale lui aussi', () => {
    // La garde `.kt` coupait DEUX choses alors qu une seule est propre a
    // Kotlin. La vacuite se lit pareil dans les deux langages, `package a;`
    // compris, et gater les deux sur l extension laissait chaque fichier Java
    // vide debout comme une coquille.
    const texte = ['package com.x;', '', 'import java.io.File;', '',
      'class Coquille {', '    void f(File x) {}', '}'].join(NL);
    const c = cascade('a/A.java', texte, [{ start: texte.indexOf('class Coquille'), end: texte.length }]);
    expect(c.emptyFiles).toEqual(['a/A.java']);
    // L autre moitie reste Kotlin : aucun import Java n est touche.
    expect(c.imports.size).toBe(0);
  });

  it('temoin : un fichier Java qui garde une classe n est pas signale', () => {
    const texte = ['package com.x;', '', 'class A {}', 'class B {}'].join(NL);
    const c = cascade('a/B.java', texte, [{ start: texte.indexOf('class A'), end: texte.indexOf('class B') }]);
    expect(c.emptyFiles).toEqual([]);
  });
});
