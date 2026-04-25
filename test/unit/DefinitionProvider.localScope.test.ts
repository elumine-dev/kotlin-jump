/**
 * Local scope resolution — Cmd+Click on a parameter / local val / var
 * usage must jump to its declaration in the SAME function, not search
 * the workspace. Reproducer (Kevin's @Composable PokemonCard):
 *
 *   @Composable
 *   fun PokemonCard(name: String, level: Int) {
 *       var clicks by remember { mutableStateOf(0) }
 *       Text(text = name)              // ← Cmd+Click on `name` lands here
 *       Text(text = "Level $level")    // ← Cmd+Click on `level` lands here
 *       Button(onClick = { clicks++ })  // ← Cmd+Click on `clicks` lands here
 *   }
 *
 * Without this resolver, `name`/`level` fall through to the workspace
 * index → tens of unrelated matches. `clicks` works because VS Code's
 * fallback textual match finds a single in-file occurrence — but
 * relying on textual fallback is fragile (any other file declaring
 * `clicks` instantly poisons the result).
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

const POKEMON_CARD = `package com.example.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf

@Composable
fun PokemonCard(name: String, level: Int) {
    var clicks by remember { mutableStateOf(0) }
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = name)
        Text(text = "Level $level")
        Row(modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = { clicks++ }) {
                Text(text = "Tapped $clicks times")
            }
        }
    }
}`;

// A second file that declares unrelated top-level `name` / `level` /
// `clicks` so the workspace index would happily return them if the
// local-scope resolver doesn't intercept first. This is the exact
// failure mode Kevin reported.
const POISON_KT = `package com.example.poison

const val name   = "global"
const val level  = 99
const val clicks = 0`;

function setup() {
  const index = new SymbolIndex();
  addFile(index, 'file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
  addFile(index, 'file:///src/com/example/poison/Poison.kt', POISON_KT);
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

const PARAM_LINE  = 7;  // `fun PokemonCard(name: String, level: Int) {`
const TEXT_NAME   = 10; // `Text(text = name)`
const TEXT_LEVEL  = 11; // `Text(text = "Level $level")`
const BUTTON_CLK  = 13; // `Button(onClick = { clicks++ }) {`
const TAPPED_CLK  = 14; // `Text(text = "Tapped $clicks times")`
const CLICKS_DECL = 8;  // `var clicks by remember { mutableStateOf(0) }`

describe('local-scope-defn — parameters', () => {
  it('Cmd+Click on `name` usage → jumps to the function parameter, not the workspace', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    const col = findCol(POKEMON_CARD.split('\n')[TEXT_NAME], 'name') + 1;
    const result = await provider.provideDefinition(doc, new Position(TEXT_NAME, col)) as Location | Location[];

    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(PARAM_LINE);
    // Paramètre 'name' commence après `fun PokemonCard(`
    const expectedCol = POKEMON_CARD.split('\n')[PARAM_LINE].indexOf('name');
    expect(loc.range.start.character).toBe(expectedCol);
  });

  it('Cmd+Click on `level` usage in interpolation → function parameter', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    // `Text(text = "Level $level")` — cursor on `level` inside the
    // string template.
    const col = findCol(POKEMON_CARD.split('\n')[TEXT_LEVEL], 'level') + 1;
    const result = await provider.provideDefinition(doc, new Position(TEXT_LEVEL, col)) as Location | Location[];
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(PARAM_LINE);
  });

  it('does not fall through to the workspace index when a local match exists', async () => {
    // The poison file declares `const val name = "global"`. If the
    // resolver fell through, the result would include that file too.
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    const col = findCol(POKEMON_CARD.split('\n')[TEXT_NAME], 'name') + 1;
    const result = await provider.provideDefinition(doc, new Position(TEXT_NAME, col));
    const locations = Array.isArray(result) ? result : [result];
    for (const loc of locations) {
      expect((loc as Location).uri.toString()).toBe('file:///src/com/example/ui/PokemonCard.kt');
    }
  });
});

describe('local-scope-defn — local val / var declarations', () => {
  it('Cmd+Click on `clicks` (a local var) inside a lambda body → its declaration', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    const col = findCol(POKEMON_CARD.split('\n')[BUTTON_CLK], 'clicks') + 1;
    const result = await provider.provideDefinition(doc, new Position(BUTTON_CLK, col)) as Location | Location[];
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(CLICKS_DECL);
  });

  it('Cmd+Click on `clicks` deeper in the function (string interpolation) → same declaration', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    const col = findCol(POKEMON_CARD.split('\n')[TAPPED_CLK], 'clicks') + 1;
    const result = await provider.provideDefinition(doc, new Position(TAPPED_CLK, col)) as Location | Location[];
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(CLICKS_DECL);
  });
});

// ── for-loop bindings ────────────────────────────────────────────────────────

const POKEMON_LIST = `package com.example.ui

import androidx.compose.runtime.Composable

@Composable
fun PokemonList(names: List<String>) {
    Column {
        for (name in names) {
            PokemonCard(name = name, level = 50)
        }
    }
}`;

const POISON_FOR_LIST = `package com.example.poison

const val name  = "global"
const val names = listOf<String>()`;

function setupForList() {
  const index = new SymbolIndex();
  addFile(index, 'file:///src/com/example/ui/PokemonList.kt', POKEMON_LIST);
  addFile(index, 'file:///src/com/example/poison/Poison.kt', POISON_FOR_LIST);
  return new KotlinDefinitionProvider(index);
}

describe('local-scope-defn — for-loop and lambda bindings', () => {
  it('Cmd+Click on `name` (RHS of named-arg) inside `for (name in names)` → loop binding', async () => {
    const provider = setupForList();
    const doc = mockDocument('file:///src/com/example/ui/PokemonList.kt', POKEMON_LIST);
    // Line 8: `            PokemonCard(name = name, level = 50)`
    // We want the SECOND `name` — the value side of the named arg.
    const line = POKEMON_LIST.split('\n')[8];
    const secondName = line.indexOf('name', line.indexOf('name') + 1);
    const result = await provider.provideDefinition(doc, new Position(8, secondName + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // Loop binding lives on line 7: `        for (name in names) {`
    expect(loc.range.start.line).toBe(7);
    expect(loc.uri.toString()).toBe('file:///src/com/example/ui/PokemonList.kt');
  });

  it('Cmd+Click on `names` inside the `for (name in names)` → fun parameter', async () => {
    const provider = setupForList();
    const doc = mockDocument('file:///src/com/example/ui/PokemonList.kt', POKEMON_LIST);
    const line = POKEMON_LIST.split('\n')[7];
    const namesCol = line.indexOf('names');
    const result = await provider.provideDefinition(doc, new Position(7, namesCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // PokemonList signature on line 5: `fun PokemonList(names: List<String>) {`
    expect(loc.range.start.line).toBe(5);
  });

  it('does not pick up the global poison `const val name` for a for-loop binding', async () => {
    const provider = setupForList();
    const doc = mockDocument('file:///src/com/example/ui/PokemonList.kt', POKEMON_LIST);
    const line = POKEMON_LIST.split('\n')[8];
    const secondName = line.indexOf('name', line.indexOf('name') + 1);
    const result = await provider.provideDefinition(doc, new Position(8, secondName + 1));
    const locs = Array.isArray(result) ? result : [result];
    for (const loc of locs) {
      expect((loc as Location).uri.toString()).not.toContain('poison');
    }
  });

  it('lambda parameter resolves locally — `xs.forEach { item -> use(item) }`', async () => {
    const code = `package com.example.ui

fun process(xs: List<Int>) {
    xs.forEach { item ->
        println(item)
    }
}`;
    const index = new SymbolIndex();
    addFile(index, 'file:///src/com/example/ui/Process.kt', code);
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///src/com/example/ui/Process.kt', code);
    // Line 4: `        println(item)` — cursor on `item`.
    const line = code.split('\n')[4];
    const itemCol = line.indexOf('item');
    const result = await provider.provideDefinition(doc, new Position(4, itemCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // Binding on line 3: `    xs.forEach { item ->`
    expect(loc.range.start.line).toBe(3);
  });
});

// ── Smart-nav: cursor on a declaration jumps to usages ──────────────────────

describe('local-scope-defn — cursor on declaration → jump to usage(s)', () => {
  it('Cmd+Click on `name` declaration in `for (name in names)` → jumps to the single usage', async () => {
    const code = `package com.example.compose

@Composable
fun PokemonCard(name: String, level: Int) { }

@Composable
fun PokemonList(names: List<String>) {
    for (name in names) {
        PokemonCard(name = name, level = 50)
    }
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Pokemon.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Pokemon.kt', code);
    const lines = code.split('\n');
    // Line 7 is `    for (name in names) {`. Click on the binding `name`.
    const declLine = 7;
    const declCol  = lines[declLine].indexOf('name');
    const result = await provider.provideDefinition(doc, new Position(declLine, declCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // Single usage is on line 8: `        PokemonCard(name = name, level = 50)`
    // The RHS `name` (second occurrence on that line).
    expect(loc.range.start.line).toBe(8);
    const usageCol = lines[8].indexOf('name', lines[8].indexOf('name') + 1);
    expect(loc.range.start.character).toBe(usageCol);
  });

  it('Cmd+Click on a function parameter declaration → jumps to its single usage', async () => {
    const code = `package com.example
fun greet(target: String) {
    println("Hello, $target!")
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Greet.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Greet.kt', code);
    const lines = code.split('\n');
    const declLine = 1;
    const declCol  = lines[declLine].indexOf('target');
    const result = await provider.provideDefinition(doc, new Position(declLine, declCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    expect(loc.range.start.line).toBe(2);
  });

  it('multiple usages → returns array, VS Code shows picker', async () => {
    const code = `package com.example
fun build(value: String): String {
    val a = value
    val b = value
    return a + b
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Build.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Build.kt', code);
    const lines = code.split('\n');
    const declCol = lines[1].indexOf('value');
    const result = await provider.provideDefinition(doc, new Position(1, declCol + 1));
    expect(Array.isArray(result)).toBe(true);
    const arr = result as Location[];
    expect(arr.length).toBe(2);
    expect(arr[0].range.start.line).toBe(2);
    expect(arr[1].range.start.line).toBe(3);
  });

  it('declaration with zero usages → returns the declaration itself (no false jump)', async () => {
    const code = `package com.example
fun unused(orphan: String) {
    println("nothing")
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Orphan.kt', code);
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument('file:///src/Orphan.kt', code);
    const lines = code.split('\n');
    const declCol = lines[1].indexOf('orphan');
    const result = await provider.provideDefinition(doc, new Position(1, declCol + 1));
    const loc = (Array.isArray(result) ? result[0] : result) as Location;
    expect(loc).toBeDefined();
    // No usage → fall back to the declaration itself.
    expect(loc.range.start.line).toBe(1);
  });
});

describe('local-scope-defn — non-local words still fall through to the index', () => {
  it('a top-level type referenced inside the function still resolves via the index', async () => {
    // `Modifier` and `Text` etc. are NOT local — the resolver must
    // return undefined for those so the regular pipeline picks them
    // up. This guards against an over-eager resolver swallowing every
    // word.
    const provider = setup();
    const doc = mockDocument('file:///src/com/example/ui/PokemonCard.kt', POKEMON_CARD);
    const col = findCol(POKEMON_CARD.split('\n')[9], 'Modifier') + 1;
    const result = await provider.provideDefinition(doc, new Position(9, col));
    // The workspace index has no `Modifier` defined — null is fine.
    // The point: the resolver did NOT pretend it was a local.
    if (result) {
      const locations = Array.isArray(result) ? result : [result];
      // No location should point into PokemonCard.kt (where there is
      // no `Modifier` declaration) by virtue of the local resolver.
      const pokemonCardLocs = locations.filter(l =>
        (l as Location).uri.toString() === 'file:///src/com/example/ui/PokemonCard.kt',
      );
      expect(pokemonCardLocs).toHaveLength(0);
    }
  });
});
