import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
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

  it('le `when` de Mockito est un appel, le `when` de Kotlin est une branche', () => {
    // La collision qui comptait : `when(mock.get()).thenReturn(x)` est
    // l instruction la plus courante d un test Java, et `when (x) { … }` est
    // une branche Kotlin. Refuser le mot refusait toutes les stubbings, qui
    // sont exactement ce qui doit partir avec un mock. Ce qui les separe est
    // ce qui suit la parenthese.
    const base = {
      path: 'app/src/test/java/com/x/BaseTest.kt',
      text: [
        'package com.x',
        '',
        'abstract class BaseTest {',
        '    @Mock',
        '    lateinit var resize: Resize',
        '',
        '    @Before',
        '    fun setup() {',
        '        `when`(resize.go(1)).thenReturn(2)',
        '        when (mode) {',
        '            1 -> configure(resize)',
        '            else -> other()',
        '        }',
        '    }',
        '}',
        '',
      ].join('\n'),
    };
    const sub = {
      path: 'app/src/test/java/com/x/OtherTest.kt',
      text: 'package com.x\n\nimport kotlin.test.Test\n\nclass OtherTest : BaseTest() {\n    @Test\n    fun other() { Live().ping() }\n}\n',
    };
    // Le `when (mode) { … }` nomme `resize` dans une branche : le
    // planificateur refuse de couper, et retient le groupe plutot que de
    // laisser un `1 ->` sans corps.
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, base, sub]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.cuts.filter((c: any) => c.path === base.path)).toEqual([]);
  });

  it('une ligne de @Before qui alimente un objet SURVIVANT ne part jamais', () => {
    // Les deux echecs que le build a trouves, et que la compilation ne
    // trouvait pas. `ServerModelDOTest` a rendu un ComparisonFailure et
    // `EditionThumbnailServiceImplTest` un NullPointerException : le @Before
    // avait perdu une ligne qui configurait un objet que les tests utilisent
    // encore. La ligne nomme bien un membre qui part, mais son SUJET reste.
    const test = {
      path: 'app/src/test/java/com/x/FixtureTest.java',
      text: [
        'package com.x;',
        '',
        'public class FixtureTest {',
        '',
        '\tprivate HashMap<String, String> components;',
        '',
        '\t@Before',
        '\tpublic void setUp() {',
        '\t\tcomponents = new HashMap<>();',
        '\t\tcomponents.put("live", "a");',
        '\t\tcomponents.put(Resize.KEY, "b");',
        '\t}',
        '',
        '\t@Test',
        '\tpublic void testConstructor() { assertEquals(2, components.size()); }',
        '}',
        '',
      ].join('\n'),
    };
    // Le fichier est partage, comme `ServerModelDOTest` l est sur le projet
    // de reference, donc le prendre entier n est pas une option non plus.
    const sub = {
      path: 'app/src/test/java/com/x/SubFixtureTest.java',
      text: 'package com.x;\n\npublic class SubFixtureTest extends FixtureTest {\n\t@Test\n\tpublic void more() { new Live().ping(); }\n}\n',
    };
    // `Resize` part, la ligne qui le nomme alimente `components`, et
    // `testConstructor` compte les entrees. Retenir est la seule bonne
    // reponse : couper compilerait et ferait echouer le test.
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, LIVE, LIVE_USER, test, sub]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(plan.cuts.filter((c: any) => c.path === test.path)).toEqual([]);
    expect(plan.files).not.toContain(test.path);
  });

  it('le sujet de l instruction est ce qui decide, pas le fait qu elle nomme le partant', () => {
    const cut = {
      path: 'app/src/test/java/com/x/SubjectTest.java',
      text: 'package com.x;\n\npublic class SubjectTest {\n\t@Before\n\tpublic void setUp() {\n\t\tspec.setResize(new Resize());\n\t\tkept.ping();\n\t}\n\n\t@Test\n\tpublic void t() { kept.check(); }\n}\n',
    };
    // Sujet `spec`, qui survit : rien ne bouge, meme si la ligne construit
    // exactement ce qui part.
    const plan = closure(['Resize'], [{ path: PROD_PATH, text: PROD_TEXT }, cut]);
    expect(plan.cuts.filter((c: any) => c.path === cut.path)).toEqual([]);
  });
});

