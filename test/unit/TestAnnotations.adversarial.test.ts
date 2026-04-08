/**
 * Tests adversaires — Détection des annotations de test dans KotlinParser
 *
 * Chaque suite cible un vecteur de bug spécifique.
 * Les tests qui révèlent un bug connu sont marqués avec un ID (BUG TA-N).
 *
 * Vecteurs couverts :
 *   TA-1  @Test dans une string / comment → faux positif
 *   TA-2  @Test multi-lignes (avec paramètres) → annotation window effacée
 *   TA-3  @RunWith multi-lignes → isTestClass non détecté
 *   TA-4  @Before/@After seul ne doit pas produire un test
 *   TA-5  Annotations empilées dans différents ordres
 *   TA-6  Companion object contenant @Test
 *   TA-7  Nested class avec @Test
 *   TA-8  @Test sur suspend / inline / extension fun
 *   TA-9  @Test sur fun avec backtick
 *   TA-10 @Test avec FQN complet (@org.junit.Test) — non supporté (limitation)
 *   TA-11 Classes multiples dans un même fichier
 *   TA-12 @Ignore seul sur une classe (pas isIgnored sur class, limitation)
 *   TA-13 Patterns lapresse réels
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { isTestFun } from '../../src/testing/KotlinTestController';

function symbols(code: string) {
  return parse('file:///test/java/Test.kt', code).symbols;
}

function find(code: string, name: string) {
  return symbols(code).find(s => s.name === name);
}

function addKt(index: SymbolIndex, uri: string, code: string, mod?: string) {
  index.add(parse(uri, code), mod);
}

// ── TA-1 : @Test dans un contexte non-code ───────────────────────────────────

describe('TA-1 — @Test dans string / commentaire (faux positifs)', () => {
  it('ne détecte PAS @Test dans une raw string', () => {
    const code = [
      'class DocTest {',
      '  val doc = """',
      '  @Test',
      '  fun notATest() {}',
      '  """',
      '}',
    ].join('\n');
    const fun_ = find(code, 'notATest');
    // notATest est dans la raw string — ne doit PAS être dans l'index
    expect(fun_).toBeUndefined();
  });

  it('ne détecte PAS @Test dans un line comment', () => {
    const code = [
      'class FooTest {',
      '  // @Test',
      '  fun commentedTest() {}',
      '}',
    ].join('\n');
    const fun_ = find(code, 'commentedTest');
    expect(fun_?.isTest).toBeUndefined();
  });

  it('ne détecte PAS @Test dans un block comment', () => {
    const code = [
      'class FooTest {',
      '  /*',
      '   * @Test',
      '   */',
      '  fun blockCommentedTest() {}',
      '}',
    ].join('\n');
    const fun_ = find(code, 'blockCommentedTest');
    expect(fun_?.isTest).toBeUndefined();
  });

  it('ne détecte PAS @Test dans une string normale', () => {
    const code = [
      'class FooTest {',
      '  val annotation = "@Test"',
      '  fun notATest() {}',
      '}',
    ].join('\n');
    // annotationWindow est effacée par la val — notATest ne doit pas avoir isTest
    const fun_ = find(code, 'notATest');
    expect(fun_?.isTest).toBeUndefined();
  });

  it('@Test légitime juste après une val non-annotation est détecté', () => {
    const code = [
      'class FooTest {',
      '  val x = 1',
      '  @Test',
      '  fun realTest() {}',
      '}',
    ].join('\n');
    expect(find(code, 'realTest')?.isTest).toBe(true);
  });
});

// ── TA-2 : @Test multi-lignes (paramètres) ──────────────────────────────────

