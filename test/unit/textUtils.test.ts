import { describe, it, expect } from 'vitest';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../../src/util/textUtils';

// ── isInsideCommentOrString — normal code ─────────────────────────────────────

describe('isInsideCommentOrString — normal code positions', () => {
  it('returns false for a word on a plain line with no strings or comments', () => {
    expect(isInsideCommentOrString('val x = foo()', 8)).toBe(false); // 'f' in 'foo'
  });

  it('returns false for position 0 on a plain line', () => {
    expect(isInsideCommentOrString('class Foo {}', 0)).toBe(false);
  });

  it('returns false for position at end of plain identifier', () => {
    expect(isInsideCommentOrString('fun greet()', 3)).toBe(false); // 'g'
  });
});

// ── isInsideCommentOrString — string literals ─────────────────────────────────

describe('isInsideCommentOrString — string literals', () => {
  it('returns true for position inside a double-quoted string', () => {
    // `"hello"`: h=1, e=2, l=3, l=4, o=5
    expect(isInsideCommentOrString('"hello"', 3)).toBe(true); // 'l'
  });

  it('returns true at the opening quote character itself', () => {
    // Reaching `"` sets inStr and then checks i===pos → returns true
    expect(isInsideCommentOrString('"hello"', 0)).toBe(true); // opening "
  });

  it('returns false after the closing quote', () => {
    // `"hi" foo`: after `"` at index 3, next chars are outside string
    // "hi" = "(0)h(1)i(2)"(3) (4)f(5)o(6)o(7)
    expect(isInsideCommentOrString('"hi" foo', 5)).toBe(false); // 'f'
  });

  it('returns true for position inside a single-quoted char literal', () => {
    // `'x'`: x is at index 1
    expect(isInsideCommentOrString("'x'", 1)).toBe(true);
  });

  it('returns true at the opening single-quote', () => {
    expect(isInsideCommentOrString("'x'", 0)).toBe(true);
  });

  it('returns false for position after a closed string', () => {
    // `"a"b` — 'b' at index 3 is outside the string
    expect(isInsideCommentOrString('"a"b', 3)).toBe(false);
  });

  it('handles empty string — no crash', () => {
    // `""` — positions 0 (open ") returns true, position 2 is beyond → false
    expect(isInsideCommentOrString('""', 0)).toBe(true); // opening quote
    // closing quote: i=1 in inStr branch → line[i]===inStr → inStr=false; continue (not i===pos check)
    // → loop ends → returns !!inStr = false
    expect(isInsideCommentOrString('""', 1)).toBe(false); // closing quote, closed state
  });
});

// ── isInsideCommentOrString — escape sequences ────────────────────────────────

describe('isInsideCommentOrString — escape sequences inside strings', () => {
  it('treats char after \\ as escaped — position is still inside string', () => {
    // `"say \"hi\""`: after the backslash at index 5, index 6 is the escaped `"` and is skipped
    // The `h` at index 7 is still inside the outer string
    const line = '"say \\"hi\\""';
    // Indices: "(0)s(1)a(2)y(3) (4)\(5)"(6)h(7)i(8)\(9)"(10)"(11)
    expect(isInsideCommentOrString(line, 7)).toBe(true); // 'h' after escaped quote
  });

  it('escaped backslash at end of string does not consume the closing quote', () => {
    // `"a\\"` — the `\\` is an escaped backslash; the `"` at index 4 closes the string
    // Actually in JS strings: `"a\\\\"` is the JS literal for the string `a\\`
    // As a raw line: a  \  \  "   → `"a\\"` in the actual file
    // i=0: " → inStr="; i=1: a → inside; i=2: \ → i++ → i becomes 3, skip; i=4: " → close
    const line = '"a\\\\"';
    expect(isInsideCommentOrString(line, 1)).toBe(true);  // 'a' inside string
    expect(isInsideCommentOrString(line, 4)).toBe(false); // after closing "
  });
});

// ── isInsideCommentOrString — line comments ───────────────────────────────────

describe('isInsideCommentOrString — // line comments', () => {
  it('returns true for position at the first / of a // comment', () => {
    // `// comment`: pos=0 is at `//` → return pos >= i (0 >= 0) = true
    expect(isInsideCommentOrString('// comment', 0)).toBe(true);
  });

  it('returns true for position anywhere inside a // comment', () => {
    expect(isInsideCommentOrString('code // note', 8)).toBe(true); // 'n' in 'note'
  });

  it('returns false for position before the // comment', () => {
    // `code // note`: pos=1 is 'o' in 'code', before the comment
    expect(isInsideCommentOrString('code // note', 1)).toBe(false);
  });

  it('// inside a string is NOT treated as a comment start', () => {
    // `"url // path"`: the `//` is inside the string → comment detection does not apply
    // pos=6 is the first `/`
    expect(isInsideCommentOrString('"url // path"', 6)).toBe(true);
  });

  it('// adjacent to code without space is still a comment', () => {
    // `x//comment`
    expect(isInsideCommentOrString('x//comment', 2)).toBe(true); // 'c' in comment
    expect(isInsideCommentOrString('x//comment', 1)).toBe(true); // first '/'
    expect(isInsideCommentOrString('x//comment', 0)).toBe(false); // 'x' before comment
  });
});

