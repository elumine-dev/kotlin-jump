/**
 * Adversarial tests for FoldingRangeProvider.
 *
 * Based on real Kotlin patterns found in lapresse production code.
 * Goal: find bugs and prevent regressions from unusual-but-valid Kotlin.
 */
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

function comments(code: string) { return provide(code).filter(r => r.kind === FoldingRangeKind.Comment); }
function regions(code: string)  { return provide(code).filter(r => r.kind === FoldingRangeKind.Region); }
function imports(code: string)  { return provide(code).filter(r => r.kind === FoldingRangeKind.Imports); }

// ── Raw strings containing /**  (confirmed bug: these must NOT create folds) ─

describe('raw string false-positive KDoc', () => {
  it('multi-line raw string with /**...*/ inside → 0 Comment folds', () => {
    // Pattern from lapresse JSON parsing tests
    const code = [
      'val sql = """',       // line 0 — opens raw string
      '    /**',             // line 1 — looks like KDoc but is raw string content
      '     * Not KDoc',     // line 2
      '     */',             // line 3
      '    SELECT * FROM x', // line 4
      '"""',                 // line 5 — closes raw string
    ].join('\n');
    expect(comments(code)).toHaveLength(0);
  });

  it('Regex raw string with special chars → 0 Comment folds', () => {
    // Real pattern from lapresse/MarginJsonParserDelegate.kt
    const code = `val PATTERN = Regex("""^\\{\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\}$""")`;
    expect(comments(code)).toHaveLength(0);
  });

  it('JSON in raw string with braces and fake comment chars → 0 Comment folds', () => {
    // Pattern from lapresse test files (fromJson with triple-quoted JSON)
    const code = [
      'val input = Gson().fromJson(',
      '    """',
      '        {',
      '            "kind": "list",',
      '            "type": "unordered"',
      '        }',
      '    """.trimIndent(),',
      '    ListDO::class.java',
      ')',
    ].join('\n');
    expect(comments(code)).toHaveLength(0);
  });

  it('single-line raw string with /**...*/ on same line → 0 Comment folds', () => {
    const code = `val s = """/** not KDoc */"""`;
    expect(comments(code)).toHaveLength(0);
  });

  it('real KDoc AFTER closing raw string is still detected', () => {
    // The scanner must resume after the raw string ends
    const code = [
      'val s = """',      // line 0
      'content',          // line 1
      '"""',              // line 2 — closes raw string
      '/**',              // line 3 — REAL KDoc
      ' * Does stuff',    // line 4
      ' */',              // line 5
      'fun foo() {}',     // line 6
    ].join('\n');
    const cs = comments(code);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ start: 3, end: 5 });
  });

  it('two raw strings then a KDoc — only the KDoc is folded', () => {
    const code = [
      'val a = """one"""', // line 0 — inline raw string, opens+closes
      'val b = """two"""', // line 1
      '/**',               // line 2
      ' * Real KDoc',      // line 3
      ' */',               // line 4
      'fun f() {}',        // line 5
    ].join('\n');
    const cs = comments(code);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ start: 2, end: 4 });
  });
});

// ── Non-KDoc block comments (`/* */`) ────────────────────────────────────────

describe('non-KDoc block comments', () => {
  it('/* ===== Section ===== */ style → 0 Comment folds (by design)', () => {
    // Real pattern from lapresse FontBuilderTest.kt
    const code = [
      '/* ========== RobotoSerif ========== */',
      'class FontBuilderTest {',
      '  fun test() {}',
      '}',
    ].join('\n');
    expect(comments(code)).toHaveLength(0);
  });

  it('/* multi-line non-KDoc */ → 0 Comment folds', () => {
    const code = [
      '/*',
      ' * Not KDoc — no double star',
      ' */',
      'fun foo() {}',
    ].join('\n');
    expect(comments(code)).toHaveLength(0);
  });
});

// ── Lapresse companion object patterns ───────────────────────────────────────

describe('companion object', () => {
  it('named companion object `companion object Companion` → Region fold', () => {
    // Real pattern from lapresse DemoPlaybackService.kt
    const code = [
      'class Foo {',
      '  companion object Companion {',  // named companion — IS indexed by parser
      '    const val TAG = "Foo"',
      '    val EMPTY = Foo()',
      '  }',
      '}',
    ].join('\n');
    const rs = regions(code);
    // Should have Region folds for both Foo and Companion
    expect(rs.length).toBeGreaterThanOrEqual(2);
    const companionFold = rs.find(r => r.start === 1);
    expect(companionFold).toBeDefined();
  });

  it('unnamed companion object → no fold (not indexed by parser)', () => {
    const code = [
      'class Bar {',
      '  companion object {',  // unnamed — NOT indexed
      '    val TAG = "Bar"',
      '  }',
      '}',
    ].join('\n');
    const rs = regions(code);
    // Only Bar itself should have a fold; the unnamed companion is not in the index
    const companionFold = rs.find(r => r.start === 1);
    expect(companionFold).toBeUndefined();
  });
});

