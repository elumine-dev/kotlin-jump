import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Une accolade de lambda n'est pas forcement la fin de l'expression.
 *
 *   fun getTagVisibility() = model.tag.text.takeIf { it.isNotBlank() }?.let { View.VISIBLE }
 *       ?: View.GONE
 *
 * La portee s'arrete sur l'accolade fermante, donc `lineBasedEnd` est faux,
 * donc le test de continuation et la marche d'expression, tous deux gardes par
 * lui, ne s'appliquaient pas. La coupe prenait la premiere ligne et laissait
 * `?: View.GONE` seul dans le fichier, qui ne compile plus.
 *
 * Trouve par l'invariant ORPHELIN du harnais, ajoute parce que les sept autres
 * regardent ce que la coupe CONTIENT et aucun ce qu'elle LAISSE. Trois
 * occurrences sur /workspace/exampleapp, dans du code vivant.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');
const MAIN = '/w/app/src/main/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin'];

const coupe = (texte: string, nom: string): string | undefined => {
  const sources = [
    { path: `${MAIN}/A.kt`, text: texte },
    { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun r() = 1\n' },
  ];
  const m = mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] })
    .find((x: any) => x.name === nom);
  if (!m) return undefined;
  return m.removeStart >= 0 ? texte.slice(m.removeStart, m.removeEnd) : undefined;
};

const AVEC_ELVIS = [
  'package com.x',
  '',
  'class A {',
  '    fun mort() = tag.text.takeIf { it.isNotBlank() }?.let { View.VISIBLE }',
  '        ?: View.GONE',
  '',
  '    fun vivant() = 1',
  '}',
  '',
].join('\n');

describe.skipIf(!mod)('un Elvis apres un lambda appartient a la declaration', () => {
  it('la coupe prend les deux lignes', () => {
    expect(coupe(AVEC_ELVIS, 'mort')).toBe(
      '    fun mort() = tag.text.takeIf { it.isNotBlank() }?.let { View.VISIBLE }\n        ?: View.GONE\n');
  });

  it('elle ne laisse pas l Elvis derriere', () => {
    const c = coupe(AVEC_ELVIS, 'mort');
    expect(c).toBeDefined();
    expect(AVEC_ELVIS.replace(c!, '')).not.toContain('?: View.GONE');
  });

  it('une suite par appel chaine compte aussi', () => {
    const t = [
      'package com.x',
      '',
      'class B {',
      '    fun mort() = items.map { it }',
      '        .filter { it > 0 }',
      '',
      '    fun vivant() = 1',
      '}',
      '',
    ].join('\n');
    expect(coupe(t, 'mort')).toBe('    fun mort() = items.map { it }\n        .filter { it > 0 }\n');
  });

  it('temoin : une declaration qui finit vraiment sur son accolade ne deborde pas', () => {
    const t = [
      'package com.x',
      '',
      'class C {',
      '    fun mort() {',
      '        val a = 1',
      '    }',
      '',
      '    fun vivant() = 1',
      '}',
      '',
    ].join('\n');
    expect(coupe(t, 'mort')).toBe('    fun mort() {\n        val a = 1\n    }\n');
  });

  it('temoin Java : un champ ne suit pas la methode du dessous', () => {
    const t = [
      'package com.x;',
      '',
      'class D {',
      '    void mort() {',
      '        int a = 1;',
      '    }',
      '',
      '    int vivant = 2;',
      '}',
      '',
    ].join('\n');
    const c = coupe(t, 'mort');
    if (c !== undefined) expect(c).not.toContain('vivant');
  });
});