/**
 * La REECRITURE d un appel de setter, mesuree sur le projet de reference.
 *
 * `ThumbnailSpec.setOtherThumbnailToPrefetch` n est appele que d un @Before,
 * et la ligne alimente `thumbnailSpec`, que chaque test du fichier lit encore.
 * La couper compile et fait echouer les tests : le planificateur retient le
 * groupe, et cette retenue reste. La branche ecrite a la main n a ni coupe ni
 * garde la ligne : elle l a reecrite en `thumbnailSpec.otherThumbnailToPrefetch
 * = new ThumbnailSpec(…)` et a supprime le setter. `@JvmField var` expose la
 * propriete a Java comme un champ, donc l affectation fait exactement ce que
 * faisait l appel.
 */
const SPEC_PATH = 'app/src/main/java/com/x/Spec.kt';
/** La production : un setter d une affectation, la propriete dans le constructeur primaire. */
const specText = (o: { jvmField?: boolean; property?: string; body?: string[] } = {}) => {
  const property = o.property ?? 'other';
  return [
    'package com.x',
    '',
    'class Spec(',
    '    @JvmField val size: Int,',
    `    ${o.jvmField === false ? '' : '@JvmField '}var ${property}: Spec? = null`,
    ') {',
    '',
    '    fun setOther(spec: Spec?) {',
    ...(o.body ?? [`        ${property} = spec`]),
    '    }',
    '',
    `    fun hasOther(): Boolean = ${property} != null`,
    '}',
    '',
  ].join('\n');
};
/** La coupe que fait l appelant : le setter seul, comme pour tout groupe de membre. */
const setterExtent = (text: string) => {
  const start = text.indexOf('    fun setOther');
  return { path: SPEC_PATH, start, end: text.indexOf('}\n', start) + 2 };
};
const javaTest = (call: string[]) => ({
  path: 'app/src/test/java/com/x/SpecTest.java',
  text: [
    'package com.x;',
    '',
    'public class SpecTest {',
    '',
    '\tprivate Spec spec;',
    '',
    '\t@Before',
    '\tpublic void setUp() {',
    '\t\tspec = new Spec(500, null);',
    ...call,
    '\t}',
    '',
    '\t@Test',
    '\tpublic void keepsSize() { assertEquals(500, spec.size); }',
    '}',
    '',
  ].join('\n'),
});
/**
 * Partage, comme `EditionThumbnailServiceImplTest` que nomme un composant
 * Dagger : prendre le fichier entier n est pas une option, et la ligne du
 * @Before alimente `spec`, qui survit. Sans reecriture, le groupe est retenu.
 */
const javaSub = {
  path: 'app/src/test/java/com/x/SubSpecTest.java',
  text: 'package com.x;\n\npublic class SubSpecTest extends SpecTest {\n\t@Test\n\tpublic void more() { new Live().ping(); }\n}\n',
};
const kotlinTest = (body: string[]) => ({
  path: 'app/src/test/java/com/x/SpecTest.kt',
  text: [
    'package com.x',
    '',
    'import org.junit.Before',
    'import org.junit.Test',
    '',
    'class SpecTest {',
    '    private lateinit var spec: Spec',
    '',
    '    @Before',
    '    fun setUp() {',
    '        spec = Spec(500)',
    '    }',
    '',
    ...body,
    '',
    '    @Test',
    '    fun keepsSize() { check(spec.size == 500) }',
    '}',
    '',
  ].join('\n'),
});
const rewrites = (plan: any) => plan.cuts.filter((c: any) => c.kind === 'rewrite');

