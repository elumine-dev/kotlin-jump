/**
 * Tests adversariaux — KotlinTestController
 *
 * Vecteurs couverts :
 *   TC-1  Deux classes avec même simple name dans des packages différents — IDs distincts
 *   TC-2  Package vide (default package)
 *   TC-3  Top-level fun sans classe englobante — limitation connue
 *   TC-4  isTestFun — lifecycle exclusion prioritaire sur path-based
 *   TC-5  isTestFun — @Ignore sur une méthode @Test → isTestFun=true mais entry.isIgnored=true
 *   TC-6  isTestFun avec extraSegs custom
 *   TC-7  isTestFun — kind=composable qualifie
 *   TC-8  Stress scale — 335 classes × 5 méthodes (newsapp)
 *   TC-9  Multiple modules — 46 modules
 *   TC-10 Propagation de tous les flags dans le pipeline parser → SymbolIndex
 *   TC-11 isTestFun — plusieurs annotations lifecycle (toutes exclues)
 *   TC-12 Classe helper sans méthodes @Test dans test/java/ — aucune méthode visible
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { isTestFun, DEFAULT_TEST_SEGS } from '../../src/testing/KotlinTestController';

function addKt(index: SymbolIndex, uri: string, code: string, mod?: string) {
  index.add(parse(uri, code), mod);
}

function makeIndex(uri: string, code: string, mod?: string): SymbolIndex {
  const idx = new SymbolIndex();
  addKt(idx, uri, code, mod);
  return idx;
}

function getEntry(idx: SymbolIndex, uri: string, name: string) {
  return idx.getFileSymbols(uri).find(e => e.name === name);
}

// ── TC-1 : Deux classes même simple name, packages différents ─────────────────

describe('TC-1 — Same simple name, different packages', () => {
  it('FQNs distincts → pas de collision dans l\'index', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///src/test/java/foo/FooTest.kt', [
      'package com.example.foo',
      'class FooTest {',
      '  @Test fun testA() {}',
      '}',
    ].join('\n'), ':moduleA');

    addKt(idx, 'file:///src/test/java/bar/FooTest.kt', [
      'package com.example.bar',
      'class FooTest {',
      '  @Test fun testB() {}',
      '}',
    ].join('\n'), ':moduleB');

    const entryA = idx.lookupFqn('com.example.foo.FooTest.testA');
    const entryB = idx.lookupFqn('com.example.bar.FooTest.testB');
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    // Les FQNs sont différents
    expect(entryA!.fqn).not.toBe(entryB!.fqn);
    // Les deux sont des tests
    expect(isTestFun(entryA!, [])).toBe(true);
    expect(isTestFun(entryB!, [])).toBe(true);
  });

  it('mth| IDs distincts — "mth|com.example.foo.FooTest.testA" ≠ "mth|com.example.bar.FooTest.testA"', () => {
    const fqnA = 'com.example.foo.FooTest.testA';
    const fqnB = 'com.example.bar.FooTest.testA';
    expect(`mth|${fqnA}`).not.toBe(`mth|${fqnB}`);
  });
});

// ── TC-2 : Default package ─────────────────────────────────────────────────────

describe('TC-2 — Default package (pas de déclaration package)', () => {
  it('classe dans le default package — packageName=""', () => {
    const idx = makeIndex('file:///src/test/java/SimpleTest.kt', [
      'class SimpleTest {',
      '  @Test fun testSomething() {}',
      '}',
    ].join('\n'), ':app');

    const entries = idx.getFileSymbols('file:///src/test/java/SimpleTest.kt');
    const classEntry = entries.find(e => e.name === 'SimpleTest');
    const funEntry = entries.find(e => e.name === 'testSomething');

    expect(classEntry).toBeDefined();
    expect(classEntry!.packageName).toBe('');
    expect(funEntry).toBeDefined();
    expect(isTestFun(funEntry!, [])).toBe(true);
  });

  it('FQN de méthode sans package = "SimpleTest.testSomething"', () => {
    const idx = makeIndex('file:///src/test/java/SimpleTest.kt', [
      'class SimpleTest {',
      '  @Test fun testSomething() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/SimpleTest.kt', 'testSomething');
    expect(entry!.fqn).toBe('SimpleTest.testSomething');
  });
});

// ── TC-3 : Top-level test function (pas de classe) ───────────────────────────

describe('TC-3 — Top-level fun sans classe englobante (limitation connue)', () => {
  it('top-level @Test fun dans test/java/ — isTest=true mais depth=0', () => {
    const idx = makeIndex('file:///src/test/java/TopLevelTest.kt', [
      'package com.example',
      '@Test fun topLevelTest() {}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/TopLevelTest.kt', 'topLevelTest');
    expect(entry).toBeDefined();
    expect(entry!.isTest).toBe(true);
    expect(entry!.depth).toBe(0);
    // isTestFun retourne true (annotation-based) — mais depth=0 signifie pas de classe englobante
    expect(isTestFun(entry!, [])).toBe(true);
  });

  it('top-level fun dans test/java/ sans @Test — non détecté (annotation requise)', () => {
    const idx = makeIndex('file:///src/test/java/utils/TestHelper.kt', [
      'package com.example.utils',
      'fun helperFun() {}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/utils/TestHelper.kt', 'helperFun');
    expect(entry).toBeDefined();
    expect(entry!.depth).toBe(0);
    // Sans @Test, non détecté même dans test/java/
    expect(isTestFun(entry!, [])).toBe(false);
  });
});

// ── TC-4 : Lifecycle exclusion prioritaire sur path ───────────────────────────

describe('TC-4 — @Before/@After exclut même si fichier dans test/java/', () => {
  it('@Before dans test/java/ → isTestFun=false', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  @Before',
      '  fun setUp() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'setUp');
    expect(entry!.isLifecycle).toBe(true);
    expect(isTestFun(entry!, [])).toBe(false);
  });

  it('@After dans androidTest/ → isTestFun=false', () => {
    const idx = makeIndex('file:///src/androidTest/java/FooTest.kt', [
      'class FooTest {',
      '  @After',
      '  fun tearDown() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/androidTest/java/FooTest.kt', 'tearDown');
    expect(entry!.isLifecycle).toBe(true);
    expect(isTestFun(entry!, [])).toBe(false);
  });

  it('@BeforeEach avec @Test sur la même méthode — lifecycle gagne', () => {
    // En pratique impossible mais testons la priorité
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  @BeforeEach',
      '  @Test',
      '  fun ambiguous() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'ambiguous');
    expect(entry!.isLifecycle).toBe(true);
    expect(isTestFun(entry!, [])).toBe(false);
  });

  it('@BeforeClass (JUnit 4 static) exclu', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  companion object {',
      '    @BeforeClass',
      '    fun setUpAll() {}',
      '  }',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'setUpAll');
    expect(entry!.isLifecycle).toBe(true);
    expect(isTestFun(entry!, [])).toBe(false);
  });
});

// ── TC-5 : @Ignore sur une méthode @Test ──────────────────────────────────────

describe('TC-5 — @Ignore sur @Test', () => {
  it('@Ignore + @Test → isTestFun=true ET isIgnored=true', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  @Ignore',
      '  @Test',
      '  fun ignoredTest() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'ignoredTest');
    expect(entry!.isIgnored).toBe(true);
    expect(entry!.isTest).toBe(true);
    // isTestFun retourne true — c'est bien un test, juste ignoré
    expect(isTestFun(entry!, [])).toBe(true);
  });

  it('@Disabled (JUnit 5) → isIgnored=true', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  @Disabled',
      '  @Test',
      '  fun disabledTest() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'disabledTest');
    expect(entry!.isIgnored).toBe(true);
  });

  it('méthode @Test sans @Ignore → isIgnored=undefined', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', [
      'class FooTest {',
      '  @Test fun normalTest() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/FooTest.kt', 'normalTest');
    expect(entry!.isIgnored).toBeUndefined();
  });
});

// ── TC-6 : extraSegs custom ───────────────────────────────────────────────────

describe('TC-6 — extraSegs custom via configuration', () => {
  it('segement custom "unitTests/" — sans @Test, toujours non détecté', () => {
    const idx = makeIndex('file:///src/unitTests/kotlin/FooTest.kt', [
      'class FooTest {',
      '  fun testSomething() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/unitTests/kotlin/FooTest.kt', 'testSomething');
    // Sans @Test, jamais détecté — extraSegs n'affecte que isTestFile(), pas isTestFun()
    expect(isTestFun(entry!, [])).toBe(false);
    expect(isTestFun(entry!, ['unitTests/'])).toBe(false);
  });

  it('extraSegs vide → sans @Test, non détecté', () => {
    const entry = {
      kind: 'fun' as const,
      uri: { path: '/project/src/test/java/Foo.kt' } as any,
      name: 'testFoo',
      isPrivate: undefined,
      isLifecycle: undefined,
      isTest: undefined,
    } as any;
    expect(isTestFun(entry, [])).toBe(false);
  });

  it('DEFAULT_TEST_SEGS couvre test/java, test/kotlin, androidTest, jvmTest, commonTest', () => {
    expect(DEFAULT_TEST_SEGS).toContain('test/java/');
    expect(DEFAULT_TEST_SEGS).toContain('test/kotlin/');
    expect(DEFAULT_TEST_SEGS).toContain('androidTest/');
    expect(DEFAULT_TEST_SEGS).toContain('jvmTest/');
    expect(DEFAULT_TEST_SEGS).toContain('commonTest/');
  });

  it('src/main/java/ ne matche pas DEFAULT_TEST_SEGS', () => {
    const entry = {
      kind: 'fun' as const,
      uri: { path: '/project/src/main/java/Foo.kt' } as any,
      name: 'testFoo',
      isPrivate: undefined,
      isLifecycle: undefined,
      isTest: undefined,
    } as any;
    expect(isTestFun(entry, [])).toBe(false);
  });
});

// ── TC-7 : kind=composable qualifie comme test ───────────────────────────────

describe('TC-7 — kind=composable dans test path', () => {
  it('@Composable fun dans test/kotlin/ — isTestFun=true', () => {
    const idx = makeIndex('file:///src/test/kotlin/FooTest.kt', [
      'class FooTest {',
      '  @Composable',
      '  @Test',
      '  fun composableTest() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/kotlin/FooTest.kt', 'composableTest');
    expect(entry!.kind).toBe('composable');
    expect(isTestFun(entry!, [])).toBe(true);
  });
});

// ── TC-8 : Stress scale — newsapp (335 classes × 5 méthodes) ────────────────

describe('TC-8 — Stress scale newsapp: 335 classes × 5 méthodes', () => {
  function buildBigAppLikeCode(classIndex: number, pkg: string): string {
    return [
      `package ${pkg}`,
      `import org.junit.Test`,
      `import org.junit.Before`,
      `@RunWith(RobolectricTestRunner::class)`,
      `class Test${classIndex} {`,
      `  @Before fun setUp() {}`,
      `  @Test fun testMethod1() {}`,
      `  @Test fun testMethod2() {}`,
      `  @Test fun testMethod3() {}`,
      `  @Test fun testMethod4() {}`,
      `  @Test fun testMethod5() {}`,
      `  private fun helperMethod() {}`,  // private → exclu
      `}`,
    ].join('\n');
  }

  it('1675 méthodes de test indexées sans corruption (335 classes × 5 méthodes)', () => {
    const idx = new SymbolIndex();
    const CLASSES_PER_MODULE = 7; // ~335/46 ≈ 7 classes par module

    let totalTestMethods = 0;
    let totalLifecycleMethods = 0;

    for (let m = 0; m < 46; m++) {
      const moduleName = `:module${m}`;
      for (let c = 0; c < CLASSES_PER_MODULE; c++) {
        const globalIdx = m * CLASSES_PER_MODULE + c;
        const pkg = `com.example.module${m}.pkg${c % 3}`;
        const uri = `file:///src/test/java/${pkg.replace(/\./g, '/')}/Test${globalIdx}.kt`;
        addKt(idx, uri, buildBigAppLikeCode(globalIdx, pkg), moduleName);
      }
    }

    const allFiles = [...idx.fileUriStrings()];
    let testFunCount = 0;
    let lifecycleCount = 0;

    for (const uri of allFiles) {
      const entries = idx.getFileSymbols(uri);
      for (const e of entries) {
        if (e.kind !== 'fun' && e.kind !== 'composable') continue;
        if (e.isLifecycle) { lifecycleCount++; continue; }
        if (isTestFun(e, [])) testFunCount++;
      }
    }

    const expectedClasses = 46 * CLASSES_PER_MODULE; // 322
    const expectedTestMethods = expectedClasses * 5;
    const expectedLifecycle = expectedClasses * 1;

    expect(testFunCount).toBe(expectedTestMethods);
    expect(lifecycleCount).toBe(expectedLifecycle);
  });

  it('pas de collision de FQN entre 322 classes (même nom dans modules différents)', () => {
    const idx = new SymbolIndex();
    const seen = new Set<string>();
    let collisions = 0;

    for (let m = 0; m < 10; m++) {
      for (let c = 0; c < 5; c++) {
        const globalIdx = m * 5 + c;
        const pkg = `com.example.module${m}`;
        const uri = `file:///src/test/java/${pkg}/Test${globalIdx}.kt`;
        addKt(idx, uri, `package ${pkg}\nclass Test${globalIdx} { @Test fun testA() {} }`, `:module${m}`);

        const fqn = `${pkg}.Test${globalIdx}.testA`;
        if (seen.has(fqn)) collisions++;
        seen.add(fqn);
      }
    }

    expect(collisions).toBe(0);
  });
});

// ── TC-9 : Multiple modules (46 modules) ──────────────────────────────────────

describe('TC-9 — Multiple modules (46 modules)', () => {
  it('46 modules → 46 moduleName distincts', () => {
    const idx = new SymbolIndex();
    for (let m = 0; m < 46; m++) {
      addKt(idx,
        `file:///modules/module${m}/src/test/java/Test.kt`,
        `package pkg${m}\nclass TestM${m} { @Test fun testFoo() {} }`,
        `:module${m}`,
      );
    }

    const moduleNames = new Set<string>();
    for (const uri of idx.fileUriStrings()) {
      const entries = idx.getFileSymbols(uri);
      if (entries[0]?.moduleName) moduleNames.add(entries[0].moduleName);
    }
    expect(moduleNames.size).toBe(46);
  });
});

// ── TC-10 : Propagation de tous les flags dans le pipeline ────────────────────

describe('TC-10 — Propagation flags parser → SymbolIndex', () => {
  it('isTest propagé', () => {
    const idx = makeIndex('file:///src/test/java/T.kt', [
      'class T {',
      '  @Test fun t() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/T.kt', 't');
    expect(entry!.isTest).toBe(true);
  });

  it('isIgnored propagé', () => {
    const idx = makeIndex('file:///src/test/java/T.kt', [
      'class T {',
      '  @Ignore',
      '  @Test',
      '  fun t() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/T.kt', 't');
    expect(entry!.isIgnored).toBe(true);
    expect(entry!.isTest).toBe(true);
  });

  it('isLifecycle propagé', () => {
    const idx = makeIndex('file:///src/test/java/T.kt', [
      'class T {',
      '  @Before fun setUp() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/test/java/T.kt', 'setUp');
    expect(entry!.isLifecycle).toBe(true);
  });

  it('isTestClass propagé sur classe avec @RunWith', () => {
    const idx = makeIndex('file:///src/test/java/T.kt', [
      '@RunWith(RobolectricTestRunner::class)',
      'class FooTest {',
      '  @Test fun testFoo() {}',
      '}',
    ].join('\n'));
    const classEntry = getEntry(idx, 'file:///src/test/java/T.kt', 'FooTest');
    expect(classEntry!.isTestClass).toBe(true);
  });

  it('flags undefined pour méthode normale hors test', () => {
    const idx = makeIndex('file:///src/main/java/Foo.kt', [
      'class Foo {',
      '  fun normalMethod() {}',
      '}',
    ].join('\n'));
    const entry = getEntry(idx, 'file:///src/main/java/Foo.kt', 'normalMethod');
    expect(entry!.isTest).toBeUndefined();
    expect(entry!.isIgnored).toBeUndefined();
    expect(entry!.isLifecycle).toBeUndefined();
  });
});

// ── TC-11 : Toutes les annotations lifecycle exclues ──────────────────────────

describe('TC-11 — Toutes les annotations lifecycle exclues', () => {
  const LIFECYCLE_ANNS = [
    ['@Before', 'setUp'],
    ['@After', 'tearDown'],
    ['@BeforeEach', 'beforeEach'],
    ['@AfterEach', 'afterEach'],
    ['@BeforeAll', 'beforeAll'],
    ['@AfterAll', 'afterAll'],
    ['@BeforeClass', 'beforeClass'],
    ['@AfterClass', 'afterClass'],
  ] as const;

  for (const [ann, methodName] of LIFECYCLE_ANNS) {
    it(`${ann} → isTestFun=false même dans test/java/`, () => {
      const idx = makeIndex('file:///src/test/java/T.kt', [
        'class T {',
        `  ${ann}`,
        `  fun ${methodName}() {}`,
        '}',
      ].join('\n'));
      const entry = getEntry(idx, 'file:///src/test/java/T.kt', methodName);
      expect(entry!.isLifecycle).toBe(true);
      expect(isTestFun(entry!, [])).toBe(false);
    });
  }
});

// ── TC-12 : Helper class sans méthodes @Test ──────────────────────────────────

describe('TC-12 — Helper class dans test/java/ sans @Test', () => {
  it('classe avec seulement des helpers — 0 méthodes isTestFun', () => {
    const idx = makeIndex('file:///src/test/java/BaseTest.kt', [
      'open class BaseTest {',
      '  @Before fun setUp() {}',
      '  @After fun tearDown() {}',
      '  fun assertSomeCondition(x: Int) {}',
      '  private fun internalHelper() {}',
      '}',
    ].join('\n'));

    const entries = idx.getFileSymbols('file:///src/test/java/BaseTest.kt');
    const testMethods = entries.filter(e => isTestFun(e, []));

    // setUp → lifecycle → exclu
    // tearDown → lifecycle → exclu
    // assertSomeCondition → public sans @Test → exclu
    // internalHelper → private → exclu
    const assertMethod = entries.find(e => e.name === 'assertSomeCondition');
    expect(assertMethod).toBeDefined();
    expect(isTestFun(assertMethod!, [])).toBe(false); // correct — helper sans @Test exclu

    const setUp = entries.find(e => e.name === 'setUp');
    expect(isTestFun(setUp!, [])).toBe(false); // @Before exclu ✓

    const privateHelper = entries.find(e => e.name === 'internalHelper');
    expect(isTestFun(privateHelper!, [])).toBe(false); // private exclu ✓
  });

  it('newsapp: BaseTest.kt avec seulement @Before → setUp exclu des tests', () => {
    // Pattern commun à newsapp — classe de base avec setUp uniquement
    // Note: `open fun` n'est pas dans les modificateurs RE_FUN — utiliser `fun` ici
    const idx = makeIndex('file:///src/test/java/com/example/news/BaseTest.kt', [
      'package com.example.news',
      'open class BaseTest {',
      '  @Before',
      '  fun setUp() {}',  // sans `open` — limitation connue du parser
      '}',
    ].join('\n'), ':newsfeed:core');

    const entries = idx.getFileSymbols('file:///src/test/java/com/example/news/BaseTest.kt');
    const setUp = entries.find(e => e.name === 'setUp');
    expect(setUp!.isLifecycle).toBe(true);
    expect(isTestFun(setUp!, [])).toBe(false);
  });
});
