import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { extractKDocFromLines, formatKDoc } from '../../src/util/SignatureReader';

describe('DEEP BUGS - More edge cases', () => {
  // BUG 6: Multiple val on one line with semicolon — known limitation
  it('BUG 6: Multiple val separated by semicolon — only first is indexed (known limitation)', () => {
    // The line-by-line regex parser matches the first RE_PROP hit per line and moves on.
    // `val b` on the same line after `val a` is never seen. Not fixable without a
    // multi-pass or AST-based approach.
    const code = 'val a = 1; val b = 2';
    const result = parse('file:///test.kt', code);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('a');
    expect(names).not.toContain('b'); // limitation documented — second val on same line is invisible
  });

  // BUG 7: Empty @param body
  it('BUG 7: @param with no description', () => {
    const lines = ['/** @param x */', 'fun foo(x: Int) {}'];
    const result = extractKDocFromLines(lines, 1);
    const formatted = formatKDoc(['@param x']);
    // What happens with regex when there's no .*?
    expect(formatted).toContain('x');
  });

  // BUG 8: Duplicate @param same name
  it('BUG 8: Duplicate @param with same name', () => {
    const lines = [
      '/**',
      ' * @param x first x',
      ' * @param x second x',
      ' */',
      'fun foo(x: Int) {}'
    ];
    const result = extractKDocFromLines(lines, 4);
    // How many times does x appear?
    expect(result).toBeDefined();
  });

  // BUG 9: Class on same line as val — known limitation
  it('BUG 9: Class after val on same line is not indexed (known limitation)', () => {
    // RE_PROP matches `val x` first; the parser extracts that symbol and continues
    // to the next line — `class Foo` on the same line is never reached.
    // This is the same single-match-per-line limitation as BUG 6.
    const code = `val x = 42; val c = '{'; val y = "string"; class Foo {}`;
    const result = parse('file:///test.kt', code);
    const foo = result.symbols.find(s => s.name === 'Foo');
    expect(foo).toBeUndefined(); // limitation documented — not indexed
  });

  // BUG 10: Escaped newline in string affecting line counting
  it('BUG 10: String with escaped newline', () => {
    const code = `val s = "line1\\
line2"
class Bar {}`;
    const result = parse('file:///test.kt', code);
    const bar = result.symbols.find(s => s.name === 'Bar');
    expect(bar).toBeDefined();
  });

  // BUG 11: Triple quote unclosed at EOF
  it('BUG 11: Raw string triple quote unclosed at EOF', () => {
    const code = `val x = """unclosed`;
    const result = parse('file:///test.kt', code);
    // Parser should handle EOF gracefully
    expect(result.symbols.length).toBeGreaterThanOrEqual(0);
  });

  // BUG 12: Class with object expression using lambda with braces
  it('BUG 12: Object expression with lambda body', () => {
    const code = `val x = object : Foo() { override fun bar() { doSomething() } }
class Next {}`;
    const result = parse('file:///test.kt', code);
    const next = result.symbols.find(s => s.name === 'Next');
    // If inline object body messes up depth, Next might be wrong
    expect(next?.depth).toBe(0);
  });

  // BUG 13: Sealed class matching with nested when blocks
  it('BUG 13: Sealed class member detection', () => {
    const code = `sealed class Result {
    data class Success(val data: String) : Result()
    data class Error(val ex: Exception) : Result()
}`;
    const result = parse('file:///test.kt', code);
    const success = result.symbols.find(s => s.name === 'Success');
    const error = result.symbols.find(s => s.name === 'Error');
    // Both should be indexed as nested classes
    expect(success?.depth).toBe(1);
    expect(error?.depth).toBe(1);
  });

  // BUG 14: Inline property with lambda default value
  it('BUG 14: Property with lambda default', () => {
    const code = `val callback: (Int) -> Unit = { x -> println(x) }`;
    const result = parse('file:///test.kt', code);
    const callback = result.symbols.find(s => s.name === 'callback');
    expect(callback).toBeDefined();
  });

  // BUG 15: Abstract and lateinit combination
  it('BUG 15: abstract lateinit property', () => {
    const code = `abstract class Base { abstract lateinit var name: String }`;
    const result = parse('file:///test.kt', code);
    const name = result.symbols.find(s => s.name === 'name');
    expect(name?.isLateinit).toBe(true);
    expect(name?.isAbstract).toBe(true);
  });
});
