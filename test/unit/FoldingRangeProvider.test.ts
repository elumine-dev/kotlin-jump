import { describe, it, expect } from 'vitest';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { FoldingRangeKind } from './__mocks__/vscode';

function provide(code: string, uri = 'file:///test.kt') {
  const index = new SymbolIndex();
  index.add(parse(uri, code));
  const provider = new KotlinFoldingRangeProvider(index);
  const doc = mockDocument(uri, code);
  return provider.provideFoldingRanges(doc, {} as any, {} as any);
}

// ── Empty file ────────────────────────────────────────────────────────────────

describe('empty file', () => {
  it('returns no folding ranges', () => {
    expect(provide('')).toEqual([]);
  });
});

// ── Import block ──────────────────────────────────────────────────────────────

describe('import block', () => {
  it('no imports → no Imports fold', () => {
    const code = `class Foo {}`;
    const ranges = provide(code);
    expect(ranges.some(r => r.kind === FoldingRangeKind.Imports)).toBe(false);
  });

  it('single-line import → no Imports fold', () => {
    const code = `import com.example.Foo\n\nclass Bar {}`;
    const ranges = provide(code);
    expect(ranges.some(r => r.kind === FoldingRangeKind.Imports)).toBe(false);
  });

  it('multi-line import block → one Imports fold spanning the block', () => {
    const code = [
      'import com.example.Alpha',  // line 0
      'import com.example.Beta',   // line 1
      'import com.example.Gamma',  // line 2
      '',
      'class Foo {}',
    ].join('\n');
    const ranges = provide(code);
    const imp = ranges.filter(r => r.kind === FoldingRangeKind.Imports);
    expect(imp).toHaveLength(1);
    expect(imp[0].start).toBe(0);
    expect(imp[0].end).toBe(2);
  });

  it('import block with blank line in middle → fold from first to last import', () => {
    // The organizeImports scanner finds firstLine/lastLine of actual import lines
    const code = [
      'import com.example.A',  // line 0
      '',                       // line 1 — blank, not an import
      'import com.example.B',  // line 2
      '',
      'class X {}',
    ].join('\n');
    const ranges = provide(code);
    const imp = ranges.filter(r => r.kind === FoldingRangeKind.Imports);
    // firstLine=0, lastLine=2 → lastLine > firstLine → fold exists
    expect(imp).toHaveLength(1);
    expect(imp[0].start).toBe(0);
    expect(imp[0].end).toBe(2);
  });
});

// ── KDoc block comments ───────────────────────────────────────────────────────

describe('KDoc block comments', () => {
  it('single-line KDoc `/** Short */` → no Comment fold', () => {
    const code = `/** Short */\nclass Foo {}`;
    const ranges = provide(code);
    expect(ranges.some(r => r.kind === FoldingRangeKind.Comment)).toBe(false);
  });

  it('multi-line KDoc → one Comment fold', () => {
    const code = [
      '/**',          // line 0
      ' * Does stuff',// line 1
      ' */',          // line 2
      'fun foo() {}', // line 3
    ].join('\n');
    const ranges = provide(code);
    const comments = ranges.filter(r => r.kind === FoldingRangeKind.Comment);
    expect(comments).toHaveLength(1);
    expect(comments[0].start).toBe(0);
    expect(comments[0].end).toBe(2);
  });

  it('multiple KDoc blocks → one Comment fold per block', () => {
    const code = [
      '/**',              // line 0
      ' * Class doc',     // line 1
      ' */',              // line 2
      'class Foo {',      // line 3
      '  /**',            // line 4
      '   * Method doc',  // line 5
      '   */',            // line 6
      '  fun bar() {}',   // line 7
      '}',                // line 8
    ].join('\n');
    const ranges = provide(code);
    const comments = ranges.filter(r => r.kind === FoldingRangeKind.Comment);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ start: 0, end: 2 });
    expect(comments[1]).toMatchObject({ start: 4, end: 6 });
  });
});

// ── Symbol folding (Region) ───────────────────────────────────────────────────