describe('TA-2 — @Test / annotations avec paramètres multi-lignes', () => {
  it('@ParameterizedTest avec @ValueSource multi-lignes', () => {
    // annotationWindow garde 3 lignes — si l'annotation dépasse, elle est coupée
    const code = [
      'class FooTest {',
      '  @ParameterizedTest',
      '  @ValueSource(',
      '    strings = ["a", "b"]',
      '  )',
      '  fun testParam(s: String) {}',
      '}',
    ].join('\n');
    const fun_ = find(code, 'testParam');
    // @ParameterizedTest est dans la window → isTest=true
    expect(fun_?.isTest).toBe(true);
  });

  it('@RepeatedTest(5) sur une ligne avec paramètre', () => {
    const code = [
      'class FooTest {',
      '  @RepeatedTest(5)',
      '  fun repeatedTest() {}',
      '}',
    ].join('\n');
    expect(find(code, 'repeatedTest')?.isTest).toBe(true);
  });

  it('@Ignore("reason") avec paramètre', () => {
    const code = [
      'class FooTest {',
      '  @Ignore("flaky in CI")',
      '  @Test',
      '  fun flaky() {}',
      '}',
    ].join('\n');
    const fun_ = find(code, 'flaky');
    expect(fun_?.isIgnored).toBe(true);
    expect(fun_?.isTest).toBe(true);
  });

  it('@Test en 4ème position dans la window (window = 3) — cas limite', () => {
    // annotationWindow a 3 slots — si @Test est plus de 3 lignes avant fun, perdu
    const code = [
      'class FooTest {',
      '  @Annotation1',
      '  @Annotation2',
      '  @Annotation3',
      '  @Test',              // 4e annotation — shift() enlève Annotation1
      '  fun windowTest() {}',
    ].join('\n');
    // @Test doit toujours être détecté (3 slots, @Test est le dernier)
    expect(find(code, 'windowTest')?.isTest).toBe(true);
  });

  it('@Test en 5ème position — en dehors de la window de 3', () => {
    // Limitation connue : annotationWindow est limitée à 3 lignes
    // Si la chaîne d'annotations est plus longue, @Test peut être perdu
    const code = [
      'class FooTest {',
      '  @Annotation1',
      '  @Annotation2',
      '  @Annotation3',
      '  @Annotation4',
      '  @Test',              // 5e — @Test remplace Annotation2 dans la window
      '  fun deepAnnotated() {}',
    ].join('\n');
    // @Test est toujours dans la window (shift enlève les vieilles entrées)
    expect(find(code, 'deepAnnotated')?.isTest).toBe(true);
  });
});

// ── TA-3 : @RunWith multi-lignes ─────────────────────────────────────────────

describe('TA-3 — @RunWith multi-lignes', () => {
  it('@RunWith sur une ligne', () => {
    const code = '@RunWith(RobolectricTestRunner::class)\nclass FooTest';
    expect(find(code, 'FooTest')?.isTestClass).toBe(true);
  });

  it('@RunWith(\n  Clazz::class\n) — multi-lignes — BUG TA-3 potentiel', () => {
    const code = [
      '@RunWith(',
      '  RobolectricTestRunner::class',
      ')',
      'class FooTest',
    ].join('\n');
    // BUG TA-3 : annotationWindow a @RunWith( comme première ligne,
    // puis les lignes suivantes (continuation entre parens) — parenDepth > 0
    // → les lignes 2/3 NE devraient PAS vider annotationWindow
    // → quand `class FooTest` est parsé, @RunWith est encore dans la window
    const cls = find(code, 'FooTest');
    expect(cls?.isTestClass).toBe(true);
  });
});

// ── TA-4 : @Before / @After ne sont PAS des tests ────────────────────────────

describe('TA-4 — @Before / @After ne doivent pas être détectés comme tests', () => {
  const LIFECYCLE_ANNOTATIONS = [
    '@Before', '@After', '@BeforeEach', '@AfterEach',
    '@BeforeAll', '@AfterAll', '@BeforeClass', '@AfterClass',
  ];

  for (const ann of LIFECYCLE_ANNOTATIONS) {
    it(`${ann} fun setUp() → isLifecycle=true, isTestFun=false`, () => {
      const code = `class T {\n  ${ann}\n  fun setUp() {}\n}`;
      const sym = find(code, 'setUp');
      expect(sym?.isLifecycle).toBe(true);
      // isTestFun doit exclure les lifecycle
      const entry = (() => {
        const idx = new SymbolIndex();
        addKt(idx, 'file:///src/test/java/T.kt', code);
        return idx.getFileSymbols('file:///src/test/java/T.kt').find(e => e.name === 'setUp');
      })();
      expect(entry).toBeDefined();
      expect(isTestFun(entry!, [])).toBe(false);
    });
  }

  it('fun annotée @Before ET @Test — lifecycle gagne (isLifecycle=true)', () => {
    const code = [
      'class T {',
      '  @Before',
      '  @Test',
      '  fun ambiguous() {}',
      '}',
    ].join('\n');
    const sym = find(code, 'ambiguous');
    // @Before vient en premier → isLifecycle=true → exclus
    expect(sym?.isLifecycle).toBe(true);
  });
});

// ── TA-5 : Ordre d'empilage des annotations ──────────────────────────────────

