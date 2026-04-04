/**
 * Tests for the async provider methods of KotlinCallHierarchyProvider:
 *   - prepareCallHierarchy (sync, but tested here for completeness alongside async)
 *   - provideCallHierarchyIncomingCalls
 *   - provideCallHierarchyOutgoingCalls
 *
 * The existing CallHierarchy.test.ts and CallHierarchyEdgeCases.test.ts test the
 * extracted helper logic in isolation. This file tests the actual provider class,
 * including the async I/O paths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';
import { mockDocument, positionOf } from './helpers';
import { workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}
function noCancel() {
  return { isCancellationRequested: false } as any;
}

// ── Shared fixture ───────────────────────────────────────────────────────────

const CALLER_URI = 'file:///Caller.kt';
const CALLEE_URI = 'file:///Callee.kt';

const CALLEE_CODE = `package com.example

fun greet() {
    println("hello")
}`;

const CALLER_CODE = `package com.example

fun main() {
    greet()
    greet()
}

fun setup() {
    greet()
}`;

// ── prepareCallHierarchy ─────────────────────────────────────────────────────

describe('CallHierarchyProvider — prepareCallHierarchy', () => {
  let index: SymbolIndex;
  let provider: KotlinCallHierarchyProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, CALLEE_URI, CALLEE_CODE);
    addKt(index, CALLER_URI, CALLER_CODE);
    provider = new KotlinCallHierarchyProvider(index);
  });

  it('on function declaration → returns item for that function', () => {
    const doc   = mockDocument(CALLEE_URI, CALLEE_CODE);
    const items = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'));
    expect(items).toHaveLength(1);
    expect(items![0].name).toBe('greet');
  });

  it('on a call site → resolves to the function definition', () => {
    const doc   = mockDocument(CALLER_URI, CALLER_CODE);
    const items = provider.prepareCallHierarchy(doc, positionOf(CALLER_CODE, 'greet'));
    expect(items).not.toBeNull();
    expect(items!.some(i => i.name === 'greet')).toBe(true);
  });

  it('on a val/var → returns null (not a function)', () => {
    const code = 'package com.example\nval count = 0\nfun foo() {}';
    const doc  = mockDocument('file:///X.kt', code);
    addKt(index, 'file:///X.kt', code);
    expect(provider.prepareCallHierarchy(doc, positionOf(code, 'count'))).toBeNull();
  });

  it('on a class name → returns null (not a function)', () => {
    const code = 'package com.example\nclass MyRepo {}';
    const doc  = mockDocument('file:///X.kt', code);
    addKt(index, 'file:///X.kt', code);
    expect(provider.prepareCallHierarchy(doc, positionOf(code, 'MyRepo'))).toBeNull();
  });

  it('single-char word → returns null', () => {
    const code = 'val x = 1';
    const doc  = mockDocument('file:///X.kt', code);
    expect(provider.prepareCallHierarchy(doc, positionOf(code, 'x'))).toBeNull();
  });

  it('@Composable functions ARE included (kind=composable counts as fun)', () => {
    const code = 'package com.example\n@Composable\nfun HomeScreen() {}';
    addKt(index, 'file:///Home.kt', code);
    const doc   = mockDocument('file:///Home.kt', code);
    const items = provider.prepareCallHierarchy(doc, positionOf(code, 'HomeScreen'));
    expect(items).not.toBeNull();
    expect(items![0].name).toBe('HomeScreen');
  });
});

// ── provideCallHierarchyIncomingCalls ────────────────────────────────────────

describe('CallHierarchyProvider — provideCallHierarchyIncomingCalls', () => {
  let index: SymbolIndex;
  let provider: KotlinCallHierarchyProvider;
  let origOpenDoc: typeof workspace.openTextDocument;
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origOpenDoc  = workspace.openTextDocument;
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    addKt(index, CALLEE_URI, CALLEE_CODE);
    addKt(index, CALLER_URI, CALLER_CODE);
    provider = new KotlinCallHierarchyProvider(index);

    // Default mocks
    workspace.openTextDocument = async (uri: any) => {
      const u = uri.toString();
      const code = u === CALLEE_URI ? CALLEE_CODE : CALLER_CODE;
      return mockDocument(u, code) as any;
    };
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      if (u === CALLEE_URI) return Buffer.from(CALLEE_CODE) as any;
      if (u === CALLER_URI) return Buffer.from(CALLER_CODE) as any;
      return Buffer.from('') as any;
    };
  });
  afterEach(() => {
    workspace.openTextDocument = origOpenDoc;
    workspace.fs.readFile      = origReadFile;
  });

  it('function with callers returns one entry per distinct calling function', async () => {
    const doc     = mockDocument(CALLEE_URI, CALLEE_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());
    // greet() is called from main() and setup() → 2 callers
    expect(results).toHaveLength(2);
    const names = results.map(r => r.from.name);
    expect(names).toContain('main');
    expect(names).toContain('setup');
  });

  it('call ranges reflect where in the caller function the call appears', async () => {
    const doc     = mockDocument(CALLEE_URI, CALLEE_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());

    const mainCaller = results.find(r => r.from.name === 'main')!;
    // main() calls greet() TWICE → 2 ranges
    expect(mainCaller.fromRanges).toHaveLength(2);
  });

  it('declaration site is excluded from incoming calls', async () => {
    // greet() declaration is in CALLEE_CODE — that line should not appear as an incoming call
    const doc     = mockDocument(CALLEE_URI, CALLEE_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());

    // No incoming call should be "from" CALLEE_URI on the greet declaration line
    const declLine = CALLEE_CODE.split('\n').findIndex(l => l.includes('fun greet'));
    for (const r of results) {
      for (const range of r.fromRanges) {
        if (r.from.uri.toString() === CALLEE_URI) {
          expect(range.start.line).not.toBe(declLine);
        }
      }
    }
  });

  it('function with no callers → empty array', async () => {
    const SOLO_CODE = 'package com.example\nfun solo() {}';
    addKt(index, 'file:///Solo.kt', SOLO_CODE);
    workspace.fs.readFile = async () => Buffer.from(SOLO_CODE) as any;
    workspace.openTextDocument = async () => mockDocument('file:///Solo.kt', SOLO_CODE) as any;

    const doc     = mockDocument('file:///Solo.kt', SOLO_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(SOLO_CODE, 'solo'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());
    expect(results).toHaveLength(0);
  });

  it('recursive function: recursive call site IS an incoming call (from itself)', async () => {
    const REC_CODE = `package com.example
fun factorial(n: Int): Int {
    if (n <= 1) return 1
    return factorial(n - 1)
}`;
    addKt(index, 'file:///Rec.kt', REC_CODE);
    // Return non-matching content for the pre-existing fixture files so only Rec.kt contributes
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      return Buffer.from(u === 'file:///Rec.kt' ? REC_CODE : 'package com.example') as any;
    };
    workspace.openTextDocument = async () => mockDocument('file:///Rec.kt', REC_CODE) as any;

    const doc     = mockDocument('file:///Rec.kt', REC_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(REC_CODE, 'factorial'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());

    // The recursive call on line 3 is inside factorial itself → 1 incoming call from factorial
    expect(results).toHaveLength(1);
    expect(results[0].from.name).toBe('factorial');
  });

  it('cancellation → returns empty array immediately', async () => {
    const doc    = mockDocument(CALLEE_URI, CALLEE_CODE);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(
      item, { isCancellationRequested: true } as any,
    );
    expect(results).toHaveLength(0);
  });

  it('callers in multiple files are each returned', async () => {
    const EXTRA_URI  = 'file:///Extra.kt';
    const EXTRA_CODE = 'package com.example\nfun other() { greet() }';
    addKt(index, EXTRA_URI, EXTRA_CODE);

    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      if (u === CALLEE_URI) return Buffer.from(CALLEE_CODE) as any;
      if (u === CALLER_URI) return Buffer.from(CALLER_CODE) as any;
      if (u === EXTRA_URI)  return Buffer.from(EXTRA_CODE)  as any;
      return Buffer.from('') as any;
    };
    workspace.openTextDocument = async (uri: any) => {
      const u = uri.toString();
      if (u === CALLEE_URI) return mockDocument(u, CALLEE_CODE) as any;
      return mockDocument(u, CALLER_CODE) as any;
    };

    const doc     = mockDocument(CALLEE_URI, CALLEE_CODE);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(CALLEE_CODE, 'greet'))!;
    const results = await provider.provideCallHierarchyIncomingCalls(item, noCancel());

    const callerNames = results.map(r => r.from.name);
    expect(callerNames).toContain('other'); // from Extra.kt
    expect(callerNames).toContain('main');  // from Caller.kt
    expect(callerNames).toContain('setup'); // from Caller.kt
  });
});

// ── provideCallHierarchyOutgoingCalls ────────────────────────────────────────

describe('CallHierarchyProvider — provideCallHierarchyOutgoingCalls', () => {
  let index: SymbolIndex;
  let provider: KotlinCallHierarchyProvider;
  let origOpenDoc: typeof workspace.openTextDocument;

  beforeEach(() => {
    origOpenDoc = workspace.openTextDocument;
    index = new SymbolIndex();
    addKt(index, CALLEE_URI, CALLEE_CODE);
    addKt(index, CALLER_URI, CALLER_CODE);
    provider = new KotlinCallHierarchyProvider(index);
  });
  afterEach(() => { workspace.openTextDocument = origOpenDoc; });

  it('returns indexed functions called in the body', async () => {
    const code = `package com.example
fun process() {
    validate()
    save()
}
fun validate() {}
fun save() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const names = results.map(r => r.to.name);
    expect(names).toContain('validate');
    expect(names).toContain('save');
  });

  it('call ranges are within the function body (not other functions)', async () => {
    const code = `package com.example
fun process() {
    validate()
}
fun validate() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const validateEntry = results.find(r => r.to.name === 'validate');
    expect(validateEntry).toBeDefined();
    // The call range must be inside process(), not in validate()
    const validateDeclLine = code.split('\n').findIndex(l => l.startsWith('fun validate'));
    for (const range of validateEntry!.fromRanges) {
      expect(range.start.line).toBeLessThan(validateDeclLine);
    }
  });

  it('calls NOT in index are silently skipped (stdlib, etc.)', async () => {
    const code = `package com.example
fun process() {
    println("hello")
    listOf(1, 2, 3)
    validate()
}
fun validate() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    // println, listOf are not in the index → skipped; only validate is returned
    const names = results.map(r => r.to.name);
    expect(names).not.toContain('println');
    expect(names).not.toContain('listOf');
    expect(names).toContain('validate');
  });

  it('calls inside comments are NOT included', async () => {
    const code = `package com.example
fun process() {
    // validate() is called elsewhere
    save()
}
fun validate() {}
fun save() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const names = results.map(r => r.to.name);
    expect(names).not.toContain('validate');
    expect(names).toContain('save');
  });

  it('expression body: fun f() = call() detects the call', async () => {
    const code = `package com.example
fun double(x: Int) = multiply(x, 2)
fun multiply(a: Int, b: Int) = a * b`;
    addKt(index, 'file:///Math.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///Math.kt', code) as any;

    const doc    = mockDocument('file:///Math.kt', code);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(code, 'double'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const names = results.map(r => r.to.name);
    expect(names).toContain('multiply');
  });

  it('expression body with return type: fun f(): T = call() detects the call', async () => {
    const code = `package com.example
fun greetUser(id: String): String = formatName(id)
fun formatName(s: String): String = s`;
    addKt(index, 'file:///Greet.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///Greet.kt', code) as any;

    const doc    = mockDocument('file:///Greet.kt', code);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(code, 'greetUser'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    expect(results.map(r => r.to.name)).toContain('formatName');
  });

  it('expression body with default param: fun f(x: Int = 0) = call() detects the call', async () => {
    const code = `package com.example
fun compute(x: Int = 0) = process(x)
fun process(n: Int) = n`;
    addKt(index, 'file:///Compute.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///Compute.kt', code) as any;

    const doc    = mockDocument('file:///Compute.kt', code);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(code, 'compute'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    expect(results.map(r => r.to.name)).toContain('process');
  });

  it('expression body: call range is on the declaration line', async () => {
    const code = `package com.example
fun double(x: Int) = multiply(x, 2)
fun multiply(a: Int, b: Int) = a * b`;
    addKt(index, 'file:///Math.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///Math.kt', code) as any;

    const doc    = mockDocument('file:///Math.kt', code);
    const [item] = provider.prepareCallHierarchy(doc, positionOf(code, 'double'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const entry = results.find(r => r.to.name === 'multiply')!;
    expect(entry).toBeDefined();
    // The call range must be on the same line as the fun declaration (line 1)
    const declLine = code.split('\n').findIndex(l => l.includes('fun double'));
    for (const range of entry.fromRanges) {
      expect(range.start.line).toBe(declLine);
    }
  });

  it('cancellation → returns empty array', async () => {
    const code = `package com.example
fun process() { validate() }
fun validate() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(
      item, { isCancellationRequested: true } as any,
    );
    expect(results).toHaveLength(0);
  });

  it('same callee called multiple times → single entry with multiple ranges', async () => {
    const code = `package com.example
fun process() {
    validate()
    validate()
    validate()
}
fun validate() {}`;
    addKt(index, 'file:///P.kt', code);
    workspace.openTextDocument = async () => mockDocument('file:///P.kt', code) as any;

    const doc     = mockDocument('file:///P.kt', code);
    const [item]  = provider.prepareCallHierarchy(doc, positionOf(code, 'process'))!;
    const results = await provider.provideCallHierarchyOutgoingCalls(item, noCancel());

    const validateEntry = results.find(r => r.to.name === 'validate')!;
    expect(validateEntry).toBeDefined();
    expect(validateEntry.fromRanges).toHaveLength(3);
  });

  it('item with no .data → returns empty array without throwing', async () => {
    workspace.openTextDocument = async () => mockDocument(CALLER_URI, CALLER_CODE) as any;
    // Manually construct an item with no .data
    const { CallHierarchyItem, Range } = await import('./__mocks__/vscode');
    const bareItem = new CallHierarchyItem(
      11, 'greet', 'detail', { toString: () => CALLEE_URI },
      new Range(2, 0, 2, 5), new Range(2, 0, 2, 5),
    );
    // .data is undefined
    const results = await provider.provideCallHierarchyOutgoingCalls(bareItem as any, noCancel());
    expect(results).toHaveLength(0);
  });
});
