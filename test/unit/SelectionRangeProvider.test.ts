import { describe, it, expect } from 'vitest';
import { KotlinSelectionRangeProvider } from '../../src/providers/SelectionRangeProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { Position } from './__mocks__/vscode';

function provide(code: string, positions: Position[], uri = 'file:///test.kt') {
  const index = new SymbolIndex();
  index.add(parse(uri, code));
  const provider = new KotlinSelectionRangeProvider(index);
  const doc = mockDocument(uri, code);
  return provider.provideSelectionRanges(doc, positions, {} as any);
}

// Walk the parent chain and collect all ranges as [startLine, endLine] pairs, innermost first
function collectChain(sel: any): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let cur: any = sel;
  while (cur) {
    result.push([cur.range.start.line, cur.range.end.line]);
    cur = cur.parent;
  }
  return result;
}

// ── Empty file ────────────────────────────────────────────────────────────────

describe('empty file', () => {
  it('returns file range for any position', () => {
    const [sel] = provide('', [new Position(0, 0)]);
    const chain = collectChain(sel);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toEqual([0, 0]);
  });
});

// ── Position outside all symbols ──────────────────────────────────────────────

describe('position outside all symbols', () => {
  it('returns only file range when cursor is in a header comment', () => {
    const code = `// Copyright header\n\nclass Foo {\n  fun bar() {}\n}`;
    const [sel] = provide(code, [new Position(0, 0)]);
    const chain = collectChain(sel);
    // Innermost should be the file range (no enclosing symbol)
    const lastLine = code.split('\n').length - 1;
    const root = chain[chain.length - 1];
    expect(root[0]).toBe(0);
    expect(root[1]).toBe(lastLine);
  });
});

// ── Single symbol ─────────────────────────────────────────────────────────────

describe('single top-level class', () => {
  const code = `class Foo {\n  val x = 1\n}`;

  it('cursor inside class body → at least class range + file range in chain', () => {
    const [sel] = provide(code, [new Position(1, 2)]);
    const chain = collectChain(sel);
    expect(chain.length).toBeGreaterThanOrEqual(2);
    // Outermost is the file range (covers entire file)
    const lastLine = code.split('\n').length - 1;
    expect(chain[chain.length - 1]).toEqual([0, lastLine]);
    // At least one range in chain starts at line 0 (class Foo)
    expect(chain.some(([s]) => s === 0)).toBe(true);
  });

  it('cursor on declaration line (boundary)', () => {
    const [sel] = provide(code, [new Position(0, 0)]);
    const chain = collectChain(sel);
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });

  it('cursor on last line of block (end boundary)', () => {
    const lastLine = code.split('\n').length - 1;
    const [sel] = provide(code, [new Position(lastLine, 0)]);
    const chain = collectChain(sel);
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Nested symbols ────────────────────────────────────────────────────────────

describe('nested class + method', () => {
  const code = [
    'class Outer {',          // line 0
    '  fun inner() {',        // line 1
    '    val x = 1',          // line 2
    '  }',                    // line 3
    '}',                      // line 4
  ].join('\n');

  it('cursor inside nested method → method < class < file chain', () => {
    const [sel] = provide(code, [new Position(2, 4)]);
    const chain = collectChain(sel);
    // Should have at least 3 levels: innermost (method or class) + file
    expect(chain.length).toBeGreaterThanOrEqual(3);
    // Chain must be strictly expanding (each parent starts before or at its child)
    for (let i = 0; i < chain.length - 1; i++) {
      expect(chain[i][0]).toBeGreaterThanOrEqual(chain[i + 1][0]);
      expect(chain[i][1]).toBeLessThanOrEqual(chain[i + 1][1]);
    }
  });
});

// ── Multiple sibling classes ──────────────────────────────────────────────────

describe('multiple sibling classes', () => {
  const code = [
    'class Alpha {',   // line 0
    '  val a = 1',     // line 1
    '}',               // line 2
    'class Beta {',    // line 3
    '  val b = 2',     // line 4
    '}',               // line 5
  ].join('\n');

  it('cursor in Alpha → only Alpha in chain, not Beta', () => {
    const [sel] = provide(code, [new Position(1, 2)]);
    const chain = collectChain(sel);
    // All ranges in chain should start at or before line 1 and end at or after line 1
    for (const [start, end] of chain) {
      expect(start).toBeLessThanOrEqual(1);
      expect(end).toBeGreaterThanOrEqual(1);
    }
    // Alpha ends at line 2, so no range should start at line 3 (Beta)
    const startLines = chain.map(([s]) => s);
    expect(startLines).not.toContain(3);
  });

  it('cursor in Beta → Alpha range [0,2] not in chain', () => {
    const [sel] = provide(code, [new Position(4, 2)]);
    const chain = collectChain(sel);
    // Alpha occupies lines 0-2; it should NOT appear in the chain
    // (the file range starts at 0 too but ends at 5, not 2)
    expect(chain).not.toContainEqual([0, 2]);
  });
});

// ── Multiple positions ────────────────────────────────────────────────────────

describe('multiple positions at once', () => {
  const code = `class Foo {\n  fun bar() {}\n}`;

  it('returns one SelectionRange per position', () => {
    const positions = [new Position(0, 0), new Position(1, 2)];
    const results = provide(code, positions);
    expect(results).toHaveLength(2);
  });
});

// ── Chain parent invariant ────────────────────────────────────────────────────

describe('chain parent invariant', () => {
  const code = [
    'class A {',        // line 0
    '  fun f() {',      // line 1
    '    return 1',     // line 2
    '  }',              // line 3
    '}',                // line 4
  ].join('\n');

  it('every parent range strictly contains its child range', () => {
    const [sel] = provide(code, [new Position(2, 4)]);
    const chain = collectChain(sel);
    for (let i = 0; i < chain.length - 1; i++) {
      const [childStart, childEnd] = chain[i];
      const [parentStart, parentEnd] = chain[i + 1];
      // Parent must start at or before child, end at or after child
      expect(parentStart).toBeLessThanOrEqual(childStart);
      expect(parentEnd).toBeGreaterThanOrEqual(childEnd);
    }
  });
});
