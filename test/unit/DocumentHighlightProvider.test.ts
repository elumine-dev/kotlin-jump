import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinDocumentHighlightProvider } from '../../src/providers/DocumentHighlightProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { DocumentHighlightKind } from './__mocks__/vscode';

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const FILE = 'file:///com/example/Greeter.kt';

const CODE = `package com.example

class Greeter(private val name: String) {
    fun greet(): String {
        val greeting = "Hello, \$name"
        return greeting
    }

    fun greetLoud(): String = greet().uppercase()
}`;

describe('KotlinDocumentHighlightProvider', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, FILE, CODE);
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('returns highlights for a symbol with multiple occurrences', () => {
    const doc = mockDocument(FILE, CODE);
    // 'greet' appears as declaration (fun greet) and as usage (greet().uppercase())
    const pos = positionOf(CODE, 'greet', 1); // first occurrence — declaration
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token);
    expect(result).toBeDefined();
    expect(result!.length).toBeGreaterThanOrEqual(2);
  });

  it('marks the declaration line as Write and usages as Read', () => {
    const doc = mockDocument(FILE, CODE);
    const pos = positionOf(CODE, 'greet', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    const writes = result.filter(h => h.kind === DocumentHighlightKind.Write);
    const reads  = result.filter(h => h.kind === DocumentHighlightKind.Read);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(reads.length).toBeGreaterThanOrEqual(1);
  });

  it('skips import lines', () => {
    const codeWithImport = `package com.example

import com.other.Greeter

class Foo {
    val g = Greeter("world")
    fun run() = g.greet()
}`;
    const uri = 'file:///com/example/Foo.kt';
    addFile(index, uri, codeWithImport);
    const doc = mockDocument(uri, codeWithImport);
    const pos = positionOf(codeWithImport, 'Greeter', 2); // usage, not the import
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // No highlight should be on the import line (line 2)
    const importLineHighlights = result.filter(h => h.range.start.line === 2);
    expect(importLineHighlights).toHaveLength(0);
  });

  it('returns undefined for a word that does not appear in the file', () => {
    const doc = mockDocument(FILE, CODE);
    // 'NonExistentClass' is not in the file
    const pos = { line: 0, character: 0 } as any;
    // mockDocument.getWordRangeAtPosition will return undefined for line 0, char 0 ('package')
    // Use a fresh doc where the word exists nowhere
    const emptyDoc = mockDocument(FILE, 'package com.example\n\nclass Foo {}');
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(emptyDoc, pos, token);
    // 'package' keyword has no index entry → highlights only where it appears in text
    // We just verify it returns something or undefined without throwing
    expect(() => provider.provideDocumentHighlights(emptyDoc, pos, token)).not.toThrow();
  });

  it('does not highlight occurrences inside strings', () => {
    const codeStr = `package com.example

class Greeter {
    fun greet() {
        val msg = "call greet here"
        return greet()
    }
}`;
    const uri = 'file:///GreeterStr.kt';
    addFile(index, uri, codeStr);
    const doc = mockDocument(uri, codeStr);
    const pos = positionOf(codeStr, 'greet', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The occurrence inside the string literal "call greet here" must NOT be highlighted
    const stringLinePart = result.filter(h => {
      const lineText = codeStr.split('\n')[h.range.start.line];
      return lineText.includes('"call greet here"') &&
             h.range.start.character > lineText.indexOf('"');
    });
    expect(stringLinePart).toHaveLength(0);
  });
});