describe('TA-5 — Ordre d\'empilage des annotations', () => {
  it('@Test avant @Ignore', () => {
    const code = 'class T {\n  @Test\n  @Ignore\n  fun t() {} \n}';
    const s = find(code, 't');
    expect(s?.isTest).toBe(true);
    expect(s?.isIgnored).toBe(true);
  });

  it('@Ignore avant @Test', () => {
    const code = 'class T {\n  @Ignore\n  @Test\n  fun t() {}\n}';
    const s = find(code, 't');
    expect(s?.isTest).toBe(true);
    expect(s?.isIgnored).toBe(true);
  });

  it('@Test sur la même ligne que fun (inline)', () => {
    // @Test fun testInline() {}  — @Test est sur la ligne de la déclaration
    const code = 'class T { @Test fun testInline() {} }';
    const s = find(code, 'testInline');
    expect(s?.isTest).toBe(true);
  });

  it('@Ignore sur la même ligne que fun', () => {
    const code = 'class T { @Ignore fun ignoredTest() {} }';
    const s = find(code, 'ignoredTest');
    expect(s?.isIgnored).toBe(true);
  });

  it('@Test @Ignore sur la même ligne', () => {
    const code = 'class T { @Test @Ignore fun t() {} }';
    const s = find(code, 't');
    expect(s?.isTest).toBe(true);
    expect(s?.isIgnored).toBe(true);
  });
});

// ── TA-6 : Companion object contenant @Test ─────────────────────────────────

describe('TA-6 — companion object et @Test', () => {
  it('@Test dans companion object → isTest=true (même si non-standard JUnit)', () => {
    const code = [
      'class FooTest {',
      '  companion object {',
      '    @Test',
      '    fun companionTest() {}',
      '  }',
      '}',
    ].join('\n');
    const sym = find(code, 'companionTest');
    expect(sym?.isTest).toBe(true);
  });

  it('@Before dans companion object → isLifecycle=true', () => {
    const code = [
      'class FooTest {',
      '  companion object {',
      '    @BeforeClass',
      '    @JvmStatic',
      '    fun setUpClass() {}',
      '  }',
      '}',
    ].join('\n');
    const sym = find(code, 'setUpClass');
    expect(sym?.isLifecycle).toBe(true);
  });
});

// ── TA-7 : Classes imbriquées / inner classes ────────────────────────────────

describe('TA-7 — classes imbriquées et @Nested', () => {
  it('@Test dans une classe normale → détecté (depth=2)', () => {
    const code = [
      'class OuterTest {',
      '  @Test fun outerTest() {}',
      '',
      '  inner class InnerTest {',
      '    @Test fun innerTest() {}',
      '  }',
      '}',
    ].join('\n');
    const outer = find(code, 'outerTest');
    const inner = find(code, 'innerTest');
    expect(outer?.isTest).toBe(true);
    expect(inner?.isTest).toBe(true);
    // depth différent
    expect(inner!.depth).toBeGreaterThan(outer!.depth);
  });

  it('@Nested class (JUnit 5) — isTestClass non requis mais @Test détecté', () => {
    const code = [
      'class OuterTest {',
      '  @Nested',
      '  inner class WhenFoo {',
      '    @Test fun testSomething() {}',
      '  }',
      '}',
    ].join('\n');
    const fun_ = find(code, 'testSomething');
    expect(fun_?.isTest).toBe(true);
  });
});

// ── TA-8 : Modificateurs spéciaux sur les fonctions de test ─────────────────

describe('TA-8 — modificateurs spéciaux sur @Test fun', () => {
  it('suspend @Test fun est détecté', () => {
    const code = 'class T {\n  @Test\n  suspend fun suspendTest() {}\n}';
    const s = find(code, 'suspendTest');
    expect(s?.isTest).toBe(true);
    expect(s?.isSuspend).toBe(true);
  });

  it('@Test inline fun est détecté', () => {
    const code = 'class T {\n  @Test\n  inline fun inlineTest() {}\n}';
    expect(find(code, 'inlineTest')?.isTest).toBe(true);
  });

  it('@Test override fun est détecté', () => {
    const code = 'class T : Base() {\n  @Test\n  override fun overriddenTest() {}\n}';
    const s = find(code, 'overriddenTest');
    expect(s?.isTest).toBe(true);
    expect(s?.isOverride).toBe(true);
  });

  it('@Test fun <T> genericTest() est détecté', () => {
    const code = 'class T {\n  @Test\n  fun <T> genericTest(): T? = null\n}';
    expect(find(code, 'genericTest')?.isTest).toBe(true);
  });

  it('fun extension sans @Test dans test path — isTestFun = false', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///src/test/java/ExtTest.kt', [
      'class ExtTest {',
      '  fun String.extensionTest() {}',
      '}',
    ].join('\n'));
    const entries = idx.getFileSymbols('file:///src/test/java/ExtTest.kt');
    const extFun = entries.find(e => e.name === 'extensionTest');
    expect(extFun).toBeDefined();
    // Extension fun sans @Test → non détectée (annotation requise)
    expect(isTestFun(extFun!, [])).toBe(false);
    expect(extFun?.isExtension).toBe(true);
  });
});

