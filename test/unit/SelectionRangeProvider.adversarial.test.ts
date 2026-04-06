/**
 * Adversarial tests for SelectionRangeProvider.
 *
 * Based on real Kotlin patterns found in lapresse production code.
 * Goal: verify the selection range chain is correct for unusual-but-valid syntax.
 */
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

function chain(code: string, pos: Position): Array<[number, number]> {
  const [sel] = provide(code, [pos]);
  const result: Array<[number, number]> = [];
  let cur: any = sel;
  while (cur) {
    result.push([cur.range.start.line, cur.range.end.line]);
    cur = cur.parent;
  }
  return result;
}

// ── Named companion object (from lapresse DemoPlaybackService.kt) ─────────────

describe('named companion object', () => {
  const code = [
    'class Foo {',                   // line 0
    '  companion object Companion {', // line 1 — named, IS indexed
    '    const val TAG = "Foo"',     // line 2
    '    val EMPTY = Foo()',          // line 3
    '  }',                           // line 4
    '}',                             // line 5
  ].join('\n');

  it('cursor inside named companion body → chain includes companion + class + file', () => {
    const c = chain(code, new Position(2, 4));
    // Chain must include a range starting at line 1 (companion object)
    expect(c.some(([s]) => s === 1)).toBe(true);
    // And a range starting at line 0 (class Foo)
    expect(c.some(([s]) => s === 0)).toBe(true);
    // Chain must be strictly expanding
    for (let i = 0; i < c.length - 1; i++) {
      expect(c[i][0]).toBeGreaterThanOrEqual(c[i + 1][0]);
      expect(c[i][1]).toBeLessThanOrEqual(c[i + 1][1]);
    }
  });

  it('cursor on companion declaration line → companion appears in chain', () => {
    const c = chain(code, new Position(1, 2));
    expect(c.some(([s]) => s === 1)).toBe(true);
  });
});

// ── Unnamed companion object (NOT indexed by parser) ─────────────────────────

describe('unnamed companion object', () => {
  const code = [
    'class Bar {',         // line 0
    '  companion object {', // line 1 — unnamed, NOT indexed
    '    val TAG = "Bar"', // line 2
    '  }',                 // line 3
    '}',                   // line 4
  ].join('\n');

  it('cursor inside unnamed companion body → chain has class + file (companion not indexed)', () => {
    const c = chain(code, new Position(2, 4));
    // The unnamed companion is not in the index → its range won't appear
    // Chain should have Bar (line 0) and file range
    expect(c.some(([s]) => s === 0)).toBe(true);
    // Should NOT have a range starting at line 1 (unnamed companion not indexed)
    expect(c.some(([s, e]) => s === 1 && e < 4)).toBe(false);
  });
});

// ── Extension functions (from lapresse TextStyleModel.kt) ────────────────────

describe('extension functions', () => {
  it('cursor inside extension function body → chain: extension fn + file', () => {
    const code = [
      'fun TextStyleModel.toComposeTextStyle(color: Int): TextStyle {', // line 0
      '  val decoration = when (textDecoration) {',                      // line 1
      '    else -> TextDecoration.None',                                  // line 2
      '  }',                                                             // line 3
      '  return TextStyle(textDecoration = decoration)',                 // line 4
      '}',                                                               // line 5
    ].join('\n');
    const c = chain(code, new Position(2, 4));
    expect(c.some(([s]) => s === 0)).toBe(true);
    // Function range should end at or include line 5
    const fnRange = c.find(([s]) => s === 0);
    expect(fnRange).toBeDefined();
    expect(fnRange![1]).toBeGreaterThanOrEqual(2);
  });
});

// ── Operator functions (from lapresse ViewSpacing) ────────────────────────────

describe('operator functions', () => {
  const code = [
    'data class ViewSpacing(val x: Int) {',       // line 0
    '  operator fun plus(other: ViewSpacing): ViewSpacing {', // line 1
    '    return ViewSpacing(x + other.x)',          // line 2
    '  }',                                          // line 3
    '  operator fun minus(other: ViewSpacing): ViewSpacing {', // line 4
    '    return ViewSpacing(x - other.x)',           // line 5
    '  }',                                           // line 6
    '}',                                             // line 7
  ].join('\n');

  it('cursor in `operator fun plus` body → chain: plus fn + class + file', () => {
    const c = chain(code, new Position(2, 4));
    expect(c.some(([s]) => s === 1)).toBe(true); // operator fun plus at line 1
    expect(c.some(([s]) => s === 0)).toBe(true); // class at line 0
    for (let i = 0; i < c.length - 1; i++) {
      expect(c[i][0]).toBeGreaterThanOrEqual(c[i + 1][0]);
      expect(c[i][1]).toBeLessThanOrEqual(c[i + 1][1]);
    }
  });

  it('cursor in `minus` → plus not in chain', () => {
    const c = chain(code, new Position(5, 4));
    // plus ends at line 3; minus starts at line 4
    // chain for cursor at line 5 should NOT include plus [1,3]
    expect(c).not.toContainEqual([1, 3]);
  });
});