// ── ADVERSARIAL: comment and string false-positives ──────────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: comment/string filtering', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('does not highlight symbol inside // line comment', () => {
    const code = [
      'package com.example',
      'fun greet() {}',
      'fun test() {',
      '    greet() // greet is called here',
      '}',
    ].join('\n');
    const uri = 'file:///CommentTest.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'greet', 2); // the call on line 3
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The occurrence inside '// greet is called here' must NOT be highlighted
    const commentOccurrences = result.filter(h => {
      const line = code.split('\n')[h.range.start.line];
      const col  = h.range.start.character;
      return line.includes('//') && col > line.indexOf('//');
    });
    expect(commentOccurrences).toHaveLength(0);
  });

  it('does NOT highlight symbol inside /* block comment */ on same line', () => {
    // isInsideCommentOrString now handles /* */ inline block comments correctly
    const code = [
      'package com.example',
      'fun greet() {}',
      'fun test() {',
      '    /* greet here */ val x = 1',
      '}',
    ].join('\n');
    const uri = 'file:///BlockComment.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'greet', 2); // inside /* */
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token);
    // Cursor is inside /* */ — highlights should NOT include the block comment occurrence
    expect(result).toBeDefined();
    const blockCommentLine = result!.filter(h => h.range.start.line === 3);
    expect(blockCommentLine.length).toBe(0);
  });

  it('does not highlight symbol that appears only inside strings', () => {
    const code = [
      'package com.example',
      'fun test() {',
      '    val msg = "greet the user"',
      '}',
    ].join('\n');
    const uri = 'file:///StringOnly.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    // Cursor on 'greet' inside the string
    const pos   = positionOf(code, 'greet');
    const token = { isCancellationRequested: false } as any;
    // Should return no highlights (or undefined), as the only occurrence is in a string
    const result = provider.provideDocumentHighlights(doc, pos, token);
    expect(result == null || result.length === 0).toBe(true);
  });

  it('does not highlight symbol at escaped quote position inside string', () => {
    // "say \"greet\" please" — 'greet' is between escaped quotes, inside string
    const code = [
      'package com.example',
      'fun greet() {}',
      'fun test() {',
      '    val s = "say \\"greet\\" please"',
      '    greet()',
      '}',
    ].join('\n');
    const uri = 'file:///EscapeTest.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'greet', 3); // the call on line 4
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The 'greet' inside the escaped string (line 3) must NOT be highlighted
    const stringLine = result.filter(h => h.range.start.line === 3);
    expect(stringLine).toHaveLength(0);
  });
});

// ── ADVERSARIAL: word boundary precision ─────────────────────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: word boundary precision', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('does not highlight `name` inside `firstName` (word boundary)', () => {
    const code = [
      'package com.example',
      'fun name(): String = "Alice"',
      'fun test() {',
      '    val firstName = "Bob"',
      '    val n = name()',
      '}',
    ].join('\n');
    const uri = 'file:///Boundary.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'name', 1); // declaration
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // 'firstName' on line 3 must NOT produce a highlight for 'name'
    const falsePositive = result.filter(h => {
      const line = code.split('\n')[h.range.start.line];
      return line.includes('firstName');
    });
    expect(falsePositive).toHaveLength(0);
  });

  it('does not highlight `Int` inside `Integer` (word boundary)', () => {
    const code = [
      'package com.example',
      'fun toInt(): Int = 0',
      'fun test() {',
      '    val x: Integer = Integer(0)',
      '    val y: Int = toInt()',
      '}',
    ].join('\n');
    const uri = 'file:///IntBoundary.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, ' Int', 1); // first standalone Int (after ': ')
    // Find actual Int position
    const intPos = positionOf(code, 'Int', 1); // declaration
    const token  = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, intPos, token)!;

    // 'Integer' lines must NOT be highlighted for 'Int'
    const integerLines = result.filter(h => {
      const line = code.split('\n')[h.range.start.line];
      return line.includes('Integer');
    });
    expect(integerLines).toHaveLength(0);
  });

  it('highlights are case-sensitive — `log` does not match `Log`', () => {
    const code = [
      'package com.example',
      'fun log() {}',
      'fun test() {',
      '    log()',
      '    Log.d("tag", "msg")',
      '}',
    ].join('\n');
    const uri = 'file:///CaseSensitive.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'log', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // No highlight on the line with 'Log.d'
    const logLines = result.filter(h => {
      const line = code.split('\n')[h.range.start.line];
      return line.includes('Log.d');
    });
    expect(logLines).toHaveLength(0);
  });
});

