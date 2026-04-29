/**
 * Adversarial integration tests for SuppressHoverProvider.
 *
 * Goal: try to break the provider with realistic Kotlin / Java syntax that
 * the happy-path tests don't cover. Each test either:
 *
 *   - documents a real bug to fix (test fails until the provider is patched),
 *   - documents an accepted limitation (test asserts current behaviour with a
 *     comment explaining why we don't fix it), or
 *   - validates a robustness guarantee (provider must never throw, regardless
 *     of input shape).
 *
 * When a test changes verdict (pass → fail or vice versa), update the test
 * AND the provider in the same PR.
 */

import { describe, it, expect } from 'vitest';
import './__mocks__/vscode';
import { SuppressHoverProvider } from '../../src/providers/SuppressHoverProvider';

function hover(lines: string[], cursorLine: number, cursorCol: number) {
  const provider = new SuppressHoverProvider();
  const doc = {
    lineAt: (n: number) => ({ text: lines[n] ?? '' }),
  } as any;
  const position = { line: cursorLine, character: cursorCol } as any;
  return provider.provideHover(doc, position);
}

function hoverText(h: any): string {
  if (!h) return '';
  const parts = Array.isArray(h.contents) ? h.contents : [h.contents];
  return parts.map((p: any) => p?.value ?? String(p ?? '')).join('\n');
}

// ── ADV-1 — Annotation site-target prefixes (Kotlin) ──────────────────────
// Real-world Kotlin code uses site-targets: @file:Suppress, @get:Suppress,
// @set:Suppress, @param:Suppress, @property:Suppress, @field:Suppress,
// @receiver:Suppress, @setparam:Suppress, @delegate:Suppress.
// All of these are valid Kotlin and should resolve hover the same way.

describe('ADV-1 — site-target annotation prefixes (@file:, @get:, etc.)', () => {
  it('@file:Suppress("UNCHECKED_CAST") at top of a file', () => {
    const line = '@file:Suppress("UNCHECKED_CAST")';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h, 'hover should fire on file-level @Suppress').not.toBeNull();
    expect(hoverText(h)).toContain('UNCHECKED_CAST');
  });

  it('@get:Suppress("UNCHECKED_CAST") on a property getter', () => {
    const line = '@get:Suppress("UNCHECKED_CAST") val foo: String get() = ""';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('UNCHECKED_CAST');
  });

  it('@property:Suppress("DEPRECATION") on a class property', () => {
    const line = '@property:Suppress("DEPRECATION") val x = 1';
    const col  = line.indexOf('DEPRECATION') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('DEPRECATION');
  });

  it('@param:Suppress("UNUSED_PARAMETER") on a constructor parameter', () => {
    const line = 'class Foo(@param:Suppress("UNUSED_PARAMETER") val x: Int)';
    const col  = line.indexOf('UNUSED_PARAMETER') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('UNUSED_PARAMETER');
  });
});

// ── ADV-2 — False-positive guards ─────────────────────────────────────────

describe('ADV-2 — must NOT fire on lookalike contexts', () => {
  it('does NOT fire when @Suppress appears inside a string literal', () => {
    // Real case: a string holding documentation about @Suppress.
    const line = `val doc = "Use @Suppress(\\\"UNCHECKED_CAST\\\") if needed"`;
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h, 'must not fire on @Suppress mentioned inside a string literal').toBeNull();
  });

  it('does NOT fire on a custom annotation that merely starts with "Suppress"', () => {
    const line = '@SuppressMyWarning("UNCHECKED_CAST")';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h, '@SuppressMyWarning is a different annotation').toBeNull();
  });

  it('does NOT fire on a custom annotation containing "Suppress" as a substring', () => {
    const line = '@MySuppress("UNCHECKED_CAST")';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).toBeNull();
  });

  it('does NOT fire when cursor is on the comma between two IDs', () => {
    const line = '@Suppress("UNCHECKED_CAST", "DEPRECATION")';
    const commaCol = line.indexOf(',');
    const h = hover([line], 0, commaCol);
    expect(h).toBeNull();
  });

  it('does NOT fire when cursor is on whitespace inside the parens', () => {
    const line = '@Suppress(  "UNCHECKED_CAST"  )';
    const wsCol = line.indexOf('(') + 1;     // first whitespace char
    const h = hover([line], 0, wsCol);
    expect(h).toBeNull();
  });

  it('does NOT fire when cursor is BEFORE the opening @ of the annotation', () => {
    const line = 'val x = 1; @Suppress("UNCHECKED_CAST") val y = 2';
    const beforeAt = line.indexOf('val x') + 1; // somewhere in "val x"
    const h = hover([line], 0, beforeAt);
    expect(h).toBeNull();
  });
});

