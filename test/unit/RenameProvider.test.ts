import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinRenameProvider } from '../../src/providers/RenameProvider';
import { mockDocument, positionOf } from './helpers';
import { Position, workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const DECL_URI  = 'file:///DataStore.kt';
const DECL_CODE = 'package com.example\nclass DataStore {}';

// ── prepareRename ────────────────────────────────────────────────────────────

describe('RenameProvider — prepareRename', () => {
  let index: SymbolIndex;
  let provider: KotlinRenameProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, DECL_URI, DECL_CODE);
    provider = new KotlinRenameProvider(index);
  });

  it('returns a range for an indexed symbol', () => {
    const doc = mockDocument(DECL_URI, DECL_CODE);
    expect(provider.prepareRename(doc, positionOf(DECL_CODE, 'DataStore'))).not.toBeNull();
  });

  it('range text exactly equals the symbol name', () => {
    const doc = mockDocument(DECL_URI, DECL_CODE);
    const result = provider.prepareRename(doc, positionOf(DECL_CODE, 'DataStore'))!;
    expect(doc.getText(result.range)).toBe('DataStore');
  });

  it('returns an object with placeholder equal to the symbol name', () => {
    const doc = mockDocument(DECL_URI, DECL_CODE);
    const result = provider.prepareRename(doc, positionOf(DECL_CODE, 'DataStore'))!;
    expect(result.placeholder).toBe('DataStore');
  });

  it('returns null for a word that is not in the index', () => {
    const code = 'package com.example\nval mystery = 42';
    const doc  = mockDocument('file:///Other.kt', code);
    expect(provider.prepareRename(doc, positionOf(code, 'mystery'))).toBeNull();
  });

  it('returns null for a single-character word', () => {
    const code = 'val x = 1';
    const doc  = mockDocument('file:///Foo.kt', code);
    expect(provider.prepareRename(doc, positionOf(code, 'x'))).toBeNull();
  });

  it('returns null when cursor is on whitespace between tokens', () => {
    // Position 5 in 'class DataStore' is the space after 'class'
    const code = 'class DataStore';
    const doc  = mockDocument('file:///Foo.kt', code);
    expect(provider.prepareRename(doc, new Position(0, 5))).toBeNull();
  });

  it('cursor at start of symbol → valid range', () => {
    const doc = mockDocument(DECL_URI, DECL_CODE);
    const pos = positionOf(DECL_CODE, 'DataStore'); // points at 'D'
    expect(provider.prepareRename(doc, pos)).not.toBeNull();
  });

  it('cursor in the middle of symbol → valid range', () => {
    const doc   = mockDocument(DECL_URI, DECL_CODE);
    const start = positionOf(DECL_CODE, 'DataStore');
    const mid   = new Position(start.line, start.character + 4); // inside 'DataStore'
    expect(provider.prepareRename(doc, mid)).not.toBeNull();
  });
});

// ── provideRenameEdits ───────────────────────────────────────────────────────

