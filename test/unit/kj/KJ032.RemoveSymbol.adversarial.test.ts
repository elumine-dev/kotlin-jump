import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-032 — le plan de suppression, isolément.
 *
 * Trois choses peuvent casser la compilation ici, et chacune a ses cas :
 *   1. une étendue trop large ou trop courte,
 *   2. un import laissé derrière dans un AUTRE fichier,
 *   3. un fichier vidé de tout sauf son package et ses imports.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const TEST_SETS = ['test/kotlin'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const kt = (path: string, text: string) => ({ path, text });
const find = (sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: TEST_SETS });
const only = (sources: { path: string; text: string }[], name: string) =>
  find(sources).find((f: any) => f.name === name);

/** Applique l'étendue comme le ferait le quick fix. */
function removed(text: string, f: any): string {
  const { start, end } = mod.wholeLineExtent(text, f.removeStart, f.removeEnd);
  return text.slice(0, start) + text.slice(end);
}

describe.skipIf(!mod)('étendue de la déclaration', () => {
  it('une classe avec corps part en entier', () => {
    const text = 'package com.x\n\nclass Ghost {\n  fun a() = 1\n}\n\nclass Kept\n';
    const sources = [kt(`${MAIN}/A.kt`, text), kt(`${MAIN}/B.kt`, 'package com.x\n\nval k = Kept()\n')];
    const f = only(sources, 'Ghost');
    expect(f.removeStart).toBeGreaterThanOrEqual(0);
    const out = removed(text, f);
    expect(out).not.toContain('class Ghost');
    expect(out).not.toContain('fun a()');
    expect(out).toContain('class Kept');
  });

  it('le KDoc et les annotations au-dessus sont absorbés', () => {
    const text = [
      'package com.x',
      '',
      '/** Doc for the ghost. */',
      '@Composable',
      'fun GhostScreen() {',
      '  render()',
      '}',
      '',
    ].join('\n');
    const f = only([kt(`${MAIN}/G.kt`, text)], 'GhostScreen');
    const out = removed(text, f);
    expect(out).not.toContain('Doc for the ghost');
    expect(out).not.toContain('@Composable');
    expect(out).not.toContain('GhostScreen');
  });

  it('une fonction à corps-expression sur une ligne', () => {
    const text = 'package com.x\n\nfun ghostly() = 42\n\nfun kept() = 1\n';
    const sources = [kt(`${MAIN}/E.kt`, text), kt(`${MAIN}/U.kt`, 'package com.x\n\nval u = kept()\n')];
    const f = only(sources, 'ghostly');
    expect(removed(text, f)).not.toContain('ghostly');
  });

  it('un initialiseur multiligne rend l’étendue incertaine, donc pas de fix', () => {
    const text = 'package com.x\n\nval ghostly = listOf(\n  1,\n  2,\n)\n';
    const f = only([kt(`${MAIN}/M.kt`, text)], 'ghostly');
    expect(f).toBeDefined();
    // signalé, mais sans suppression automatique : l'étendue n'est pas sûre
    expect(f.removeStart).toBe(-1);
  });

  it('deux morts dans un fichier se planifient de la fin vers le début', () => {
    const text = 'package com.x\n\nclass GhostA\n\nclass GhostB\n';
    const found = find([kt(`${MAIN}/T.kt`, text)]).filter((f: any) => f.removeStart !== -1);
    expect(found).toHaveLength(2);
    const plan = [...found].sort((a: any, b: any) => b.removeStart - a.removeStart);
    let out = text;
    for (const f of plan) {
      const { start, end } = mod.wholeLineExtent(out, f.removeStart, f.removeEnd);
      out = out.slice(0, start) + out.slice(end);
    }
    expect(out.trim()).toBe('package com.x');
  });
});

describe.skipIf(!mod)('imports orphelins dans les autres fichiers', () => {
  it('un import qui ne sert qu’à la déclaration morte est signalé', () => {
    const sources = [
      kt(`${MAIN}/Ghost.kt`, 'package com.x\n\nclass Ghost\n'),
      kt('/w/app/src/main/kotlin/com/y/Stale.kt',
        'package com.y\n\nimport com.x.Ghost\n\nfun other() = 1\n'),
    ];
    const f = only(sources, 'Ghost');
    expect(f.staleImports).toHaveLength(1);
    expect(f.staleImports[0].path).toContain('Stale.kt');
    expect(f.staleImports[0].line).toBe(2);
  });

  it('sans import orphelin, la liste est vide', () => {
    expect(only([kt(`${MAIN}/G.kt`, 'package com.x\n\nclass Ghost\n')], 'Ghost').staleImports).toEqual([]);
  });

  it('plusieurs fichiers portant un import orphelin sont tous listés', () => {
    const sources = [
      kt(`${MAIN}/Ghost.kt`, 'package com.x\n\nclass Ghost\n'),
      kt('/w/app/src/main/kotlin/com/y/A.kt', 'package com.y\n\nimport com.x.Ghost\n\nfun a() = 1\n'),
      kt('/w/app/src/main/kotlin/com/z/B.kt', 'package com.z\n\nimport com.x.Ghost\n\nfun b() = 2\n'),
    ];
    expect(only(sources, 'Ghost').staleImports).toHaveLength(2);
  });

  it('un import réellement utilisé ne rend pas la déclaration morte, donc rien à lister', () => {
    const sources = [
      kt(`${MAIN}/Ghost.kt`, 'package com.x\n\nclass Ghost\n'),
      kt('/w/app/src/main/kotlin/com/y/U.kt', 'package com.y\n\nimport com.x.Ghost\n\nval g = Ghost()\n'),
    ];
    expect(only(sources, 'Ghost')).toBeUndefined();
  });
});

describe.skipIf(!mod)('fichier vidé', () => {
  it('un fichier ne contenant que la déclaration morte doit être supprimé', () => {
    const f = only([kt(`${MAIN}/Solo.kt`, 'package com.x\n\nimport java.util.Date\n\nclass Ghost\n')], 'Ghost');
    expect(f.fileBecomesEmpty).toBe(true);
  });

  it('un fichier gardant une déclaration vivante ne l’est pas', () => {
    const sources = [
      kt(`${MAIN}/Two.kt`, 'package com.x\n\nclass Ghost\n\nclass Kept\n'),
      kt(`${MAIN}/U.kt`, 'package com.x\n\nval k = Kept()\n'),
    ];
    expect(only(sources, 'Ghost').fileBecomesEmpty).toBe(false);
  });

  it('des commentaires résiduels ne comptent pas comme du contenu', () => {
    const text = 'package com.x\n\n// just a note\n\nclass Ghost\n';
    expect(only([kt(`${MAIN}/C.kt`, text)], 'Ghost').fileBecomesEmpty).toBe(true);
  });

  it('deux morts dans un fichier qui n’a qu’eux : le fichier part', () => {
    const found = find([kt(`${MAIN}/Both.kt`, 'package com.x\n\nclass GhostA\n\nclass GhostB\n')]);
    expect(found).toHaveLength(2);
    expect(found.every((f: any) => f.fileBecomesEmpty)).toBe(true);
  });
});