// ── ADV-3 — Malformed / mid-edit input must not crash ─────────────────────

describe('ADV-3 — malformed input never throws', () => {
  it('unclosed string literal: @Suppress("UNCHECKED_CAST', () => {
    const line = '@Suppress("UNCHECKED_CAST';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    expect(() => hover([line], 0, col)).not.toThrow();
  });

  it('unclosed annotation parens: @Suppress("UNCHECKED_CAST"', () => {
    const line = '@Suppress("UNCHECKED_CAST"';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    // Provider treats unclosed parens as "still inside" — that's fine for
    // mid-edit; just must not throw and must still return the hover.
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('UNCHECKED_CAST');
  });

  it('empty string literal: @Suppress("")', () => {
    const line = '@Suppress("")';
    // Cursor anywhere inside the empty string position
    const col = line.indexOf('""') + 1;
    const h = hover([line], 0, col);
    expect(h, 'empty ID has no description').toBeNull();
  });

  it('whitespace-only ID: @Suppress("   ")', () => {
    const line = '@Suppress("   ")';
    const col = line.indexOf('"') + 2;
    const h = hover([line], 0, col);
    expect(h).toBeNull();
  });

  it('numeric-only ID: @Suppress("12345")', () => {
    const line = '@Suppress("12345")';
    const col = line.indexOf('1') + 1;
    const h = hover([line], 0, col);
    expect(h, 'numeric IDs are not real suppressions').toBeNull();
  });

  it('cursor on opening quote', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    const col  = line.indexOf('"');
    expect(() => hover([line], 0, col)).not.toThrow();
  });

  it('cursor on closing quote', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    const col  = line.lastIndexOf('"');
    expect(() => hover([line], 0, col)).not.toThrow();
  });

  it('cursor at column past end of line', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    expect(() => hover([line], 0, line.length + 100)).not.toThrow();
  });

  it('empty line', () => {
    expect(() => hover([''], 0, 0)).not.toThrow();
    expect(hover([''], 0, 0)).toBeNull();
  });

  it('cursor on a non-existent line', () => {
    const lines = ['@Suppress("UNCHECKED_CAST")'];
    expect(() => hover(lines, 5, 0)).not.toThrow();
  });
});

// ── ADV-4 — Case sensitivity ──────────────────────────────────────────────

describe('ADV-4 — case sensitivity matches the toolchain', () => {
  it('Kotlin warnings are UPPER_SNAKE — lowercase variant is NOT recognized', () => {
    const line = '@Suppress("unchecked_cast")';
    const col  = line.indexOf('unchecked_cast') + 2;
    const h = hover([line], 0, col);
    // Kotlin compiler is case-sensitive; lowercase doesn't match anything real.
    expect(h, 'lowercase Kotlin ID should not match the dictionary').toBeNull();
  });

  it('javac warnings ARE lowercase — `unchecked` matches', () => {
    const line = '@SuppressWarnings("unchecked")';
    const col  = line.indexOf('unchecked') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('javac');
  });

  it('Android Lint IDs are PascalCase — lowercase first letter is NOT a match', () => {
    const line = '@SuppressLint("missingPermission")';
    const col  = line.indexOf('missingPermission') + 2;
    const h = hover([line], 0, col);
    expect(h).toBeNull();
  });
});

// ── ADV-5 — Multi-annotation lines ────────────────────────────────────────

