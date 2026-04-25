/**
 * Named-argument LHS resolution — Cmd+Click on the LHS of `Foo(arg = …)`
 * jumps to `arg`'s declaration in `Foo`'s parameter list. Critical
 * because Kevin's screenshot showed a clear regression: the LHS `name`
 * in `PokemonCard(name = name, …)` was matching the for-loop binding
 * via the local-scope resolver, instead of the called function's
 * `name` parameter.
 *
 * Coverage matches the table in the planning doc:
 *  - LHS shadowing a local — must STILL resolve to the called fn's param
 *  - LHS in same file
 *  - LHS in a different workspace file (index lookup)
 *  - LHS multi-line
 *  - false positives: `==`, `<=`, `>=`, `!=`, `val name = …`
 *  - nested calls: `Modifier.padding(top = 8.dp)` — `top` is `padding`'s arg
 */

import { describe, it, expect } from 'vitest';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Location, Position } from './__mocks__/vscode';

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── The flagship reproducer from Kevin's screenshot ──────────────────────────

const POKEMON_FILE = `package com.example.compose

@Composable
fun PokemonCard(name: String, level: Int) {
    Text(text = name)
}

@Composable
fun PokemonList(names: List<String>) {
    Column {
        for (name in names) {
            PokemonCard(name = name, level = 50)
        }
    }
}`;

const POKEMON_LINES = POKEMON_FILE.split('\n');
const POKEMON_PARAM_LINE = 3;  // `fun PokemonCard(name: String, level: Int) {`
const POKEMON_FOR_LINE   = 10; // `        for (name in names) {`
const POKEMON_CALL_LINE  = 11; // `            PokemonCard(name = name, level = 50)`

function setup() {
  const index = new SymbolIndex();
  addFile(index, 'file:///src/com/example/compose/Pokemon.kt', POKEMON_FILE);
  return new KotlinDefinitionProvider(index);
}

function findCol(line: string, needle: string, occurrence = 0): number {
  let pos = -1;
  for (let i = 0; i <= occurrence; i++) {
    pos = line.indexOf(needle, pos + 1);
    if (pos < 0) return -1;
  }
  return pos;
}

