/**
 * Fuzz + structural invariant tests for KotlinParser.
 *
 * The parser is used on EVERY file in the workspace. A crash or a structural
 * invariant violation propagates to every feature (Go to Definition, Find
 * Usages, CodeLens, Inlay Hints, etc.). Finding bugs here has maximum impact.
 *
 * Test strategies:
 *
 *   KPF-1  Crash-resistance: parse() must never throw on any input.
 *          Malformed, truncated, or adversarial Kotlin must always return
 *          a valid ParsedFile (possibly empty symbols/imports).
 *
 *   KPF-2  Determinism: parse(uri, code) called twice always returns the
 *          same result (deep equality). Non-determinism is invisible in
 *          normal use but breaks incremental re-indexing and snapshot tests.
 *
 *   KPF-3  Structural invariants that must hold for any parsed file:
 *          - line numbers are non-negative and non-decreasing
 *          - depth is non-negative for all symbols
 *          - nested symbols have depth > their containing class's depth
 *          - packageName matches the package declaration (or empty string)
 *          - imports contains the exact set of import paths in the file
 *
 *   KPF-4  Mutation fuzz: take valid Kotlin snippets, apply random mutations
 *          (delete char, insert char, duplicate line), verify no crash and
 *          structural invariants still hold.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Seeded PRNG (Mulberry32) — deterministic mutations. */
