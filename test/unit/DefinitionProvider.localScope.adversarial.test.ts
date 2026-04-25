/**
 * ADV — DefinitionProvider local scope + named-arg + smart-nav.
 *
 * Each test was written to BREAK the implementation. A failure here
 * is a real bug worth fixing before release. Coverage classes:
 *
 *   PARSE     — function-signature parsing edge cases
 *   SCOPE     — nested scopes, shadowing, lambda/for/lambda inside lambda
 *   CTX       — cursor in comments / strings / interpolation
 *   NAMED-ARG — LHS detection false positives & negatives
 *   SMART-NAV — cursor-on-decl pivot
 *   PERF      — large files, many candidates
 */

import { describe, it, expect } from 'vitest';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Location, Position } from './__mocks__/vscode';

function addFile(idx: SymbolIndex, uri: string, code: string) { idx.add(parse(uri, code)); }
function setupP(code: string, uri = 'file:///src/F.kt') {
  const idx = new SymbolIndex();
  addFile(idx, uri, code);
  return { provider: new KotlinDefinitionProvider(idx), doc: mockDocument(uri, code), code };
}
function colOf(line: string, needle: string, occurrence = 0): number {
  let pos = -1;
  for (let i = 0; i <= occurrence; i++) {
    pos = line.indexOf(needle, pos + 1);
    if (pos < 0) return -1;
  }
  return pos;
}
function locOf(result: any): Location | undefined {
  if (!result) return undefined;
  return Array.isArray(result) ? result[0] : result;
}

// ── PARSE — exotic function signatures ───────────────────────────────────────

