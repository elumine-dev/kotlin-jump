/**
 * ADV — local-scope guards across all 6 providers flagged by the audit.
 * Each test verifies the provider does NOT return wrong workspace info
 * when the cursor is on a local symbol that shares a name with a
 * top-level workspace symbol (the "poison" file).
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { KotlinImplementationProvider } from '../../src/providers/ImplementationProvider';
import { KotlinReferenceProvider } from '../../src/providers/ReferenceProvider';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Location, Position } from './__mocks__/vscode';

function addFile(idx: SymbolIndex, uri: string, code: string) { idx.add(parse(uri, code)); }

const POISON = `package com.example.poison

interface Repository { fun fetch() }
class FooRepository : Repository { override fun fetch() {} }
fun send(message: String, retries: Int) {}
const val name = "global"
const val target = 42`;

const LOCALS = `package com.example.app

fun outer(target: String, name: String) {
    val send: (Int, Int) -> Unit = { a, b -> println(a + b) }
    val fetch: () -> Unit = {}
    send(1, 2)
    fetch()
    println(target + name)
}`;

function setup() {
  const idx = new SymbolIndex();
  addFile(idx, 'file:///poison.kt', POISON);
  addFile(idx, 'file:///app.kt', LOCALS);
  return idx;
}

const lines = LOCALS.split('\n');

describe('ADV — ImplementationProvider local guard', () => {
  it('Cmd+Click on local fun parameter `target` → null (not the poison interface)', () => {
    const provider = new KotlinImplementationProvider(setup());
    const doc = mockDocument('file:///app.kt', LOCALS);
    const col = lines[2].indexOf('target');
    const r = provider.provideImplementation(doc, new Position(2, col + 1)) as any;
    expect(r).toBeNull();
  });

  it('Cmd+Click on local `fetch` (closure var) → null (not Repository.fetch)', () => {
    const provider = new KotlinImplementationProvider(setup());
    const doc = mockDocument('file:///app.kt', LOCALS);
    // line 4: `    val fetch: () -> Unit = {}`
    const col = lines[4].indexOf('fetch');
    const r = provider.provideImplementation(doc, new Position(4, col + 1)) as any;
    expect(r).toBeNull();
  });

  it('Cmd+Click in plain string returns null (no implementations of literal text)', () => {
    const code = `package com.example
class Repository
fun render() { println("Repository here") }`;
    const idx = new SymbolIndex();
    addFile(idx, 'file:///x.kt', code);
    const provider = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///x.kt', code);
    const col = code.split('\n')[2].indexOf('Repository');
    const r = provider.provideImplementation(doc, new Position(2, col + 1)) as any;
    expect(r).toBeNull();
  });
});

describe('ADV — ReferenceProvider local guard', () => {
  it('Find References on local `target` → only in-function usages, not the poison `const val target`', async () => {
    const provider = new KotlinReferenceProvider(setup());
    const doc = mockDocument('file:///app.kt', LOCALS);
    const col = lines[2].indexOf('target');
    const result = await provider.provideReferences(
      doc, new Position(2, col + 1),
      { includeDeclaration: true } as any,
      { isCancellationRequested: false } as any,
    ) as Location[] | null;
    expect(result).not.toBeNull();
    for (const loc of result!) {
      expect(loc.uri.toString()).not.toContain('poison');
    }
  });
});

describe('ADV — CallHierarchyProvider local guard', () => {
  it('prepareCallHierarchy on local `send` → null (not the poison fn)', () => {
    const provider = new KotlinCallHierarchyProvider(setup());
    const doc = mockDocument('file:///app.kt', LOCALS);
    const col = lines[3].indexOf('send');
    const r = provider.prepareCallHierarchy(doc, new Position(3, col + 1));
    expect(r).toBeNull();
  });
});

describe('ADV — SignatureHelpProvider local guard', () => {
  it('signature help inside local `send(...)` lambda call → null', async () => {
    const provider = new KotlinSignatureHelpProvider(setup());
    const doc = mockDocument('file:///app.kt', LOCALS);
    // Cursor inside `send(1, 2)` parens.
    const callLine = lines.findIndex(l => l.includes('send(1, 2)'));
    const sendCol  = lines[callLine].indexOf('send(1');
    const r = await provider.provideSignatureHelp(
      doc, new Position(callLine, sendCol + 6), // inside the parens
      { isCancellationRequested: false } as any,
      { triggerCharacter: undefined } as any,
    );
    // Local lambda — should NOT show the poison fn's signature.
    expect(r).toBeNull();
  });
});