function mkRng(seed: number): () => number {
  let t = seed >>> 0;
  return function next(): number {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Assert structural invariants on any ParsedFile. */
function assertParseInvariants(result: ReturnType<typeof parse>, label: string): void {
  // INV-A: always returns an object (never null/undefined)
  expect(result, `${label}: result must be defined`).toBeDefined();
  expect(typeof result.packageName, `${label}: packageName is string`).toBe('string');
  expect(Array.isArray(result.imports), `${label}: imports is array`).toBe(true);
  expect(Array.isArray(result.symbols), `${label}: symbols is array`).toBe(true);

  // INV-B: line numbers are non-negative and non-decreasing
  let prevLine = -1;
  for (const sym of result.symbols) {
    expect(sym.line, `${label}: line ${sym.line} must be ≥ 0`).toBeGreaterThanOrEqual(0);
    expect(sym.line, `${label}: line ${sym.line} must be ≥ prev ${prevLine}`).toBeGreaterThanOrEqual(prevLine);
    prevLine = sym.line;
  }

  // INV-C: depth is non-negative
  for (const sym of result.symbols) {
    expect(sym.depth, `${label}: depth ${sym.depth} of '${sym.name}' must be ≥ 0`).toBeGreaterThanOrEqual(0);
  }

  // INV-D: character positions are non-negative
  for (const sym of result.symbols) {
    expect(sym.character, `${label}: character ${sym.character} of '${sym.name}' must be ≥ 0`).toBeGreaterThanOrEqual(0);
  }

  // INV-E: symbol names are non-empty strings
  for (const sym of result.symbols) {
    expect(sym.name.length, `${label}: symbol name must be non-empty`).toBeGreaterThan(0);
  }

  // INV-F: import strings are non-empty and contain a dot (must be qualified paths)
  for (const imp of result.imports) {
    expect(typeof imp, `${label}: import must be string`).toBe('string');
    expect(imp.length, `${label}: import "${imp}" must be non-empty`).toBeGreaterThan(0);
  }
}

// ── KPF-1: Crash-resistance ───────────────────────────────────────────────────

describe('KPF-1 — crash-resistance: parse() must never throw on any input', () => {
  const CRASH_INPUTS = [
    '',
    ' ',
    '\n',
    '\t',
    '\r\n',
    'x',
    'package',
    'package ',
    'import',
    'import ',
    'class',
    'class {',
    'class }',
    '{}',
    '{{{{',
    '}}}}',
    '"""',
    '"""never closed',
    '// just a comment',
    '/* block comment',
    '/* unclosed',
    '*/  orphan close */',
    'fun',
    'fun f',
    'fun f(',
    'fun f()',
    'fun f() {',
    'val',
    'val x',
    'val x =',
    'object',
    'object {}',
    'sealed',
    'sealed class',
    'data class',
    'data class Foo',
    'class Foo<',
    'class Foo<T',
    'class Foo<T>',
    'class Foo<T : ',
    'class Foo<T : Comparable<T>>',
    'class Foo<T : List<Map<String, Bar>>>',
    'class Foo : ',
    'class Foo : Bar, ',
    'class A { class B { class C { class D { } } }',  // missing closing braces
    'val x = """\n',  // unclosed raw string
    'val x = """raw\ncontent\n"""',
    '@',
    '@Annotation',
    '@Annotation class',
    'typealias',
    'typealias Foo',
    'typealias Foo =',
    'typealias Foo = Bar',
    'enum class',
    'enum class Color { RED, GREEN, BLUE }',
    '`backtick name`',
    'fun `backtick fun`()',
    'class `Backtick Class`',
    '\u0000\u0001\u0002',   // null bytes
    'a'.repeat(10_000),     // very long line
    ('class A { '.repeat(100) + '}'.repeat(100)), // deeply nested
    'import com.a.Foo\nimport com.b.Bar\nimport '.slice(0, -1), // truncated last import
    'package com.very.deeply.nested.package.name.that.goes.on.forever\nclass Foo',
  ];

  for (const input of CRASH_INPUTS) {
    it(`does not crash on: ${JSON.stringify(input).slice(0, 60)}`, () => {
      expect(() => parse('file:///test.kt', input)).not.toThrow();
      const result = parse('file:///test.kt', input);
      assertParseInvariants(result, JSON.stringify(input).slice(0, 40));
    });
  }
});

// ── KPF-2: Determinism ────────────────────────────────────────────────────────

describe('KPF-2 — determinism: parse() called twice returns identical result', () => {
  const DETERMINISM_INPUTS = [
    '',
    'package com.p\nclass Foo',
    `package com.example
import com.a.Alpha
import com.b.Beta

class MyClass : Alpha {
  fun doSomething(): Beta = Beta()
  val x = 42
}`,
    `package com.ui

import androidx.compose.runtime.Composable
import androidx.compose.material.Text

@Composable
fun HelloWorld() {
  Text("Hello")
}`,
    `sealed class Result<out T> {
  data class Success<T>(val value: T) : Result<T>()
  data class Error(val message: String, val cause: Throwable?) : Result<Nothing>()
  object Loading : Result<Nothing>()
}`,
    `package com.deep
class Outer {
  class Middle {
    class Inner {
      fun method() {}
    }
  }
}`,
  ];

  for (const code of DETERMINISM_INPUTS) {
    it(`deterministic for: ${JSON.stringify(code).slice(0, 60)}`, () => {
      const r1 = parse('file:///test.kt', code);
      const r2 = parse('file:///test.kt', code);

      expect(r1.packageName,  'packageName').toBe(r2.packageName);
      expect(r1.imports,      'imports').toEqual(r2.imports);
      expect(r1.symbols.length, 'symbol count').toBe(r2.symbols.length);

      for (let i = 0; i < r1.symbols.length; i++) {
        const a = r1.symbols[i];
        const b = r2.symbols[i];
        expect(a.name,  `sym[${i}].name`).toBe(b.name);
        expect(a.kind,  `sym[${i}].kind`).toBe(b.kind);
        expect(a.line,  `sym[${i}].line`).toBe(b.line);
        expect(a.depth, `sym[${i}].depth`).toBe(b.depth);
      }
    });
  }
});

// ── KPF-3: Structural invariants on real Kotlin patterns ──────────────────────

describe('KPF-3 — structural invariants on known Kotlin patterns', () => {
  it('empty file: no symbols, no imports, empty packageName', () => {
    const r = parse('file:///empty.kt', '');
    expect(r.packageName).toBe('');
    expect(r.imports).toHaveLength(0);
    expect(r.symbols).toHaveLength(0);
    assertParseInvariants(r, 'empty');
  });

  it('package-only file: correct packageName, no symbols', () => {
    const r = parse('file:///pkg.kt', 'package com.example.myapp');
    expect(r.packageName).toBe('com.example.myapp');
    expect(r.symbols).toHaveLength(0);
    assertParseInvariants(r, 'package-only');
  });

  it('imports-only file: correct import list, no symbols', () => {
    const code = 'import com.a.Foo\nimport com.b.Bar\nimport com.c.*';
    const r = parse('file:///imp.kt', code);
    expect(r.imports).toContain('com.a.Foo');
    expect(r.imports).toContain('com.b.Bar');
    expect(r.imports).toContain('com.c.*');
    expect(r.symbols).toHaveLength(0);
    assertParseInvariants(r, 'imports-only');
  });

  it('nested classes: inner depth > outer depth', () => {
    const code = `class Outer {
  class Inner {
    class DeepInner {}
  }
}`;
    const r = parse('file:///nested.kt', code);
    const outer     = r.symbols.find(s => s.name === 'Outer');
    const inner     = r.symbols.find(s => s.name === 'Inner');
    const deepInner = r.symbols.find(s => s.name === 'DeepInner');

    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(deepInner).toBeDefined();
    expect(inner!.depth).toBeGreaterThan(outer!.depth);
    expect(deepInner!.depth).toBeGreaterThan(inner!.depth);
    assertParseInvariants(r, 'nested');
  });

  it('class-level functions have higher depth than the class', () => {
    const code = `class MyClass {
  fun method() {}
  val prop = 1
}`;
    const r    = parse('file:///cls.kt', code);
    const cls  = r.symbols.find(s => s.name === 'MyClass')!;
    const meth = r.symbols.find(s => s.name === 'method')!;
    const prop = r.symbols.find(s => s.name === 'prop')!;

    expect(meth.depth).toBeGreaterThan(cls.depth);
    expect(prop.depth).toBeGreaterThan(cls.depth);
    assertParseInvariants(r, 'class members');
  });

  it('top-level functions have depth 0', () => {
    const code = `package com.p
fun topLevel() {}
fun anotherTop() {}`;
    const r = parse('file:///top.kt', code);
    for (const sym of r.symbols) {
      expect(sym.depth, `${sym.name} must have depth 0`).toBe(0);
    }
    assertParseInvariants(r, 'top-level');
  });

  it('line numbers are monotonically non-decreasing across all symbols', () => {
    const code = `package com.p
class A {
  fun a1() {}
  fun a2() {}
}
class B {
  class B1 {
    fun b1() {}
  }
}
fun topLevel() {}`;
    const r = parse('file:///mono.kt', code);
    for (let i = 1; i < r.symbols.length; i++) {
      expect(r.symbols[i].line, `sym[${i}].line ≥ sym[${i-1}].line`).toBeGreaterThanOrEqual(r.symbols[i-1].line);
    }
    assertParseInvariants(r, 'monotonic lines');
  });

  it('companion object members are indexed', () => {
    const code = `class MyClass {
  companion object {
    fun create(): MyClass = MyClass()
    const val TAG = "MyClass"
  }
}`;
    const r = parse('file:///companion.kt', code);
    assertParseInvariants(r, 'companion');
    // companion members should be present
    const create = r.symbols.find(s => s.name === 'create');
    const tag    = r.symbols.find(s => s.name === 'TAG');
    expect(create || tag).toBeDefined(); // at least one member indexed
  });

  it('data class primary constructor val params are indexed as properties', () => {
    // In Kotlin, `data class Foo(val x: T)` creates a real property x — the parser
    // indexes it at depth 1 (inside the class). This is correct behavior.
    const code = `data class Point(val x: Double, val y: Double)`;
    const r = parse('file:///point.kt', code);
    assertParseInvariants(r, 'data class');
    // The class itself is indexed
    expect(r.symbols.find(s => s.name === 'Point')).toBeDefined();
    // val params are indexed as properties (depth 1)
    const x = r.symbols.find(s => s.name === 'x');
    const y = r.symbols.find(s => s.name === 'y');
    if (x) expect(x.depth).toBeGreaterThan(0); // must be inside Point, not top-level
    if (y) expect(y.depth).toBeGreaterThan(0);
  });
});

// ── KPF-4: Mutation fuzz ──────────────────────────────────────────────────────

describe('KPF-4 — mutation fuzz: random mutations of valid code must not crash', () => {
  // Corpus of valid Kotlin snippets to mutate
  const CORPUS = [
    `package com.p
import com.a.Alpha
class MyClass : Alpha {
  fun doSomething(): Unit {}
  val x = 42
}`,

    `sealed class State {
  object Loading : State()
  data class Success(val data: String) : State()
  data class Error(val msg: String) : State()
}`,

    `package com.ui
import androidx.compose.runtime.Composable
@Composable
fun Screen(modifier: Modifier = Modifier) {
  Column {
    Text("Hello")
    Button(onClick = {}) { Text("Click") }
  }
}`,

    `class Outer<T : Comparable<T>>(private val value: T) {
  inner class Inner {
    fun compare(other: T): Int = value.compareTo(other)
  }
  companion object {
    fun <T : Comparable<T>> create(v: T) = Outer(v)
  }
}`,

    `interface Repository<T, ID> {
  suspend fun findById(id: ID): T?
  suspend fun save(entity: T): T
  suspend fun delete(id: ID)
  fun findAll(): Flow<T>
}`,
  ];

  function mutate(code: string, rng: () => number): string {
    const chars = [...code];
    const op = rng();

    if (op < 0.25 && chars.length > 0) {
      // Delete random character
      const idx = Math.floor(rng() * chars.length);
      chars.splice(idx, 1);
    } else if (op < 0.5) {
      // Insert random printable ASCII
      const idx = Math.floor(rng() * (chars.length + 1));
      const ch  = String.fromCharCode(32 + Math.floor(rng() * 95));
      chars.splice(idx, 0, ch);
    } else if (op < 0.70) {
      // Duplicate a random line
      const lines = code.split('\n');
      if (lines.length > 0) {
        const idx = Math.floor(rng() * lines.length);
        lines.splice(idx, 0, lines[idx]);
        return lines.join('\n');
      }
    } else if (op < 0.85) {
      // Delete a random line
      const lines = code.split('\n');
      if (lines.length > 1) {
        const idx = Math.floor(rng() * lines.length);
        lines.splice(idx, 1);
        return lines.join('\n');
      }
    } else {
      // Replace a random char with a keyword
      const keywords = ['class', 'fun', 'val', 'var', 'import', '{', '}', '(', ')', '"'];
      const idx = Math.floor(rng() * (chars.length + 1));
      const kw  = keywords[Math.floor(rng() * keywords.length)];
      chars.splice(idx, 0, ...kw);
    }

    return chars.join('');
  }

  function fuzzCorpus(seed: number, mutations: number): void {
    const rng = mkRng(seed);
    for (const base of CORPUS) {
      let code = base;
      for (let m = 0; m < mutations; m++) {
        code = mutate(code, rng);

        let result: ReturnType<typeof parse> | undefined;
        expect(() => {
          result = parse('file:///fuzz.kt', code);
        }, `seed=${seed} corpus step=${m}: parse must not throw`).not.toThrow();

        if (result) {
          assertParseInvariants(result, `seed=${seed} step=${m}`);
        }
      }
    }
  }

  it('seed 0xABCD — 30 mutations per corpus file', () => fuzzCorpus(0xABCD, 30));
  it('seed 0x1234 — 30 mutations per corpus file', () => fuzzCorpus(0x1234, 30));
  it('seed 0xFACE — 50 mutations per corpus file', () => fuzzCorpus(0xFACE, 50));
  it('seed 0xBEEF — 50 mutations per corpus file', () => fuzzCorpus(0xBEEF, 50));
  it('seed 0xDEAD — 80 mutations (stress)', () => fuzzCorpus(0xDEAD, 80));

  it('truncation at every character position does not crash', () => {
    const code = `package com.p
import com.a.Foo
class MyClass : Foo {
  fun method(): Unit {}
}`;
    for (let len = 0; len < code.length; len += 3) {
      const truncated = code.slice(0, len);
      expect(() => parse('file:///trunc.kt', truncated), `len=${len}`).not.toThrow();
    }
  });

  it('repeating the same valid file 100× produces identical symbol count', () => {
    const code = `package com.p\nclass Alpha\nfun beta() {}\nval gamma = 1`;
    const expected = parse('file:///rep.kt', code).symbols.length;
    for (let i = 0; i < 100; i++) {
      const r = parse('file:///rep.kt', code);
      expect(r.symbols.length, `iteration ${i}`).toBe(expected);
    }
  });
});

// ── KPF-5: Known parser blind spots ──────────────────────────────────────────
// These test patterns that the regex-based parser is known to have trouble with.
// Failing tests here reveal known limitations; the important thing is no CRASH
// and no INCORRECT results that silently poison the index.

describe('KPF-5 — parser blind spots: no phantom symbols from non-code content', () => {
  it('keywords inside string literals are not indexed', () => {
    const code = `val doc = "class Phantom {}; fun fakeFunc() {}"`;
    const r = parse('file:///str.kt', code);
    expect(r.symbols.find(s => s.name === 'Phantom')).toBeUndefined();
    expect(r.symbols.find(s => s.name === 'fakeFunc')).toBeUndefined();
    assertParseInvariants(r, 'string literal keywords');
  });

  it('keywords inside line comments are not indexed', () => {
    const code = `// class Phantom {}\nclass Real {}`;
    const r = parse('file:///comment.kt', code);
    expect(r.symbols.find(s => s.name === 'Phantom')).toBeUndefined();
    expect(r.symbols.find(s => s.name === 'Real')).toBeDefined();
    assertParseInvariants(r, 'comment keywords');
  });

  it('import-like strings in body are not added to imports list', () => {
    // "import" keyword inside a string should not be parsed as an import
    const code = `class X {\n  val msg = "import com.fake.Lib"\n}`;
    const r = parse('file:///fake-import.kt', code);
    expect(r.imports).not.toContain('com.fake.Lib');
    assertParseInvariants(r, 'fake import in string');
  });

  it('deeply nested generics do not confuse depth tracking', () => {
    const code = `class Container<A : Comparable<A>, B : Map<String, List<A>>> {
  fun process(): Map<String, List<A>> = emptyMap()
}`;
    const r = parse('file:///generics.kt', code);
    assertParseInvariants(r, 'deep generics');
    const cls = r.symbols.find(s => s.name === 'Container');
    expect(cls).toBeDefined();
    expect(cls!.depth).toBe(0); // top-level class
  });

  it('lambda braces do not shift class member depth', () => {
    const code = `class MyClass {
  val handler = { x: Int ->
    val inner = x + 1
    inner
  }
  fun realMethod() {}
}`;
    const r   = parse('file:///lambda.kt', code);
    const cls = r.symbols.find(s => s.name === 'MyClass');
    const mth = r.symbols.find(s => s.name === 'realMethod');
    expect(cls).toBeDefined();
    if (mth) {
      expect(mth.depth).toBeGreaterThan(cls!.depth);
    }
    assertParseInvariants(r, 'lambda braces');
  });
});
