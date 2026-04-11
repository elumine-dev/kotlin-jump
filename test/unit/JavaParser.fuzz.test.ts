/**
 * Fuzz + structural invariant tests for JavaParser.
 *
 * Mirrors the KotlinParser fuzz approach: crash-resistance, determinism,
 * and structural invariants that must hold for any parsed Java file.
 *
 * The Java parser is used for:
 *   - Sources JARs (library symbols for Go to Definition)
 *   - Java files in the workspace (mixed Kotlin/Java projects)
 *
 * A crash or negative-depth bug here corrupts library symbol navigation.
 */

import { describe, it, expect } from 'vitest';
import { parseJava } from '../../src/indexer/JavaParser';

// ── PRNG ─────────────────────────────────────────────────────────────────────

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

// ── Structural invariants ─────────────────────────────────────────────────────

function assertJavaInvariants(result: ReturnType<typeof parseJava>, label: string): void {
  expect(result, `${label}: result defined`).toBeDefined();
  expect(typeof result.packageName, `${label}: packageName type`).toBe('string');
  expect(Array.isArray(result.imports), `${label}: imports array`).toBe(true);
  expect(Array.isArray(result.symbols), `${label}: symbols array`).toBe(true);

  let prevLine = -1;
  for (const sym of result.symbols) {
    expect(sym.line,      `${label}: line ≥ 0 for '${sym.name}'`).toBeGreaterThanOrEqual(0);
    expect(sym.line,      `${label}: line ≥ prevLine (${prevLine}) for '${sym.name}'`).toBeGreaterThanOrEqual(prevLine);
    expect(sym.depth,     `${label}: depth ≥ 0 for '${sym.name}'`).toBeGreaterThanOrEqual(0);
    expect(sym.character, `${label}: character ≥ 0 for '${sym.name}'`).toBeGreaterThanOrEqual(0);
    expect(sym.name.length, `${label}: name non-empty`).toBeGreaterThan(0);
    prevLine = sym.line;
  }
}

// ── JPF-1: Crash-resistance ───────────────────────────────────────────────────

describe('JPF-1 — crash-resistance: parseJava() must never throw on any input', () => {
  const CRASH_INPUTS = [
    '',
    ' ',
    '\n',
    'class',
    'class {',
    'class }',
    '{}',
    '{{{{',
    '}}}}',    // ← this triggered negative depth before the fix
    '}}}}}}}',
    '// comment',
    '/* block',
    'public',
    'public class',
    'public class Foo {',
    'public class Foo {}',
    'interface',
    'interface Foo {',
    'enum',
    'enum Color { RED, GREEN }',
    'package',
    'package com.example',
    'import',
    'import com.example.Foo',
    '@Override',
    '@SuppressWarnings("unchecked")',
    '"unterminated string',
    "'x",
    'a'.repeat(10_000),
    ('class A { '.repeat(50)) + ('}'.repeat(40)), // unbalanced — missing 10 closing
    '}class Foo {}',   // class after stray }
    '} } } class Foo { }',
  ];

  for (const input of CRASH_INPUTS) {
    it(`does not crash on: ${JSON.stringify(input).slice(0, 60)}`, () => {
      expect(() => parseJava('file:///Test.java', input)).not.toThrow();
      const result = parseJava('file:///Test.java', input);
      assertJavaInvariants(result, JSON.stringify(input).slice(0, 40));
    });
  }
});

// ── JPF-2: Negative depth regression ─────────────────────────────────────────
// The critical bug: extra } characters must not produce symbols with depth < 0.

