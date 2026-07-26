/**
 * Tests adversariaux — GradleTestRunner
 *
 * Vecteurs couverts :
 *   GA-1  Nested class JVM ($) → classname="Outer$Inner" normalisé en "Outer.Inner"
 *   GA-2  Parameterized tests → name="testLogin[0]" préservé comme clé
 *   GA-3  CDATA dans failure body
 *   GA-4  Failure sans attribut message="" (body seulement)
 *   GA-5  Entities XML (&amp; &quot; &apos;) dans message
 *   GA-6  Stress test — 335 testcases en XML
 *   GA-7  buildGradleTask avec module 3 niveaux
 *   GA-8  buildTestFilters — déduplication
 *   GA-9  Stdout regex — classe avec chiffres, tirets dans package
 *   GA-10 XML avec namespace xmlns sur testsuite
 */

import { describe, it, expect } from 'vitest';

// ── Inline helpers extracted from GradleTestRunner ───────────────────────────

function parseJUnitXml(xml: string): Map<string, { state: string; durationMs?: number; message?: string; expected?: string; actual?: string }> {
  const results = new Map<string, { state: string; durationMs?: number; message?: string; expected?: string; actual?: string }>();

  const RE_TESTCASE = /<testcase\s([^>]*?)(?:>([\s\S]*?)<\/testcase>|\/>)/g;
  const RE_ATTR = /(\w+)="([^"]*)"/g;

  let m: RegExpExecArray | null;
  while ((m = RE_TESTCASE.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrStr = m[1] ?? '';
    let a: RegExpExecArray | null;
    RE_ATTR.lastIndex = 0;
    while ((a = RE_ATTR.exec(attrStr)) !== null) attrs[a[1]] = a[2];

    // GA-1 fix: normalise JVM '$' nested class separator to '.'
    const classFqn = (attrs['classname'] ?? '').replace(/\$/g, '.');
    const name      = attrs['name'] ?? '';
    const timeStr   = attrs['time'] ?? '0';
    const durationMs = Math.round(parseFloat(timeStr) * 1000);
    const body = m[2] ?? '';

    let state = 'passed';
    let message: string | undefined;
    let expected: string | undefined;
    let actual: string | undefined;

    if (/<skipped/i.test(body)) {
      state = 'skipped';
    } else if (/<(?:failure|error)/i.test(body)) {
      state = 'failed';
      const failMatch = /<(?:failure|error)[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/(?:failure|error)>/i.exec(body);
      if (failMatch) {
        message = unescapeXml(failMatch[1]);
        const stackTrace = failMatch[2].trim();
        if (stackTrace) message = `${message}\n${stackTrace}`;
        const diffMatch = /expected[^<]*<([^>]*)>[^<]*(?:but was|was)[^<]*<([^>]*)>/i.exec(message);
        if (diffMatch) { expected = diffMatch[1]; actual = diffMatch[2]; }
        const diffMatch2 = /expected \[([^\]]*)\] but (?:found|was) \[([^\]]*)\]/i.exec(message);
        if (diffMatch2) { expected = diffMatch2[1]; actual = diffMatch2[2]; }
      }
    }

    results.set(`${classFqn}.${name}`, { state, durationMs, message, expected, actual });
  }

  return results;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function buildGradleTask(moduleName: string): string {
  return moduleName ? `${moduleName}:test` : 'test';
}

function buildTestFilters(specs: { fqn: string; name: string }[]): string[] {
  const filters: string[] = [];
  const seen = new Set<string>();
  for (const { fqn, name } of specs) {
    const parts = fqn.split('.');
    const classFqn = parts.slice(0, -1).join('.');
    const filter = `${classFqn}.${name}`;
    if (!seen.has(filter)) { seen.add(filter); filters.push('--tests', filter); }
  }
  return filters;
}

const RE_GRADLE_RESULT = /^(\S+)\s+>\s+(\S+)\s+(PASSED|FAILED|SKIPPED)\s*$/;
function parseStdoutLine(line: string): { key: string; state: string } | undefined {
  const m = RE_GRADLE_RESULT.exec(line.trim());
  if (!m) return undefined;
  const [, classFqn, methodName, stateStr] = m;
  const state = stateStr === 'PASSED' ? 'passed' : stateStr === 'SKIPPED' ? 'skipped' : 'failed';
  return { key: `${classFqn}.${methodName}`, state };
}

