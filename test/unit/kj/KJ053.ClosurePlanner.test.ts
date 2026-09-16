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

const LIVE = { path: 'app/src/main/java/com/x/Live.kt', text: 'package com.x\n\nclass Live {\n    fun ping() = 1\n}\n' };
/** `Live` is used by main code, so it is not dead with any island. */
const LIVE_USER = { path: 'app/src/main/java/com/x/UsesLive.kt', text: 'package com.x\n\nfun boot() = Live().ping()\n' };
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
    // The subclass tests something LIVE too, like the eleven assembler tests
    // under AssemblerBaseTest: it is not dedicated to the island.
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: [
        'package com.x',
        '',
        'import kotlin.test.Test',
        '',
        'class OtherTest : BaseTest() {',
        '    @Test',
        '    fun other() { ready(); Live().ping() }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, base, sub]);
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

  it('un champ d une classe de base partagee, utilise seulement par des instructions isolees : le champ et ces lignes partent, la base reste', () => {
    // La forme AssemblerBaseTest mesuree au niveau du MEMBRE : le champ
    // `htmlFormatterHelper` et une ligne dans un @Before, jamais nommes par
    // les onze sous-classes. Le fichier partage reste, ses sous-classes aussi.
    const base = {
      path: 'app/src/test/java/com/x/BaseTest.kt',
      text: [
        'package com.x',
        '',
        'import org.junit.Before',
        '',
        'abstract class BaseTest {',
        '    internal lateinit var resize: Resize',
        '    internal var other = 1',
        '',
        '    @Before',
        '    fun setUp() {',
        '        resize = Resize()',
        '        other = 2',
        '    }',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass OtherTest : BaseTest() {\n    @Test\n    fun other() { check(other == 2) }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, base, sub]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    const cuts = plan.cuts.filter((c: any) => c.path === base.path).map((c: any) => base.text.slice(c.start, c.end).trim());
    expect(cuts).toEqual(['internal lateinit var resize: Resize', 'resize = Resize()']);
  });

  it('un champ partage dont un usage n est pas une instruction isolee : rien n est coupe, le groupe est retenu', () => {
    const base = {
      path: 'app/src/test/java/com/x/BaseTest.kt',
      text: [
        'package com.x',
        '',
        'abstract class BaseTest {',
        '    internal lateinit var resize: Resize',
        '    fun ready() = if (true) resize.go(1) else 0',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass OtherTest : BaseTest() {\n    @Test\n    fun other() { ready(); Live().ping() }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, base, sub]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.cuts.filter((c: any) => c.path === base.path)).toEqual([]);
  });

  it('un double de test et le test qui l utilise forment un ilot a cheval sur la frontiere : les trois partent ensemble', () => {
    // La forme GridGameTimer : `GridGameTimer4Test extends GridGameTimer`,
    // `GridGameTimerTest` n utilise que le double, et rien d autre ne nomme
    // aucun des trois. Un ilot de code mort dont deux membres sont des tests.
    const double = {
      path: 'app/src/test/java/com/x/ResizeDouble.kt',
      text: 'package com.x\n\nclass ResizeDouble : Resize() {\n    fun peek() = 1\n}\n',
    };
    const test = {
      path: 'app/src/test/java/com/x/ResizeDoubleTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass ResizeDoubleTest {\n    private val d = ResizeDouble()\n    @Test\n    fun peeks() { d.peek() }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, double, test]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files.sort()).toEqual([double.path, test.path].sort());
  });

  it('un ilot dont un membre est nomme par une source principale n en est pas un : retenu', () => {
    const double = {
      path: 'app/src/test/java/com/x/ResizeDouble.kt',
      text: 'package com.x\n\nclass ResizeDouble : Resize()\n',
    };
    const mainUser = {
      path: 'app/src/main/java/com/x/Uses.kt',
      text: 'package com.x\n\nval d = ResizeDouble()\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, double, mainUser]);
    expect(mod.isClosed(plan)).toBe(false);
  });

  it('un homonyme importe d un autre paquet, ou imbrique en production, ne retient pas l ilot', () => {
    // La forme GridGameTimerTest : il nomme `View` (android.view.View) et
    // la production declare un `View` IMBRIQUE dans NavigatorContract. Un
    // nom simple, deux types. L ilot {double, test, regles} doit fermer.
    const contract = {
      path: 'app/src/main/java/com/x/NavigatorContract.kt',
      text: 'package com.x\n\ninterface NavigatorContract {\n    interface View { fun show() }\n}\n',
    };
    const contractUser = {
      path: 'app/src/main/java/com/x/Navigator.kt',
      text: 'package com.x\n\nclass Navigator(val v: NavigatorContract.View)\n',
    };
    const double = {
      path: 'app/src/test/java/com/x/ResizeDouble.kt',
      text: 'package com.x\n\nclass ResizeDouble : Resize()\n',
    };
    const rules = {
      path: 'app/src/test/java/com/x/ResizeRules.kt',
      text: 'package com.x\n\nobject ResizeRules { const val START = 1 }\n',
    };
    const test = {
      path: 'app/src/test/java/com/x/ResizeDoubleTest.kt',
      text: [
        'package com.x',
        '',
        'import android.view.View',
        'import kotlin.test.Test',
        '',
        'class ResizeDoubleTest {',
        '    private val d = ResizeDouble()',
        '    private var view: View? = null',
        '    @Test',
        '    fun starts() { check(ResizeRules.START == 1); d.go(1) }',
        '}',
        '',
      ].join('\n'),
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, contract, contractUser, double, rules, test]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files.sort()).toEqual([double.path, rules.path, test.path].sort());
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

  it('la forme AssemblerBaseTest : un mock partage, un @Before sur trois lignes, et le fichier reste', () => {
    // Le cas mesure qui retenait HtmlFormatterHelper. Le fichier est etendu
    // par vingt-six classes, et AUCUNE ne nomme `htmlFormatterHelper` : le
    // champ est une surface privee dans un fichier partage. L'usage tient sur
    // trois lignes, la mention est sur la DERNIERE.
    const base = {
      path: 'app/src/test/java/com/x/AssemblerBaseTest.kt',
      text: [
        'package com.x',
        '',
        'abstract class AssemblerBaseTest {',
        '    @Mock',
        '    internal lateinit var resize: Resize',
        '',
        '    @Mock',
        '    internal lateinit var dateParseDelegate: DateParseDelegate',
        '',
        '    @Before',
        '    open fun setup() {',
        '        MockitoAnnotations.openMocks(this)',
        '',
        '        doAnswer {',
        '            it.arguments[0]',
        '        }.whenever(resize).go(any())',
        '',
        '        whenever(dateParseDelegate.parseDate(any())).thenReturn(null)',
        '    }',
        '',
        '    fun ready() = dateParseDelegate.parseDate("x")',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass OtherTest : AssemblerBaseTest() {\n    @Test\n    fun other() { ready(); Live().ping() }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, base, sub]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    const cuts = plan.cuts.filter((c: any) => c.path === base.path).map((c: any) => base.text.slice(c.start, c.end).trim());
    expect(cuts).toEqual([
      '@Mock\n    internal lateinit var resize: Resize',
      'doAnswer {\n            it.arguments[0]\n        }.whenever(resize).go(any())',
    ]);
    // Ce que le @Before fait d'autre reste : le framework l'execute encore.
    expect(cuts.join('')).not.toContain('openMocks');
    expect(cuts.join('')).not.toContain('dateParseDelegate');
  });

  it('une mention dans un initialiseur static : l instruction part, pas le fichier', () => {
    // La forme MockAnalyticsDataUtils : les mocks vivent dans un `static { }`,
    // qu aucun analyseur ne rapporte comme declaration. Le fichier entier
    // etait donc la seule reponse disponible, et il est partage.
    const util = {
      path: 'app/src/test/java/com/x/MockData.java',
      text: [
        'package com.x;',
        '',
        'final class MockData {',
        '',
        '\tstatic String NAME = "n";',
        '',
        '\tstatic Resize RESIZE;',
        '',
        '\tstatic {',
        '\t\tRESIZE = Mockito.mock(Resize.class);',
        '\t\twhen(RESIZE.go(1)).thenReturn(2);',
        '\t}',
        '}',
        '',
      ].join('\n'),
    };
    const user = {
      path: 'app/src/test/java/com/x/UserTest.java',
      text: 'package com.x;\n\npublic class UserTest {\n\t@Test\n\tpublic void t() { assertEquals("n", MockData.NAME); new Live().ping(); }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, util, user]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    const cuts = plan.cuts.filter((c: any) => c.path === util.path).map((c: any) => util.text.slice(c.start, c.end).trim());
    expect(cuts).toContain('static Resize RESIZE;');
    expect(cuts.join('\n')).toContain('RESIZE = Mockito.mock(Resize.class);');
    expect(cuts.join('\n')).toContain('when(RESIZE.go(1)).thenReturn(2);');
    // `NAME`, que l autre test lit, ne bouge pas.
    expect(cuts.join('\n')).not.toContain('NAME');
  });

  it('un @Before qui ne fait qu appeler une aide retiree : la ligne part, le fichier reste', () => {
    // La forme AbstractAnalyticsHelperTest : `setUpPageDataModelMocks()` est
    // appelee depuis le `@Before`, et le fichier est etendu par trois autres.
    const base = {
      path: 'app/src/test/java/com/x/AbstractHelperTest.java',
      text: [
        'package com.x;',
        '',
        'public abstract class AbstractHelperTest {',
        '',
        '\t@Before',
        '\tpublic void setup() throws Exception {',
        '\t\tMockitoAnnotations.openMocks(this);',
        '\t\tsetUpResizeMocks();',
        '\t\tonSetUp();',
        '\t}',
        '',
        '\tprotected void setUpResizeMocks() {',
        '\t\tResize resize = new Resize();',
        '\t\twhen(resize.go(1)).thenReturn(2);',
        '\t}',
        '',
        '\tprotected void onSetUp() { }',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/SubTest.java',
      text: 'package com.x;\n\npublic class SubTest extends AbstractHelperTest {\n\t@Test\n\tpublic void t() { onSetUp(); }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, base, sub]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    const cuts = plan.cuts.filter((c: any) => c.path === base.path).map((c: any) => base.text.slice(c.start, c.end).trim());
    expect(cuts.some((c: string) => c.startsWith('protected void setUpResizeMocks'))).toBe(true);
    expect(cuts).toContain('setUpResizeMocks();');
    // `onSetUp`, que la sous-classe appelle, et `openMocks` restent.
    expect(cuts.join('\n')).not.toContain('onSetUp');
    expect(cuts.join('\n')).not.toContain('openMocks');
  });

  it('une declaration dont un dependant n est pas une instruction isolee : rien ne part', () => {
    // La discipline qui borne tout le reste. `held` sort avec les lignes qui
    // le lisent quand ce sont des instructions ; ici la derniere est un
    // `return` dans une aide que la sous-classe appelle, et plus rien ne bouge.
    const base = {
      path: 'app/src/test/java/com/x/BaseTest.kt',
      text: [
        'package com.x',
        '',
        'abstract class BaseTest {',
        '    private val held = Resize()',
        '',
        '    fun ready(): Int {',
        '        return held.go(1) + 1',
        '    }',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass OtherTest : BaseTest() {\n    @Test\n    fun other() { check(ready() == 3); Live().ping() }\n}\n',
    };
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, base, sub]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.cuts.filter((c: any) => c.path === base.path)).toEqual([]);
  });
});
