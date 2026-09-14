import { describe, it, expect } from 'vitest';
import { cascadeAfterRemoval } from '../../../src/providers/removalCascade';

/**
 * Quand la cascade emporte TOUT un bloc d imports, une des deux lignes vides
 * qui l encadraient part avec lui.
 *
 * Vu sur le projet de reference : `BasePostViewModel.kt` a perdu sa classe et
 * ses vingt imports, et il est reste `package ...` suivi de DEUX lignes vides
 * avant l enum qui survivait. detekt refuse ce fichier (`NoConsecutiveBlankLines`).
 * La cascade coupait les imports ligne par ligne sans regarder ce qui les
 * entourait ; les coupes de declarations, elles, ont `sansTrouDeLignesVides`
 * depuis longtemps.
 */

const P = '/w/app/src/main/kotlin/com/x/A.kt';

/** Le texte apres la coupe de la declaration (lignes entieres) et de la cascade. */
function apres(texte: string, declaration: string) {
  const start = texte.indexOf(declaration);
  let end = start + declaration.length;
  if (texte[end] === '\n') end++;
  if (texte[end] === '\n') end++; // la ligne vide qui suivait la declaration part avec elle
  const cascade = cascadeAfterRemoval(new Map([[P, [{ start, end }]]]), new Map([[P, texte]]));
  const toutes = [{ start, end }, ...(cascade.imports.get(P) ?? [])].sort((a, b) => b.start - a.start);
  let out = texte;
  let borne = Infinity;
  for (const c of toutes) {
    expect(c.end <= borne, 'deux coupes se chevauchent').toBe(true);
    out = out.slice(0, c.start) + out.slice(c.end);
    borne = c.start;
  }
  return out;
}

describe('KJ-048 un bloc d imports retire ne laisse pas deux lignes vides', () => {
  it('le cas du projet de reference : tout le bloc part, une seule ligne vide reste', () => {
    const texte = 'package com.x\n\nimport java.io.File\nimport java.util.UUID\n\nclass Mort {\n    val f: File? = null\n    val u = UUID.randomUUID()\n}\n\nenum class Vivant { X }\n';
    const classe = 'class Mort {\n    val f: File? = null\n    val u = UUID.randomUUID()\n}';
    expect(apres(texte, classe)).toBe('package com.x\n\nenum class Vivant { X }\n');
  });

  it('un groupe d imports encadre de lignes vides part avec l une d elles', () => {
    const texte = 'package com.x\n\nimport java.util.UUID\n\nimport java.io.File\n\nclass Mort {\n    val f: File? = null\n}\n\nfun vivant() = UUID.randomUUID()\n';
    expect(apres(texte, 'class Mort {\n    val f: File? = null\n}')).toBe('package com.x\n\nimport java.util.UUID\n\nfun vivant() = UUID.randomUUID()\n');
  });

  it('temoin : une partie du bloc seulement, les lignes vides ne bougent pas', () => {
    const texte = 'package com.x\n\nimport java.io.File\nimport java.util.UUID\n\nclass Mort {\n    val f: File? = null\n}\n\nfun vivant() = UUID.randomUUID()\n';
    expect(apres(texte, 'class Mort {\n    val f: File? = null\n}')).toBe('package com.x\n\nimport java.util.UUID\n\nfun vivant() = UUID.randomUUID()\n');
  });

  it('temoin : le DERNIER import d un bloc seulement, la ligne vide d apres reste', () => {
    const texte = 'package com.x\n\nimport java.util.UUID\nimport java.io.File\n\nclass Mort {\n    val f: File? = null\n}\n\nfun vivant() = UUID.randomUUID()\n';
    expect(apres(texte, 'class Mort {\n    val f: File? = null\n}')).toBe('package com.x\n\nimport java.util.UUID\n\nfun vivant() = UUID.randomUUID()\n');
  });

  it('une ligne vide deja prise par la coupe d une declaration n est pas reprise', () => {
    const texte = 'package com.x\n\nimport java.io.File\n\nclass Mort {\n    val f: File? = null\n}\n\nenum class Vivant { X }\n';
    const start = texte.indexOf('\nclass Mort') + 1 - 1; // la ligne vide sous les imports
    const end = texte.indexOf('}\n\nenum') + 3;
    const extents = cascadeAfterRemoval(new Map([[P, [{ start, end }]]]), new Map([[P, texte]])).imports.get(P) ?? [];
    for (const e of extents) expect(e.end <= start || e.start >= end, 'la cascade chevauche la coupe').toBe(true);
  });

  it('l etendue ajoutee commence toujours par la ligne d import', () => {
    const texte = 'package com.x\n\nimport java.io.File\n\nclass Mort {\n    val f: File? = null\n}\n\nenum class Vivant { X }\n';
    const start = texte.indexOf('class Mort');
    const end = texte.indexOf('}\n\nenum') + 2;
    const extents = cascadeAfterRemoval(new Map([[P, [{ start, end }]]]), new Map([[P, texte]])).imports.get(P) ?? [];
    for (const e of extents) expect(texte.slice(e.start, e.end)).toMatch(/^import /);
  });
});
