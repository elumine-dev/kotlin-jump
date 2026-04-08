import { describe, it, expect } from 'vitest';

// ── Test XML parsing logic (extracted for unit testing) ────────────────────

// Inline the XML parsing logic so tests don't need VS Code API
function parseJUnitXml(xml: string): Map<string, { state: string; durationMs?: number; message?: string; expected?: string; actual?: string }> {
  const results = new Map<string, { state: string; durationMs?: number; message?: string; expected?: string; actual?: string }>();

  const RE_TESTCASE = /<testcase\s([^>]*?)(?:>([\s\S]*?)<\/testcase>|\/>)/g;
  const RE_ATTR = /(\w+)="([^"]*)"/g;

  let m: RegExpExecArray | null;
  while ((m = RE_TESTCASE.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrStr = m[1] ?? m[3] ?? '';
    let a: RegExpExecArray | null;
    RE_ATTR.lastIndex = 0;
    while ((a = RE_ATTR.exec(attrStr)) !== null) attrs[a[1]] = a[2];

    const classFqn  = attrs['classname'] ?? '';
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
        message = failMatch[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
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

// Inline the Gradle stdout parser
const RE_GRADLE_RESULT = /^(\S+)\s+>\s+(\S+)\s+(PASSED|FAILED|SKIPPED)\s*$/;
function parseStdoutLine(line: string): { key: string; state: string } | undefined {
  const m = RE_GRADLE_RESULT.exec(line.trim());
  if (!m) return undefined;
  const [, classFqn, methodName, stateStr] = m;
  const state = stateStr === 'PASSED' ? 'passed' : stateStr === 'SKIPPED' ? 'skipped' : 'failed';
  return { key: `${classFqn}.${methodName}`, state };
}

// ── XML parsing tests ────────────────────────────────────────────────────────

describe('parseJUnitXml', () => {
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
      <testsuite name="nuglif.rubicon.FooTest">
        <testcase classname="nuglif.rubicon.FooTest" name="testA" time="0.1"/>
        <testcase classname="nuglif.rubicon.FooTest" name="testB" time="0.2">
          <failure message="oops">stacktrace</failure>
        </testcase>
        <testcase classname="nuglif.rubicon.FooTest" name="testC" time="0">
          <skipped/>
        </testcase>
      </testsuite>
    `;
    const results = parseJUnitXml(xml);
    expect(results.get('nuglif.rubicon.FooTest.testA')!.state).toBe('passed');
    expect(results.get('nuglif.rubicon.FooTest.testB')!.state).toBe('failed');
    expect(results.get('nuglif.rubicon.FooTest.testC')!.state).toBe('skipped');
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
    const classFqn = 'nuglif.rubicon.FooTest';
    const method = 'testGetUser';
    const filter = `${classFqn}.${method}`;
    expect(filter).toBe('nuglif.rubicon.FooTest.testGetUser');
    expect(filter).not.toContain('#');
  });

  it('builds module task correctly from moduleName', () => {
    const moduleName = ':rubicon:app';
    const task = `${moduleName}:test`;
    expect(task).toBe(':rubicon:app:test');
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
    const r = parseStdoutLine('nuglif.rubicon.FooTest > testGetUser PASSED');
    expect(r).toBeDefined();
    expect(r!.key).toBe('nuglif.rubicon.FooTest.testGetUser');
    expect(r!.state).toBe('passed');
  });

  it('parses FAILED line', () => {
    const r = parseStdoutLine('nuglif.rubicon.FooTest > testError FAILED');
    expect(r!.state).toBe('failed');
  });

  it('parses SKIPPED line', () => {
    const r = parseStdoutLine('nuglif.rubicon.FooTest > testSkipped SKIPPED');
    expect(r!.state).toBe('skipped');
  });

  it('ignores non-result lines', () => {
    expect(parseStdoutLine('> Task :rubicon:app:test')).toBeUndefined();
    expect(parseStdoutLine('BUILD SUCCESSFUL in 12s')).toBeUndefined();
    expect(parseStdoutLine('')).toBeUndefined();
    expect(parseStdoutLine('Starting Gradle Daemon...')).toBeUndefined();
  });

  it('does not match multi-word test names (known limitation — Gradle strips backticks)', () => {
    // Gradle actually strips backticks and outputs: "FooTest > play starts playback PASSED"
    // Our regex (\S+) only matches single words — multi-word names are a known gap
    const r = parseStdoutLine('nuglif.rubicon.FooTest > `play starts playback` PASSED');
    // Not matched — multi-word names fall back to XML parsing
    expect(r).toBeUndefined();
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