// ── isInsideCommentOrString — mixed strings and comments ──────────────────────

describe('isInsideCommentOrString — string followed by comment', () => {
  it('returns false for position inside the string part', () => {
    // `"foo" // bar`: 'f' is at index 1
    expect(isInsideCommentOrString('"foo" // bar', 1)).toBe(true); // inside string
  });

  it('returns true for position inside the comment part', () => {
    // `"foo" // bar`: 'b' in bar is after the //
    expect(isInsideCommentOrString('"foo" // bar', 9)).toBe(true);
  });

  it('returns false for position in normal code between string and comment', () => {
    // `val x = "y" // comment`: space after string before comment
    // `v(0)a(1)l(2) (3)x(4) (5)=(6) (7)"(8)y(9)"(10) (11)/(12)/(13)c...`
    expect(isInsideCommentOrString('val x = "y" // comment', 4)).toBe(false); // 'x'
  });
});

// ── isInsideCommentOrString — block comments ─────────────────────────────────

describe('isInsideCommentOrString — block comments', () => {
  it('/* block comment */ content is filtered correctly', () => {
    const line = '    /* greet here */';
    const greetPos = line.indexOf('greet');
    expect(isInsideCommentOrString(line, greetPos)).toBe(true);
  });

  it('position before /* → false', () => {
    const line = 'val x = 1; /* comment */';
    expect(isInsideCommentOrString(line, 4)).toBe(false); // pos of 'x'
  });

  it('position after */ → false', () => {
    const line = '/* comment */ val x = 1';
    const pos = line.indexOf('val');
    expect(isInsideCommentOrString(line, pos)).toBe(false);
  });
});

// ── isInsideCommentOrString — edge cases ─────────────────────────────────────

describe('isInsideCommentOrString — edge cases', () => {
  it('empty line — returns false for any position', () => {
    expect(isInsideCommentOrString('', 0)).toBe(false);
  });

  it('line with only a string — returns true for content, false for pos past end', () => {
    expect(isInsideCommentOrString('"hello"', 100)).toBe(false); // past end, string closed
  });

  it('unclosed string at end of line — returns true for position past content', () => {
    // `"unclosed` — inStr is still set when loop ends → returns true
    expect(isInsideCommentOrString('"unclosed', 100)).toBe(true);
  });

  it('adjacent strings — correctly tracks open/close state', () => {
    // `"a""b"`: first string "a", then second "b"
    // "(0)a(1)"(2)"(3)b(4)"(5)
    expect(isInsideCommentOrString('"a""b"', 1)).toBe(true);  // 'a' — inside first string
    // index 2: closing " of first string → inStr=false
    // index 3: opening " of second string → inStr="
    expect(isInsideCommentOrString('"a""b"', 4)).toBe(true);  // 'b' — inside second string
  });

  it('single-quoted string containing a double quote: \'"\' ', () => {
    // In Kotlin, `'"'` is a char literal containing a double quote
    // '(0)"(1)'(2)
    expect(isInsideCommentOrString('\'"\'', 1)).toBe(true); // the " at index 1 is inside '...'
  });
});

// ── isInsideStringInterpolation ───────────────────────────────────────────────

describe('isInsideStringInterpolation — happy path', () => {
  it('returns true for a name inside `${...}` in a real string', () => {
    const line = 'val s = "Hello ${NAME}!"';
    const idx  = line.indexOf('NAME');
    expect(isInsideStringInterpolation(line, idx)).toBe(true);
  });

  it('returns false for plain string content (no `${...}`)', () => {
    const line = 'val s = "Hello NAME!"';
    const idx  = line.indexOf('NAME');
    expect(isInsideStringInterpolation(line, idx)).toBe(false);
  });

  it('returns false for code outside any string', () => {
    const line = 'val NAME = 1';
    const idx  = line.indexOf('NAME');
    expect(isInsideStringInterpolation(line, idx)).toBe(false);
  });
});

describe('isInsideStringInterpolation — comment guards', () => {
  it('returns false when the `${...}` lives inside a /* */ block comment', () => {
    // The bug: previously returned true because the helper walked past
    // `/*` and treated the inner `"` as a real string opener.
    const line = '/* old: was "${TIMEOUT_MS}ms" — to remove */';
    const idx  = line.indexOf('TIMEOUT_MS');
    expect(isInsideStringInterpolation(line, idx)).toBe(false);
  });

  it('returns false for an unclosed `/*` even if it contains `${...}`', () => {
    const line = '/* trailing "${X}';
    const idx  = line.indexOf('X');
    expect(isInsideStringInterpolation(line, idx)).toBe(false);
  });

  it('still returns true when an interpolation comes AFTER a closed block comment', () => {
    const line = '/* nope */ val s = "${X}"';
    const idx  = line.indexOf('${X}') + 2;
    expect(isInsideStringInterpolation(line, idx)).toBe(true);
  });

  it('returns false inside a // line comment', () => {
    const line = '// "${X}"';
    const idx  = line.indexOf('X');
    expect(isInsideStringInterpolation(line, idx)).toBe(false);
  });
});
