import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-065 — une fonction de test retiree laisse UNE ligne vide, pas deux.
 *
 * Les deux commandes de suppression grandissent deja leurs etendues pour ca
 * (`wholeLineExtent`, `sansTrouDeLignesVides`, tenues d accord par le temoin
 * BothPathsCutTheSame). Les coupes de tests du planificateur de fermeture ne
 * le faisaient pas : detekt, NoConsecutiveBlankLines, un constat par coupe.
 * Meme politique que la passe fusionnee : vide au dessus ET en dessous, une
 * seule part ; jamais en tete ni en fin de fichier, jamais collee au code.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const closure: any = await importOrNull('src/providers/testCoRemovalClosure');

const SEGS = ['test/java', 'test/kotlin'];
const PROD_PATH = 'app/src/main/java/com/x/Resize.kt';
const PROD_TEXT = 'package com.x\n\nclass Resize {\n    fun go(a: Int) = a * 2\n}\n';
const PROD_EXTENT = { path: PROD_PATH, start: PROD_TEXT.indexOf('class'), end: PROD_TEXT.length };
const applique = (text: string, cuts: { start: number; end: number }[]) => {
  let out = text;
  for (const c of [...cuts].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end);
  return out;
};

describe.skipIf(!mod || !closure)('une ligne vide la ou la coupe a eu lieu', () => {
  it('une fonction de test entre deux lignes vides : la coupe emporte celle du dessous', () => {
    const test = {
      path: 'app/src/test/java/com/x/ResizeTest.kt',
      text: [
        'package com.x', '',
        'import kotlin.test.Test', '',
        'class ResizeTest {',
        '    @Test',
        '    fun first() { check(1 == 1) }',
        '',
        '    @Test',
        '    fun doubles() { check(Resize().go(2) == 4) }',
        '',
        '    @Test',
        '    fun last() { check(2 == 2) }',
        '}', '',
      ].join('\n'),
    };
    const plan = closure.planClosure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, test], SEGS, [PROD_EXTENT]);
    expect(plan.withheld).toBeUndefined();
    const cuts = plan.cuts.filter((c: any) => c.path === test.path);
    expect(cuts.map((c: any) => c.name)).toEqual(['doubles']);
    expect(applique(test.text, cuts)).toBe([
      'package com.x', '',
      'import kotlin.test.Test', '',
      'class ResizeTest {',
      '    @Test',
      '    fun first() { check(1 == 1) }',
      '',
      '    @Test',
      '    fun last() { check(2 == 2) }',
      '}', '',
    ].join('\n'));
  });

  it('collee a la fonction suivante : la ligne vide du dessus reste', () => {
    const test = {
      path: 'app/src/test/java/com/x/ResizeTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass ResizeTest {\n    @Test\n    fun first() { check(1 == 1) }\n\n    @Test\n    fun doubles() { check(Resize().go(2) == 4) }\n    @Test\n    fun last() { check(2 == 2) }\n}\n',
    };
    const plan = closure.planClosure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, test], SEGS, [PROD_EXTENT]);
    const cuts = plan.cuts.filter((c: any) => c.path === test.path);
    expect(applique(test.text, cuts)).toBe('package com.x\n\nimport kotlin.test.Test\n\nclass ResizeTest {\n    @Test\n    fun first() { check(1 == 1) }\n\n    @Test\n    fun last() { check(2 == 2) }\n}\n');
  });

  it('le bornage brut : entre deux vides une seule part, en tete de fichier rien de plus', () => {
    const text = 'a\n\nb\n\nc\n';
    const e = mod.absorbOneBlankLine(text, 3, 5);
    expect(text.slice(0, e.start) + text.slice(e.end)).toBe('a\n\nc\n');
    const head = mod.absorbOneBlankLine(text, 0, 2);
    expect(text.slice(0, head.start) + text.slice(head.end)).toBe('\nb\n\nc\n');
  });
});
