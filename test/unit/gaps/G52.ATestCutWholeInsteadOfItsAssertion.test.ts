import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G52, un test coupe entier au lieu de son assertion.
 *
 * Sur le projet de reference, v1.43.0 supprimait `ListAggregatorV4DOTest.java` entier pour
 * la seule ligne `Assert.assertEquals(ListAggregatorV4DO.TYPE_LIST, ...)` ;
 * le reste du fichier verifiait du parsing vivant. Meme chose pour
 * `LayoutMetadataHelperTest` et `AppConstTest`.
 *
 * Deux defauts dans `testCoRemovalClosure.ts` :
 *   1. la coupe d assertion n etait tentee que si une AUTRE fonction du
 *      fichier ne nommait rien de ce qui part ; un fichier a un seul @Test
 *      partait donc entier ;
 *   2. `Assert.assertEquals(...)` n etait pas reconnu comme une assertion,
 *      le sujet lu etait `Assert`.
 *
 * Regle voulue : la fonction ne part que s il ne lui reste aucune assertion
 * sur du vivant, le fichier que si toutes ses fonctions partent.
 */

const mod: any = await importOrNull('src/providers/testCoRemovalClosure');

const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

const FOO_PATH = 'app/src/main/java/p/Foo.java';
const FOO_TEXT = [
  'package p;',
  '',
  'public class Foo {',
  '\tpublic static final String DEAD = "list";',
  '',
  '\tpublic String type;',
  '}',
  '',
].join('\n');
const DEAD_START = FOO_TEXT.indexOf('\tpublic static final String DEAD');
const DEAD_EXTENT = { path: FOO_PATH, start: DEAD_START, end: FOO_TEXT.indexOf('\n', DEAD_START) + 1 };

function fooTest(style: 'qualified' | 'static', body: string[]): { path: string; text: string } {
  const imports = style === 'qualified'
    ? ['import org.junit.Assert;']
    : ['import static org.junit.Assert.assertEquals;', 'import static org.junit.Assert.assertNotNull;'];
  return {
    path: 'app/src/test/java/p/FooTest.java',
    text: [
      'package p;',
      '',
      ...imports,
      'import org.junit.Test;',
      '',
      'public class FooTest {',
      '',
      '\t@Test',
      '\tpublic void parses() {',
      ...body.map(l => `\t\t${l}`),
      '\t}',
      '}',
      '',
    ].join('\n'),
  };
}

const planFoo = (test: { path: string; text: string }) =>
  mod.planClosure(['DEAD'], [{ path: FOO_PATH, text: FOO_TEXT }, test], SEGS, [DEAD_EXTENT]);

/** The text each cut removes in `path`, one entry per cut. */
const cutTexts = (plan: any, test: { path: string; text: string }) =>
  plan.cuts.filter((c: any) => c.path === test.path).map((c: any) => test.text.slice(c.start, c.end));

describe.skipIf(!mod)('G52, un seul @Test qui verifie aussi du vivant', () => {
  it('Assert.assertEquals qualifie : une ligne part, pas le fichier', () => {
    const test = fooTest('qualified', [
      'Foo foo = new Foo();',
      'Assert.assertNotNull(foo);',
      'Assert.assertEquals(Foo.DEAD, foo.type);',
      'Assert.assertEquals("x", foo.type);',
    ]);
    const plan = planFoo(test);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).not.toContain(test.path);
    expect(cutTexts(plan, test)).toEqual(['\t\tAssert.assertEquals(Foo.DEAD, foo.type);\n']);
  });

  it('assertEquals en import statique : une ligne part, pas le fichier', () => {
    const test = fooTest('static', [
      'Foo foo = new Foo();',
      'assertNotNull(foo);',
      'assertEquals(Foo.DEAD, foo.type);',
      'assertEquals("x", foo.type);',
    ]);
    const plan = planFoo(test);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).not.toContain(test.path);
    expect(cutTexts(plan, test)).toEqual(['\t\tassertEquals(Foo.DEAD, foo.type);\n']);
  });
});

describe.skipIf(!mod)('G52, gardes', () => {
  it('toutes les assertions nomment ce qui part : le fichier part entier', () => {
    const test = fooTest('qualified', [
      'Assert.assertEquals("list", Foo.DEAD);',
      'Assert.assertNotNull(Foo.DEAD);',
    ]);
    const plan = planFoo(test);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).toEqual([test.path]);
    expect(cutTexts(plan, test)).toEqual([]);
  });

  it('forme ViewUtilsTest : les deux tests du mort partent, le test du vivant et le fichier restent', () => {
    const utilsPath = 'app/src/main/java/p/ViewUtils.java';
    const utilsText = [
      'package p;',
      '',
      'public class ViewUtils {',
      '\tpublic static int dpToPx(int dp) {',
      '\t\treturn dp * 2;',
      '\t}',
      '',
      '\tpublic static boolean isPointInsideBounds(int x, int w) {',
      '\t\treturn x >= 0 && x < w;',
      '\t}',
      '}',
      '',
    ].join('\n');
    const start = utilsText.indexOf('\tpublic static int dpToPx');
    const extent = { path: utilsPath, start, end: utilsText.indexOf('\n\n', start) + 1 };
    const test = {
      path: 'app/src/test/java/p/ViewUtilsTest.java',
      text: [
        'package p;',
        '',
        'import org.junit.Assert;',
        'import org.junit.Test;',
        '',
        'public class ViewUtilsTest {',
        '',
        '\t@Test',
        '\tpublic void testDpToPx() {',
        '\t\tAssert.assertEquals(2, ViewUtils.dpToPx(1));',
        '\t}',
        '',
        '\t@Test',
        '\tpublic void testDpToPxZero() {',
        '\t\tAssert.assertEquals(0, ViewUtils.dpToPx(0));',
        '\t}',
        '',
        '\t@Test',
        '\tpublic void testIsPointInsideBound() {',
        '\t\tAssert.assertTrue(ViewUtils.isPointInsideBounds(1, 4));',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    const plan = mod.planClosure(['dpToPx'], [{ path: utilsPath, text: utilsText }, test], SEGS, [extent]);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).not.toContain(test.path);
    const cuts = plan.cuts.filter((c: any) => c.path === test.path);
    expect(cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'testDpToPx'], ['function', 'testDpToPxZero']]);
    expect(test.text.slice(cuts[0].start, cuts[1].end)).not.toContain('isPointInsideBounds');
  });
});
