/**
 * Adversarial & stress tests for NullAssertionProvider.
 *
 * Strategy: attack the scanner with inputs designed to fool it.
 *
 * Attack surface:
 *  1. isInsideCommentOrString — string/comment boundary detection
 *  2. countTripleQuotes — raw string tracking via naive triple-quote counting
 *  3. indexOf('!!') — linear !! scan without regex, overlapping occurrences
 *
 * Tests are named ADVER-NULL-* so they're easy to grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { NullAssertionProvider } from '../../src/providers/NullAssertionProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeVisibleTextEditors').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
}

function decs(lines: string[]) {
  setup();
  const provider = new NullAssertionProvider();
  const editor = {
    document: { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }) },
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  provider.invalidateAll();
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

// ── ADVER-NULL-1: String boundary attacks ─────────────────────────────────────

describe('ADVER-NULL-1 — !! inside vs. outside string boundaries', () => {
  it('!! inside string template ${x!!} must NOT decorate', () => {
    // isInsideCommentOrString("\"${x!!}\"", 4) should return true
    expect(decs(['"${x!!}"'])).toHaveLength(0);
  });

  it('!! immediately after closing quote "abc"!! MUST decorate', () => {
    const result = decs(['"abc"!!']);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(5);
  });

  it('!! after escaped backslash at end of string "hello\\\\"!! MUST decorate', () => {
    // "hello\\" is a valid string ending in backslash — !! follows closing quote
    expect(decs(['"hello\\\\"!!'])).toHaveLength(1);
  });

  it('!! between two string literals "a"!!"b" MUST decorate', () => {
    expect(decs(['"a"!!"b"'])).toHaveLength(1);
  });

  it('!! inside second string of concatenation "a" + "b!!" must NOT decorate', () => {
    expect(decs(['"a" + "b!!"'])).toHaveLength(0);
  });

  it('null!! — null literal with !! MUST decorate', () => {
    expect(decs(['val x = null!!'])).toHaveLength(1);
  });

  it('!! with single-quoted char literal after closing quote', () => {
    // 'a'!! — in Kotlin chars are delimited by ', but we still check
    // Single-quote handling — isInsideCommentOrString handles ' as string delimiter
    const result = decs(["val c = 'a'!!"]);
    // !! is after the closing ' so it MUST decorate
    expect(result).toHaveLength(1);
  });
});

// ── ADVER-NULL-2: Comment boundary attacks ────────────────────────────────────

describe('ADVER-NULL-2 — !! near comment boundaries', () => {
  it('!! before // comment MUST decorate, !! inside comment must NOT', () => {
    const result = decs(['val x = y!! // ignore this!!']);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe('val x = y'.length);
  });

  it('!! after closed /* */ block comment MUST decorate', () => {
    expect(decs(['/* skip this!! */ x!!'])).toHaveLength(1);
  });

  it('!! inside /* */ block comment must NOT decorate', () => {
    expect(decs(['val x = /* y!! */ 1'])).toHaveLength(0);
  });

  it('unclosed /* block comment suppresses !! to end of line', () => {
    expect(decs(['val x = /* y!! z'])).toHaveLength(0);
  });

  it('!! immediately after closing */ with no space', () => {
    expect(decs(['/*skip*/x!!'])).toHaveLength(1);
  });

  it('entire line is a // comment with !! — no decoration', () => {
    expect(decs(['// x!! y!! z!!'])).toHaveLength(0);
  });
});

// ── ADVER-NULL-3: Raw string (triple-quote) attacks ───────────────────────────

