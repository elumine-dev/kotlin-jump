import { describe, it, expect } from 'vitest';
import { parseStdoutLine as parseStdoutLineReal, parseJUnitXml as parseJUnitXmlReal, TestResult } from '../../src/testing/GradleTestRunner';

// ── Test XML parsing logic (extracted for unit testing) ────────────────────

// Le vrai parseur du module, pas une reconstitution. Celle qui vivait ici
// ignorait la normalisation des noms JUnit 5, celle des classes imbriquees
// (`Outer$Inner`) et le desechappement XML : les trois pouvaient etre
// debranchees du module sans qu'un seul test bronche.
function parseJUnitXml(xml: string) {
  const results = new Map<string, TestResult>();
  parseJUnitXmlReal(xml, results);
  return results;
}

// Le vrai parseur, pas une copie : la version recopiee ici portait encore
// `\\S+` pour le nom de methode alors que le module accepte les noms en
// backticks depuis longtemps, et personne ne l'a vu.
function parseStdoutLine(line: string): { key: string; state: string } | undefined {
  const results = new Map<string, { classFqn: string; methodName: string; state: string }>();
  parseStdoutLineReal(line, results as never);
  const premier = [...results.entries()][0];
  return premier ? { key: premier[0], state: premier[1].state } : undefined;
}

// ── XML parsing tests ────────────────────────────────────────────────────────

