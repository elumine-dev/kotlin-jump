import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-060 — un fichier source qui ne declare rien.
 *
 * Ce qu une suppression laisse derriere elle quand elle a pris la derniere
 * declaration et que personne n a regarde a nouveau : une ligne `package`,
 * quelques imports, et rien. La cascade supprime un fichier qu elle VIDE dans
 * la meme ronde, mais un fichier deja vide au depart n est vu par aucun
 * detecteur : tous cherchent des declarations, et il n y en a pas.
 *
 * Le test est litteral, expres : commentaires et chaines blanchis, chaque
 * ligne restante doit etre un `package`, un `import`, un `@file:`, un `;`
 * seul ou du vide. N importe quoi d autre garde le fichier.
 */

const mod: any = await importOrNull('src/providers/emptySourceFiles');

describe.skipIf(!mod)('findEmptySourceFiles', () => {
  it('package, imports, commentaires et rien d autre : rapporte', () => {
    const files = [
      { path: '/p/a/src/main/java/com/x/Empty.kt', text: 'package com.x\n\nimport com.y.Thing\n\n// once held a class\n\n/* and a doc */\n' },
      { path: '/p/a/src/main/java/com/x/AlsoEmpty.java', text: 'package com.x;\n\nimport com.y.Thing;\n' },
      { path: '/p/a/src/main/java/com/x/Alive.kt', text: 'package com.x\n\nclass Alive\n' },
    ];
    const found = mod.findEmptySourceFiles({ sources: files });
    expect(found.map((f: any) => f.path)).toEqual([files[1].path, files[0].path]);
    expect(found[1].lines).toBe(8);
  });

  it('un typealias, une constante ou un @file:JvmName suivi de code gardent le fichier', () => {
    const files = [
      { path: '/p/a/src/main/java/com/x/Alias.kt', text: 'package com.x\n\ntypealias Id = String\n' },
      { path: '/p/a/src/main/java/com/x/Const.kt', text: 'package com.x\n\ninternal const val FLAG = false\n' },
      { path: '/p/a/src/main/java/com/x/Named.kt', text: '@file:JvmName("Util")\npackage com.x\n\nfun util() = 1\n' },
    ];
    expect(mod.findEmptySourceFiles({ sources: files })).toEqual([]);
  });

  it('une chaine ou un commentaire qui ressemble a du code ne compte pas, et un vrai code dans le commentaire non plus', () => {
    // Le contenu blanchi decide : `// class Ghost` n est pas une classe.
    const files = [{ path: '/p/a/src/main/java/com/x/Ghost.kt', text: 'package com.x\n// class Ghost {\n//   fun x() = 1\n// }\n' }];
    expect(mod.findEmptySourceFiles({ sources: files }).map((f: any) => f.path)).toEqual([files[0].path]);
  });

  it('package-info.java, module-info.java et les scripts .kts sont exclus', () => {
    const files = [
      { path: '/p/a/src/main/java/com/x/package-info.java', text: '@ParametersAreNonnullByDefault\npackage com.x;\n' },
      { path: '/p/a/src/main/java/module-info.java', text: 'module com.x {\n}\n' },
      { path: '/p/a/build.gradle.kts', text: '\n' },
    ];
    expect(mod.findEmptySourceFiles({ sources: files })).toEqual([]);
  });

  it('un corpus tronque ne prouve rien', () => {
    const files = [{ path: '/p/a/src/main/java/com/x/Empty.kt', text: 'package com.x\n' }];
    expect(mod.findEmptySourceFiles({ sources: files, truncated: true })).toEqual([]);
  });

  it('le resume compte ce qu il y a, et rien quand il n y a rien', () => {
    expect(mod.emptySourceSummary([])).toBe('No empty source file: every file declares something.');
    expect(mod.emptySourceSummary([{ path: 'a' }])).toBe('1 source file declaring nothing.');
  });
});
