import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-053 — le planificateur de FERMETURE derriere « Remove Code Used Only by
 * Tests: Unproven Groups, Review Each ».
 *
 * KJ-047 retient tout plan qu'il ne sait pas placer. Ce planificateur repond a
 * une autre question : si le lecteur accepte le groupe, l'espace de travail
 * compile-t-il encore ? Il construit l'edition, l'applique EN MEMOIRE, et
 * rescanne chaque source survivante pour chaque nom retire. Une mention qui
 * survit retient le groupe, avec le fichier qui la porte.
 *
 * Les quatre formes ci-dessous ont ete mesurees sur le projet de reference.
 * Sous KJ-047 seul, les trois premieres cassaient la compilation (15 erreurs)
 * ou supprimaient sept tests la ou la branche ecrite a la main en retirait un.
 */

const mod: any = await importOrNull('src/providers/testCoRemovalClosure');

const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

const PROD_PATH = 'app/src/main/java/com/x/Resize.kt';
const PROD_TEXT = 'package com.x\n\nclass Resize {\n    fun go(a: Int) = a * 2\n}\n';
/** The cut the caller makes: the whole class. */
const PROD_EXTENT = { path: PROD_PATH, start: PROD_TEXT.indexOf('class'), end: PROD_TEXT.length };

const closure = (names: string[], sources: { path: string; text: string }[], extents = [PROD_EXTENT]) =>
  mod.planClosure(names, sources, SEGS, extents);

describe.skipIf(!mod)('planClosure', () => {
  it('un type porte par un champ et un @Before, sans fonction @Test qui le nomme : le fichier part entier', () => {
    // La forme ResizePhotoUseCaseTest : KJ-047 le retenait (mention hors de
    // toute fonction de test), et un plan qui retirait la classe sans ce
    // fichier laissait quatre « Unresolved reference ».
    const test = {
      path: 'app/src/test/java/com/x/ResizeTest.kt',
      text: [
        'package com.x',
        '',
        'import kotlin.test.BeforeTest',
        'import kotlin.test.Test',
        'import kotlin.test.assertEquals',
        '',
        'class ResizeTest {',
        '    private lateinit var resize: Resize',
        '',
        '    @BeforeTest',
        '    fun setup() { resize = Resize() }',
        '',
        '    @Test',
        '    fun doubles() { assertEquals(4, resize.go(2)) }',
        '',
        '    @Test',
        '    fun zero() { assertEquals(0, resize.go(0)) }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, test]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([test.path]);
    expect(plan.cuts).toEqual([]);
  });

  it('un champ dans une classe de base que d autres tests etendent : retenu, avec le fichier qui l etend', () => {
    // La forme AssemblerBaseTest : prendre le fichier entier orphelinerait les
    // sous-classes, et le couper laisserait la mention.
    const base = {
      path: 'app/src/test/java/com/x/BaseTest.kt',
      text: [
        'package com.x',
        '',
        'abstract class BaseTest {',
        '    internal lateinit var resize: Resize',
        '    fun ready() = resize.go(1)',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: [
        'package com.x',
        '',
        'import kotlin.test.Test',
        '',
        'class OtherTest : BaseTest() {',
        '    @Test',
        '    fun other() { ready() }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, base, sub]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.withheld).toContain('BaseTest');
    expect(plan.withheld).toContain(sub.path);
  });

  it('une mention dans une aide d une classe imbriquee : l aide part, puis le seul test qui l appelle, pas le fichier', () => {
    // La forme BaseLoginViewModelPopupModelTest : sept tests, un seul
    // concerne. Le premier jet prenait le fichier entier.
    const test = {
      path: 'app/src/test/java/com/x/ViewModelTest.kt',
      text: [
        'package com.x',
        '',
        'import kotlin.test.Test',
        '',
        'class ViewModelTest {',
        '    private class Fake {',
        '        fun emitResize() { Resize().go(3) }',
        '        fun emitOther() = 1',
        '    }',
        '',
        '    @Test',
        '    fun resizes() { Fake().emitResize() }',
        '',
        '    @Test',
        '    fun others() { Fake().emitOther() }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, test]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    const names = plan.cuts.map((c: any) => c.name).sort();
    expect(names).toEqual(['emitResize', 'resizes']);
  });

  it('un @Before qui nomme le type engage le fichier entier, jamais une coupe isolee', () => {
    // Mesure sur le projet de reference : `ServerModelDOTest` a perdu son
    // `@Before setUp()` et ses tests survivants ont leve NullPointerException
    // a la ligne 43. Une methode de cycle de vie n'a pas d'appelant textuel a
    // couper avec elle ; le fichier est l'unite.
    const test = {
      path: 'app/src/test/java/com/x/LifecycleTest.kt',
      text: [
        'package com.x',
        '',
        'import org.junit.Before',
        'import org.junit.Test',
        '',
        'class LifecycleTest {',
        '    private var r: Resize? = null',
        '',
        '    @Before',
        '    fun setUp() { r = Resize() }',
        '',
        '    @Test',
        '    fun uses() { r!!.go(1) }',
        '',
        '    @Test',
        '    fun unrelated() { }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, test]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([test.path]);
    expect(plan.cuts).toEqual([]);
  });

  it('une propriete de premier niveau dans un jeu de sources de test reconnu se coupe, et le plan ferme', () => {
    // `src/testFlavor/` est un jeu de sources de test pour isTestSourceSet :
    // la mention est placable, donc pas de retenue. Le temoin d'origine
    // supposait le contraire et avait tort.
    const elsewhere = {
      path: 'app/src/testFlavor/java/com/x/Elsewhere.kt',
      text: 'package com.x\n\nval keep = Resize()\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, elsewhere]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.cuts.map((c: any) => c.name)).toEqual(['keep']);
  });

  it('une mention dans une source principale, hors import, retient le groupe : le verdict etait faux', () => {
    const user = {
      path: 'app/src/main/java/com/x/Caller.kt',
      text: 'package com.x\n\nfun call() = Resize().go(1)\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, user]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.withheld).toContain('main source');
  });

  it('un import seul dans une source principale part avec la declaration', () => {
    const importer = {
      path: 'app/src/main/java/com/y/Importer.kt',
      text: 'package com.y\n\nimport com.x.Resize\n\nfun nothing() = 1\n',
    };
    const test = {
      path: 'app/src/test/java/com/x/ResizeTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass ResizeTest {\n    @Test\n    fun t() { Resize().go(1) }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, importer, test]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.cuts.some((c: any) => c.path === importer.path && c.kind === 'import')).toBe(true);
  });
});