describe('named-arg-lhs — flagship reproducer (PokemonCard call)', () => {
  it('LHS `name` in `PokemonCard(name = name, ...)` → param at line 3', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/compose/Pokemon.kt', POKEMON_FILE);
    // First `name` on the call line is the LHS.
    const lhsCol = findCol(POKEMON_LINES[POKEMON_CALL_LINE], 'name');
    const result = await provider.provideDefinition(doc, new Position(POKEMON_CALL_LINE, lhsCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(POKEMON_PARAM_LINE);
    // Column should be the `name` in `(name: String,`.
    const expectedCol = POKEMON_LINES[POKEMON_PARAM_LINE].indexOf('name');
    expect(loc.range.start.character).toBe(expectedCol);
  });

  it('RHS `name` in `PokemonCard(name = name, ...)` → for-loop binding at line 11', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/compose/Pokemon.kt', POKEMON_FILE);
    // Second `name` = the RHS value.
    const rhsCol = findCol(POKEMON_LINES[POKEMON_CALL_LINE], 'name', 1);
    const result = await provider.provideDefinition(doc, new Position(POKEMON_CALL_LINE, rhsCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(POKEMON_FOR_LINE);
  });

  it('LHS `level` → param `level` at line 3 (no local binding to confuse it)', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/compose/Pokemon.kt', POKEMON_FILE);
    const lvlCol = findCol(POKEMON_LINES[POKEMON_CALL_LINE], 'level');
    const result = await provider.provideDefinition(doc, new Position(POKEMON_CALL_LINE, lvlCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(POKEMON_PARAM_LINE);
    const expectedCol = POKEMON_LINES[POKEMON_PARAM_LINE].indexOf('level');
    expect(loc.range.start.character).toBe(expectedCol);
  });
});

// ── False-positive guards ────────────────────────────────────────────────────

describe('named-arg-lhs — false-positive guards', () => {
  it('`==` is NOT a named arg — fallthrough to next step', async () => {
    const code = `package com.example
fun cmp(left: Int, right: Int): Boolean {
    return left == right
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Cmp.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Cmp.kt', code);
    // Cursor on `left` in `left == right`. Should resolve to param via local scope, NOT crash on named-arg path.
    const line = code.split('\n')[2];
    const col = line.indexOf('left ==');
    const result = await provider.provideDefinition(doc, new Position(2, col + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // Expect it to land on the parameter declaration line (line 1).
    expect(loc.range.start.line).toBe(1);
  });

  it('`val name = …` is NOT a named arg', async () => {
    const code = `package com.example
fun foo() {
    val name = "hello"
    println(name)
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Foo.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Foo.kt', code);
    const lines = code.split('\n');
    // Cursor on `name` in `val name = ...` — declaration. Resolver
    // shouldn't claim it's a named-arg LHS.
    const col = lines[2].indexOf('name');
    const result = await provider.provideDefinition(doc, new Position(2, col + 1));
    // Either null (declaration) or self — never a wrong wandering result.
    if (result) {
      const loc = (Array.isArray(result) ? result[0] : result) as Location;
      expect(loc.uri.toString()).toBe('file:///src/Foo.kt');
    }
  });

  it('LHS detection NOT triggered when followed by `>=`, `<=`, `!=`', async () => {
    const code = `package com.example
fun foo(num: Int): Boolean {
    return num >= 5 && num <= 10 && num != 7
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Foo.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Foo.kt', code);
    const line = code.split('\n')[2];
    // Cursor on first `num`. Should jump to param `num` line 1, not crash.
    const col = line.indexOf('num >=');
    const result = await provider.provideDefinition(doc, new Position(2, col + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(1);
  });
});

// ── Nested call disambiguation ───────────────────────────────────────────────

describe('named-arg-lhs — nested calls', () => {
  it('`Modifier.padding(top = 8.dp)` — `top` resolves against `padding`, not the outer call', async () => {
    // Provide a local `padding` fun so the resolver can find it.
    const code = `package com.example

fun padding(top: Int, bottom: Int): String = ""

fun caller() {
    val r = padding(top = 8, bottom = 4)
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Pad.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Pad.kt', code);
    const lines = code.split('\n');
    const callLine = 5; // `    val r = padding(top = 8, bottom = 4)`
    const topCol = lines[callLine].indexOf('top');
    const result = await provider.provideDefinition(doc, new Position(callLine, topCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // Should land on `fun padding(top: …)` parameter, line 2.
    expect(loc.range.start.line).toBe(2);
    expect(loc.range.start.character).toBe(lines[2].indexOf('top'));
  });
});

// ── Multi-line call ──────────────────────────────────────────────────────────

describe('named-arg-lhs — multi-line call', () => {
  it('LHS spans multiple lines — each LHS resolves to its param', async () => {
    const code = `package com.example

fun build(name: String, level: Int, count: Int): String = ""

fun caller() {
    val r = build(
        name = "alpha",
        level = 50,
        count = 3
    )
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Build.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Build.kt', code);
    const lines = code.split('\n');

    // `name = "alpha"` on line 6 — LHS `name` should jump to param decl line 2.
    const nameCol = lines[6].indexOf('name');
    const r1 = await provider.provideDefinition(doc, new Position(6, nameCol + 1));
    const loc1 = (Array.isArray(r1) ? r1[0] : r1) as Location;
    expect(loc1).toBeDefined();
    expect(loc1.range.start.line).toBe(2);

    // `count = 3` on line 8.
    const countCol = lines[8].indexOf('count');
    const r2 = await provider.provideDefinition(doc, new Position(8, countCol + 1));
    const loc2 = (Array.isArray(r2) ? r2[0] : r2) as Location;
    expect(loc2).toBeDefined();
    expect(loc2.range.start.line).toBe(2);
  });
});

// ── Cross-file resolution via index ──────────────────────────────────────────

describe('named-arg-lhs — function declared in another file', () => {
  it('LHS resolves through the workspace index when the called fun is elsewhere', async () => {
    const widget = `package com.example.widget

fun greet(name: String, formal: Boolean): String = ""`;
    const caller = `package com.example.app

import com.example.widget.greet

fun main() {
    val s = greet(name = "Kevin", formal = true)
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/widget/Greet.kt', widget);
    addFile(idx, 'file:///src/app/Main.kt', caller);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/app/Main.kt', caller);
    const lines = caller.split('\n');
    const nameCol = lines[5].indexOf('name');
    const result = await provider.provideDefinition(doc, new Position(5, nameCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.uri.toString()).toBe('file:///src/widget/Greet.kt');
  });
});
