import { describe, it, expect } from 'vitest';
import { LogcatLineParser, STACK_FRAME_REGEX } from '../../src/logcat/LogcatLineParser';

function parseAll(lines: string[]) {
  const parser = new LogcatLineParser();
  let n = 0;
  const out = [];
  for (const line of lines) {
    const e = parser.feed(line, () => n++);
    if (e) out.push(e);
  }
  const last = parser.flush();
  if (last) out.push(last);
  return out;
}

describe('LogcatLineParser — prefix lines', () => {
  it('parses a standard threadtime,year line', () => {
    const [e] = parseAll([
      '2026-01-15 12:34:56.789  1234  5678 D MyTag: hello world',
    ]);
    expect(e).toMatchObject({
      pid: 1234, tid: 5678, level: 'D', tag: 'MyTag', message: 'hello world',
    });
    expect(new Date(e!.ts).toISOString()).toMatch(/^2026-01-15T/);
  });

  it('handles tags with spaces (tag captures everything before the colon)', () => {
    const [e] = parseAll([
      '2026-01-15 12:34:56.789  1234  5678 I My Spaced Tag: payload',
    ]);
    expect(e!.tag).toBe('My Spaced Tag');
    expect(e!.message).toBe('payload');
  });

  it('parses every level letter', () => {
    for (const lvl of ['V', 'D', 'I', 'W', 'E', 'F'] as const) {
      const [e] = parseAll([`2026-01-15 12:34:56.789  1  2 ${lvl} Tag: m`]);
      expect(e!.level).toBe(lvl);
    }
  });

  it('does not match lines with malformed timestamps', () => {
    const out = parseAll(['XX-01-15 12:34:56.789  1  2 D Tag: m']);
    expect(out).toHaveLength(0); // no entry produced; line is dropped
  });

  it('produces monotonic seq ids', () => {
    const out = parseAll([
      '2026-01-15 12:34:56.789  1  2 I A: a',
      '2026-01-15 12:34:56.790  1  2 I B: b',
      '2026-01-15 12:34:56.791  1  2 I C: c',
    ]);
    expect(out.map(e => e.seq)).toEqual([0, 1, 2]);
  });
});

describe('LogcatLineParser — continuation lines', () => {
  it('joins indented stack frames into the previous entry', () => {
    const out = parseAll([
      '2026-01-15 12:34:56.789  1  2 E AndroidRuntime: FATAL EXCEPTION: main',
      '\tat com.app.MainActivity.onCreate(MainActivity.kt:42)',
      '\tat com.app.MainActivity.onResume(MainActivity.kt:51)',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toContain('FATAL EXCEPTION: main');
    expect(out[0]!.message).toContain('MainActivity.kt:42');
    expect(out[0]!.message).toContain('MainActivity.kt:51');
    expect(out[0]!.isStackFrame).toBe(true);
  });

  it('drops continuation lines that arrive before any prefix', () => {
    const out = parseAll([
      '\tat com.app.X.fn(X.kt:1)',  // orphaned — no parent yet
      '2026-01-15 12:34:56.789  1  2 I T: m',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toBe('m');
  });

  it('flushes the in-flight entry on stream end', () => {
    const parser = new LogcatLineParser();
    let n = 0;
    parser.feed('2026-01-15 12:34:56.789  1  2 I T: hi', () => n++);
    expect(parser.flush()).not.toBeNull();
    expect(parser.flush()).toBeNull();
  });
});

describe('STACK_FRAME_REGEX coverage', () => {
  const matches = (line: string) => STACK_FRAME_REGEX.test(line);

  it('matches Kotlin top-level synthetic class', () => {
    expect(matches('\tat com.app.MainActivityKt.onResume(MainActivity.kt:42)')).toBe(true);
  });

  it('matches Java standard frames', () => {
    expect(matches('\tat com.app.MainActivity.onCreate(MainActivity.java:42)')).toBe(true);
  });

  it('matches inner classes via $', () => {
    expect(matches('\tat com.app.Outer$Inner.foo(Outer.kt:42)')).toBe(true);
  });

  it('matches Compose recomposition frames', () => {
    expect(matches('\tat androidx.compose.runtime.RecomposerKt.recompose(Recomposer.kt:42)')).toBe(true);
  });

  it('matches coroutine internal frames', () => {
    expect(matches('\tat kotlinx.coroutines.internal.LimitedDispatcher.dispatch(LimitedDispatcher.kt:42)')).toBe(true);
  });

  it('matches inline-class lambda frames', () => {
    expect(matches('\tat com.app.MainKt$$inlined$flow$1.invokeSuspend(Main.kt:42)')).toBe(true);
  });

  it('rejects non-frame lines', () => {
    expect(matches('Caused by: java.lang.IllegalStateException: oops')).toBe(false);
    expect(matches('\t... 12 more')).toBe(false);
    expect(matches('hello world')).toBe(false);
  });
});
