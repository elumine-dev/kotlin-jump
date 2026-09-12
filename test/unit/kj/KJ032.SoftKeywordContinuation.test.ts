import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Un modificateur Kotlin est un mot-cle SOUPLE : `value`, `data`, `open`,
 * `expect`, `operator` sont des identifiants parfaitement legitimes.
 *
 * Le test qui decide si la ligne suivante ouvre une declaration les reconnait
 * nus. Une ligne de continuation qui commence par l'un d'eux se lisait donc
 * comme une declaration neuve, la declaration au dessus etait jugee finie, et
 * la coupe s'arretait une ligne trop tot :
 *
 *   val ghostly = if (a)      <- seule ligne coupee
 *       value
 *   else
 *       other                 <- reste derriere, ne compile plus
 *
 * `open` etait deja dans la liste avant 1.42.233 ; cette version y a ajoute
 * `value`, `data`, `expect`, `actual`, `operator`, `infix` et les autres, donc
 * elle a elargi le defaut. Un mot n'ouvre une declaration que suivi d'un
 * mot-cle DUR.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const MAIN = '/w/app/src/main/kotlin/com/x';

const coupe = (texte: string, nom = 'ghostly'): string | undefined => {
  const f = (mod.findUnusedSymbols({ sources: [{ path: `${MAIN}/M.kt`, text: texte }], testSourceSets: [] }) as any[])
    .find(x => x.name === nom);
  if (!f) return undefined;
  return f.removeStart >= 0 ? texte.slice(f.removeStart, f.removeEnd) : undefined;
};

const avecSuite = (mot: string) =>
  `package com.x\n\nval ghostly = if (a)\n    ${mot}\nelse\n    other\n\nclass K\n`;

describe.skipIf(!mod)('un mot-cle souple ne termine pas la declaration du dessus', () => {
  for (const mot of ['value', 'data', 'open', 'expect', 'actual', 'operator', 'inner', 'final']) {
    it(`suite commencant par \`${mot}\``, () => {
      const texte = avecSuite(mot);
      expect(coupe(texte)).toBe(`val ghostly = if (a)\n    ${mot}\nelse\n    other\n`);
    });
  }

  it('temoin : un identifiant ordinaire donnait deja la bonne coupe', () => {
    expect(coupe(avecSuite('alpha'))).toBe('val ghostly = if (a)\n    alpha\nelse\n    other\n');
  });

  it('le meme mot suivi d un mot-cle dur ouvre bien une declaration', () => {
    const texte = 'package com.x\n\nval ghostly = 1\n\ndata class Kept(val a: Int)\n';
    expect(coupe(texte)).toBe('val ghostly = 1\n');
  });

  it('Java : un champ ne mange pas la methode qui le suit', () => {
    const texte = [
      'package com.x;',
      '',
      'class B {',
      '    static int MORT = 1;',
      '    public void foo() {',
      '        int a = 1;',
      '    }',
      '}',
      '',
    ].join('\n');
    const f = (mod.findUnusedSymbols({ sources: [{ path: `${MAIN}/B.java`, text: texte }], testSourceSets: [] }) as any[])
      .find(x => x.name === 'MORT');
    if (f && f.removeStart >= 0) {
      expect(texte.slice(f.removeStart, f.removeEnd)).toBe('    static int MORT = 1;\n');
    }
  });
});