describe('ADV-5 — multiple annotations on one line', () => {
  it('@JvmStatic @Suppress("UNCHECKED_CAST") — Suppress is second', () => {
    const line = '@JvmStatic @Suppress("UNCHECKED_CAST") fun foo() = 1';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('UNCHECKED_CAST');
  });

  it('two @Suppress annotations side by side, cursor on the second', () => {
    const line = '@Suppress("UNCHECKED_CAST") @Suppress("DEPRECATION") fun foo() = 1';
    const col  = line.indexOf('DEPRECATION') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('DEPRECATION');
  });

  it('@Suppress next to @SuppressLint — each resolves independently', () => {
    const line = '@Suppress("UNCHECKED_CAST") @SuppressLint("MissingPermission") fun foo() = 1';

    const a = hover([line], 0, line.indexOf('UNCHECKED_CAST') + 2);
    expect(hoverText(a)).toContain('Kotlin warning');

    const b = hover([line], 0, line.indexOf('MissingPermission') + 2);
    expect(hoverText(b)).toContain('Android Lint');
  });
});

// ── ADV-6 — Vararg / named-argument forms ────────────────────────────────

describe('ADV-6 — Kotlin vararg + named-argument shapes', () => {
  it('@Suppress(names = ["UNCHECKED_CAST"]) — named vararg with array literal', () => {
    const line = '@Suppress(names = ["UNCHECKED_CAST"])';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('UNCHECKED_CAST');
  });

  it('trailing comma after the last ID: @Suppress("UNCHECKED_CAST",)', () => {
    const line = '@Suppress("UNCHECKED_CAST",)';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
  });
});

// ── ADV-7 — Long inputs / pathological lines ─────────────────────────────