describe('ADV-PARSE — function signatures the parser must survive', () => {
  it('extension function: `fun String.greet(target: String)`', async () => {
    const code = `package com.example
fun String.greet(target: String): String = this + target`;
    const { provider, doc } = setupP(code);
    // `target` usage is in body; param decl on line 1.
    const callLine = 1;
    // `this + target` — cursor on `target`.
    const tCol = colOf(code.split('\n')[1], 'target', 1);
    const r = await provider.provideDefinition(doc, new Position(callLine, tCol + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
    // First `target` is at the param decl col.
    expect(loc!.range.start.character).toBe(colOf(code.split('\n')[1], 'target'));
  });

  it('generic with constraints: `fun <T : Comparable<T>> sort(items: List<T>)`', async () => {
    const code = `package com.example
fun <T : Comparable<T>> sort(items: List<T>): List<T> {
    return items.sorted()
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[2];
    const c = line.indexOf('items');
    const r = await provider.provideDefinition(doc, new Position(2, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
  });

  it('default parameter values containing `=` do NOT confuse named-arg detection', async () => {
    const code = `package com.example
fun render(label: String, padding: Int = 8, count: Int = 1) {
    println(label + padding)
}`;
    const { provider, doc } = setupP(code);
    // Cursor on `padding` in the body — should jump to param at line 1.
    const line = code.split('\n')[2];
    const c = line.indexOf('padding');
    const r = await provider.provideDefinition(doc, new Position(2, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
  });

  it('multi-line signature with default values + trailing comma', async () => {
    const code = `package com.example
fun build(
    name: String,
    level: Int = 50,
    count: Int = 1,
) {
    println(name)
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[6];
    const c = line.indexOf('name');
    const r = await provider.provideDefinition(doc, new Position(6, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2); // `    name: String,`
  });

  it('vararg parameter is recognized as a binding', async () => {
    const code = `package com.example
fun show(vararg labels: String) {
    labels.forEach { println(it) }
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[2];
    const c = line.indexOf('labels');
    const r = await provider.provideDefinition(doc, new Position(2, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
  });

  it('operator function: `operator fun plus(other: Int)`', async () => {
    const code = `package com.example
class Box(val n: Int) {
    operator fun plus(other: Box): Box {
        return Box(n + other.n)
    }
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[3];
    const c = line.indexOf('other');
    const r = await provider.provideDefinition(doc, new Position(3, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2);
  });
});

// ── SCOPE — nested fns, shadowing, lambdas in lambdas ───────────────────────

describe('ADV-SCOPE — shadowing and nested scopes', () => {
  it('inner local `val` shadows outer parameter of the same name', async () => {
    const code = `package com.example
fun outer(value: Int): Int {
    val value = 5
    return value
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[3]; // return value
    const c = line.indexOf('value');
    const r = await provider.provideDefinition(doc, new Position(3, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    // Inner `val value = 5` on line 2 should win.
    expect(loc!.range.start.line).toBe(2);
  });

  it('lambda parameter shadows outer for-loop binding of the same name', async () => {
    const code = `package com.example
fun process(items: List<Int>) {
    for (it in items) {
        items.forEach { it ->
            println(it)
        }
    }
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[4]; // println(it)
    const c = line.indexOf('it');
    const r = await provider.provideDefinition(doc, new Position(4, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    // Inner lambda `it` on line 3 should win over for-loop `it` on line 2.
    expect(loc!.range.start.line).toBe(3);
  });

  it('destructuring for-loop: `for ((key, value) in pairs)`', async () => {
    const code = `package com.example
fun dump(pairs: Map<String, Int>) {
    for ((key, value) in pairs) {
        println("$key=$value")
    }
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[3];
    // cursor on `value` inside string interpolation
    const c = line.indexOf('value');
    const r = await provider.provideDefinition(doc, new Position(3, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2);
  });

  it('top-level function declaring inside its body a fn with shadowing param — outer binding wins', async () => {
    // Local fn declarations are tricky; we don't fully support them.
    // The test guards the OUTER param resolution against breakage.
    const code = `package com.example
fun outer(target: String) {
    println(target)
    fun inner(target: String) { println(target) }
    inner("nested")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[2];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(2, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1); // outer param
  });
});

// ── CTX — comments, strings, interpolation ──────────────────────────────────

describe('ADV-CTX — context awareness in scans', () => {
  it('a `name` mentioned only in a comment does NOT count as a usage for smart-nav', async () => {
    const code = `package com.example
fun pickup(target: String) {
    // The target variable holds the name of the trainer
    println(target)
}`;
    const { provider, doc } = setupP(code);
    // Smart-nav: click on `target` declaration.
    const line = code.split('\n')[1];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    // Should jump to the `println(target)` usage on line 3, NOT
    // to the comment on line 2.
    expect(loc!.range.start.line).toBe(3);
  });

  it('a `name` inside a string literal does NOT count as usage', async () => {
    const code = `package com.example
fun pickup(target: String) {
    val msg = "the literal word target appears here"
    println(target + msg)
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(3);
  });

  it('short interpolation `$word` IS a usage', async () => {
    const code = `package com.example
fun greet(target: String) {
    println("Hello, $target!")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2);
  });

  it('full interpolation `${ word }` IS a usage', async () => {
    const code = `package com.example
fun greet(target: String) {
    println("Hello, \${target.uppercase()}!")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2);
  });
});

// ── NAMED-ARG — LHS detection edge cases ────────────────────────────────────

describe('ADV-NAMED-ARG — false positive guards', () => {
  it('assignment INSIDE a lambda inside a call — `withContext(IO) { counter = 5 }` — NOT a named-arg', async () => {
    // Use a multi-char name so resolveLocalScope's `word.length < 2`
    // guard doesn't bail before we reach the named-arg check.
    const code = `package com.example
fun work(counter: Int) {
    withContext(Dispatchers.IO) { counter = compute() }
    println(counter)
}
fun compute(): Int = 42`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('counter');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    expect(r).toBeDefined();
    const arr = Array.isArray(r) ? r : [r];
    // We expect TWO usages: the assignment inside the lambda + the println.
    expect(arr.length).toBeGreaterThanOrEqual(2);
  });

  it('LHS detection NOT triggered by `<=`, `>=`, `!=`, `<-`-style', async () => {
    const code = `package com.example
fun gt(num: Int): Boolean {
    return num >= 5 && num <= 10 && num != 7
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[2];
    const c = line.indexOf('num');
    const r = await provider.provideDefinition(doc, new Position(2, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1); // jumped to param decl
  });

  it('named-arg LHS in NESTED call disambiguates correctly', async () => {
    const code = `package com.example
fun outer(x: Int, y: Int): Int = 0
fun inner(top: Int, bottom: Int): Int = 0
fun caller() {
    val r = outer(x = inner(top = 8, bottom = 4), y = 2)
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[4];
    // Cursor on `top` LHS — should resolve to inner's `top`, NOT outer.
    const c = line.indexOf('top');
    const r = await provider.provideDefinition(doc, new Position(4, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2); // `fun inner(top: Int, ...)`
  });

  it('LHS that does not match any param of the called function — fall through gracefully (no crash)', async () => {
    const code = `package com.example
fun greet(name: String): String = ""
fun caller() {
    val r = greet(typo = "x")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[3];
    const c = line.indexOf('typo');
    const r = await provider.provideDefinition(doc, new Position(3, c + 1));
    // We don't enforce a specific result — just that it doesn't crash.
    // A null is also acceptable here.
    if (r) {
      const arr = Array.isArray(r) ? r : [r];
      // No false positive into greet's `name` param (typo ≠ name).
      for (const loc of arr) {
        expect((loc as Location).range.start.character).not.toBe(
          code.split('\n')[1].indexOf('name'),
        );
      }
    }
  });
});

// ── SMART-NAV — cursor on declaration → usages ──────────────────────────────

describe('ADV-SMART-NAV — declaration pivots to usage', () => {
  it('zero usages → returns the declaration itself', async () => {
    const code = `package com.example
fun unused(orphan: String) {
    println("nothing")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('orphan');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
  });

  it('multiple usages → returns array (picker)', async () => {
    const code = `package com.example
fun build(value: String) {
    val a = value
    val b = value
    val c = value
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('value');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    expect(Array.isArray(r)).toBe(true);
    expect((r as Location[]).length).toBe(3);
  });

  it('cursor on declaration but not exactly on first char of word still resolves', async () => {
    const code = `package com.example
fun sample(target: String) {
    println(target)
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[1];
    const c = line.indexOf('target');
    // Cursor on the LAST char of the word (4 + position).
    const r = await provider.provideDefinition(doc, new Position(1, c + 5));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(2); // pivoted to usage
  });

  it('declaration with single usage that is an LHS named-arg of an unrelated call → falls back to declaration', async () => {
    // `target` is declared as a local val; the only "occurrence" is
    // the LHS of a named-arg in a call to another function whose
    // parameter happens to share the name. Our filter must skip the
    // LHS, leaving zero usages — fall back to declaration.
    const code = `package com.example
fun greet(target: String): String = ""
fun caller() {
    val target = "alpha"
    val r = greet(target = "beta")
}`;
    const { provider, doc } = setupP(code);
    const line = code.split('\n')[3];
    const c = line.indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(3, c + 1));
    const loc = locOf(r);
    expect(loc).toBeDefined();
    // Either falls back to the declaration line 3, or — if the impl
    // also collects the RHS string `"beta"` as a usage (it shouldn't,
    // it's a string literal) — must NOT jump to line 1 (the unrelated
    // greet param).
    expect(loc!.range.start.line).not.toBe(1);
  });
});

// ── PERF — large-scale tests ────────────────────────────────────────────────

describe('ADV-PERF — provider stays responsive on large files', () => {
  it('1000-line synthetic file with one function: cursor on param resolves quickly', async () => {
    const lines: string[] = [
      'package com.example',
      'fun bigFn(target: String) {',
    ];
    for (let i = 0; i < 1000; i++) lines.push(`    println("noise $i")`);
    lines.push('    println(target)');
    lines.push('}');
    const code = lines.join('\n');
    const { provider, doc } = setupP(code);
    // Cursor on `target` usage near the bottom.
    const usageLine = lines.length - 2;
    const c = lines[usageLine].indexOf('target');
    const start = performance.now();
    const r = await provider.provideDefinition(doc, new Position(usageLine, c + 1));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    const loc = locOf(r);
    expect(loc).toBeDefined();
    expect(loc!.range.start.line).toBe(1);
  });

  it('many usages of the same binding — all collected without blowing up', async () => {
    const lines: string[] = ['package com.example', 'fun heavy(target: String) {'];
    for (let i = 0; i < 100; i++) lines.push(`    println(target)`);
    lines.push('}');
    const code = lines.join('\n');
    const { provider, doc } = setupP(code);
    const c = lines[1].indexOf('target');
    const r = await provider.provideDefinition(doc, new Position(1, c + 1));
    expect(Array.isArray(r)).toBe(true);
    expect((r as Location[]).length).toBe(100);
  });
});