// ── TA-9 : Noms backtick ──────────────────────────────────────────────────────

describe('TA-9 — @Test sur fun avec nom entre backticks', () => {
  it('@Test fun `should return null when empty`() détecté avec isTest=true', () => {
    const code = [
      'class FooTest {',
      '  @Test',
      '  fun `should return null when empty`() {}',
      '}',
    ].join('\n');
    const syms = symbols(code);
    const testFun = syms.find(s => s.name === 'should return null when empty');
    expect(testFun).toBeDefined();
    expect(testFun?.isTest).toBe(true);
  });

  it('@Test fun `test avec accents éàü`() indexé', () => {
    const code = [
      'class T {',
      '  @Test',
      '  fun `test avec accents éàü`() {}',
      '}',
    ].join('\n');
    const syms = symbols(code);
    const t = syms.find(s => s.name.includes('accents'));
    expect(t?.isTest).toBe(true);
  });

  it('isTestFun sur un SymbolEntry avec nom backtick', () => {
    const idx = new SymbolIndex();
    const uri = 'file:///src/test/java/FooTest.kt';
    addKt(idx, uri, [
      'class FooTest {',
      '  @Test',
      '  fun `play starts playback`() {}',
      '}',
    ].join('\n'));
    const entries = idx.getFileSymbols(uri);
    const t = entries.find(e => e.name === 'play starts playback');
    expect(t).toBeDefined();
    expect(isTestFun(t!, [])).toBe(true);
  });
});

// ── TA-10 : FQN complet de l'annotation ─────────────────────────────────────

describe('TA-10 — @org.junit.Test (FQN) — limitation connue', () => {
  it('@org.junit.Test non détecté par RE_TEST (limitation)', () => {
    // RE_TEST = /@(?:Test|ParameterizedTest|...)/ ne supporte pas les FQN
    const code = 'class T {\n  @org.junit.Test\n  fun fqnTest() {}\n}';
    const s = find(code, 'fqnTest');
    // Limitation connue : FQN non supporté — isTest reste undefined
    // Ce test DOCUMENTE la limitation, pas un bug à corriger maintenant
    expect(s?.isTest).toBeUndefined();
  });

  it('@Test (sans FQN) est toujours détecté', () => {
    const code = 'class T {\n  @Test\n  fun test() {}\n}';
    expect(find(code, 'test')?.isTest).toBe(true);
  });
});

// ── TA-11 : Plusieurs classes dans un même fichier ────────────────────────────

describe('TA-11 — plusieurs classes de test dans un fichier', () => {
  it('deux classes @RunWith dans le même fichier — toutes deux détectées', () => {
    const code = [
      'package nuglif.rubicon',
      '@RunWith(RobolectricTestRunner::class)',
      'class FooTest {',
      '  @Test fun testFoo() {}',
      '}',
      '@RunWith(RobolectricTestRunner::class)',
      'class BarTest {',
      '  @Test fun testBar() {}',
      '}',
    ].join('\n');
    const syms = symbols(code);
    expect(syms.find(s => s.name === 'FooTest')?.isTestClass).toBe(true);
    expect(syms.find(s => s.name === 'BarTest')?.isTestClass).toBe(true);
    expect(syms.find(s => s.name === 'testFoo')?.isTest).toBe(true);
    expect(syms.find(s => s.name === 'testBar')?.isTest).toBe(true);
  });

  it('classe normale et classe de test dans le même fichier', () => {
    const code = [
      'class Service { fun process() {} }',
      'class ServiceTest {',
      '  @Test fun testProcess() {}',
      '}',
    ].join('\n');
    const syms = symbols(code);
    expect(syms.find(s => s.name === 'Service')?.isTestClass).toBeUndefined();
    expect(syms.find(s => s.name === 'ServiceTest')?.isTestClass).toBeUndefined(); // pas de @RunWith
    expect(syms.find(s => s.name === 'testProcess')?.isTest).toBe(true);
    expect(syms.find(s => s.name === 'process')?.isTest).toBeUndefined();
  });
});