// ── Inline + infix + reified (from lapresse StyleModelAssembler.kt) ───────────

describe('inline infix reified function', () => {
  it('cursor inside complex modifier function → chain works', () => {
    const code = [
      'private inline infix fun <reified T : Any> T.merge(other: T): T {', // line 0
      '  return other',                                                      // line 1
      '}',                                                                   // line 2
    ].join('\n');
    const c = chain(code, new Position(1, 2));
    expect(c.some(([s]) => s === 0)).toBe(true);
    expect(c.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Sealed class hierarchy (from lapresse ActionModel.kt) ────────────────────

describe('sealed class hierarchy', () => {
  it('cursor inside nested data class → chain: data class + file', () => {
    const code = [
      'sealed class ActionTargetModel',              // line 0 — no body, single line
      '',
      'data class OpenUrlActionTargetModel(',         // line 2
      '    val url: String',                          // line 3
      ') : ActionTargetModel()',                      // line 4
      '',
      'data class MailToActionTargetModel(',          // line 6
      '    val to: List<String>,',                    // line 7
      '    val subject: String',                      // line 8
      ') : ActionTargetModel()',                      // line 9
    ].join('\n');

    // Cursor inside OpenUrlActionTargetModel (line 3)
    const c = chain(code, new Position(3, 4));
    // OpenUrl is at line 2; it should appear in chain
    expect(c.some(([s]) => s === 2)).toBe(true);
    // MailTo (line 6) should NOT appear (cursor is not inside it)
    expect(c.some(([s]) => s === 6)).toBe(false);
  });
});

// ── Anonymous object expression (NOT indexed) ─────────────────────────────────

describe('anonymous object expression', () => {
  it('cursor inside anonymous object body → falls back to enclosing function', () => {
    // Real pattern from lapresse MainActivityModule.kt
    const code = [
      'fun provideEmptyMediaSelector() =', // line 0 — indexed
      '    object : MediaEngineSelector {', // line 1 — NOT indexed
      '        override fun setUp() {}',   // line 2
      '    }',                             // line 3
    ].join('\n');

    const c = chain(code, new Position(2, 8));
    // The enclosing function (line 0) should be in chain
    expect(c.some(([s]) => s === 0)).toBe(true);
    // The anonymous object (line 1) is not indexed → range starting at 1 should not appear
    // (unless the parser somehow captures it, which it doesn't)
    expect(c.some(([s]) => s === 1)).toBe(false);
  });
});

// ── @file: annotation (from lapresse) ────────────────────────────────────────

describe('@file: annotation', () => {
  it('cursor on @file:Suppress line → only file range (no symbol contains line 0)', () => {
    const code = [
      '@file:Suppress("MagicNumber")',  // line 0 — not a symbol
      'package com.example',            // line 1
      '',
      'class Foo {',                     // line 3
      '  val x = 42',                   // line 4
      '}',                              // line 5
    ].join('\n');

    const c = chain(code, new Position(0, 0));
    // Only file range — no symbol starts at or before line 0 with depth 0
    // (Foo starts at line 3, after our cursor)
    const lastLine = code.split('\n').length - 1;
    expect(c[c.length - 1]).toEqual([0, lastLine]); // file range is root
    // No symbol from the index should contain line 0 (Foo starts at line 3)
    expect(c.some(([s]) => s === 3)).toBe(false);
  });
});

// ── Lambda bodies (not indexed) ───────────────────────────────────────────────

describe('lambda bodies are not indexed', () => {
  it('cursor inside .map { } lambda → falls back to enclosing function chain', () => {
    // Lambdas are not separate symbols in the index
    const code = [
      'class Adapter {',                                // line 0
      '  fun transform(items: List<String>): List<Int> {', // line 1
      '    return items.map {',                         // line 2
      '      it.length',                               // line 3
      '    }',                                         // line 4
      '  }',                                           // line 5
      '}',                                             // line 6
    ].join('\n');

    const c = chain(code, new Position(3, 6));
    // transform (line 1) and Adapter (line 0) should be in chain
    expect(c.some(([s]) => s === 1)).toBe(true);
    expect(c.some(([s]) => s === 0)).toBe(true);
    // Parent invariant
    for (let i = 0; i < c.length - 1; i++) {
      expect(c[i][0]).toBeGreaterThanOrEqual(c[i + 1][0]);
      expect(c[i][1]).toBeLessThanOrEqual(c[i + 1][1]);
    }
  });

  it('cursor inside complex nested lambda (like LaunchedEffect) → enclosing function', () => {
    // Real pattern from lapresse OnboardingBackground.kt
    const code = [
      '@Composable',
      'fun OnboardingBackground() {',  // line 1
      '  LaunchedEffect(true) {',      // line 2 — lambda, not indexed
      '    delay(100)',                 // line 3
      '    isAnimationDone = true',    // line 4
      '  }',                           // line 5
      '}',                             // line 6
    ].join('\n');

    const c = chain(code, new Position(3, 4));
    expect(c.some(([s]) => s === 1)).toBe(true); // OnboardingBackground
  });
});

// ── Delegation pattern (from lapresse ContentCardModuleViewHolder) ────────────

describe('class delegation pattern', () => {
  it('`class Foo(...) : Base(root), Interface by delegate` → class indexed, cursor works', () => {
    // Real pattern from lapresse: class implementing interface via delegation
    const code = [
      'class ContentCardModuleViewHolder(',   // line 0
      '    private val binding: CardBinding,', // line 1
      ') : ModuleViewHolderBase(binding.root), Disposer by disposer {', // line 2
      '  fun bind(data: String) {',           // line 3
      '    binding.title.text = data',        // line 4
      '  }',                                  // line 5
      '}',                                    // line 6
    ].join('\n');

    const c = chain(code, new Position(4, 4));
    // bind function (line 3) should be in chain
    expect(c.some(([s]) => s === 3)).toBe(true);
    // ContentCardModuleViewHolder (line 0) should be in chain
    expect(c.some(([s]) => s === 0)).toBe(true);
  });
});

// ── Multiple positions edge cases ─────────────────────────────────────────────

describe('multiple positions with complex code', () => {
  it('two positions in different classes → independent chains', () => {
    const code = [
      'class Alpha {',   // line 0
      '  fun fa() {',   // line 1
      '    val a = 1',  // line 2
      '  }',            // line 3
      '}',              // line 4
      'class Beta {',   // line 5
      '  fun fb() {',   // line 6
      '    val b = 2',  // line 7
      '  }',            // line 8
      '}',              // line 9
    ].join('\n');

    const [selAlpha, selBeta] = provide(code, [new Position(2, 4), new Position(7, 4)]);

    const chainAlpha: Array<[number, number]> = [];
    let cur: any = selAlpha;
    while (cur) { chainAlpha.push([cur.range.start.line, cur.range.end.line]); cur = cur.parent; }

    const chainBeta: Array<[number, number]> = [];
    cur = selBeta;
    while (cur) { chainBeta.push([cur.range.start.line, cur.range.end.line]); cur = cur.parent; }

    // Alpha chain should contain line 0, not line 5
    expect(chainAlpha.some(([s]) => s === 0)).toBe(true);
    expect(chainAlpha.some(([s]) => s === 5)).toBe(false);

    // Beta chain should contain line 5, not line 0
    expect(chainBeta.some(([s]) => s === 5)).toBe(true);
    // Beta chain contains file range which starts at 0, but Alpha class [0,4] should not be there
    expect(chainBeta).not.toContainEqual([0, 4]);
  });
});

// ── Boundary: cursor exactly between symbols ──────────────────────────────────

describe('cursor at boundaries', () => {
  it('cursor on blank line between two classes → INSIDE class A (rangeEndLine extends to line before B)', () => {
    // This documents a known behavior: rangeEndLine(A) returns line 3 (blank line before B),
    // not line 2 (closing brace). The blank line "belongs" to A's range.
    // Consistent with DocumentSymbolProvider outline behavior.
    const code = [
      'class A {',  // line 0
      '  val x = 1',// line 1
      '}',          // line 2
      '',           // line 3 — blank line: rangeEndLine(A) = max(4-1, 0) = 3, so A=[0,3]
      'class B {',  // line 4
      '  val y = 2',// line 5
      '}',          // line 6
    ].join('\n');

    const c = chain(code, new Position(3, 0));
    // Line 3 is inside A's range [0,3] — A should appear in the chain
    expect(c.some(([s]) => s === 0)).toBe(true);
    // B starts at line 4 → B's range does NOT contain line 3
    expect(c.some(([s]) => s === 4)).toBe(false);
  });

  it('cursor on closing brace line → still inside the symbol', () => {
    const code = [
      'class Foo {', // line 0
      '  val x = 1', // line 1
      '}',           // line 2
    ].join('\n');

    // rangeEndLine for Foo (depth 0, line 0) → falls back to lastLine=2
    // So Foo range is [0, 2], which CONTAINS line 2
    const c = chain(code, new Position(2, 0));
    expect(c.some(([s]) => s === 0)).toBe(true);
  });
});