describe.skipIf(!mod)('planClosure : un appel de setter se reecrit en affectation', () => {
  it('un appelant Java, la propriete @JvmField : une coupe de reecriture, indentation et point-virgule gardes', () => {
    const prod = { path: SPEC_PATH, text: specText() };
    const ext = setterExtent(prod.text);
    // Le groupe est le setter, pas la classe : c est lui que la production perd.
    expect(prod.text.slice(ext.start, ext.end)).toBe('    fun setOther(spec: Spec?) {\n        other = spec\n    }\n');
    const test = javaTest(['\t\tspec.setOther(new Spec(100, null));']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test, javaSub], SEGS, [ext]);
    expect(plan.withheld).toBeUndefined();
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    expect(plan.cuts).toHaveLength(1);
    const cut = plan.cuts[0];
    expect(cut.kind).toBe('rewrite');
    expect(cut.name).toBe('setOther');
    expect(cut.path).toBe(test.path);
    expect(test.text.slice(cut.start, cut.end)).toBe('\t\tspec.setOther(new Spec(100, null));\n');
    expect(cut.replacement).toBe('\t\tspec.other = new Spec(100, null);\n');
  });

  it('un appelant Java, la propriete sans @JvmField : Java ne voit que des accesseurs, retenu sans reecriture', () => {
    // Le `@JvmField` de la ligne du dessus, celui de `size`, ne compte pas.
    const prod = { path: SPEC_PATH, text: specText({ jvmField: false, property: 'prefetch' }) };
    const test = javaTest(['\t\tspec.setOther(new Spec(100, null));']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test, javaSub], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(rewrites(plan)).toEqual([]);
    expect(plan.files).not.toContain(test.path);
  });

  it('un appelant Kotlin, un var public ordinaire : reecrit sans point-virgule', () => {
    const prod = { path: SPEC_PATH, text: specText({ jvmField: false, property: 'prefetch' }) };
    const test = kotlinTest([
      '    @Before',
      '    fun prefetch() {',
      '        spec.setOther(Spec(100))',
      '        check(spec.hasOther())',
      '    }',
    ]);
    const plan = mod.planClosure(['setOther'], [prod, test], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([]);
    expect(rewrites(plan).map((c: any) => c.replacement)).toEqual(['        spec.prefetch = Spec(100)\n']);
    expect(test.text.slice(plan.cuts[0].start, plan.cuts[0].end)).toBe('        spec.setOther(Spec(100))\n');
  });

  it('un setter qui fait plus que l affectation : pas de reecriture, retenu', () => {
    const prod = { path: SPEC_PATH, text: specText({ body: ['        other = spec', '        check(hasOther())'] }) };
    const test = javaTest(['\t\tspec.setOther(new Spec(100, null));']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test, javaSub], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(false);
    expect(rewrites(plan)).toEqual([]);
  });

  it('un argument sur plusieurs lignes est garde tel quel', () => {
    const prod = { path: SPEC_PATH, text: specText() };
    const test = javaTest([
      '\t\tspec.setOther(new Spec(',
      '\t\t\t\t100, null));',
    ]);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test, javaSub], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.cuts).toHaveLength(1);
    expect(test.text.slice(plan.cuts[0].start, plan.cuts[0].end)).toBe('\t\tspec.setOther(new Spec(\n\t\t\t\t100, null));\n');
    expect(plan.cuts[0].replacement).toBe('\t\tspec.other = new Spec(\n\t\t\t\t100, null);\n');
  });

  it('dans une fonction @Test aussi : la ligne se reecrit et le test reste', () => {
    // Rien ne change a l execution, donc la reecriture vaut partout ou
    // l instruction se trouve, et un test qui ne faisait que poser la
    // propriete continue de tourner.
    const prod = { path: SPEC_PATH, text: specText({ jvmField: false, property: 'prefetch' }) };
    const test = kotlinTest([
      '    @Test',
      '    fun prefetches() {',
      '        spec.setOther(Spec(100))',
      '        check(spec.hasOther())',
      '    }',
    ]);
    const plan = mod.planClosure(['setOther'], [prod, test], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.cutFunctions).toBe(0);
    expect(plan.cuts.map((c: any) => c.kind)).toEqual(['rewrite']);
  });

  it('une fonction @Test qui nomme aussi le setter autrement part entiere, sans reecriture dedans', () => {
    // Deux editions sur des plages imbriquees font une edition que VS Code
    // refuse : la coupe de la fonction absorbe la reecriture.
    const prod = { path: SPEC_PATH, text: specText({ jvmField: false, property: 'prefetch' }) };
    const test = kotlinTest([
      '    @Test',
      '    fun prefetches() {',
      '        spec.setOther(Spec(100))',
      '        verify(spec).setOther(any())',
      '    }',
    ]);
    const plan = mod.planClosure(['setOther'], [prod, test], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'prefetches']]);
  });
});

/**
 * Ce que la relecture adverse a refute sur la premiere version de la
 * reecriture : six formes fermaient et ne compilaient pas, deux editions se
 * chevauchaient. Chaque forme est reprise ici avec des noms neutres, et
 * chacune est le temoin de sa correction.
 */
const cmd: any = await importOrNull('src/commands/RemoveTestOnlyCode');
/** Une classe avec un var ordinaire, le setter d une affectation. */
const specWith = (property: string[], setter = ['    fun setOther(spec: Spec?) {', '        prefetch = spec', '    }']) => [
  'package com.x',
  '',
  'class Spec(@JvmField val size: Int) {',
  ...property,
  '',
  ...setter,
  '',
  '    fun hasOther(): Boolean = prefetch != null',
  '}',
  '',
].join('\n');
const kotlinTestFile = (path: string, body: string[], imports = ['import org.junit.Test']) => ({
  path,
  text: ['package com.x', '', ...imports, '', 'class SpecTest {', ...body, '}', ''].join('\n'),
});
const prefetchesTest = (call: string[]) => kotlinTestFile('app/src/test/java/com/x/SpecTest.kt', [
  '    @Test',
  '    fun prefetches() {',
  '        val spec = Spec(500)',
  ...call,
  '        check(spec.hasOther())',
  '    }',
]);

