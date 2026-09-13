import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';

/**
 * Un point-virgule dans un COMMENTAIRE ne termine pas la declaration.
 *
 * La 1.42.236 a appris a la marche d expression qu un `;` clot ce qu elle
 * suit, pour l empecher de traverser la methode Java d en dessous. Le
 * commentaire pose au dessus dit « a profondeur zero », et la profondeur est
 * bien comptee sur la copie blanchie. Le point-virgule, lui, est lu sur la
 * ligne BRUTE.
 *
 * Alors un commentaire de fin de ligne qui se termine par un point-virgule
 * arrete la marche au milieu de l expression :
 *
 *   val fantome = 1 + // note;
 *       2
 *
 * La coupe emporte la premiere ligne et laisse `    2` tout seul, ce qui ne
 * compile plus. Le meme piege existe pour une chaine, et c est exactement la
 * raison pour laquelle le test de l OPERATEUR, lui, est fait sur le brut : le
 * nettoyeur vide les chaines et `val x = "done"` se lirait sur `=`. Les deux
 * tests ne veulent pas la meme copie.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const VIVANT = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(vivant()) }\n');

const coupe = (texte: string, nom: string, nomFichier = 'A.kt') => {
  const t = (findUnusedSymbols({
    sources: [f(`${MAIN}/${nomFichier}`, texte), VIVANT, GRADLE],
    testSourceSets: ['/src/test/'],
  } as any) as any[]).find(s => s.name === nom);
  if (!t || t.removeStart < 0) return undefined;
  return { coupe: texte.slice(t.removeStart, t.removeEnd), reste: texte.slice(0, t.removeStart) + texte.slice(t.removeEnd) };
};

const AVEC = [
  'package com.x',
  '',
  'val fantome = 1 + // note;',
  '    2',
  '',
  'fun vivant() = 3',
  '',
].join('\n');

const SANS = AVEC.replace('// note;', '// note');

describe('KJ-032 un point-virgule en commentaire ne clot rien', () => {
  it('temoin : sans le point-virgule, les deux lignes partent', () => {
    const r = coupe(SANS, 'fantome')!;
    expect(r.coupe).toContain('    2');
    expect(r.reste).not.toContain('    2');
  });

  it('avec le point-virgule dans le commentaire, la suite ne reste pas orpheline', () => {
    const r = coupe(AVEC, 'fantome')!;
    expect(r.reste).not.toContain('    2');
    expect(r.coupe).toContain('    2');
  });

  it('temoin : un vrai point-virgule Java clot toujours la declaration', () => {
    const java = [
      'package com.x;',
      '',
      'class A {',
      '    private int fantome = 1;',
      '',
      '    int vivant() { return 3; }',
      '}',
      '',
    ].join('\n');
    const r = coupe(java, 'fantome', 'A.java');
    // Qu il soit rapporte ou non, la coupe ne doit jamais avaler la methode.
    if (r !== undefined) expect(r.coupe).not.toContain('vivant');
  });
});
