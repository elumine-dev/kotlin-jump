import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Une declaration ne continue pas sur la ligne suivante quand celle ci ouvre
 * une declaration a elle.
 *
 * La liste de mots qui repond a cette question enumerait `val`, `var`, `fun`,
 * `private`, `override`, `data`... et pas `const`. Un bloc de constantes, la
 * forme que prend tout companion object, se lisait donc comme UNE declaration
 * etalee sur six lignes : l'etendue etait refusee et le diagnostic s'affichait
 * sans le moindre correctif.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 58 des 66 declarations
 * signalees sans correctif tenaient a ce seul mot.
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

const COMPANION = [
  'package com.x',
  '',
  'class A {',
  '    companion object {',
  '        const val DELAY = 10L',
  '        const val MORT = 100',
  '        const val RATIO = 100',
  '    }',
  '',
  '    fun go() = DELAY + RATIO',
  '}',
  '',
].join('\n');

describe.skipIf(!mod)('une ligne qui ouvre une declaration n est pas une continuation', () => {
  it('const val suivi de const val : la coupe est offerte et vaut sa ligne', () => {
    expect(coupe(COMPANION, 'MORT')).toBe('        const val MORT = 100\n');
  });

  it('la constante du milieu ne mange pas ses voisines', () => {
    const c = coupe(COMPANION, 'MORT');
    expect(c).toBeDefined();
    expect(c).not.toContain('DELAY');
    expect(c).not.toContain('RATIO');
  });

  it('lateinit var suivi de lateinit var : meme regle', () => {
    const t = [
      'package com.x',
      '',
      'class B {',
      '    lateinit var mort: String',
      '    lateinit var vivant: String',
      '',
      '    fun go() = vivant',
      '}',
      '',
    ].join('\n');
    expect(coupe(t, 'mort')).toBe('    lateinit var mort: String\n');
  });
});
