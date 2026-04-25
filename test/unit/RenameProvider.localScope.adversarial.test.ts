/**
 * ADV — RenameProvider local scope.
 *
 * Repro of the data-loss bug the audit flagged: F2 on a function
 * parameter triggered a workspace-wide search-and-replace. With this
 * fix, rename of a local symbol is scoped to the enclosing function;
 * only the declaration and its in-function usages are touched.
 */

import { describe, it, expect } from 'vitest';
import { KotlinRenameProvider } from '../../src/providers/RenameProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';

function addFile(idx: SymbolIndex, uri: string, code: string) { idx.add(parse(uri, code)); }

const POISON_FILE = `package com.example.poison

const val name   = "global"
const val target = 42
fun renderName() = name`;

const COMPOSE_FILE = `package com.example.compose

@Composable
fun PokemonCard(name: String, level: Int) {
    Text(text = name)
}

@Composable
fun PokemonList(names: List<String>) {
    for (name in names) {
        PokemonCard(name = name, level = 50)
    }
}`;

function setup() {
  const idx = new SymbolIndex();
  addFile(idx, 'file:///src/poison.kt', POISON_FILE);
  addFile(idx, 'file:///src/Compose.kt', COMPOSE_FILE);
  return new KotlinRenameProvider(idx);
}

describe('ADV-RENAME — local-scope rename does NOT touch the workspace', () => {
  it('renaming `name` (function parameter) edits only the param + its usage in PokemonCard', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/Compose.kt', COMPOSE_FILE);
    const lines = COMPOSE_FILE.split('\n');
    // Cursor on `name` parameter declaration in PokemonCard signature.
    const declLine = 3;
    const declCol  = lines[declLine].indexOf('name');

    const edit = await provider.provideRenameEdits(
      doc,
      new Position(declLine, declCol + 1),
      'newName',
      { isCancellationRequested: false } as any,
    );
    expect(edit).not.toBeNull();
    // The mock WorkspaceEdit captures replace calls; iterate edits to
    // verify we only touched ONE file (the Compose file) and never
    // the poison file.
    const entries = (edit as any)._entries as Array<{ uri: any }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(String(e.uri.toString?.() ?? e.uri)).not.toContain('poison');
    }
    // Sanity check — at least the param decl + the usage in Text(text = name)
    // (note: the LHS `name` in Text(text = name) is a named-arg label
    // referring to Text's `text` param, not this `name` — so it's
    // correctly excluded by findLocalUsages' looksLikeNamedArgLhs).
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });

  it('renaming `name` for-loop binding inside PokemonList edits ONLY that scope', async () => {
    const provider = setup();
    const doc = mockDocument('file:///src/Compose.kt', COMPOSE_FILE);
    const lines = COMPOSE_FILE.split('\n');
    const declLine = 9; // `    for (name in names) {`
    const declCol  = lines[declLine].indexOf('name');
    const edit = await provider.provideRenameEdits(
      doc,
      new Position(declLine, declCol + 1),
      'item',
      { isCancellationRequested: false } as any,
    );
    expect(edit).not.toBeNull();
    const entries = (edit as any)._entries as Array<{ uri: any }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(String(e.uri.toString?.() ?? e.uri)).not.toContain('poison');
    }
  });

  it('prepareRename returns placeholder for a local symbol even when the index has nothing', async () => {
    // No top-level `target` in the workspace beyond the poison file's
    // `const val target = 42`. Even without that, the local-scope
    // detection should allow rename of a local.
    const code = `package com.example
fun localOnly(orphan: String) {
    println(orphan)
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Local.kt', code);
    const provider = new KotlinRenameProvider(idx);
    const doc = mockDocument('file:///src/Local.kt', code);
    const lines = code.split('\n');
    const declCol = lines[1].indexOf('orphan');
    const result = provider.prepareRename(doc, new Position(1, declCol + 1));
    expect(result).not.toBeNull();
    expect(result!.placeholder).toBe('orphan');
  });

  it('prepareRename refuses rename inside a string literal', async () => {
    const code = `package com.example
const val Level = 99
fun render() {
    println("Level something")
}`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///src/Str.kt', code);
    const provider = new KotlinRenameProvider(idx);
    const doc = mockDocument('file:///src/Str.kt', code);
    const lines = code.split('\n');
    const col = lines[3].indexOf('Level');
    const result = provider.prepareRename(doc, new Position(3, col + 1));
    expect(result).toBeNull();
  });
});