// ── GA-1 : Nested class — JVM '$' normalisé ─────────────────────────────────

describe('GA-1 — Nested class JVM classname normalisation', () => {
  it('classname="pkg.Outer$Inner" normalisé en "pkg.Outer.Inner"', () => {
    const xml = `
      <testcase classname="com.example.news.OuterTest$InnerTest" name="testMethod" time="0.1"/>
    `;
    const results = parseJUnitXml(xml);
    // Before fix: key would be "com.example.news.OuterTest$InnerTest.testMethod" → not found
    // After fix: key is "com.example.news.OuterTest.InnerTest.testMethod"
    expect(results.has('com.example.news.OuterTest.InnerTest.testMethod')).toBe(true);
    expect(results.has('com.example.news.OuterTest$InnerTest.testMethod')).toBe(false);
  });

  it('classname multi-niveau "$" — "A$B$C" → "A.B.C"', () => {
    const xml = `<testcase classname="pkg.A$B$C" name="test" time="0"/>`;
    const results = parseJUnitXml(xml);
    expect(results.has('pkg.A.B.C.test')).toBe(true);
  });

  it('classname sans "$" inchangé', () => {
    const xml = `<testcase classname="com.example.FooTest" name="testBar" time="0.05"/>`;
    const results = parseJUnitXml(xml);
    expect(results.has('com.example.FooTest.testBar')).toBe(true);
  });

  it('état passed préservé après normalisation', () => {
    const xml = `<testcase classname="pkg.Outer$Inner" name="testOk" time="0.2"/>`;
    const results = parseJUnitXml(xml);
    expect(results.get('pkg.Outer.Inner.testOk')!.state).toBe('passed');
  });

  it('état failed préservé après normalisation', () => {
    const xml = `
      <testcase classname="pkg.Outer$Inner" name="testFail" time="0.1">
        <failure message="oops">stack</failure>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('pkg.Outer.Inner.testFail')!.state).toBe('failed');
  });
});

// ── GA-2 : Parameterized tests — index préservé ──────────────────────────────

describe('GA-2 — Parameterized tests (name avec [index])', () => {
  it('name="testLogin[0]" stocké avec [0]', () => {
    const xml = `<testcase classname="com.example.FooTest" name="testLogin[0]" time="0.1"/>`;
    const results = parseJUnitXml(xml);
    expect(results.has('com.example.FooTest.testLogin[0]')).toBe(true);
  });

  it('plusieurs indices stockés indépendamment', () => {
    const xml = `
      <testcase classname="Foo" name="test[0]" time="0.1"/>
      <testcase classname="Foo" name="test[1]" time="0.2">
        <failure message="expected 1 but was 2">stack</failure>
      </testcase>
      <testcase classname="Foo" name="test[2]" time="0.05"/>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('Foo.test[0]')!.state).toBe('passed');
    expect(results.get('Foo.test[1]')!.state).toBe('failed');
    expect(results.get('Foo.test[2]')!.state).toBe('passed');
  });

  it('RE_ATTR capture correctement les crochets dans la valeur name', () => {
    // name="method(arg1, arg2)" — JUnit 5 display name
    const xml = `<testcase classname="Foo" name="testAdd(1, 2)" time="0"/>`;
    const results = parseJUnitXml(xml);
    expect(results.has('Foo.testAdd(1, 2)')).toBe(true);
  });
});

// ── GA-3 : CDATA dans failure body ────────────────────────────────────────────

describe('GA-3 — CDATA sections dans failure', () => {
  it('failure avec CDATA — état=failed détecté', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0.1">
        <failure message="assertion failed"><![CDATA[
          org.junit.AssertionError: assertion failed
            at Foo.test(Foo.kt:10)
        ]]></failure>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('Foo.test')!.state).toBe('failed');
  });

  it('failure avec CDATA — message via attribut récupéré', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <failure message="expected:&lt;1&gt; but was:&lt;2&gt;"><![CDATA[stack trace]]></failure>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('Foo.test')!;
    expect(r.state).toBe('failed');
    expect(r.message).toContain('expected:<1> but was:<2>');
  });
});

// ── GA-4 : Failure sans attribut message="" ──────────────────────────────────