describe('parseJUnitXml', () => {
  // Les trois normalisations du module pouvaient etre debranchees sans qu'un
  // seul test bronche : la reconstitution qui vivait dans ce fichier ne les
  // faisait pas, donc personne ne les exercait.

  it('normalise un nom JUnit 5 pour qu il rejoigne le symbole indexe', () => {
    const xml = '<testsuite><testcase classname="com.example.FooTest" name="myTest()" time="0.01"/></testsuite>';
    const results = parseJUnitXml(xml);
    // Sans la normalisation la cle serait `...myTest()`, que l'index ne porte
    // pas : le test restait affiche comme jamais execute.
    expect([...results.keys()]).toEqual(['com.example.FooTest.myTest']);
  });

  it('normalise un nom de test parametre', () => {
    const xml = '<testsuite><testcase classname="com.example.FooTest" name="myTest(String)[1] - val" time="0"/></testsuite>';
    expect([...parseJUnitXml(xml).keys()]).toEqual(['com.example.FooTest.myTest']);
  });

  it('ramene une classe imbriquee JVM sur la forme Kotlin', () => {
    const xml = '<testsuite><testcase classname="com.example.Outer$Inner" name="works" time="0"/></testsuite>';
    expect([...parseJUnitXml(xml).keys()]).toEqual(['com.example.Outer.Inner.works']);
  });

  it('desechappe les entites XML du message d echec', () => {
    const xml = '<testsuite><testcase classname="com.example.FooTest" name="t" time="0">'
      + '<failure message="expected &quot;a&quot; but was &quot;b&quot; and l&apos;objet">trace</failure>'
      + '</testcase></testsuite>';
    const r = parseJUnitXml(xml).get('com.example.FooTest.t')!;
    expect(r.state).toBe('failed');
    expect(r.message).toContain('expected "a" but was "b"');
    expect(r.message).toContain("l'objet");
    expect(r.message).not.toContain('&quot;');
    expect(r.message).not.toContain('&apos;');
  });

  it('parses a passing test', () => {
    const xml = `
      <testsuite name="com.example.FooTest">
        <testcase classname="com.example.FooTest" name="testSuccess" time="0.123"/>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('com.example.FooTest.testSuccess');
    expect(r).toBeDefined();
    expect(r!.state).toBe('passed');
    expect(r!.durationMs).toBe(123);
  });

  it('parses a failing test with message', () => {
    const xml = `
      <testsuite>
        <testcase classname="com.example.FooTest" name="testFail" time="0.5">
          <failure message="expected:&lt;1&gt; but was:&lt;2&gt;">
            org.junit.ComparisonFailure: expected:&lt;1&gt; but was:&lt;2&gt;
              at FooTest.testFail(FooTest.kt:15)
          </failure>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('com.example.FooTest.testFail');
    expect(r!.state).toBe('failed');
    expect(r!.message).toContain('expected:<1> but was:<2>');
    expect(r!.durationMs).toBe(500);
  });

  it('extracts expected/actual for diff view (JUnit 4 format)', () => {
    const xml = `
      <testsuite>
        <testcase classname="com.example.FooTest" name="testDiff" time="0.1">
          <failure message="expected:&lt;hello&gt; but was:&lt;world&gt;">stack</failure>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('com.example.FooTest.testDiff');
    expect(r!.expected).toBe('hello');
    expect(r!.actual).toBe('world');
  });

  it('parses a skipped test', () => {
    const xml = `
      <testsuite>
        <testcase classname="com.example.FooTest" name="testSkip" time="0">
          <skipped/>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    const r = results.get('com.example.FooTest.testSkip');
    expect(r!.state).toBe('skipped');
  });

  it('handles multiple test cases in one testsuite', () => {
    const xml = `
      <testsuite name="com.example.news.FooTest">
        <testcase classname="com.example.news.FooTest" name="testA" time="0.1"/>
        <testcase classname="com.example.news.FooTest" name="testB" time="0.2">
          <failure message="oops">stacktrace</failure>
        </testcase>
        <testcase classname="com.example.news.FooTest" name="testC" time="0">
          <skipped/>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('com.example.news.FooTest.testA')!.state).toBe('passed');
    expect(results.get('com.example.news.FooTest.testB')!.state).toBe('failed');
    expect(results.get('com.example.news.FooTest.testC')!.state).toBe('skipped');
  });

  it('handles self-closing testcase (no body)', () => {
    const xml = `<testcase classname="pkg.Test" name="ok" time="0.01"/>`;
    const results = parseJUnitXml(xml);
    expect(results.get('pkg.Test.ok')!.state).toBe('passed');
  });
});

// ── Gradle command building ───────────────────────────────────────────────────

describe('Gradle --tests filter syntax', () => {
  it('uses dot separator (not #) for method filter', () => {
    // Gradle requires "pkg.ClassName.methodName", not "pkg.ClassName#methodName"
    const classFqn = 'com.example.news.FooTest';
    const method = 'testGetUser';
    const filter = `${classFqn}.${method}`;
    expect(filter).toBe('com.example.news.FooTest.testGetUser');
    expect(filter).not.toContain('#');
  });

  it('builds module task correctly from moduleName', () => {
    const moduleName = ':newsfeed:app';
    const task = `${moduleName}:test`;
    expect(task).toBe(':newsfeed:app:test');
  });

  it('builds root task when moduleName is empty', () => {
    const moduleName = '';
    const task = moduleName ? `${moduleName}:test` : 'test';
    expect(task).toBe('test');
  });
});

// ── Stdout parsing ────────────────────────────────────────────────────────────

describe('parseStdoutLine (Gradle output)', () => {
  it('parses PASSED line', () => {
    const r = parseStdoutLine('com.example.news.FooTest > testGetUser PASSED');
    expect(r).toBeDefined();
    expect(r!.key).toBe('com.example.news.FooTest.testGetUser');
    expect(r!.state).toBe('passed');
  });

  it('parses FAILED line', () => {
    const r = parseStdoutLine('com.example.news.FooTest > testError FAILED');
    expect(r!.state).toBe('failed');
  });

  it('parses SKIPPED line', () => {
    const r = parseStdoutLine('com.example.news.FooTest > testSkipped SKIPPED');
    expect(r!.state).toBe('skipped');
  });

  it('ignores non-result lines', () => {
    expect(parseStdoutLine('> Task :newsfeed:app:test')).toBeUndefined();
    expect(parseStdoutLine('BUILD SUCCESSFUL in 12s')).toBeUndefined();
    expect(parseStdoutLine('')).toBeUndefined();
    expect(parseStdoutLine('Starting Gradle Daemon...')).toBeUndefined();
  });

  it('matches a multi-word test name, backticks or not', () => {
    // Gradle strips the backticks and prints the words. The module reads the
    // method name lazily for that reason; this test asserted the opposite,
    // because it ran against its own copy of an older regex.
    expect(parseStdoutLine('com.example.news.FooTest > play starts playback PASSED'))
      .toEqual({ key: 'com.example.news.FooTest.play starts playback', state: 'passed' });
    // Backticks kept by an older Gradle: they belong to the name, nothing else changes.
    expect(parseStdoutLine('com.example.news.FooTest > `play starts playback` PASSED'))
      .toEqual({ key: 'com.example.news.FooTest.`play starts playback`', state: 'passed' });
  });
});

// ── Adversarial: XML edge cases ───────────────────────────────────────────────

describe('parseJUnitXml — adversarial', () => {
  it('handles malformed time attribute gracefully', () => {
    const xml = `<testcase classname="Foo" name="bar" time="N/A" />`;
    const results = parseJUnitXml(xml);
    const r = results.get('Foo.bar');
    expect(r).toBeDefined();
    expect(Number.isNaN(r!.durationMs)).toBe(true); // NaN from parseFloat("N/A") — acceptable
  });

  it('handles missing classname attribute', () => {
    const xml = `<testcase name="test" time="0"/>`;
    const results = parseJUnitXml(xml);
    // Key is ".test" — degenerate but no crash
    expect(results.has('.test')).toBe(true);
  });

  it('handles error element instead of failure', () => {
    const xml = `
      <testcase classname="Foo" name="bar" time="0">
        <error message="NullPointerException">NPE stack</error>
      </testcase>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('Foo.bar')!.state).toBe('failed');
    expect(results.get('Foo.bar')!.message).toBe('NullPointerException\nNPE stack');
  });

  it('handles multiple testsuites in one XML', () => {
    const xml = `
      <testsuites>
        <testsuite name="Foo">
          <testcase classname="Foo" name="a" time="0"/>
        </testsuite>
        <testsuite name="Bar">
          <testcase classname="Bar" name="b" time="0"/>
        </testsuite>
      </testsuites>
    `;
    const results = parseJUnitXml(xml);
    expect(results.has('Foo.a')).toBe(true);
    expect(results.has('Bar.b')).toBe(true);
  });
});