// ── Operator and modifier combinations (from lapresse ViewSpacing) ────────────

describe('operator and modifier combos', () => {
  it('`operator fun plus(other: T): T { }` → Region fold', () => {
    // Real pattern from lapresse MarginJsonParserDelegate.kt
    const code = [
      'data class ViewSpacing(val x: Int) {',
      '  operator fun plus(other: ViewSpacing): ViewSpacing {',
      '    return ViewSpacing(x + other.x)',
      '  }',
      '}',
    ].join('\n');
    const rs = regions(code);
    expect(rs.length).toBeGreaterThanOrEqual(2);
    // operator fun at line 1 should be folded
    expect(rs.some(r => r.start === 1)).toBe(true);
  });

  it('`inline infix fun <reified T : Any> T.merge(other: T): T { }` → Region fold', () => {
    // Real pattern from lapresse StyleModelAssembler.kt
    const code = [
      'private inline infix fun <reified T : Any> T.merge(other: T): T {',
      '  return other',
      '}',
    ].join('\n');
    const rs = regions(code);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ start: 0, end: 2 });
  });

  it('`fun foo(): Gson = Serializer.gson` explicit return type single-line → no Region fold', () => {
    // Real pattern from lapresse MainActivityModule.kt
    // Single-expression function: parser indexes it, but rangeEndLine sees the NEXT symbol
    // immediately on the next line → end = start → no fold
    const code = [
      'fun provideJsonConverter(): Gson = Serializer.gson',
      'fun provideOther(): Int = 42',
    ].join('\n');
    const rs = regions(code);
    // Both functions are on consecutive lines → rangeEndLine returns the same line → no fold
    expect(rs).toHaveLength(0);
  });
});

// ── Anonymous objects (NOT indexed → no fold) ────────────────────────────────

describe('anonymous object expressions', () => {
  it('`object : Interface { ... }` → no Region fold', () => {
    // Real pattern from lapresse MainActivityModule.kt provideEmptyMediaSelector()
    const code = [
      'fun provideEmptyMediaSelector() =',
      '    object : MediaEngineSelector {',
      '        override fun setUp() {}',
      '    }',
    ].join('\n');
    const rs = regions(code);
    // provideEmptyMediaSelector (line 0) may or may not fold (single expression)
    // The anonymous object (line 1) is NOT indexed → no fold for it
    const anonFold = rs.find(r => r.start === 1);
    expect(anonFold).toBeUndefined();
  });
});

// ── Sealed class with nested data classes (from lapresse ActionModel.kt) ──────

describe('sealed class with nested data classes', () => {
  it('sealed class + multiple nested data classes → Region folds for each', () => {
    const code = [
      'sealed class ActionTargetModel',           // line 0 — single line, no fold
      '',
      'data class OpenUrlActionTargetModel(',      // line 2
      '    val url: String',                       // line 3
      ') : ActionTargetModel()',                   // line 4
      '',
      'data class MailToActionTargetModel(',       // line 6
      '    val to: List<String>,',                 // line 7
      '    val subject: String',                   // line 8
      ') : ActionTargetModel()',                   // line 9
    ].join('\n');
    const rs = regions(code);
    // OpenUrl and MailTo are multi-line (constructor params span multiple lines)
    // Each should get a fold
    expect(rs.length).toBeGreaterThanOrEqual(1);
  });

  it('sealed class with inline subtypes → body folds', () => {
    const code = [
      'sealed class Result {',        // line 0
      '  data class Success(',        // line 1
      '    val data: String',         // line 2
      '  ) : Result()',               // line 3
      '  data class Error(',          // line 4
      '    val message: String',      // line 5
      '  ) : Result()',               // line 6
      '}',                            // line 7
    ].join('\n');
    const rs = regions(code);
    // At minimum: sealed class (line 0) gets a fold
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(rs.some(r => r.start === 0)).toBe(true);
  });
});

// ── @file: annotations (from lapresse) ───────────────────────────────────────