describe.skipIf(!mod)('planClosure : la reecriture refuse ce que la fermeture ne prouve pas', () => {
  it('l argument nomme une aide coupee dans un AUTRE fichier : refuse ou retenu, dans les deux ordres', () => {
    // `spec.setOther(primed())`, `primed` etant une aide de fixture que le
    // plan coupe dans Fixtures.kt. La premiere version fermait dans les deux
    // ordres et la ligne reecrite appelait encore `primed` : la verification
    // finale ne lisait que les noms locaux du fichier reecrit.
    const prod = { path: SPEC_PATH, text: specText() };
    const test = prefetchesTest(['        spec.setOther(primed())']);
    const fixtures = {
      path: 'app/src/test/java/com/x/Fixtures.kt',
      text: 'package com.x\n\nfun primed(): Spec = Spec(100).also { it.setOther(Spec(1)) }\n',
    };
    for (const order of [[test, fixtures], [fixtures, test]]) {
      const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, ...order], SEGS, [setterExtent(prod.text)]);
      const reecritSurPrimed = rewrites(plan).some((c: any) => /\bprimed\b/.test(c.replacement));
      expect(mod.isClosed(plan) && reecritSurPrimed).toBe(false);
    }
    // L aide rencontree APRES la reecriture : la verification finale retient.
    const tard = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test, fixtures], SEGS, [setterExtent(prod.text)]);
    expect(tard.withheld).toContain('primed still mentioned in the rewritten');
    // L aide deja coupee AVANT : la reecriture est refusee, le test part avec
    // sa fonction puis son fichier, comme avant la reecriture. Cela compile.
    const tot = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, fixtures, test], SEGS, [setterExtent(prod.text)]);
    expect(mod.isClosed(tot)).toBe(true);
    expect(rewrites(tot)).toEqual([]);
    expect(tot.files).toEqual([test.path]);
    expect(tot.cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'primed']]);
  });

  it('un `private set` sous un `get()` explicite : pas de reecriture a travers un setter prive', () => {
    // La premiere version ne lisait que la ligne sous la declaration ; un
    // `get() = field` y pousse le `private set` une ligne plus bas.
    const prod = { path: SPEC_PATH, text: specWith(['    var prefetch: Spec? = null', '        get() = field', '        private set']) };
    const test = kotlinTest(['    @Test', '    fun prefetches() {', '        spec.setOther(Spec(100))', '        check(spec.hasOther())', '    }']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [setterExtent(prod.text)]);
    expect(rewrites(plan)).toEqual([]);
    expect(plan.cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'prefetches']]);
  });

  it('un `get()` explicite sans `private set` reste reecrit : la lecture s arrete au membre suivant', () => {
    // Le garde-fou n est pas « tout `private set` de la classe » : celui de la
    // propriete SUIVANTE ne compte pas.
    const prod = { path: SPEC_PATH, text: specWith([
      '    var prefetch: Spec? = null',
      '        get() = field',
      '    var other: Spec? = null',
      '        private set',
    ]) };
    const test = kotlinTest(['    @Test', '    fun prefetches() {', '        spec.setOther(Spec(100))', '        check(spec.hasOther())', '    }']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [setterExtent(prod.text)]);
    expect(rewrites(plan).map((c: any) => c.replacement)).toEqual(['        spec.prefetch = Spec(100)\n']);
  });

  it('un argument nomme n est pas reecrit : `spec.other = spec = Spec(100)` n est pas du Kotlin', () => {
    const prod = { path: SPEC_PATH, text: specWith(['    var prefetch: Spec? = null']) };
    const test = prefetchesTest(['        spec.setOther(spec = Spec(100))']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [setterExtent(prod.text)]);
    expect(rewrites(plan)).toEqual([]);
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([test.path]);
  });

  it('l appel qui est le corps d une fonction a expression n est pas reecrit : une affectation n est pas une expression', () => {
    // `private fun prime() =` puis l appel sur la ligne du dessous : la ligne
    // au dessus finit par `=`, la valeur de l appel est prise.
    const prod = { path: SPEC_PATH, text: specWith(['    var prefetch: Spec? = null']) };
    const test = kotlinTestFile('app/src/test/java/com/x/SpecTest.kt', [
      '    private lateinit var spec: Spec',
      '',
      '    @Before',
      '    fun setUp() {',
      '        spec = Spec(500)',
      '        prime()',
      '    }',
      '',
      '    private fun prime() =',
      '        spec.setOther(Spec(100))',
      '',
      '    @Test',
      '    fun keepsSize() { check(spec.size == 500) }',
    ], ['import org.junit.Before', 'import org.junit.Test']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [setterExtent(prod.text)]);
    expect(rewrites(plan)).toEqual([]);
    // Sans reecriture, la mention retombe sur le chemin d avant : hors de
    // toute fonction de test, le fichier part entier, et cela compile.
    expect(mod.isClosed(plan)).toBe(true);
    expect(plan.files).toEqual([test.path]);
  });

  it('un appel dont la chaine continue sur la ligne du dessous n est pas reecrit', () => {
    const prod = { path: SPEC_PATH, text: specWith(['    var prefetch: Spec? = null']) };
    const test = kotlinTest(['    @Test', '    fun prefetches() {', '        spec.setOther(Spec(100))', '            .also { check(true) }', '    }']);
    const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [setterExtent(prod.text)]);
    expect(rewrites(plan)).toEqual([]);
    expect(plan.cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'prefetches']]);
  });

  it('un var internal est refuse d emblee : le module d un appelant ne se lit pas dans son chemin', () => {
    // Un depot extrait sous un dossier `src` : lu jusqu au premier `src/`,
    // chaque fichier etait du meme module, et lib/src/main se faisait ecrire
    // depuis app/src/test.
    const root = '/Users/me/src/proj';
    const prod = { path: `${root}/lib/src/main/java/com/x/Spec.kt`, text: specWith(['    internal var prefetch: Spec? = null']) };
    const live = { path: `${root}/lib/src/main/java/com/x/Live.kt`, text: LIVE.text };
    const liveUser = { path: `${root}/lib/src/main/java/com/x/UsesLive.kt`, text: LIVE_USER.text };
    const test = { ...prefetchesTest(['        spec.setOther(Spec(100))']), path: `${root}/app/src/test/java/com/x/SpecTest.kt` };
    const ext = { ...setterExtent(prod.text), path: prod.path };
    const plan = mod.planClosure(['setOther'], [prod, live, liveUser, test], SEGS, [ext]);
    expect(rewrites(plan)).toEqual([]);
    expect(plan.files).toEqual([test.path]);
  });

  it('un setter @Synchronized n est pas reecrit : l affectation ne prendrait pas le verrou', () => {
    const prod = { path: SPEC_PATH, text: specWith(['    @JvmField var prefetch: Spec? = null'], [
      '    @Synchronized',
      '    fun setOther(spec: Spec?) {',
      '        prefetch = spec',
      '    }',
    ]) };
    const test = kotlinTest(['    @Test', '    fun prefetches() {', '        spec.setOther(Spec(100))', '        check(spec.hasOther())', '    }']);
    // L etendue de l appelant commence a l annotation, ou a la ligne `fun`
    // seulement : les deux lisent l annotation.
    const depuisAnnotation = { path: SPEC_PATH, start: prod.text.indexOf('    @Synchronized'), end: setterExtent(prod.text).end };
    const depuisFun = setterExtent(prod.text);
    for (const ext of [depuisAnnotation, depuisFun]) {
      const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, [ext]);
      expect(rewrites(plan)).toEqual([]);
      expect(plan.cuts.map((c: any) => [c.kind, c.name])).toEqual([['function', 'prefetches']]);
    }
  });
});