describe('ADVER-NULL-3 — !! inside / outside raw strings', () => {
  it('!! inside a multi-line raw string block must NOT decorate', () => {
    const result = decs([
      'val s = """',
      'foo!! bar!!',   // inside raw string
      '"""',
    ]);
    expect(result).toHaveLength(0);
  });

  it('!! after the raw string block closes MUST decorate', () => {
    const result = decs([
      'val s = """',
      'inner',
      '"""',
      'val y = z!!',   // outside raw string
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.line).toBe(3);
  });

  it('multiple raw string blocks — !! between them MUST decorate', () => {
    const result = decs([
      '"""',             // open raw 1
      'inside1!!',       // inside — skip
      '"""',             // close raw 1
      'between!!',       // outside — MUST decorate
      '"""',             // open raw 2
      'inside2!!',       // inside — skip
      '"""',             // close raw 2
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.line).toBe(3);
  });

  it('nested !! right after opening triple quote on same line is skipped', () => {
    // Line with odd triple count → toggled to inRawString=true → skip
    expect(decs(['val s = """!!skip'])).toHaveLength(0);
  });

  it('single-line raw string """foo!!bar""" — !! inside quotes string via isInsideCommentOrString', () => {
    // Triple count = 2 (even) → NOT toggled to raw string mode
    // isInsideCommentOrString handles the !! position within the """-delimited content
    // Expected: !! at position after 3rd " — treated as inside a string by isInsideCommentOrString
    expect(decs(['"""foo!!bar"""'])).toHaveLength(0);
  });
});

// ── ADVER-NULL-4: Overlapping and adjacent !! ─────────────────────────────────

describe('ADVER-NULL-4 — overlapping and adjacent !! patterns', () => {
  it('!!!! produces exactly 2 decorations at cols 0 and 2', () => {
    const result = decs(['!!!!']);
    expect(result).toHaveLength(2);
    expect(result[0].range.start.character).toBe(0);
    expect(result[1].range.start.character).toBe(2);
  });

  it('!!!!! (5 chars) produces 2 decorations (at 0 and 2, char 4 is standalone !)', () => {
    // indexOf('!!', 0)=0, idx+2=2; indexOf('!!', 2)=2, idx+2=4; indexOf('!!', 4)=−1
    const result = decs(['!!!!!']);
    expect(result).toHaveLength(2);
  });

  it('!! at column 0 (start of line) MUST decorate', () => {
    const result = decs(['!!foo']);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(0);
  });

  it('!! at the very last two chars of a long line MUST decorate', () => {
    const line = 'val x = ' + 'a'.repeat(200) + '!!';
    const result = decs([line]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(line.length - 2);
  });

  it('10 separate !! on one line produces 10 decorations', () => {
    const line = Array.from({ length: 10 }, (_, i) => `a${i}!!`).join(' ');
    const result = decs([line]);
    expect(result).toHaveLength(10);
  });
});

// ── ADVER-NULL-5: Edge cases — empty, single char, no content ─────────────────

describe('ADVER-NULL-5 — boundary and degenerate inputs', () => {
  it('empty document produces 0 decorations', () => {
    expect(decs([])).toHaveLength(0);
  });

  it('single empty line produces 0 decorations', () => {
    expect(decs([''])).toHaveLength(0);
  });

  it('document with only blank lines produces 0 decorations', () => {
    expect(decs(['', '', '', ''])).toHaveLength(0);
  });

  it('package and import lines with !! are skipped (comment/import fast path)', () => {
    // These lines start with 'package ' or 'import ' — provider fast-paths them
    // but those fast paths are for comment/import, not package. Let's verify.
    const result = decs([
      'package com.test',
      'import com.other.Foo',
      'val x = foo!!',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.line).toBe(2);
  });

  it('line with only whitespace produces 0 decorations', () => {
    expect(decs(['   \t  '])).toHaveLength(0);
  });

  it('KDoc block /** ... */: opening and closing lines skipped, but middle lines are processed', () => {
    // The provider does NOT track multi-line /* */ comment state between lines.
    // Lines starting with ' *' are not on the fast-path skip list in NullAssertionProvider.
    // isInsideCommentOrString operates per-line — it only sees the content of the current line.
    // A middle line like ' * Use x!!' has no '/*' on it → !! is NOT considered inside a comment.
    // This documents known provider behaviour: KDoc-interior lines are treated as code for !! scanning.
    const result = decs([
      '/**',
      ' * Use x!! to force non-null',
      ' */',
    ]);
    // The line '/**' has tripleCount=0 and no !!, the line ' */' similarly.
    // Only ' * Use x!!' has '!!' and it is NOT suppressed (per-line comment tracking).
    expect(result).toHaveLength(1);
    expect(result[0].range.start.line).toBe(1);
  });
});

// ── ADVER-NULL-6: Stress test ─────────────────────────────────────────────────

describe('ADVER-NULL-6 — stress: large document performance', () => {
  it('500-line document, one !! per line, returns 500 decorations in < 100ms', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `val x${i} = foo${i}!!`);
    const start = performance.now();
    const result = decs(lines);
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(500);
    expect(elapsed).toBeLessThan(100);
  });

  it('500-line document, all !! inside strings, returns 0 decorations', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `val s${i} = "foo${i}!!"`);
    const result = decs(lines);
    expect(result).toHaveLength(0);
  });

  it('500-line document, all !! inside // comments, returns 0 decorations', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `val x${i} = 1 // x${i}!!`);
    const result = decs(lines);
    expect(result).toHaveLength(0);
  });

  it('1000-line document alternating decorated/not — correct count', () => {
    // Even lines: !! in code (decorated)
    // Odd lines:  !! in string (not decorated)
    const lines = Array.from({ length: 1000 }, (_, i) =>
      i % 2 === 0 ? `val x${i} = a${i}!!` : `val s${i} = "a${i}!!"`,
    );
    const result = decs(lines);
    expect(result).toHaveLength(500);
  });
});
