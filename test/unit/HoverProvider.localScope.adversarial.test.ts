/**
 * ADV — HoverProvider local scope.
 *
 * Audit reproducer: hovering a function parameter named `name` would
 * show the workspace's top-level `Foo.name` as if it were the same
 * symbol. The fix suppresses hover for local symbols rather than
 * mislead — Cmd+Click still navigates correctly.
 */

import { describe, it, expect } from 'vitest';
import { KotlinHoverProvider } from '../../src/providers/HoverProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';

function addFile(idx: SymbolIndex, uri: string, code: string) { idx.add(parse(uri, code)); }

const POISON = `package com.example.poison

class Foo(val name: String)
const val name = "global"`;

const COMPOSE = `package com.example.compose

@Composable
fun PokemonCard(name: String, level: Int) {
    Text(text = name)
    println("Level $level")
}`;

function setup() {
  const idx = new SymbolIndex();
  addFile(idx, 'file:///src/Poison.kt', POISON);
  addFile(idx, 'file:///src/Compose.kt', COMPOSE);
  return new KotlinHoverProvider(idx);
}

describe('ADV-HOVER — local-scope suppression', () => {
  it('hover on parameter `name` returns null (avoid wrong workspace info)', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/Compose.kt', COMPOSE);
    // Hover on `name` USAGE inside Text(text = name).
    const line = COMPOSE.split('\n')[4];
    const col = line.lastIndexOf('name');
    const r = await provider.provideHover(
      doc,
      new Position(4, col + 1),
      { isCancellationRequested: false } as any,
    );
    expect(r).toBeNull();
  });

  it('hover on `Level` inside string literal returns null', async () => {
    const code = `package com.example
const val Level = 99
fun render(level: Int) {
    println("Level $level")
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Str.kt', code);
    const provider = new KotlinHoverProvider(idx);
    const doc = mockDocument('file:///src/Str.kt', code);
    const line = code.split('\n')[3];
    const col = line.indexOf('Level');
    const r = await provider.provideHover(
      doc,
      new Position(3, col + 1),
      { isCancellationRequested: false } as any,
    );
    expect(r).toBeNull();
  });

  it('hover on `$level` short-form interpolation does NOT bypass local guard either — still null because `level` is local', async () => {
    const code = `package com.example
fun render(level: Int) {
    println("$level")
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Str.kt', code);
    const provider = new KotlinHoverProvider(idx);
    const doc = mockDocument('file:///src/Str.kt', code);
    const line = code.split('\n')[2];
    const col = line.indexOf('level');
    const r = await provider.provideHover(
      doc,
      new Position(2, col + 1),
      { isCancellationRequested: false } as any,
    );
    expect(r).toBeNull(); // local param, suppress
  });

  it('hover on a top-level workspace symbol still works (not all hovers suppressed!)', async () => {
    const code = `package com.example
class MyClass
fun outer() {
    val instance = MyClass()
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Top.kt', code);
    const provider = new KotlinHoverProvider(idx);
    const doc = mockDocument('file:///src/Top.kt', code);
    const line = code.split('\n')[3];
    // Hover on `MyClass` reference (a top-level type, NOT local).
    const col = line.indexOf('MyClass');
    const r = await provider.provideHover(
      doc,
      new Position(3, col + 1),
      { isCancellationRequested: false } as any,
    );
    // Should NOT be null — MyClass is a workspace symbol, not local.
    expect(r).not.toBeNull();
  });
});