describe('@file: annotations', () => {
  it('`@file:Suppress("MagicNumber")` before package → class still gets Region fold', () => {
    // Real pattern from lapresse OnboardingBackground.kt
    const code = [
      '@file:Suppress("MagicNumber")',  // line 0
      'package com.example',            // line 1
      '',
      'class Foo {',                     // line 3
      '  fun bar() {',                   // line 4
      '    val x = 42',                  // line 5
      '  }',                             // line 6
      '}',                               // line 7
    ].join('\n');
    const rs = regions(code);
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(rs.some(r => r.start === 3)).toBe(true); // Foo starts at line 3
  });
});

// ── Data class with multi-line constructor (from lapresse) ────────────────────

describe('data class multi-line constructor', () => {
  it('data class with many params → class Region fold covers body', () => {
    // Real pattern from lapresse ClickableText, ViewSpacing, etc.
    const code = [
      'data class ClickableText(',              // line 0
      '    val annotatedString: String,',       // line 1
      '    val actions: List<String>,',         // line 2
      '    val leadingIcon: String? = null,',   // line 3
      ') {',                                    // line 4
      '    override fun toString() = annotatedString', // line 5
      '}',                                      // line 6
    ].join('\n');
    const rs = regions(code);
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(rs.some(r => r.start === 0)).toBe(true);
  });

  it('data class with no body but multi-line constructor → fold', () => {
    const code = [
      'data class Foo(',   // line 0
      '    val a: String,',// line 1
      '    val b: Int',    // line 2
      ')',                 // line 3
      '',
      'fun use() {}',      // line 5
    ].join('\n');
    const rs = regions(code);
    // Foo is at line 0, next symbol (fun use) is at line 5
    // rangeEndLine → line 4. 4 > 0 → fold exists
    expect(rs.some(r => r.start === 0)).toBe(true);
  });
});

// ── Import aliases (from lapresse) ───────────────────────────────────────────

describe('import aliases', () => {
  it('`import Foo as Bar` style → Imports fold works normally', () => {
    // Real pattern from lapresse TransformationImageDelegate.kt
    const code = [
      'import jp.wasabeef.glide.BitmapTransformation as WasabeefTransform',
      'import androidx.compose.ui.geometry.Rect as ComposeRect',
      '',
      'class Foo {}',
    ].join('\n');
    const imp = imports(code);
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ start: 0, end: 1 });
  });
});

// ── Composable functions with complex signatures (from lapresse) ──────────────

describe('composable functions', () => {
  it('@Composable with lambda param → Region fold', () => {
    // Real pattern from lapresse ActionButtons.kt
    const code = [
      '@Composable',                          // line 0
      'fun ProvideActionButtonsDimensions(',   // line 1
      '    dimensions: ActionButtonsDimensions,',
      '    content: @Composable () -> Unit,',
      ') {',
      '    CompositionLocalProvider()',
      '}',
    ].join('\n');
    const rs = regions(code);
    expect(rs.length).toBeGreaterThanOrEqual(1);
    expect(rs.some(r => r.start === 1)).toBe(true);
  });
});

// ── Interaction between imports + KDoc + regions ──────────────────────────────

describe('mixed content stress test', () => {
  it('file with imports, file-level KDoc, and class + KDoc method — all folds correct', () => {
    const code = [
      'import com.example.A',          // line 0
      'import com.example.B',          // line 1
      'import com.example.C',          // line 2
      '',
      '/**',                            // line 4
      ' * A useful class.',             // line 5
      ' */',                            // line 6
      'class MyViewModel {',            // line 7
      '    /**',                        // line 8
      '     * Fetches data.',           // line 9
      '     */',                        // line 10
      '    fun fetchData() {',          // line 11
      '        doSomething()',          // line 12
      '    }',                          // line 13
      '}',                              // line 14
    ].join('\n');

    const all = provide(code);
    const imp = all.filter(r => r.kind === FoldingRangeKind.Imports);
    const com = all.filter(r => r.kind === FoldingRangeKind.Comment);
    const reg = all.filter(r => r.kind === FoldingRangeKind.Region);

    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ start: 0, end: 2 });

    expect(com.length).toBeGreaterThanOrEqual(2);
    expect(com.find(c => c.start === 4 && c.end === 6)).toBeDefined();
    expect(com.find(c => c.start === 8 && c.end === 10)).toBeDefined();

    expect(reg.length).toBeGreaterThanOrEqual(2); // MyViewModel + fetchData
  });
});