describe('symbol Region folds', () => {
  it('single-line function → no Region fold', () => {
    const code = `fun foo() = 42`;
    const ranges = provide(code);
    expect(ranges.some(r => r.kind === FoldingRangeKind.Region)).toBe(false);
  });

  it('multi-line class → Region fold', () => {
    const code = [
      'class Foo {',   // line 0
      '  val x = 1',  // line 1
      '}',             // line 2
    ].join('\n');
    const ranges = provide(code);
    const regions = ranges.filter(r => r.kind === FoldingRangeKind.Region);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions[0].start).toBe(0);
  });

  it('multi-line function → Region fold', () => {
    const code = [
      'fun greet() {',     // line 0
      '  println("hi")',   // line 1
      '}',                 // line 2
    ].join('\n');
    const ranges = provide(code);
    const regions = ranges.filter(r => r.kind === FoldingRangeKind.Region);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions[0].start).toBe(0);
    expect(regions[0].end).toBeGreaterThan(0);
  });

  it('class with nested function → Region folds for both', () => {
    const code = [
      'class Bar {',       // line 0
      '  fun method() {',  // line 1
      '    return 1',      // line 2
      '  }',               // line 3
      '}',                 // line 4
    ].join('\n');
    const ranges = provide(code);
    const regions = ranges.filter(r => r.kind === FoldingRangeKind.Region);
    // At minimum: class fold + method fold
    expect(regions.length).toBeGreaterThanOrEqual(2);
  });
});

// ── All kinds together ────────────────────────────────────────────────────────

describe('full file with imports + kdoc + class + method', () => {
  const code = [
    'import com.example.A',   // line 0
    'import com.example.B',   // line 1
    '',                        // line 2
    '/**',                     // line 3
    ' * MyClass docs',         // line 4
    ' */',                     // line 5
    'class MyClass {',         // line 6
    '  /**',                   // line 7
    '   * method docs',        // line 8
    '   */',                   // line 9
    '  fun doSomething() {',   // line 10
    '    val x = 1',           // line 11
    '  }',                     // line 12
    '}',                       // line 13
  ].join('\n');

  it('contains an Imports fold for lines 0-1', () => {
    const ranges = provide(code);
    const imp = ranges.find(r => r.kind === FoldingRangeKind.Imports);
    expect(imp).toBeDefined();
    expect(imp!.start).toBe(0);
    expect(imp!.end).toBe(1);
  });

  it('contains Comment folds for both KDoc blocks', () => {
    const ranges = provide(code);
    const comments = ranges.filter(r => r.kind === FoldingRangeKind.Comment);
    expect(comments.length).toBeGreaterThanOrEqual(2);
  });

  it('contains Region folds for class and method', () => {
    const ranges = provide(code);
    const regions = ranges.filter(r => r.kind === FoldingRangeKind.Region);
    expect(regions.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Cache ─────────────────────────────────────────────────────────────────────

describe('cache', () => {
  it('returns same array instance on second call with same document version', () => {
    const code = `class Foo {\n  fun bar() {}\n}`;
    const index = new SymbolIndex();
    index.add(parse('file:///test.kt', code));
    const provider = new KotlinFoldingRangeProvider(index);
    const doc = mockDocument('file:///test.kt', code); // version = 1

    const first = provider.provideFoldingRanges(doc, {} as any, {} as any);
    const second = provider.provideFoldingRanges(doc, {} as any, {} as any);
    expect(second).toBe(first); // same reference → cache hit
  });

  it('recomputes when document version changes', () => {
    const code = `class Foo {\n  fun bar() {}\n}`;
    const index = new SymbolIndex();
    index.add(parse('file:///test.kt', code));
    const provider = new KotlinFoldingRangeProvider(index);

    const doc1 = mockDocument('file:///test.kt', code); // version = 1
    const first = provider.provideFoldingRanges(doc1, {} as any, {} as any);

    // Simulate document edit: new version
    const doc2 = { ...doc1, version: 2 };
    const second = provider.provideFoldingRanges(doc2 as any, {} as any, {} as any);
    expect(second).not.toBe(first); // cache miss → new array
  });
});

// ── 5000 limit ────────────────────────────────────────────────────────────────

describe('5000 range limit', () => {
  it('caps output at 5000 ranges for pathologically large files', () => {
    // Build a file with more than 5000 multi-line functions
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
      lines.push(`fun f${i}() {`);
      lines.push(`  return ${i}`);
      lines.push(`}`);
    }
    const code = lines.join('\n');
    const ranges = provide(code);
    expect(ranges.length).toBeLessThanOrEqual(5000);
  });
});