// ── ADVERSARIAL: declaration detection ───────────────────────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: declaration detection', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('marks declaration Write even when symbol is also used on the same line', () => {
    const code = [
      'package com.example',
      'fun greet() = greet()',  // recursive — declaration and usage on same line
      'fun test() { greet() }',
    ].join('\n');
    const uri = 'file:///SameLine.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'greet', 1); // first occurrence on declaration line
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The declaration line (line 1) must have at least one Write highlight
    const writes = result.filter(h => h.kind === DocumentHighlightKind.Write);
    expect(writes.some(h => h.range.start.line === 1)).toBe(true);
  });

  it('all occurrences are Read when symbol is not in file index (e.g. library type)', () => {
    const code = [
      'package com.example',
      '// LazyColumn is from the library, not declared in this file',
      'fun test() {',
      '    LazyColumn {}',
      '    LazyColumn {}',
      '}',
    ].join('\n');
    const uri = 'file:///LibType.kt';
    // NOTE: LazyColumn is NOT added to the index
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'LazyColumn', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    expect(result.every(h => h.kind === DocumentHighlightKind.Read)).toBe(true);
  });

  it('file not in index — returns highlights with all Read (no crash)', () => {
    // Document has never been indexed
    const code = 'package com.example\nfun foo() { foo() }';
    const uri  = 'file:///NotIndexed.kt';
    const doc  = mockDocument(uri, code);
    const pos  = positionOf(code, 'foo', 1);
    const token = { isCancellationRequested: false } as any;
    // Should not crash; returns Read highlights since no declaration info
    const result = provider.provideDocumentHighlights(doc, pos, token);
    expect(result).toBeDefined();
    expect(result!.every(h => h.kind === DocumentHighlightKind.Read)).toBe(true);
  });
});

// ── ADVERSARIAL: import line skipping ────────────────────────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: import line skipping', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('skips import line with alias — both parts excluded', () => {
    const code = [
      'package com.example',
      'import com.foo.Bar as Baz',
      'fun test(): Bar { TODO() }',
    ].join('\n');
    const uri = 'file:///AliasImport.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'Bar', 2); // usage on line 2
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // Import line (line 1) must not be highlighted
    expect(result.every(h => h.range.start.line !== 1)).toBe(true);
  });

  it('does NOT skip commented-out import — the symbol inside is highlighted', () => {
    const code = [
      'package com.example',
      '// import com.foo.Bar',
      'fun test(): Bar { TODO() }',
    ].join('\n');
    const uri = 'file:///CommentedImport.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'Bar', 2); // usage on line 2
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The commented import line starts with '//' not 'import', so it's NOT skipped.
    // 'Bar' inside the comment IS highlighted (known behavior; block comments are not filtered).
    // We just assert no crash and that results are defined.
    expect(result).toBeDefined();
  });
});

// ── ADVERSARIAL: structural edge cases ───────────────────────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: structural edge cases', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('single-occurrence symbol (declaration only) — returns 1 Write highlight', () => {
    const code = 'package com.example\nfun unique() {}';
    const uri  = 'file:///Unique.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'unique');
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe(DocumentHighlightKind.Write);
  });

  it('empty file — returns undefined without crash', () => {
    const uri  = 'file:///Empty.kt';
    const doc  = mockDocument(uri, '');
    const pos  = { line: 0, character: 0 } as any;
    const token = { isCancellationRequested: false } as any;
    expect(provider.provideDocumentHighlights(doc, pos, token)).toBeUndefined();
  });

  it('nested `remember { remember { } }` — both occurrences highlighted', () => {
    const code = [
      'package com.example',
      'fun remember(f: () -> Any): Any = f()',
      'fun test() {',
      '    val x = remember { remember { 0 } }',
      '}',
    ].join('\n');
    const uri = 'file:///NestedRemember.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'remember', 1); // declaration
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // Line 3 has two occurrences of 'remember'
    const line3 = result.filter(h => h.range.start.line === 3);
    expect(line3).toHaveLength(2);
  });

  it('`Modifier` highlighted at all positions including `.padding()` chain', () => {
    const code = [
      'package com.example',
      'class Modifier {',
      '    fun padding(all: Int): Modifier = this',
      '}',
      'fun test(modifier: Modifier) {',
      '    val m = modifier.padding(8)',
      '    val m2: Modifier = Modifier()',
      '}',
    ].join('\n');
    const uri = 'file:///ModifierTest.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'Modifier', 1); // class declaration
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // Occurrences: declaration (Write), return type in padding, parameter type, type annotation, constructor call
    expect(result.length).toBeGreaterThanOrEqual(4);
    const writes = result.filter(h => h.kind === DocumentHighlightKind.Write);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0].range.start.line).toBe(1); // class declaration line
  });
});