describe('RenameProvider — provideRenameEdits', () => {
  let index: SymbolIndex;
  let provider: KotlinRenameProvider;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, DECL_URI, DECL_CODE);
    provider = new KotlinRenameProvider(index);
  });
  afterEach(() => { workspace.fs.readFile = origReadFile; });

  it('returns null for a word not in the index', async () => {
    const code = 'val mystery = 99';
    const doc  = mockDocument('file:///App.kt', code);
    const result = await provider.provideRenameEdits(
      doc as any, positionOf(code, 'mystery'), 'NewName', noCancel(),
    );
    expect(result).toBeNull();
  });

  it('returns null when the token is already cancelled', async () => {
    workspace.fs.readFile = async () => Buffer.from(DECL_CODE) as any;
    const doc = mockDocument(DECL_URI, DECL_CODE);
    const result = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore',
      { isCancellationRequested: true } as any,
    );
    expect(result).toBeNull();
  });

  it('renames the declaration site itself', async () => {
    workspace.fs.readFile = async () => Buffer.from(DECL_CODE) as any;
    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    );
    expect(edit).not.toBeNull();
    const entries = (edit as any).entries() as any[];
    expect(entries.some(e => e.uri.toString() === DECL_URI)).toBe(true);
    expect(entries.every(e => e.newText === 'LocalStore')).toBe(true);
  });

  it('renames usages in other files', async () => {
    const USAGE_CODE = 'package com.example\nval store = DataStore()';
    addKt(index, 'file:///App.kt', USAGE_CODE);

    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(uri.toString().includes('DataStore.kt') ? DECL_CODE : USAGE_CODE) as any;

    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    );
    const uris = (edit as any).entries().map((e: any) => e.uri.toString());
    expect(uris).toContain(DECL_URI);
    expect(uris).toContain('file:///App.kt');
  });

  it('rename can be initiated from a usage site, not just the declaration', async () => {
    const USAGE_CODE = 'package com.example\nval store = DataStore()';
    addKt(index, 'file:///App.kt', USAGE_CODE);

    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(uri.toString().includes('DataStore.kt') ? DECL_CODE : USAGE_CODE) as any;

    // Cursor is on the USAGE, not the declaration
    const doc  = mockDocument('file:///App.kt', USAGE_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(USAGE_CODE, 'DataStore'), 'LocalStore', noCancel(),
    );
    expect(edit).not.toBeNull();
    const uris = (edit as any).entries().map((e: any) => e.uri.toString());
    expect(uris).toContain(DECL_URI);
    expect(uris).toContain('file:///App.kt');
  });

  it('DOES NOT rename occurrences inside trailing comments', async () => {
    // scanForUsages skips text after //
    const codeWithComment = 'package com.example\nval x = DataStore() // DataStore is old';
    addKt(index, 'file:///App.kt', codeWithComment);
    workspace.fs.readFile = async () => Buffer.from(codeWithComment) as any;

    const doc  = mockDocument('file:///App.kt', codeWithComment);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(codeWithComment, 'DataStore'), 'LocalStore', noCancel(),
    );

    const appEdits = ((edit as any)?.entries() ?? [])
      .filter((e: any) => e.uri.toString() === 'file:///App.kt');
    // Only the code occurrence before '//' is renamed — the comment occurrence is skipped
    expect(appEdits).toHaveLength(1);
    expect(appEdits[0].range.start.character)
      .toBeLessThan(codeWithComment.split('\n')[1].indexOf('//'));
  });

  it('DOES NOT rename occurrences inside string literals', async () => {
    const codeWithString = 'package com.example\nval name = "DataStore"';
    addKt(index, 'file:///App.kt', codeWithString);
    workspace.fs.readFile = async () => Buffer.from(codeWithString) as any;

    const doc  = mockDocument('file:///App.kt', codeWithString);
    // 'DataStore' is only inside a string — scanForUsages returns 0 results for this file
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(codeWithString, 'DataStore'), 'LocalStore', noCancel(),
    );
    const appEdits = ((edit as any)?.entries() ?? [])
      .filter((e: any) => e.uri.toString() === 'file:///App.kt');
    expect(appEdits).toHaveLength(0);
  });

  it('word boundary: DataStore does NOT rename DataStoreImpl', async () => {
    // \bDataStore\b should not match 'DataStore' in 'DataStoreImpl'
    const USAGE_CODE = 'package com.example\nclass DataStoreImpl : DataStore()';
    addKt(index, 'file:///App.kt', USAGE_CODE);

    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(uri.toString().includes('DataStore.kt') ? DECL_CODE : USAGE_CODE) as any;

    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    );

    const appEdits = ((edit as any)?.entries() ?? [])
      .filter((e: any) => e.uri.toString() === 'file:///App.kt');
    // Only the standalone DataStore() call is renamed, not the DataStoreImpl name
    expect(appEdits).toHaveLength(1);
    const line1 = USAGE_CODE.split('\n')[1];
    const implStart = line1.indexOf('DataStoreImpl');
    expect(appEdits[0].range.start.character).toBeGreaterThan(implStart + 'DataStoreImpl'.length);
  });

  it('import lines ARE renamed alongside code occurrences', async () => {
    const codeWithImport = [
      'package com.other',
      'import com.example.DataStore',
      'val s = DataStore()',
    ].join('\n');
    addKt(index, 'file:///Other.kt', codeWithImport);
    workspace.fs.readFile = async () => Buffer.from(codeWithImport) as any;

    const doc  = mockDocument('file:///Other.kt', codeWithImport);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(codeWithImport, 'DataStore', 2), 'LocalStore', noCancel(),
    );

    const otherEdits = ((edit as any)?.entries() ?? [])
      .filter((e: any) => e.uri.toString() === 'file:///Other.kt');
    const renamedLines = otherEdits.map((e: any) => e.range.start.line);
    // Both the import (line 1) and the usage (line 2) must be renamed
    expect(renamedLines).toContain(1);
    expect(renamedLines).toContain(2);
  });

  it('aliased import: only the class name token is renamed, not the alias', async () => {
    const codeWithAlias = [
      'package com.other',
      'import com.example.DataStore as DS',
      'val s = DS()',
    ].join('\n');
    addKt(index, 'file:///Alias.kt', codeWithAlias);
    workspace.fs.readFile = async () => Buffer.from(codeWithAlias) as any;

    const doc  = mockDocument('file:///Alias.kt', codeWithAlias);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(codeWithAlias, 'DataStore'), 'LocalStore', noCancel(),
    );

    const aliasEdits = ((edit as any)?.entries() ?? [])
      .filter((e: any) => e.uri.toString() === 'file:///Alias.kt');
    // Only the 'DataStore' token in the import is renamed — 'DS' is untouched
    expect(aliasEdits).toHaveLength(1);
    expect(aliasEdits[0].newText).toBe('LocalStore');
    // The renamed edit is on line 1 (import), not line 2 (usage of alias 'DS')
    expect(aliasEdits[0].range.start.line).toBe(1);
  });

  it('offers a file rename when class name matches filename', async () => {
    workspace.fs.readFile = async () => Buffer.from(DECL_CODE) as any;
    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    ) as any;

    expect(edit).not.toBeNull();
    expect(edit._fileRenames).toHaveLength(1);
    expect(edit._fileRenames[0].oldUri.toString()).toBe(DECL_URI);
    expect(edit._fileRenames[0].newUri.toString()).toBe('file:///LocalStore.kt');
    expect(edit._fileRenames[0].metadata?.needsConfirmation).toBe(true);
  });

  it('does NOT offer a file rename when class is nested inside another file', async () => {
    // Use a fresh index with only Models.kt — DataStore lives in a file with a different name
    const MODELS_URI  = 'file:///Models.kt';
    const MODELS_CODE = 'package com.example\nclass DataStore {}';
    const freshIndex = new SymbolIndex();
    addKt(freshIndex, MODELS_URI, MODELS_CODE);
    const freshProvider = new KotlinRenameProvider(freshIndex);
    workspace.fs.readFile = async () => Buffer.from(MODELS_CODE) as any;

    const doc  = mockDocument(MODELS_URI, MODELS_CODE);
    const edit = await freshProvider.provideRenameEdits(
      doc as any, positionOf(MODELS_CODE, 'DataStore'), 'LocalStore', noCancel(),
    ) as any;

    expect(edit).not.toBeNull();
    expect(edit._fileRenames).toHaveLength(0);
  });

  it('does NOT offer a file rename for top-level function', async () => {
    const FUN_URI  = 'file:///fetchUser.kt';
    const FUN_CODE = 'package com.example\nfun fetchUser() {}';
    addKt(index, FUN_URI, FUN_CODE);
    workspace.fs.readFile = async () => Buffer.from(FUN_CODE) as any;

    const doc  = mockDocument(FUN_URI, FUN_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(FUN_CODE, 'fetchUser'), 'getUser', noCancel(),
    ) as any;

    expect(edit).not.toBeNull();
    expect(edit._fileRenames).toHaveLength(0);
  });

  it('does NOT offer a file rename when target URI already exists in the index (clash guard)', async () => {
    // 'LocalStore.kt' already exists — file rename would be a clash
    addKt(index, 'file:///LocalStore.kt', 'package com.example\nclass LocalStore {}');
    workspace.fs.readFile = async () => Buffer.from(DECL_CODE) as any;

    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    ) as any;

    expect(edit).not.toBeNull();
    expect(edit._fileRenames).toHaveLength(0);
  });

  it('import in a file with its own symbols is renamed', async () => {
    // A file that both declares its own class AND imports DataStore
    const CONSUMER_URI  = 'file:///Consumer.kt';
    const CONSUMER_CODE = [
      'package com.other',
      'import com.example.DataStore',
      'class Consumer(val ds: DataStore)',
    ].join('\n');
    addKt(index, CONSUMER_URI, CONSUMER_CODE);

    workspace.fs.readFile = async (uri: any) =>
      Buffer.from(uri.toString() === CONSUMER_URI ? CONSUMER_CODE : DECL_CODE) as any;

    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    ) as any;

    expect(edit).not.toBeNull();
    const consumerEdits = edit.entries().filter((e: any) => e.uri.toString() === CONSUMER_URI);
    const renamedLines = consumerEdits.map((e: any) => e.range.start.line);
    // Both the import (line 1) and the usage (line 2) must be renamed
    expect(renamedLines).toContain(1);
    expect(renamedLines).toContain(2);
  });

  it('overloaded functions: all declarations are renamed', async () => {
    const OVERLOAD_CODE = [
      'package com.example',
      'fun compute(x: Int): Int = x',
      'fun compute(x: String): String = x',
    ].join('\n');
    addKt(index, 'file:///Compute.kt', OVERLOAD_CODE);
    workspace.fs.readFile = async () => Buffer.from(OVERLOAD_CODE) as any;

    const doc  = mockDocument('file:///Compute.kt', OVERLOAD_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(OVERLOAD_CODE, 'compute'), 'calculate', noCancel(),
    );

    const entries: any[] = (edit as any)?.entries() ?? [];
    expect(entries.every(e => e.newText === 'calculate')).toBe(true);
    // Both declaration lines have a 'compute' occurrence that should be renamed
    const renamedLines = entries.map((e: any) => e.range.start.line);
    expect(renamedLines).toContain(1); // first overload
    expect(renamedLines).toContain(2); // second overload
  });

  it('single-char word → null even if somehow indexed', async () => {
    const code = 'val x = 1';
    const doc  = mockDocument('file:///App.kt', code);
    const result = await provider.provideRenameEdits(
      doc as any, positionOf(code, 'x'), 'y', noCancel(),
    );
    expect(result).toBeNull();
  });

  it('each edit range covers exactly the old symbol name (not extra chars)', async () => {
    workspace.fs.readFile = async () => Buffer.from(DECL_CODE) as any;
    const doc  = mockDocument(DECL_URI, DECL_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(DECL_CODE, 'DataStore'), 'LocalStore', noCancel(),
    );

    const entries: any[] = (edit as any)?.entries() ?? [];
    for (const e of entries) {
      const len = e.range.end.character - e.range.start.character;
      // Range must cover exactly 'DataStore' (9 chars), not more or less
      expect(len).toBe('DataStore'.length);
    }
  });

  it('@Composable function: rename works (kind=composable, not fun)', async () => {
    const COMPOSE_CODE = 'package com.example\n@Composable\nfun HomeScreen() {}';
    addKt(index, 'file:///HomeScreen.kt', COMPOSE_CODE);
    workspace.fs.readFile = async () => Buffer.from(COMPOSE_CODE) as any;

    const doc  = mockDocument('file:///HomeScreen.kt', COMPOSE_CODE);
    const edit = await provider.provideRenameEdits(
      doc as any, positionOf(COMPOSE_CODE, 'HomeScreen'), 'MainScreen', noCancel(),
    );
    expect(edit).not.toBeNull();
    expect((edit as any).entries().every((e: any) => e.newText === 'MainScreen')).toBe(true);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function noCancel() {
  return { isCancellationRequested: false } as any;
}
