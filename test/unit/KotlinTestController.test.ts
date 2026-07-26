import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { isTestFun, DEFAULT_TEST_SEGS } from '../../src/testing/KotlinTestController';

function addKt(index: SymbolIndex, uri: string, code: string, moduleName?: string) {
  index.add(parse(uri, code), moduleName);
}

function makeIndex(uri: string, code: string, moduleName?: string): SymbolIndex {
  const idx = new SymbolIndex();
  addKt(idx, uri, code, moduleName);
  return idx;
}

// ── isTestFun detection ──────────────────────────────────────────────────────

describe('isTestFun — annotation-based', () => {
  it('detects @Test annotation', () => {
    const idx = makeIndex('file:///src/test/java/com/example/FooTest.kt', `
      package com.example
      class FooTest {
        @Test
        fun shouldPass() {}
      }
    `);
    const entries = idx.getFileSymbols('file:///src/test/java/com/example/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'shouldPass');
    expect(fun_).toBeDefined();
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('detects @ParameterizedTest', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', `
      class FooTest {
        @ParameterizedTest
        fun paramTest(x: Int) {}
      }
    `);
    const entries = idx.getFileSymbols('file:///src/test/java/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'paramTest');
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('detects @RepeatedTest', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', `
      class FooTest {
        @RepeatedTest(3)
        fun repeatMe() {}
      }
    `);
    const entries = idx.getFileSymbols('file:///src/test/java/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'repeatMe');
    expect(isTestFun(fun_!, [])).toBe(true);
  });

  it('does NOT flag a non-annotated fun as test', () => {
    const idx = makeIndex('file:///src/main/java/FooTest.kt', `
      class Foo { fun helper() {} }
    `);
    const entries = idx.getFileSymbols('file:///src/main/java/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'helper');
    expect(isTestFun(fun_!, [])).toBe(false);
  });

  it('does NOT flag private @Test fun', () => {
    const idx = makeIndex('file:///src/test/java/FooTest.kt', `
      class FooTest {
        @Test
        private fun internalHelper() {}
      }
    `);
    const entries = idx.getFileSymbols('file:///src/test/java/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'internalHelper');
    // Private — should be excluded even if annotated
    expect(fun_?.isPrivate).toBe(true);
    expect(isTestFun(fun_!, [])).toBe(false);
  });
});

describe('isTestFun — non-annotated methods are excluded', () => {
  it('does NOT flag a fun in test/java/ without @Test annotation', () => {
    const idx = makeIndex('file:///project/src/test/java/com/FooTest.kt', `
      class FooTest { fun testSomething() {} }
    `);
    const entries = idx.getFileSymbols('file:///project/src/test/java/com/FooTest.kt');
    const fun_ = entries.find(e => e.name === 'testSomething');
    expect(isTestFun(fun_!, [])).toBe(false);
  });

  it('does NOT flag a helper method in androidTest/ without @Test annotation', () => {
    const idx = makeIndex('file:///project/src/androidTest/java/com/TestViewUtils.kt', `
      class TestViewUtils { fun waitForView() {} }
    `);
    const entries = idx.getFileSymbols('file:///project/src/androidTest/java/com/TestViewUtils.kt');
    const fun_ = entries.find(e => e.name === 'waitForView');
    expect(isTestFun(fun_!, [])).toBe(false);
  });
});

// ── @Ignore detection ────────────────────────────────────────────────────────

describe('@Ignore / @Disabled detection', () => {
  it('detects @Ignore on fun', () => {
    const syms = parse('file:///test.kt', `
      class FooTest {
        @Ignore
        @Test
        fun skippedTest() {}
      }
    `).symbols;
    const fun_ = syms.find(s => s.name === 'skippedTest');
    expect(fun_?.isIgnored).toBe(true);
    expect(fun_?.isTest).toBe(true);
  });

  it('detects @Disabled (JUnit 5)', () => {
    const syms = parse('file:///test.kt', `
      class FooTest {
        @Disabled("reason")
        @Test
        fun disabledTest() {}
      }
    `).symbols;
    const fun_ = syms.find(s => s.name === 'disabledTest');
    expect(fun_?.isIgnored).toBe(true);
  });

  it('does not mark non-ignored test', () => {
    const syms = parse('file:///test.kt', `
      class FooTest {
        @Test fun normalTest() {}
      }
    `).symbols;
    const fun_ = syms.find(s => s.name === 'normalTest');
    expect(fun_?.isIgnored).toBeUndefined();
  });
});

// ── @RunWith detection ────────────────────────────────────────────────────────

describe('@RunWith / isTestClass detection', () => {
  it('detects @RunWith(AndroidJUnit4::class)', () => {
    const syms = parse('file:///test.kt', `
      @RunWith(AndroidJUnit4::class)
      class MyInstrumentedTest {}
    `).symbols;
    const cls = syms.find(s => s.name === 'MyInstrumentedTest');
    expect(cls?.isTestClass).toBe(true);
  });

  it('detects @RunWith(RobolectricTestRunner::class)', () => {
    const syms = parse('file:///test.kt', `
      @RunWith(RobolectricTestRunner::class)
      class RobolectricTest {}
    `).symbols;
    const cls = syms.find(s => s.name === 'RobolectricTest');
    expect(cls?.isTestClass).toBe(true);
  });

  it('does not mark class without @RunWith', () => {
    const syms = parse('file:///test.kt', `
      class RegularClass {}
    `).symbols;
    const cls = syms.find(s => s.name === 'RegularClass');
    expect(cls?.isTestClass).toBeUndefined();
  });
});

// ── BigApp-style patterns ───────────────────────────────────────────────────

describe('newsapp-style test patterns', () => {
  it('detects standard JUnit 4 test class', () => {
    const code = `
      package com.example.news.media.video

      import org.junit.Test
      import io.mockk.mockk

      @RunWith(RobolectricTestRunner::class)
      class VideoControllerPlayTest {

        private val controller = mockk<VideoController>(relaxed = true)

        @Before
        fun setUp() {
          MockKAnnotations.init(this)
        }

        @Test
        fun \`play starts playback\`() {}

        @Test
        fun \`pause stops playback\`() {}

        @Ignore("flaky in CI")
        @Test
        fun \`skip works\`() {}

        private fun helperMethod() {}
      }
    `;
    const uri = 'file:///project/newsfeed/app/src/test/java/com/example/news/media/video/VideoControllerPlayTest.kt';
    const idx = makeIndex(uri, code, ':newsfeed:app');
    const entries = idx.getFileSymbols(uri);

    const testFuns = entries.filter(e => isTestFun(e, []));
    const names = testFuns.map(e => e.name);

    // Only @Test-annotated funs should be detected (annotation takes priority over path)
    expect(names).toContain('play starts playback');
    expect(names).toContain('pause stops playback');
    expect(names).toContain('skip works');
    // @Before fun and private helper should not be included
    expect(names).not.toContain('setUp');
    expect(names).not.toContain('helperMethod');
  });

  it('detects moduleName for Gradle task building', () => {
    const uri = 'file:///project/newsfeed/app/src/test/java/FooTest.kt';
    const idx = makeIndex(uri, `
      class FooTest { @Test fun testIt() {} }
    `, ':newsfeed:app');
    const entries = idx.getFileSymbols(uri);
    const fun_ = entries.find(e => e.name === 'testIt');
    expect(fun_?.moduleName).toBe(':newsfeed:app');
  });
});