// ── findGradleModuleByPath — module path derivation from file location ─────

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach } from 'vitest';
import { findGradleModuleByPath } from '../../src/testing/GradleTestRunner';

describe('findGradleModuleByPath', () => {
  let tmpRoot: string;
  beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-mod-')); });
  afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  function touch(rel: string): string {
    const abs = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
    return abs;
  }

  it('M1. simple module: app/src/test/Foo.kt + app/build.gradle.kts → :app', () => {
    touch('settings.gradle.kts');
    touch('app/build.gradle.kts');
    const file = touch('app/src/test/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe(':app');
  });

  it('M2. sub-module: app/sub/src/test/Foo.kt + app/sub/build.gradle.kts → :app:sub', () => {
    touch('settings.gradle.kts');
    touch('app/sub/build.gradle.kts');
    const file = touch('app/sub/src/test/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe(':app:sub');
  });

  it('M3. file at root + build.gradle at root → empty (root project)', () => {
    touch('build.gradle.kts');
    const file = touch('src/test/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe('');
  });

  it('M4. no build.gradle anywhere up to root → empty', () => {
    const file = touch('src/test/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe('');
  });

  it('M5. module 2 levels deep: services/api → :services:api', () => {
    touch('settings.gradle.kts');
    touch('services/api/build.gradle.kts');
    const file = touch('services/api/src/main/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe(':services:api');
  });

  it('M6. Groovy build.gradle (no .kts) is also recognised', () => {
    touch('settings.gradle');
    touch('app/build.gradle');
    const file = touch('app/src/test/kotlin/Foo.kt');
    expect(findGradleModuleByPath(file, tmpRoot)).toBe(':app');
  });

  it('M7. file outside projectRoot → empty (guard against infinite walk-up)', () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-other-'));
    try {
      const fileOutside = path.join(otherRoot, 'src', 'test', 'Foo.kt');
      fs.mkdirSync(path.dirname(fileOutside), { recursive: true });
      fs.writeFileSync(fileOutside, '');
      expect(findGradleModuleByPath(fileOutside, tmpRoot)).toBe('');
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});