/**
 * Deux corrections vivent dans la commande, pas dans le planificateur : ce
 * que `construire` fait des coupes de reecriture. Elles se voient seulement
 * en lancant la commande en mode non prouve et en lisant l edition envoyee.
 */
afterEach(() => vi.restoreAllMocks());
async function lanceNonProuve(sources: { path: string; text: string }[]) {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  const editions: any[] = [];
  (vscodeMock.workspace as any).applyEdit = async (e: any) => { editions.push(e); return true; };
  const messages: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string) => { messages.push(m); return undefined; }) as any);
  vi.spyOn(vscodeMock.window, 'showWarningMessage').mockImplementation((async (m: string) => { messages.push(m); return undefined; }) as any);
  // Le MEME objet a chaque lecture : la commande relit le corpus apres la
  // question et refait le scan, sans le mode non prouve, des que l identite change.
  const data = { sources, index: null, modulesWithCode: ['/w/app'], libraryModules: [], truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'] };
  const corpus: any = { get: async () => data, invalidate: () => {} };
  await cmd.removeTestOnlyCodeCommand(corpus, true);
  const e = editions[0];
  const entries: { path: string; from: number; to: number; text: string }[] = (e?._entries ?? [])
    .map((x: any) => ({ path: x.uri.fsPath, from: x.range.start.line, to: x.range.end.line, text: x.newText }));
  return { entries, deletes: (e?._fileDeletes ?? []).map((d: any) => d.uri.fsPath as string), messages: messages.join(' | ') };
}
/** Les editions d un meme fichier dont la plage est contenue dans une autre : VS Code refuse l edition entiere. */
const imbriquees = (entries: { path: string; from: number; to: number }[]) =>
  entries.filter((a, i) => entries.some((b, j) => i !== j && a.path === b.path && a.from >= b.from && a.to <= b.to));