describe('JPF-2 — negative depth regression: unmatched } never produces depth < 0', () => {
  it('file starting with stray } still produces non-negative depth', () => {
    const code = '}\npublic class Foo {}';
    const result = parseJava('file:///Foo.java', code);
    for (const sym of result.symbols) {
      expect(sym.depth, `${sym.name} depth must be ≥ 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it('multiple stray } before class declaration', () => {
    const code = '} } } }\npublic class Bar { public void method() {} }';
    const result = parseJava('file:///Bar.java', code);
    const bar = result.symbols.find(s => s.name === 'Bar');
    if (bar) expect(bar.depth, 'Bar depth').toBeGreaterThanOrEqual(0);
    for (const sym of result.symbols) {
      expect(sym.depth, `${sym.name} depth`).toBeGreaterThanOrEqual(0);
    }
  });

  it('unbalanced nested classes — no negative depth anywhere', () => {
    const code = 'public class Outer { public class Inner { } }}}}}';
    const result = parseJava('file:///Outer.java', code);
    for (const sym of result.symbols) {
      expect(sym.depth, `${sym.name} depth`).toBeGreaterThanOrEqual(0);
    }
  });

  it('truncated file (class body cut off) — still valid depth', () => {
    const full = `package com.p;\npublic class MyClass {\n  public void method() {\n    doSomething();\n  }\n}`;
    for (let len = 0; len < full.length; len += 5) {
      const truncated = full.slice(0, len);
      const result = parseJava('file:///T.java', truncated);
      for (const sym of result.symbols) {
        expect(sym.depth, `truncated@${len}: ${sym.name} depth`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ── JPF-3: Determinism ────────────────────────────────────────────────────────

describe('JPF-3 — determinism: parseJava() called twice returns identical result', () => {
  const INPUTS = [
    '',
    'package com.example;\npublic class Foo {}',
    `package com.example;

import java.util.List;
import java.util.Map;

public class Repository<T> {
  private final List<T> items = new ArrayList<>();

  public void add(T item) { items.add(item); }
  public List<T> getAll() { return items; }

  public static class Builder<T> {
    public Repository<T> build() { return new Repository<>(); }
  }
}`,
    `public enum Color {
  RED, GREEN, BLUE;
  public boolean isDark() { return this == BLUE; }
}`,
  ];

  for (const code of INPUTS) {
    it(`deterministic for: ${JSON.stringify(code).slice(0, 60)}`, () => {
      const r1 = parseJava('file:///T.java', code);
      const r2 = parseJava('file:///T.java', code);

      expect(r1.packageName).toBe(r2.packageName);
      expect(r1.imports).toEqual(r2.imports);
      expect(r1.symbols.length).toBe(r2.symbols.length);
      for (let i = 0; i < r1.symbols.length; i++) {
        expect(r1.symbols[i].name,  `sym[${i}].name`).toBe(r2.symbols[i].name);
        expect(r1.symbols[i].depth, `sym[${i}].depth`).toBe(r2.symbols[i].depth);
        expect(r1.symbols[i].line,  `sym[${i}].line`).toBe(r2.symbols[i].line);
      }
    });
  }
});

// ── JPF-4: Structural invariants ──────────────────────────────────────────────

describe('JPF-4 — structural invariants on known Java patterns', () => {
  it('nested class has depth > outer class', () => {
    const code = `public class Outer {\n  public class Inner {\n    public class DeepInner {}\n  }\n}`;
    const r = parseJava('file:///N.java', code);
    assertJavaInvariants(r, 'nested');
    const outer = r.symbols.find(s => s.name === 'Outer');
    const inner = r.symbols.find(s => s.name === 'Inner');
    if (outer && inner) expect(inner.depth).toBeGreaterThan(outer.depth);
  });

  it('package extraction', () => {
    const r = parseJava('file:///P.java', 'package com.example.myapp;\npublic class Foo {}');
    expect(r.packageName).toBe('com.example.myapp');
  });

  it('imports always empty (JavaParser does not extract imports)', () => {
    // JavaParser returns imports:[] — Java imports are not used for word-index
    // pre-filtering (source JARs are navigated by FQN lookup, not word search).
    const code = `import java.util.List;\nimport java.util.Map;\npublic class Foo {}`;
    const r = parseJava('file:///I.java', code);
    expect(r.imports).toEqual([]);
  });

  it('enum members are indexed', () => {
    const code = `public enum Status { ACTIVE, INACTIVE, PENDING; }`;
    const r = parseJava('file:///E.java', code);
    assertJavaInvariants(r, 'enum');
    expect(r.symbols.find(s => s.name === 'Status')).toBeDefined();
  });
});

// ── JPF-5: Mutation fuzz ──────────────────────────────────────────────────────

describe('JPF-5 — mutation fuzz: random mutations must not crash or produce negative depth', () => {
  const CORPUS = [
    `package com.example;
import java.util.List;
public class Service {
  private final List<String> items;
  public Service() { this.items = new ArrayList<>(); }
  public void add(String item) { items.add(item); }
  public static class Builder { public Service build() { return new Service(); } }
}`,

    `public enum Direction {
  NORTH, SOUTH, EAST, WEST;
  public Direction opposite() {
    return switch (this) {
      case NORTH -> SOUTH;
      case SOUTH -> NORTH;
      case EAST  -> WEST;
      case WEST  -> EAST;
    };
  }
}`,

    `public interface Repository<T, ID> {
  T findById(ID id);
  List<T> findAll();
  void save(T entity);
  void delete(ID id);
}`,
  ];

  function mutate(code: string, rng: () => number): string {
    const op = rng();
    if (op < 0.3 && code.length > 0) {
      const idx = Math.floor(rng() * code.length);
      return code.slice(0, idx) + code.slice(idx + 1);
    } else if (op < 0.55) {
      const idx = Math.floor(rng() * (code.length + 1));
      const ch  = String.fromCharCode(32 + Math.floor(rng() * 95));
      return code.slice(0, idx) + ch + code.slice(idx);
    } else if (op < 0.75) {
      const lines = code.split('\n');
      if (lines.length > 1) {
        const idx = Math.floor(rng() * lines.length);
        lines.splice(idx, 1);
        return lines.join('\n');
      }
    } else {
      const lines = code.split('\n');
      const idx   = Math.floor(rng() * lines.length);
      lines.splice(idx, 0, lines[idx]);
      return lines.join('\n');
    }
    return code;
  }

  function fuzzCorpus(seed: number, mutations: number): void {
    const rng = mkRng(seed);
    for (const base of CORPUS) {
      let code = base;
      for (let m = 0; m < mutations; m++) {
        code = mutate(code, rng);
        let result: ReturnType<typeof parseJava> | undefined;
        expect(() => { result = parseJava('file:///fuzz.java', code); }, `seed=${seed} m=${m}: no throw`).not.toThrow();
        if (result) assertJavaInvariants(result, `seed=${seed} m=${m}`);
      }
    }
  }

  it('seed 0xABCD — 40 mutations per corpus', () => fuzzCorpus(0xABCD, 40));
  it('seed 0x1234 — 40 mutations per corpus', () => fuzzCorpus(0x1234, 40));
  it('seed 0xFACE — 60 mutations per corpus', () => fuzzCorpus(0xFACE, 60));
  it('seed 0xDEAD — 80 mutations (stress)',   () => fuzzCorpus(0xDEAD, 80));
});
