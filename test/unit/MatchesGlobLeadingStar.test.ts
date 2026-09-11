/**
 * `**​/` doit couvrir ZERO repertoire, sinon la racine du projet echappe a tout.
 *
 * La traduction glob vers expression reguliere remplaçait `**` par un
 * caractere gare, puis ce caractere par `.*`. Un motif `**​/buildSrc/**`
 * devenait donc `^.*​/buildSrc/.*$`, qui exige au moins un repertoire AVANT
 * `buildSrc`. Or un projet Gradle met `buildSrc` a la racine.
 *
 * Consequence : le reglage livre par defaut,
 * `unusedSymbolsIgnorePaths = ['**​/buildSrc/**', '**​/build-logic/**']`, ne
 * mettait rien de cote. Sa propre description dit pourquoi il doit le faire,
 * un plugin de convention etant identifie par son nom de fichier, donc chacune
 * de ses declarations parait non referencee et se fait proposer a la
 * suppression. Mesure sur /Users/kevin/Desktop/work/lapresse : 1 fichier sous
 * `buildSrc/`, 0 exclu.
 *
 * Le test qui couvrait le reglage passait, avec un chemin de fixture
 * `/w/buildSrc/...`. Ce `/w/` fournit le repertoire que le motif reclamait ;
 * le chemin reel, lui, est relatif a la racine de l espace de travail.
 */
import { describe, it, expect } from 'vitest';
import { matchesGlob } from '../../src/providers/unusedSymbols';

describe('matchesGlob - un prefixe `**` couvre zero repertoire', () => {
  it('le reglage livre met de cote un buildSrc a la racine', () => {
    expect(matchesGlob('buildSrc/src/main/kotlin/Conv.kt', '**/buildSrc/**')).toBe(true);
    expect(matchesGlob('build-logic/src/main/kotlin/Conv.kt', '**/build-logic/**')).toBe(true);
  });

  it('et continue de couvrir un buildSrc imbrique', () => {
    expect(matchesGlob('sub/buildSrc/src/Conv.kt', '**/buildSrc/**')).toBe(true);
    expect(matchesGlob('a/b/buildSrc/Conv.kt', '**/buildSrc/**')).toBe(true);
  });

  it('un fichier a la racine repond a `**​/*.kt`', () => {
    expect(matchesGlob('Foo.kt', '**/*.kt')).toBe(true);
    expect(matchesGlob('a/Foo.kt', '**/*.kt')).toBe(true);
    expect(matchesGlob('a/b/Foo.kt', '**/*.kt')).toBe(true);
  });

  it('`a/**​/d.kt` couvre `a/d.kt`', () => {
    expect(matchesGlob('a/d.kt', 'a/**/d.kt')).toBe(true);
    expect(matchesGlob('a/b/c/d.kt', 'a/**/d.kt')).toBe(true);
  });

  it('temoin : une seule etoile ne traverse pas un separateur', () => {
    expect(matchesGlob('Foo.kt', '*.kt')).toBe(true);
    expect(matchesGlob('a/Foo.kt', '*.kt')).toBe(false);
    expect(matchesGlob('a/d.kt', 'a/*/d.kt')).toBe(false);
    expect(matchesGlob('a/b/d.kt', 'a/*/d.kt')).toBe(true);
  });

  it('temoin : ce qui ne correspond pas ne doit pas se mettre a correspondre', () => {
    expect(matchesGlob('app/src/Main.kt', '**/buildSrc/**')).toBe(false);
    expect(matchesGlob('buildSrcOther/x.kt', '**/buildSrc/**')).toBe(false);
    expect(matchesGlob('app/src/Main.java', '**/*.kt')).toBe(false);
    expect(matchesGlob('app/generated/X.kt', '**/build/**')).toBe(false);
  });

  it('temoin : les caracteres speciaux restent litteraux', () => {
    expect(matchesGlob('a+b/x.kt', 'a+b/**')).toBe(true);
    expect(matchesGlob('aXb/x.kt', 'a+b/**')).toBe(false);
    expect(matchesGlob('x.kapt_metadata', '**/*.kapt_metadata')).toBe(true);
  });

  it('temoin : un `**` nu couvre tout', () => {
    expect(matchesGlob('a/b/c.kt', '**')).toBe(true);
    expect(matchesGlob('c.kt', '**')).toBe(true);
  });
});