describe('ADV-7 — pathological inputs do not blow up', () => {
  it('very long line (10 KB) with the annotation at the end', () => {
    const padding = 'val x = "' + 'a'.repeat(10_000) + '"; ';
    const annotation = '@Suppress("UNCHECKED_CAST")';
    const line = padding + annotation;
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const start = Date.now();
    const h = hover([line], 0, col);
    const elapsed = Date.now() - start;
    expect(h).not.toBeNull();
    expect(elapsed, 'must complete under 50 ms even on 10 KB lines').toBeLessThan(50);
  });

  it('line with 50 nested @Suppress calls — first cursor still resolves', () => {
    // Rare but legal: deeply nested annotation expressions in macros / DSLs
    const tail = '"UNCHECKED_CAST"';
    const line = '@Suppress(' + Array(50).fill(tail).join(', ') + ')';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const start = Date.now();
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('huge ID inside Suppress (200 chars) — graceful no-hover', () => {
    const longId = 'A' + 'B'.repeat(199);
    const line = `@Suppress("${longId}")`;
    const col  = line.indexOf(longId) + 5;
    const h = hover([line], 0, col);
    // The ID matches the regex shape but isn't in the dict → no hover, no crash.
    expect(h).toBeNull();
  });
});

// ── ADV-8 — Quotes & escapes ──────────────────────────────────────────────

describe('ADV-8 — quote handling', () => {
  it('single-quoted IDs (Java-style char literals are illegal but tolerated)', () => {
    // Provider explicitly accepts both quote styles for the Java case.
    const line = "@SuppressWarnings('unchecked')";
    const col  = line.indexOf('unchecked') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('unchecked');
  });

  it('escaped quote inside ID is rejected (regex requires identifier shape)', () => {
    // String content is literally `UNCHECKED\"CAST` — not an identifier.
    const line = String.raw`@Suppress("UNCHECKED\"CAST")`;
    const col  = line.indexOf('UNCHECKED') + 2;
    const h = hover([line], 0, col);
    expect(h).toBeNull();
  });

  it('mismatched quote styles inside one annotation: outer ", inner \' — only outer matters', () => {
    const line = `@Suppress("UNCHECKED_CAST", 'unchecked')`;
    const a = hover([line], 0, line.indexOf('UNCHECKED_CAST') + 2);
    expect(hoverText(a)).toContain('UNCHECKED_CAST');
    const b = hover([line], 0, line.indexOf('unchecked') + 2);
    expect(hoverText(b)).toContain('unchecked');
  });
});

// ── ADV-9 — Unicode / non-ASCII ───────────────────────────────────────────

describe('ADV-9 — non-ASCII content', () => {
  it('ID containing a non-ASCII letter is rejected (regex is ASCII-only)', () => {
    const line = '@Suppress("UNCHECKEÐ_CAST")';            // Eth, not a real ID
    const col  = line.indexOf('UNCHECKE') + 2;
    const h = hover([line], 0, col);
    expect(h).toBeNull();
  });

  it('annotation surrounded by emoji comments — still resolves', () => {
    const line = '/* 🎯 */ @Suppress("UNCHECKED_CAST") /* 🚀 */ fun foo() = 1';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h).not.toBeNull();
  });
});

// ── ADV-10 — Multi-line annotations (known limitation) ───────────────────

describe('ADV-10 — multi-line annotation: documented limitation', () => {
  it('cursor on continuation line of a multi-line @Suppress does NOT fire', () => {
    // Real Kotlin code can wrap long @Suppress lists across lines:
    //   @Suppress(
    //     "UNCHECKED_CAST",
    //     "DEPRECATION",
    //   )
    // The provider only inspects the cursor's current line. The continuation
    // line `    "UNCHECKED_CAST",` has no `@Suppress(` on it, so it returns
    // null. This is a documented limitation — not a crash.
    const lines = [
      '@Suppress(',
      '    "UNCHECKED_CAST",',
      '    "DEPRECATION",',
      ')',
      'fun foo() = 1',
    ];
    const col = lines[1].indexOf('UNCHECKED_CAST') + 2;
    const h = hover(lines, 1, col);
    // Today: returns null. If we ever lift this limitation, flip the assertion.
    expect(h, 'multi-line @Suppress is a known limitation').toBeNull();
  });
});

// ── ADV-11 — Comments containing @Suppress (behaviour audit) ─────────────

describe('ADV-11 — @Suppress inside a line comment', () => {
  it('audit: hover currently fires inside a // comment — track if we tighten this', () => {
    // Tracking-only test. The provider does not strip comments before scanning.
    // A line like `// @Suppress("UNCHECKED_CAST")` would currently produce a
    // hover. We accept this for now (low harm, common pattern is to comment
    // OUT a suppression while keeping its meaning available on hover).
    const line = '// @Suppress("UNCHECKED_CAST") — keep for next refactor';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hover([line], 0, col);
    expect(h, 'documented behaviour: hover inside a // comment is allowed').not.toBeNull();
  });
});

// ── ADV-12 — Realistic Android / Kotlin source shapes ────────────────────

describe('ADV-12 — realistic file shapes from real Android/Kotlin codebases', () => {
  it('top-of-file file:Suppress with imports underneath', () => {
    const lines = [
      '@file:Suppress("UNCHECKED_CAST", "NOTHING_TO_INLINE")',
      '',
      'package com.example.foo',
      '',
      'import android.content.Context',
      'import androidx.annotation.RestrictTo',
    ];
    const col = lines[0].indexOf('NOTHING_TO_INLINE') + 2;
    const h = hover(lines, 0, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('NOTHING_TO_INLINE');
  });

  it('Compose @Composable with @Suppress on the same indented line', () => {
    const lines = [
      'class Screen {',
      '    @Composable @Suppress("MissingPermission")',
      '    fun Render() {}',
      '}',
    ];
    const col = lines[1].indexOf('MissingPermission') + 2;
    const h = hover(lines, 1, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('MissingPermission');
  });

  it('Java method with @SuppressWarnings({"unchecked", "rawtypes"}) array literal', () => {
    const line = '    @SuppressWarnings({"unchecked", "rawtypes"}) public void foo() {}';
    const a = hover([line], 0, line.indexOf('unchecked') + 2);
    expect(hoverText(a)).toContain('unchecked');
    const b = hover([line], 0, line.indexOf('rawtypes') + 2);
    expect(hoverText(b)).toContain('rawtypes');
  });
});