const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };
const TEST_PATH = '/w/app/src/test/java/com/x/SpecTest.kt';

describe.skipIf(!mod || !cmd)('removeTestOnlyCodeCommand : ce que construire fait d une reecriture', () => {
  it('la cascade ne voit pas la reecriture : l import que l argument utilise encore reste', async () => {
    // `spec.setOther(Other())` reecrit en `spec.other = Other()` : notee comme
    // une suppression, la cascade trouvait `import com.y.Other` orphelin et
    // l enlevait sous une ligne qui l utilise toujours.
    const r = await lanceNonProuve([
      GRADLE,
      { path: '/w/app/src/main/java/com/x/Spec.kt', text: specText() },
      { path: '/w/app/src/main/java/com/y/Other.kt', text: 'package com.y\n\nimport com.x.Spec\n\nclass Other : Spec(1, null)\n' },
      { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nimport com.y.Other\n\nfun main() {\n    println(Other().hasOther() && Other().size > 0)\n}\n' },
      kotlinTestFile(TEST_PATH, [
        '    private lateinit var spec: Spec',
        '',
        '    @Before',
        '    fun setUp() {',
        '        spec = Spec(500, null)',
        '        spec.setOther(Other())',
        '    }',
        '',
        '    @Test',
        '    fun keepsSize() { check(spec.size == 500) }',
      ], ['import com.y.Other', 'import org.junit.Before', 'import org.junit.Test']),
    ]);
    expect(r.entries.filter(e => e.path === TEST_PATH).map(e => e.text)).toEqual(['        spec.other = Other()\n']);
    expect(r.deletes).toEqual([]);
    expect(r.messages).toContain('with 1 setter call rewritten as an assignment');
  });

  it('une reecriture dans une fonction qu un AUTRE groupe coupe entiere est absorbee : aucune plage imbriquee', async () => {
    // Deux groupes sur un meme test : `setA` reecrit sa ligne, `setB`, appele
    // sans receveur dans un `apply`, emporte la fonction. Planifies a part,
    // les deux arrivaient dans une edition que VS Code refuse en bloc.
    const r = await lanceNonProuve([
      GRADLE,
      { path: '/w/app/src/main/java/com/x/Spec.kt', text: [
        'package com.x', '',
        'class Spec(@JvmField val size: Int) {',
        '    @JvmField var a: Int = 0',
        '    @JvmField var b: Int = 0', '',
        '    fun setA(v: Int) {', '        a = v', '    }', '',
        '    fun setB(v: Int) {', '        b = v', '    }', '',
        '    fun sum(): Int = a + b',
        '}', '',
      ].join('\n') },
      { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nfun main() {\n    println(Spec(1).sum() + Spec(1).size)\n}\n' },
      kotlinTestFile(TEST_PATH, [
        '    @Test',
        '    fun sums() {',
        '        val spec = Spec(500)',
        '        spec.setA(1)',
        '        spec.apply { setB(2) }',
        '        check(spec.sum() == 3)',
        '    }', '',
        '    @Test',
        '    fun keepsSize() { check(Spec(500).size == 500) }',
      ]),
    ]);
    expect(imbriquees(r.entries)).toEqual([]);
    const surTest = r.entries.filter(e => e.path === TEST_PATH);
    expect(surTest.map(e => e.text)).toEqual(['']);
    expect(r.messages).toContain('Removed 2 declarations and 1 test');
    expect(r.messages).not.toContain('setter call');
  });
});

describe.skipIf(!mod)('une surcharge du setter dans le groupe : pas de reecriture', () => {
  // `spec.setOther(x)` peut se lier a l autre surcharge, dont le corps n est
  // pas cette affectation. Le planificateur retombe sur la coupe de la
  // fonction de test, comme avant la reecriture, dans les deux ordres.
  const prod = {
    path: SPEC_PATH,
    text: [
      'package com.x',
      '',
      'class Spec(',
      '    @JvmField val size: Int,',
      '    @JvmField var other: Spec? = null',
      ') {',
      '',
      '    fun setOther(spec: Spec?) {',
      '        other = spec',
      '    }',
      '',
      '    fun setOther(size: Int) {',
      '        other = Spec(size)',
      '        log(size)',
      '    }',
      '',
      '    fun hasOther(): Boolean = other != null',
      '}',
      '',
    ].join('\n'),
  };
  const first = { path: SPEC_PATH, start: prod.text.indexOf('    fun setOther(spec'), end: prod.text.indexOf('}\n', prod.text.indexOf('    fun setOther(spec')) + 2 };
  const second = { path: SPEC_PATH, start: prod.text.indexOf('    fun setOther(size'), end: prod.text.indexOf('}\n', prod.text.indexOf('    fun setOther(size')) + 2 };
  const test = prefetchesTest(['        spec.setOther(Spec(1))']);

  it('les deux etendues, dans un ordre puis dans l autre : le test part, rien n est reecrit', () => {
    // Le seul @Test du fichier nomme le setter : la fonction part, et la
    // coquille avec elle. C est la reponse d avant la reecriture.
    for (const extents of [[first, second], [second, first]]) {
      const plan = mod.planClosure(['setOther'], [prod, LIVE, LIVE_USER, test], SEGS, extents);
      expect(plan.withheld).toBeUndefined();
      expect(rewrites(plan)).toEqual([]);
      expect(plan.files).toEqual([test.path]);
    }
  });
});

describe.skipIf(!mod || !cmd)('construire : une coupe d instruction d un autre plan absorbe la reecriture', () => {
  // La forme trouvee par la verification : `setOther` reecrit la ligne
  // `spec.setOther(foo)`, et `makeOther`, dont `foo` est le champ, coupe la
  // meme ligne comme instruction du champ qui part. Seule la reecriture etait
  // regardee comme absorbable, et seulement par une coupe de FONCTION : les
  // deux editions sortaient, la ligne reecrite appelait un `foo` disparu.
  const BASE_PATH = '/w/app/src/test/java/com/x/BaseSpecTest.kt';
  const baseTest = [
    'package com.x',
    '',
    'import org.junit.Before',
    '',
    'abstract class BaseSpecTest {',
    '    private val foo = Spec(1).makeOther()',
    '    protected lateinit var spec: Spec',
    '',
    '    @Before',
    '    fun setUp() {',
    '        spec = Spec(500)',
    '        spec.setOther(foo)',
    '    }',
    '}',
    '',
  ].join('\n');
  const sub = {
    path: TEST_PATH,
    text: 'package com.x\n\nimport org.junit.Test\n\nclass SpecTest : BaseSpecTest() {\n    @Test\n    fun keepsSize() { check(spec.size == 500) }\n}\n',
  };
  const spec = (setterFirst: boolean) => {
    const setter = ['    fun setOther(spec: Spec?) {', '        other = spec', '    }', ''];
    const maker = ['    fun makeOther(): Spec = Spec(size + 1)', ''];
    return {
      path: '/w/app/src/main/java/com/x/Spec.kt',
      text: [
        'package com.x', '',
        'class Spec(', '    @JvmField val size: Int,', '    @JvmField var other: Spec? = null', ') {', '',
        ...(setterFirst ? [...setter, ...maker] : [...maker, ...setter]),
        '    fun hasOther(): Boolean = other != null', '}', '',
      ].join('\n'),
    };
  };
  const main = { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nfun main() {\n    println(Spec(1).hasOther() && Spec(2).size > 0)\n}\n' };

  it('dans les deux ordres de declaration : deux suppressions sur la base, aucune ligne reecrite, rien d imbrique', async () => {
    for (const setterFirst of [true, false]) {
      const r = await lanceNonProuve([GRADLE, spec(setterFirst), main, { path: BASE_PATH, text: baseTest }, sub]);
      const surBase = r.entries.filter(e => e.path === BASE_PATH);
      expect(surBase.map(e => e.text)).toEqual(['', '']);
      expect(surBase.some(e => e.text.includes('spec.other'))).toBe(false);
      expect(imbriquees(r.entries)).toEqual([]);
    }
  });
});

describe.skipIf(!mod)('une assertion d un test qui en garde d autres : la ligne part, le test reste', () => {
  // La forme reelle : un test des evenements de l infolettre verifiait deux
  // posts, dont un de l evenement retire. Prendre la fonction perdait un test
  // vivant ; la branche ecrite a la main avait retire une ligne `verify`.
  const EVENT_PATH = 'app/src/main/java/com/x/Events.kt';
  const EVENT_TEXT = 'package com.x\n\nclass OpenedEvent(val url: String)\nclass NewsletterEvent(val url: String)\n';
  const EVENT_EXTENT = { path: EVENT_PATH, start: EVENT_TEXT.indexOf('class OpenedEvent'), end: EVENT_TEXT.indexOf('\nclass NewsletterEvent') + 1 };
  const poster = { path: 'app/src/main/java/com/x/Router.kt', text: 'package com.x\n\nclass Router {\n    fun route(u: String) { Bus.post(NewsletterEvent(u)) }\n}\n' };

  it('deux verify, un seul nomme le partant : seule cette ligne part', () => {
    const test = kotlinTestFile('app/src/test/java/com/x/RouterTest.kt', [
      '    @Test',
      '    fun `route posts the newsletter events`() {',
      '        Router().route("u")',
      '        verify { bus.post(NewsletterEvent("u")) }',
      '        verify { bus.post(OpenedEvent("u")) }',
      '    }',
      '',
      '    @Test',
      '    fun other() { check(Router() != null) }',
    ]);
    const plan = mod.planClosure(['OpenedEvent'], [{ path: EVENT_PATH, text: EVENT_TEXT }, poster, test], SEGS, [EVENT_EXTENT]);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).toEqual([]);
    const cuts = plan.cuts.filter((c: any) => c.path === test.path).map((c: any) => test.text.slice(c.start, c.end));
    expect(cuts).toEqual(['        verify { bus.post(OpenedEvent("u")) }\n']);
  });

  it('un test dont la seule assertion nomme le partant part entier', () => {
    const test = kotlinTestFile('app/src/test/java/com/x/RouterTest.kt', [
      '    @Test',
      '    fun `route posts the opened event`() {',
      '        Router().route("u")',
      '        verify { bus.post(OpenedEvent("u")) }',
      '    }',
      '',
      '    @Test',
      '    fun other() { check(Router() != null) }',
    ]);
    const plan = mod.planClosure(['OpenedEvent'], [{ path: EVENT_PATH, text: EVENT_TEXT }, poster, test], SEGS, [EVENT_EXTENT]);
    expect(plan.withheld).toBeUndefined();
    expect(plan.cuts.filter((c: any) => c.path === test.path).map((c: any) => [c.kind, c.name])).toEqual([['function', 'route posts the opened event']]);
  });
});

describe.skipIf(!mod)('un fichier de test dedie part entier, meme si chaque test a une assertion accessoire', () => {
  // La forme ViewUtilsTest : chaque @Test nomme ce qui part et verifie aussi
  // une broutille. Ne couper que la ligne laissait un test creux dans un
  // fichier qui ne teste plus rien ; la branche ecrite a la main a supprime
  // le fichier.
  const EVENT_PATH = 'app/src/main/java/com/x/Events.kt';
  const EVENT_TEXT = 'package com.x\n\nclass OpenedEvent(val url: String)\nclass NewsletterEvent(val url: String)\n';
  const EVENT_EXTENT = { path: EVENT_PATH, start: EVENT_TEXT.indexOf('class OpenedEvent'), end: EVENT_TEXT.indexOf('\nclass NewsletterEvent') + 1 };
  const poster = { path: 'app/src/main/java/com/x/Router.kt', text: 'package com.x\n\nclass Router {\n    fun route(u: String) { Bus.post(NewsletterEvent(u)) }\n}\n' };

  it('deux tests, chacun nomme le partant et verifie autre chose : le fichier part', () => {
    const test = kotlinTestFile('app/src/test/java/com/x/OpenedTest.kt', [
      '    @Test',
      '    fun `posts on route`() {',
      '        Router().route("u")',
      '        verify { bus.post(OpenedEvent("u")) }',
      '        check(Router() != null)',
      '    }',
      '',
      '    @Test',
      '    fun `posts twice`() {',
      '        Router().route("u")',
      '        verify(exactly = 2) { bus.post(OpenedEvent("u")) }',
      '        check(true)',
      '    }',
    ]);
    const plan = mod.planClosure(['OpenedEvent'], [{ path: EVENT_PATH, text: EVENT_TEXT }, poster, test], SEGS, [EVENT_EXTENT]);
    expect(plan.withheld).toBeUndefined();
    expect(plan.files).toEqual([test.path]);
    expect(plan.cuts.filter((c: any) => c.path === test.path)).toEqual([]);
  });
});
