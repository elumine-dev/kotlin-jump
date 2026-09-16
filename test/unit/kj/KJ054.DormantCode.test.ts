import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-054 — le code present et qui ne tourne jamais : tests @Ignore et blocs
 * de code commente.
 *
 * Aucun detecteur de code mort ne les voit, par construction : le runner
 * saute l'un, tous assainissent l'autre avant de lire. Sur le projet de
 * reference, un seul fichier de test portait 343 lignes commentees, plus que
 * n'importe quel rate des familles de suppression.
 *
 * Rapporte, jamais retire par Remove Everything Unused : un test a ete ignore
 * pour une raison, et un commentaire peut etre un exemple. La commande ouvre
 * la fenetre de relecture, toutes les cases decochees.
 */

const mod: any = await importOrNull('src/providers/dormantCode');

const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const scan = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  mod.findDormantCode({ sources, testSourceSets: SEGS, ...extra });

describe.skipIf(!mod)('findDormantCode', () => {
  it('un @Ignore avec raison sur une fonction : reporte avec la raison, etendue depuis l annotation', () => {
    const test = {
      path: 'app/src/test/java/com/x/ATest.kt',
      text: [
        'package com.x',
        '',
        'import org.junit.Ignore',
        'import org.junit.Test',
        '',
        'class ATest {',
        '    @Ignore("Flaky Test")',
        '    @Test',
        '    fun flaky() {',
        '        check(true)',
        '    }',
        '',
        '    @Test',
        '    fun solid() { check(true) }',
        '}',
        '',
      ].join('\n'),
    };
    const found = scan([test]);
    expect(found).toHaveLength(1);
    const f = found[0];
    expect(f.kind).toBe('ignoredTest');
    expect(f.name).toBe('flaky');
    expect(f.reason).toBe('Flaky Test');
    expect(f.line).toBe(6);
    expect(test.text.slice(f.removeStart, f.removeEnd)).toBe(
      '    @Ignore("Flaky Test")\n    @Test\n    fun flaky() {\n        check(true)\n    }\n');
  });

  it('un @Disabled sans raison sur une classe : reporte comme classe, sans raison', () => {
    const test = {
      path: 'app/src/test/java/com/x/BTest.kt',
      text: 'package com.x\n\nimport org.junit.jupiter.api.Disabled\n\n@Disabled\nclass BTest {\n    fun t() {}\n}\n',
    };
    const found = scan([test]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('ignoredClass');
    expect(found[0].name).toBe('BTest');
    expect(found[0].reason).toBeUndefined();
  });

  it('un @Ignore en source principale n est pas un test ignore', () => {
    const main = {
      path: 'app/src/main/java/com/x/A.kt',
      text: 'package com.x\n\n@Ignore\nfun helper() {}\n',
    };
    expect(scan([main])).toEqual([]);
  });

  it('un bloc de code commente en // : reporte avec son nombre de lignes et l etendue exacte', () => {
    // La forme FeedModelAssemblerTest : un builder Kotlin, des lignes
    // `kind = X,` sans mot-cle ni point-virgule. La ponctuation suffit.
    const src = {
      path: 'app/src/test/java/com/x/CTest.kt',
      text: [
        'package com.x',
        '',
        'class CTest {',
        '//    @Test',
        '//    fun assembles() {',
        '//        val dto = PhotoDO(',
        '//            kind = PHOTO,',
        '//            url = URL,',
        '//        )',
        '//        check(dto.kind == PHOTO)',
        '//    }',
        '    fun live() {}',
        '}',
        '',
      ].join('\n'),
    };
    const found = scan([src]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('commentedCode');
    expect(found[0].lines).toBe(8);
    expect(found[0].line).toBe(3);
    expect(src.text.slice(found[0].removeStart, found[0].removeEnd).split('\n').filter(Boolean)).toHaveLength(8);
  });

  it('un bloc de prose en // n est pas du code, meme long', () => {
    const src = {
      path: 'app/src/main/java/com/x/D.kt',
      text: [
        'package com.x',
        '',
        '// This class is the entry point of the module and the reason it exists',
        '// is that the old one was too slow to start on the first launch of the',
        '// day, which the users noticed and reported to support for a year.',
        '// The design is described in the wiki and the numbers are in the',
        '// benchmark folder next to this file, run them before changing this.',
        '// Ce qui suit est la version que tout le monde utilise.',
        'class D',
        '',
      ].join('\n'),
    };
    expect(scan([src])).toEqual([]);
  });

  it('un bloc /* */ de code est reporte, un KDoc /** ne l est jamais', () => {
    const src = {
      path: 'app/src/main/java/com/x/E.kt',
      text: [
        'package com.x',
        '',
        '/**',
        ' * The one documented function.',
        ' * val looks = like(code)',
        ' * but = this(is, kdoc)',
        ' * and(stays)',
        ' */',
        'fun documented() {}',
        '',
        '/*',
        'fun old() {',
        '    val x = compute(1)',
        '    return x + 1',
        '}',
        '*/',
        'fun current() {}',
        '',
      ].join('\n'),
    };
    const found = scan([src]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('commentedCode');
    expect(found[0].line).toBe(10);
    expect(found[0].lines).toBe(6);
  });

  it('sous le seuil de lignes, rien ; le seuil se regle', () => {
    const src = {
      path: 'app/src/main/java/com/x/F.kt',
      text: 'package com.x\n\n// val a = 1\n// val b = 2\n// val c = a + b\nfun f() {}\n',
    };
    expect(scan([src])).toEqual([]);
    expect(scan([src], { minCommentedLines: 3 })).toHaveLength(1);
  });

  it('les directives en // ne comptent pas comme du code commente', () => {
    const src = {
      path: 'app/src/main/java/com/x/G.kt',
      text: [
        'package com.x',
        '// region Setup',
        '// TODO(x) = fix(this)',
        '// noinspection unused',
        '// FIXME: foo(bar);',
        '// endregion',
        'fun g() {}',
        '',
      ].join('\n'),
    };
    expect(scan([src])).toEqual([]);
  });

  it('le resume compte ce qu il y a, et rien quand il n y a rien', () => {
    expect(mod.dormantSummary([])).toBe('Nothing dormant: no ignored test, no commented-out code.');
    const one = mod.dormantSummary([
      { kind: 'ignoredTest', lines: 3 },
      { kind: 'commentedCode', lines: 343 },
    ]);
    expect(one).toBe('Dormant: 1 ignored test, 1 commented-out block (343 lines).');
  });
});