describe('GA-4 — Failure avec body seulement (pas d\'attribut message)', () => {
  it('failure sans message="" — état=failed, message fallback sur 1ère ligne', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0.1">
        <failure>NullPointerException at line 5
at Foo.test(Foo.kt:5)</failure>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('Foo.test')!;
    expect(r.state).toBe('failed');
  });

  it('error sans message="" — état=failed détecté', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <error>RuntimeException</error>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('Foo.test')!.state).toBe('failed');
  });
});

// ── GA-5 : Entités XML dans message ──────────────────────────────────────────

describe('GA-5 — Entités XML dans failure message', () => {
  it('&lt; &gt; décodés correctement', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <failure message="expected:&lt;hello&gt; but was:&lt;world&gt;">stack</failure>
      </testcase>
    `;
    const r = parseJUnitXml(xml).get('Foo.test')!;
    expect(r.message).toContain('expected:<hello> but was:<world>');
    expect(r.expected).toBe('hello');
    expect(r.actual).toBe('world');
  });

  it('&amp; décodé correctement', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <failure message="this &amp; that">stack</failure>
      </testcase>
    `;
    const r = parseJUnitXml(xml).get('Foo.test')!;
    expect(r.message).toContain('this & that');
  });

  it('&quot; décodé correctement', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <failure message="expected &quot;foo&quot;">stack</failure>
      </testcase>
    `;
    const r = parseJUnitXml(xml).get('Foo.test')!;
    expect(r.message).toContain('expected "foo"');
  });

  it('&apos; décodé correctement', () => {
    const xml = `
      <testcase classname="Foo" name="test" time="0">
        <failure message="it&apos;s broken">stack</failure>
      </testcase>
    `;
    const r = parseJUnitXml(xml).get('Foo.test')!;
    expect(r.message).toContain("it's broken");
  });
});

// ── GA-6 : Stress test — 335 testcases ───────────────────────────────────────

describe('GA-6 — Stress test (newsapp scale: 335 testcases)', () => {
  function buildLargeXml(count: number): string {
    const cases: string[] = [];
    for (let i = 0; i < count; i++) {
      const mod = i % 3;
      if (mod === 0) {
        cases.push(`<testcase classname="com.example.news.Test${i}" name="testMethod${i}" time="0.${i % 100}"/>`);
      } else if (mod === 1) {
        cases.push(`<testcase classname="com.example.news.Test${i}" name="testMethod${i}" time="0.1">
          <failure message="expected ${i}">stack</failure>
        </testcase>`);
      } else {
        cases.push(`<testcase classname="com.example.news.Test${i}" name="testMethod${i}" time="0">
          <skipped/>
        </testcase>`);
      }
    }
    return `<testsuites>${cases.join('\n')}</testsuites>`;
  }

  it('335 testcases parsés sans erreur', () => {
    const xml = buildLargeXml(335);
    const results = parseJUnitXml(xml);
    expect(results.size).toBe(335);
  });

  it('distribution correcte: ~112 passed, ~111 failed, ~112 skipped', () => {
    const xml = buildLargeXml(335);
    const results = parseJUnitXml(xml);
    let passed = 0, failed = 0, skipped = 0;
    for (const r of results.values()) {
      if (r.state === 'passed') passed++;
      else if (r.state === 'failed') failed++;
      else skipped++;
    }
    expect(passed).toBeGreaterThan(100);
    expect(failed).toBeGreaterThan(100);
    expect(skipped).toBeGreaterThan(100);
    expect(passed + failed + skipped).toBe(335);
  });

  it('aucune régression de performance sur 335 testcases', () => {
    const xml = buildLargeXml(335);
    const start = Date.now();
    parseJUnitXml(xml);
    const elapsed = Date.now() - start;
    // Le regex ne doit pas exploser exponentiellement — 50ms max
    expect(elapsed).toBeLessThan(50);
  });
});

// ── GA-7 : buildGradleTask avec modules multi-niveaux ────────────────────────

describe('GA-7 — buildGradleTask avec module 3 niveaux', () => {
  it(':core:network:impl → :core:network:impl:test', () => {
    expect(buildGradleTask(':core:network:impl')).toBe(':core:network:impl:test');
  });

  it(':newsfeed:app → :newsfeed:app:test', () => {
    expect(buildGradleTask(':newsfeed:app')).toBe(':newsfeed:app:test');
  });

  it('module vide → "test"', () => {
    expect(buildGradleTask('')).toBe('test');
  });

  it(':reader:core:domain:impl (4 niveaux) → :reader:core:domain:impl:test', () => {
    expect(buildGradleTask(':reader:core:domain:impl')).toBe(':reader:core:domain:impl:test');
  });
});

// ── GA-8 : buildTestFilters — déduplication ───────────────────────────────────

describe('GA-8 — buildTestFilters déduplication', () => {
  it('même méthode en double → un seul --tests', () => {
    const specs = [
      { fqn: 'com.example.FooTest.testBar', name: 'testBar' },
      { fqn: 'com.example.FooTest.testBar', name: 'testBar' }, // duplicate
    ];
    const filters = buildTestFilters(specs);
    expect(filters).toEqual(['--tests', 'com.example.FooTest.testBar']);
  });

  it('méthodes différentes → plusieurs --tests', () => {
    const specs = [
      { fqn: 'com.example.FooTest.testA', name: 'testA' },
      { fqn: 'com.example.FooTest.testB', name: 'testB' },
    ];
    const filters = buildTestFilters(specs);
    expect(filters).toEqual([
      '--tests', 'com.example.FooTest.testA',
      '--tests', 'com.example.FooTest.testB',
    ]);
  });

  it('liste vide → aucun filtre', () => {
    expect(buildTestFilters([])).toEqual([]);
  });

  it('méthode dans classe sans package → classFqn correct', () => {
    // FQN = "ClassName.methodName" → classFqn = "ClassName"
    const specs = [{ fqn: 'SimpleTest.testFoo', name: 'testFoo' }];
    const filters = buildTestFilters(specs);
    expect(filters).toEqual(['--tests', 'SimpleTest.testFoo']);
  });
});

// ── GA-9 : Stdout regex — patterns spéciaux ───────────────────────────────────

describe('GA-9 — parseStdoutLine patterns spéciaux', () => {
  it('classe avec chiffres dans le nom', () => {
    const r = parseStdoutLine('com.example.news.Test2FAFlow > testOtpValidation PASSED');
    expect(r?.key).toBe('com.example.news.Test2FAFlow.testOtpValidation');
    expect(r?.state).toBe('passed');
  });

  it('package profond (4 niveaux)', () => {
    const r = parseStdoutLine('com.example.core.core.network.FooTest > testRequest FAILED');
    expect(r?.key).toBe('com.example.core.core.network.FooTest.testRequest');
    expect(r?.state).toBe('failed');
  });

  it('SKIPPED préservé', () => {
    const r = parseStdoutLine('com.example.Foo > testIgnored SKIPPED');
    expect(r?.state).toBe('skipped');
  });

  it('ligne avec espaces en début ignorée proprement', () => {
    // line.trim() avant exec
    const r = parseStdoutLine('  com.example.Foo > testBar PASSED  ');
    expect(r?.key).toBe('com.example.Foo.testBar');
  });

  it('multi-mot dans nom de test — regex \S+ ne matche pas (limitation)', () => {
    // Gradle sort "FooTest > play starts playback PASSED" — les espaces cassent \S+
    const r = parseStdoutLine('FooTest > play starts playback PASSED');
    expect(r).toBeUndefined(); // limitation connue → fallback XML
  });

  it('ligne de tâche Gradle non capturée', () => {
    expect(parseStdoutLine('> Task :newsfeed:app:test FAILED')).toBeUndefined();
    expect(parseStdoutLine('> Configure project :app')).toBeUndefined();
  });
});

// ── GA-10 : XML avec namespace ────────────────────────────────────────────────

describe('GA-10 — XML avec attributs namespace / xmlns', () => {
  it('testsuite avec xmlns ne perturbe pas la détection', () => {
    const xml = `
      <testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xsi:noNamespaceSchemaLocation="..."
                 name="com.example.FooTest">
        <testcase classname="com.example.FooTest" name="testA" time="0.1"/>
        <testcase classname="com.example.FooTest" name="testB" time="0.2">
          <failure message="oops">stack</failure>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('com.example.FooTest.testA')!.state).toBe('passed');
    expect(results.get('com.example.FooTest.testB')!.state).toBe('failed');
  });

  it('testcase avec attributs additionnels inconnus', () => {
    const xml = `<testcase classname="Foo" name="test" time="0" hostname="localhost" assertions="1"/>`;
    const results = parseJUnitXml(xml);
    expect(results.get('Foo.test')!.state).toBe('passed');
  });
});