// ── TA-12 : Patterns réels lapresse ──────────────────────────────────────────

describe('TA-13 — patterns réels lapresse', () => {
  it('MockKAnnotations + @MockK ne sont pas des tests', () => {
    const code = [
      'package nuglif.rubicon.media.video',
      '@RunWith(RobolectricTestRunner::class)',
      'class VideoControllerPlayTest {',
      '  @MockK',
      '  private lateinit var controller: VideoController',
      '  @RelaxedMockK',
      '  private lateinit var listener: Listener',
      '  @Before',
      '  fun setUp() { MockKAnnotations.init(this) }',
      '  @Test',
      '  fun `play starts playback`() {}',
      '  @Test',
      '  fun `pause stops playback`() {}',
      '  @Ignore("flaky in CI")',
      '  @Test',
      '  fun `skip works`() {}',
      '  private fun helperMethod() {}',
      '}',
    ].join('\n');
    const syms = symbols(code);

    // Classe
    const cls = syms.find(s => s.name === 'VideoControllerPlayTest');
    expect(cls?.isTestClass).toBe(true);

    // Méthodes @Test
    expect(syms.find(s => s.name === 'play starts playback')?.isTest).toBe(true);
    expect(syms.find(s => s.name === 'pause stops playback')?.isTest).toBe(true);
    expect(syms.find(s => s.name === 'skip works')?.isTest).toBe(true);
    expect(syms.find(s => s.name === 'skip works')?.isIgnored).toBe(true);

    // Lifecycle
    expect(syms.find(s => s.name === 'setUp')?.isLifecycle).toBe(true);

    // Helpers privés
    expect(syms.find(s => s.name === 'helperMethod')?.isPrivate).toBe(true);

    // Vérification via isTestFun
    const idx = new SymbolIndex();
    const uri = 'file:///rubicon/app/src/test/java/nuglif/rubicon/media/video/VideoControllerPlayTest.kt';
    addKt(idx, uri, code, ':rubicon:app');
    const entries = idx.getFileSymbols(uri);
    const testFuns = entries.filter(e => isTestFun(e, []));
    const names = testFuns.map(e => e.name);

    expect(names).toContain('play starts playback');
    expect(names).toContain('pause stops playback');
    expect(names).toContain('skip works');
    expect(names).not.toContain('setUp');        // lifecycle exclu
    expect(names).not.toContain('helperMethod'); // private exclu
  });

  it('coroutine test avec runTest/runBlocking dans test path', () => {
    const idx = new SymbolIndex();
    const uri = 'file:///src/test/java/CoroutineTest.kt';
    addKt(idx, uri, [
      'package nuglif.starship.core',
      'class CoroutineTest {',
      '  @Test',
      '  fun testSuspendFunction() = runTest {',
      '    // test body',
      '  }',
      '  @Test',
      '  fun testWithRunBlocking() = runBlocking {',
      '    // test body',
      '  }',
      '}',
    ].join('\n'));
    const entries = idx.getFileSymbols(uri);
    const testFuns = entries.filter(e => isTestFun(e, []));
    expect(testFuns.map(e => e.name)).toContain('testSuspendFunction');
    expect(testFuns.map(e => e.name)).toContain('testWithRunBlocking');
  });

  it('test class sans aucun @Test — path-based ne produit pas de faux positifs avec @Before only', () => {
    const idx = new SymbolIndex();
    const uri = 'file:///src/test/java/BaseTest.kt';
    addKt(idx, uri, [
      'abstract class BaseTest {',
      '  @Before fun setUp() {}',
      '  @After  fun tearDown() {}',
      '  protected fun createSut(): Sut = Sut()',
      '}',
    ].join('\n'));
    const entries = idx.getFileSymbols(uri);
    const testFuns = entries.filter(e => isTestFun(e, []));
    const names = testFuns.map(e => e.name);
    // setUp et tearDown → lifecycle exclus
    expect(names).not.toContain('setUp');
    expect(names).not.toContain('tearDown');
    // createSut est protected mais sans @Test → exclu correctement
    expect(names).not.toContain('createSut');
  });
});
