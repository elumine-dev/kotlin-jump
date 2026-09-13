import { describe, it, expect } from 'vitest';
import { planTestCoRemoval } from '../../../src/providers/testCoRemoval';

/**
 * Une ligne d'import ne se coupe qu'une fois.
 *
 * Le plan pousse une coupe par MENTION, pas par ligne. Un ilot mort dont deux
 * membres se nomment sur le meme import, `import com.x.Outer.Inner`, rendait
 * donc deux coupes de bornes IDENTIQUES. La cascade avait exactement ce defaut
 * et il y a ete corrige ; ici il survit parce que le seul appelant
 * dedoublonne a l'application, sur la cle `chemin:debut`.
 *
 * Un plan qui se contredit reste un plan faux : `cuts.length` est un nombre
 * dont le code raisonne, et la garde vit chez l'appelant, pas chez le
 * producteur. Aucun effet visible aujourd'hui.
 */

const MAIN = 'app/src/main/kotlin/com/x';
const TEST = 'app/src/test/kotlin/com/x';

const sources = [
  { path: `${MAIN}/Outer.kt`, text: 'package com.x\n\nobject Outer {\n    class Inner\n}\n' },
  { path: `${TEST}/OuterTest.kt`, text: [
    'package com.x',
    '',
    'import com.x.Outer.Inner',
    'import org.junit.Test',
    '',
    'class OuterTest {',
    '    @Test',
    '    fun mort() {',
    '        val i = Inner()',
    '        println(i)',
    '    }',
    '',
    '    @Test',
    '    fun vivant() {',
    '        println(1)',
    '    }',
    '}',
    '',
  ].join('\n') },
];

describe('planTestCoRemoval et les imports', () => {
  it('deux noms sur une meme ligne ne donnent qu une coupe', () => {
    const plan = planTestCoRemoval(['Outer', 'Inner'], sources, ['test/kotlin'], new Set<string>(), []);
    const imports = plan.cuts.filter(c => c.kind === 'import');
    expect(imports).toHaveLength(1);
    expect(imports[0].start).toBe(15);
  });

  it('aucune paire de coupes ne partage ses bornes', () => {
    const plan = planTestCoRemoval(['Outer', 'Inner'], sources, ['test/kotlin'], new Set<string>(), []);
    const cles = plan.cuts.map(c => `${c.path}:${c.start}:${c.end}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('temoin : la fonction de test morte est bien coupee', () => {
    const plan = planTestCoRemoval(['Outer', 'Inner'], sources, ['test/kotlin'], new Set<string>(), []);
    expect(plan.cuts.filter(c => c.kind === 'function').map(c => c.name)).toEqual(['mort']);
    expect(plan.files).toEqual([]);
  });

  it('temoin : deux imports sur deux lignes donnent bien deux coupes', () => {
    const deux = [
      sources[0],
      { path: `${MAIN}/Autre.kt`, text: 'package com.x\n\nclass Autre\n' },
      { path: `${TEST}/T2.kt`, text: [
        'package com.x',
        '',
        'import com.x.Outer',
        'import com.x.Autre',
        'import org.junit.Test',
        '',
        'class T2 {',
        '    @Test',
        '    fun mort() {',
        '        println(Outer)',
        '        println(Autre())',
        '    }',
        '',
        '    @Test',
        '    fun vivant() {',
        '        println(1)',
        '    }',
        '}',
        '',
      ].join('\n') },
    ];
    const plan = planTestCoRemoval(['Outer', 'Autre'], deux, ['test/kotlin'], new Set<string>(), []);
    expect(plan.cuts.filter(c => c.kind === 'import')).toHaveLength(2);
  });
});
