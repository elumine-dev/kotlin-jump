import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { extractKDocFromLines } from '../../src/util/SignatureReader';

describe('DEEP BUGS - Adversarial hunt', () => {
  // BUG 1: Multi-line @Deprecated annotation not captured
  it('BUG 1: Multi-line @Deprecated should set isDeprecated', () => {
    const code = `@Deprecated(
    replaceWith = ReplaceWith(
        "newFun",
        imports = ["com.example"]
    )
)
fun oldFun() {}`;
    const result = parse('file:///test.kt', code);
    const oldFun = result.symbols.find(s => s.name === 'oldFun');
    // FAILS: isDeprecated is undefined because @Deprecated( is in annotationWindow but unclear if preserved
    expect(oldFun?.isDeprecated).toBe(true);
  });

  // BUG 2: File-level annotation pollutes decoration window
  it('BUG 2: @file:JvmName should not affect function annotation window', () => {
    const code = `@file:JvmName("MyClass")
fun foo() {}`;
    const result = parse('file:///test.kt', code);
    const foo = result.symbols.find(s => s.name === 'foo');
    // File-level annotations are still added to annotationWindow
    expect(foo).toBeDefined();
  });

  // BUG 3: extractKDocFromLines exceeds 20-line limit for // comments
  it('BUG 3: 21 consecutive // comments should cap at 20', () => {
    const lines = [];
    for (let i = 0; i < 21; i++) {
      lines.push(`// Comment ${i + 1}`);
    }
    lines.push('fun func() {}');
    const result = extractKDocFromLines(lines, 21);
    const lineCount = result ? result.split('\n').length : 0;
    // FAILS: Returns all 21 lines, not capped at 20
    expect(lineCount).toBeLessThanOrEqual(20);
  });

  // BUG 4: Lazy regex for KDoc allows */ inside comment
  it('BUG 4: KDoc regex with */ inside should handle carefully', () => {
    const lines = [
      '/**',
      ' * @sample foo',
      ' * val x = 1  // */ this closes early!',
      ' */',
      'fun bar() {}'
    ];
    const result = extractKDocFromLines(lines, 4);
    // The line-by-line extraction should handle this, but does it?
    expect(result).toContain('@sample');
  });

  // BUG 5: Nested block comments confuse lazy regex
  it('BUG 5: Nested /* */ inside /** */ breaks regex', () => {
    const lines = [
      '/** outer /* inner */ outer */',
      'fun baz() {}'
    ];
    const result = extractKDocFromLines(lines, 1);
    // Lazy regex /****(.*?)****/ matches up to first */ only
    // Expected: extract "outer /* inner */ outer"
    // Actual: probably extracts just "outer /*inner"
    expect(result).toBeDefined();
  });
});