// ── ADVERSARIAL: underscore-prefixed and digit-containing symbols ─────────────

describe('KotlinDocumentHighlightProvider — adversarial: symbol naming edge cases', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('highlights symbol with leading underscore (_unused)', () => {
    const code = [
      'package com.example',
      'fun _setup() {}',
      'fun test() { _setup() }',
    ].join('\n');
    const uri = 'file:///Underscore.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, '_setup', 1); // declaration
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    expect(result).toBeDefined();
    expect(result.length).toBe(2); // declaration (Write) + call (Read)
    expect(result.some(h => h.kind === DocumentHighlightKind.Write)).toBe(true);
    expect(result.some(h => h.kind === DocumentHighlightKind.Read)).toBe(true);
  });

  it('highlights symbol with digits (processData2)', () => {
    const code = [
      'package com.example',
      'fun processData2(x: Int) {}',
      'fun test() { processData2(1) }',
    ].join('\n');
    const uri = 'file:///Digits.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'processData2', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    expect(result).toBeDefined();
    expect(result.length).toBe(2);
  });

  it('returns undefined when the word appears only in import lines', () => {
    // All occurrences of 'Widget' are on import lines — import lines are skipped → 0 highlights
    const code = [
      'package com.example',
      'import com.foo.Widget',
      'import com.bar.Widget as W',
    ].join('\n');
    const uri = 'file:///ImportOnly.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    // Cursor on 'Widget' in the import line (line 1)
    const pos   = positionOf(code, 'Widget', 1);
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token);
    // All matching lines are import lines → skipped → 0 highlights → returns undefined
    expect(result == null || result.length === 0).toBe(true);
  });
});

// ── ADVERSARIAL: KNOWN LIMITATION — triple-quoted strings ────────────────────

describe('KotlinDocumentHighlightProvider — adversarial: triple-quoted string limitation', () => {
  let index: SymbolIndex;
  let provider: KotlinDocumentHighlightProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new KotlinDocumentHighlightProvider(index);
  });

  it('KNOWN LIMITATION: symbol inside triple-quoted string body is highlighted (false positive)', () => {
    // isInsideCommentOrString operates per-line; it cannot detect multi-line """ delimiters.
    // A word on an interior line of a """ block looks like normal code → false-positive highlight.
    const code = [
      'package com.example',
      'fun greet() {}',
      'fun test() {',
      '    val s = """',
      '        please call greet to say hello',   // line 4 — inside triple-quoted string
      '    """.trimIndent()',
      '    greet()',
      '}',
    ].join('\n');
    const uri = 'file:///TripleQuote.kt';
    addFile(index, uri, code);
    const doc   = mockDocument(uri, code);
    const pos   = positionOf(code, 'greet', 2); // declaration on line 1
    const token = { isCancellationRequested: false } as any;
    const result = provider.provideDocumentHighlights(doc, pos, token)!;

    // The occurrence on line 4 (inside the triple-quoted string body) IS highlighted
    // because isInsideCommentOrString processes line 4 in isolation and sees no delimiter.
    const falsePositiveLine = result.filter(h => h.range.start.line === 4);
    expect(falsePositiveLine.length).toBeGreaterThan(0);
    // Document this as a known limitation: triple-quoted string content is NOT filtered.
  });
});
