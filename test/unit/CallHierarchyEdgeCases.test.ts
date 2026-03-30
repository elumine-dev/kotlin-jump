import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Regex + helpers (must match CallHierarchyProvider exactly) ───────────────

const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'when', 'return', 'throw', 'try', 'catch',
  'finally', 'class', 'fun', 'val', 'var', 'import', 'package', 'new',
  'this', 'super', 'is', 'as', 'in', 'null', 'true', 'false', 'typeof',
  'instanceof', 'do', 'break', 'continue', 'object', 'interface',
]);

const RE_CALL = /(?:(\w+)\.)?([a-zA-Z_]\w*)\s*(?:\(|<[^>]*>\s*\(|\{)/g;

function isInsideCommentOrString(line: string, pos: number): boolean {
  let inStr: string | false = false;
  for (let i = 0; i < line.length; i++) {
    if (inStr) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === inStr) { inStr = false; continue; }
      if (i === pos) return true;
      continue;
    }
    if (line[i] === '"' || line[i] === '\'') {
      inStr = line[i];
      if (i === pos) return true;
      continue;
    }
    if (line[i] === '/' && i + 1 < line.length && line[i + 1] === '/') {
      return pos >= i;
    }
    if (i === pos) return false;
  }
  return !!inStr;
}

function extractOutgoingCalls(bodyLines: string[]): string[] {
  const calls: Set<string> = new Set();
  for (const line of bodyLines) {
    RE_CALL.lastIndex = 0;
    let m;
    while ((m = RE_CALL.exec(line)) !== null) {
      const name = m[2];
      if (KEYWORDS.has(name)) continue;
      const matchStart = m[1] ? m.index + m[1].length + 1 : m.index;
      if (isInsideCommentOrString(line, matchStart)) continue;
      calls.add(name);
    }
  }
  return [...calls];
}

function findContainingFunction(index: SymbolIndex, uri: string, callLine: number) {
  const symbols = index.getFileSymbols(uri);
  let best: any = undefined;
  for (const s of symbols) {
    if (s.line > callLine) break;
    if (s.kind === 'fun' || s.kind === 'composable') best = s;
  }
  return best;
}

// ── Outgoing: receiver.method() patterns ────────────────────────────────────

describe('Call Hierarchy Edge — receiver.method() calls', () => {
  it('obj.method() extracts method', () => {
    const calls = extractOutgoingCalls(['    repository.save()']);
    expect(calls).toContain('save');
  });

  it('obj.method() does NOT extract receiver as a call', () => {
    const calls = extractOutgoingCalls(['    repository.save()']);
    expect(calls).not.toContain('repository');
  });

  it('chained: a.b().c().d() extracts b, c, d', () => {
    const calls = extractOutgoingCalls(['    list.filter { true }.map { it }.first()']);
    expect(calls).toContain('filter');
    expect(calls).toContain('map');
    expect(calls).toContain('first');
  });

  it('nullable call: obj?.method() extracts method', () => {
    // ?. is tricky — the regex sees `obj` then `?` breaks the word boundary
    // then `.method(` — let's check
    const calls = extractOutgoingCalls(['    user?.getName()']);
    expect(calls).toContain('getName');
  });

  it('static-like: Companion.create() extracts create', () => {
    const calls = extractOutgoingCalls(['    Factory.create()']);
    expect(calls).toContain('create');
  });
});

// ── Outgoing: Kotlin-specific syntax ────────────────────────────────────────

describe('Call Hierarchy Edge — Kotlin syntax', () => {
  it('named arguments: func(name = value) extracts func', () => {
    const calls = extractOutgoingCalls(['    loadUser(id = "123", force = true)']);
    expect(calls).toContain('loadUser');
  });

  it('trailing lambda: run { doStuff() } extracts run and doStuff', () => {
    const calls = extractOutgoingCalls(['    run { doStuff() }']);
    expect(calls).toContain('run');
    expect(calls).toContain('doStuff');
  });

  it('also/let/apply/with scope functions', () => {
    const calls = extractOutgoingCalls([
      '    user.also { log(it) }',
      '    config.let { validate(it) }',
      '    builder.apply { setName("x") }',
      '    with(context) { resolve() }',
    ]);
    expect(calls).toContain('also');
    expect(calls).toContain('log');
    expect(calls).toContain('let');
    expect(calls).toContain('validate');
    expect(calls).toContain('apply');
    expect(calls).toContain('setName');
    expect(calls).toContain('resolve');
  });

  it('when expression: branches with calls', () => {
    const calls = extractOutgoingCalls([
      '    when (type) {',
      '        Type.A -> handleA()',
      '        Type.B -> handleB()',
      '        else -> fallback()',
      '    }',
    ]);
    expect(calls).toContain('handleA');
    expect(calls).toContain('handleB');
    expect(calls).toContain('fallback');
    expect(calls).not.toContain('when');
  });

  it('try/catch: calls in both branches', () => {
    const calls = extractOutgoingCalls([
      '    try {',
      '        riskyOperation()',
      '    } catch (e: Exception) {',
      '        logError(e)',
      '    }',
    ]);
    expect(calls).toContain('riskyOperation');
    expect(calls).toContain('logError');
    expect(calls).not.toContain('try');
    expect(calls).not.toContain('catch');
  });

  it('coroutine: launch/async/withContext', () => {
    const calls = extractOutgoingCalls([
      '    viewModelScope.launch {',
      '        val data = withContext(Dispatchers.IO) {',
      '            fetchFromNetwork()',
      '        }',
      '        updateUI(data)',
      '    }',
    ]);
    expect(calls).toContain('launch');
    expect(calls).toContain('withContext');
    expect(calls).toContain('fetchFromNetwork');
    expect(calls).toContain('updateUI');
  });

  it('constructor call: ClassName() detected', () => {
    const calls = extractOutgoingCalls([
      '    val user = User("john")',
      '    val list = mutableListOf<String>()',
    ]);
    expect(calls).toContain('User');
    expect(calls).toContain('mutableListOf');
  });

  it('expression body: fun x() = compute()', () => {
    const calls = extractOutgoingCalls(['    fun transform() = compute(value)']);
    expect(calls).toContain('compute');
    // 'transform' could match but it's followed by () = not ()
    // Actually the regex would match transform() too since it's followed by ()
    // This is acceptable — it appears as an outgoing call of the containing function
  });
});

// ── Outgoing: things that should NOT be calls ───────────────────────────────

describe('Call Hierarchy Edge — false positives to reject', () => {
  it('property access without parens is NOT a call', () => {
    const calls = extractOutgoingCalls([
      '    val name = user.name',
      '    val size = list.size',
      '    val x = config.value',
    ]);
    expect(calls).not.toContain('name');
    expect(calls).not.toContain('size');
    expect(calls).not.toContain('value');
  });

  it('string interpolation is NOT a call', () => {
    const calls = extractOutgoingCalls(['    val msg = "Hello ${user.name}"']);
    expect(calls).not.toContain('name');
  });

  it('type annotation is NOT a call', () => {
    const calls = extractOutgoingCalls(['    val list: List<String> = emptyList()']);
    // List<String> is not a call (no parens after String)
    // emptyList() IS a call
    expect(calls).toContain('emptyList');
    expect(calls).not.toContain('String');
  });

  it('lambda parameter declaration is NOT a call', () => {
    const calls = extractOutgoingCalls(['    list.map { item -> process(item) }']);
    expect(calls).toContain('map');
    expect(calls).toContain('process');
    expect(calls).not.toContain('item');
  });

  it('comment-only line', () => {
    const calls = extractOutgoingCalls(['    // doStuff()']);
    expect(calls).toHaveLength(0);
  });

  it('string-only value', () => {
    const calls = extractOutgoingCalls(['    val s = "doStuff()"']);
    expect(calls).toHaveLength(0);
  });

  it('multi-line string with call syntax inside', () => {
    const calls = extractOutgoingCalls([
      '    val sql = "SELECT name FROM users WHERE id = getId()"',
    ]);
    expect(calls).not.toContain('getId');
    expect(calls).not.toContain('SELECT');
  });
});

// ── Incoming: containing function detection ─────────────────────────────────

describe('Call Hierarchy Edge — containing function edge cases', () => {
  let index: SymbolIndex;

  const CODE = `package com.example

class Service {
    fun init() {
        setup()
    }

    private fun setup() {
        loadConfig()
    }

    fun loadConfig() {}
}

fun topLevel() {
    helper()
}

fun helper() {}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Service.kt', CODE);
  });

  it('call inside class method → finds the method', () => {
    // setup() at line 4 inside init() which is at line 3
    const container = findContainingFunction(index, 'file:///Service.kt', 4);
    expect(container?.name).toBe('init');
  });

  it('call inside private method → finds private method', () => {
    // loadConfig() at line 8 inside setup() which is at line 7
    const container = findContainingFunction(index, 'file:///Service.kt', 8);
    expect(container?.name).toBe('setup');
  });

  it('call inside top-level function', () => {
    // helper() at line 15 inside topLevel() at line 14
    const container = findContainingFunction(index, 'file:///Service.kt', 15);
    expect(container?.name).toBe('topLevel');
  });

  it('function with no calls before it → returns undefined for line 0', () => {
    const container = findContainingFunction(index, 'file:///Service.kt', 0);
    expect(container).toBeUndefined();
  });
});

// ── Incoming: call in init block ────────────────────────────────────────────

describe('Call Hierarchy Edge — calls in init blocks', () => {
  it('call inside init block has no containing function', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///ViewModel.kt', `package com.example

class ViewModel {
    init {
        loadData()
    }
    fun loadData() {}
}`);
    // loadData() at line 4, init block starts at line 3
    // No function contains line 4 — init is not a function
    // findContainingFunction would return undefined
    const container = findContainingFunction(index, 'file:///ViewModel.kt', 4);
    // init is NOT indexed as a function — so no containing function
    expect(container).toBeUndefined();
  });
});

// ── Prepare: various cursor positions ───────────────────────────────────────

describe('Call Hierarchy Edge — prepare at various positions', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///App.kt', `package com.example

fun process() {
    validate()
}

fun validate() {}

class Helper {
    fun doWork() {}
}

val constant = 42`);
  });

  it('prepare on function declaration → returns that function', async () => {
    const { KotlinCallHierarchyProvider } = await import('../../src/providers/CallHierarchyProvider');
    const provider = new KotlinCallHierarchyProvider(index);
    const code = `package com.example\n\nfun process() {\n    validate()\n}\n\nfun validate() {}\n\nclass Helper {\n    fun doWork() {}\n}\n\nval constant = 42`;
    const doc = mockDocument('file:///App.kt', code);
    const items = provider.prepareCallHierarchy(doc, positionOf(code, 'process'));
    expect(items).not.toBeNull();
    expect(items![0].name).toBe('process');
  });

  it('prepare on class method → returns method', async () => {
    const { KotlinCallHierarchyProvider } = await import('../../src/providers/CallHierarchyProvider');
    const provider = new KotlinCallHierarchyProvider(index);
    const code = `package com.example\n\nfun process() {\n    validate()\n}\n\nfun validate() {}\n\nclass Helper {\n    fun doWork() {}\n}\n\nval constant = 42`;
    const doc = mockDocument('file:///App.kt', code);
    const items = provider.prepareCallHierarchy(doc, positionOf(code, 'doWork'));
    expect(items).not.toBeNull();
    expect(items![0].name).toBe('doWork');
  });

  it('prepare on val → returns null', async () => {
    const { KotlinCallHierarchyProvider } = await import('../../src/providers/CallHierarchyProvider');
    const provider = new KotlinCallHierarchyProvider(index);
    const code = `package com.example\n\nfun process() {\n    validate()\n}\n\nfun validate() {}\n\nclass Helper {\n    fun doWork() {}\n}\n\nval constant = 42`;
    const doc = mockDocument('file:///App.kt', code);
    const items = provider.prepareCallHierarchy(doc, positionOf(code, 'constant'));
    expect(items).toBeNull();
  });

  it('prepare on call site → resolves to the called function', async () => {
    const { KotlinCallHierarchyProvider } = await import('../../src/providers/CallHierarchyProvider');
    const provider = new KotlinCallHierarchyProvider(index);
    const code = `package com.example\n\nfun process() {\n    validate()\n}\n\nfun validate() {}\n\nclass Helper {\n    fun doWork() {}\n}\n\nval constant = 42`;
    const doc = mockDocument('file:///App.kt', code);
    // "validate" on the call site line (line 3 = "    validate()")
    const items = provider.prepareCallHierarchy(doc, positionOf(code, 'validate'));
    expect(items).not.toBeNull();
    expect(items!.some(i => i.name === 'validate')).toBe(true);
  });

  it('prepare on single-char word → returns null', async () => {
    const { KotlinCallHierarchyProvider } = await import('../../src/providers/CallHierarchyProvider');
    const provider = new KotlinCallHierarchyProvider(index);
    const doc = mockDocument('file:///App.kt', 'val x = 1');
    const items = provider.prepareCallHierarchy(doc, positionOf('val x = 1', 'x'));
    expect(items).toBeNull();
  });
});

// ── Body end detection edge cases ───────────────────────────────────────────

describe('Call Hierarchy Edge — body end detection', () => {
  it('last function in file gets generous bound', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Last.kt', `package com.example
fun onlyFunction() {
    doStuff()
}`);
    const symbols = index.getFileSymbols('file:///Last.kt');
    const entry = symbols.find(s => s.name === 'onlyFunction');
    expect(entry).toBeDefined();
    // No next symbol → body end = entry.line + 100
    let found = false;
    let endLine = entry!.line + 100;
    for (const s of symbols) {
      if (!found) { if (s.line === entry!.line && s.name === entry!.name) found = true; continue; }
      if (s.depth <= entry!.depth) { endLine = s.line - 1; break; }
    }
    expect(endLine).toBeGreaterThan(entry!.line);
  });

  it('function followed by another at same depth', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Two.kt', `package com.example
fun first() {
    call1()
}

fun second() {
    call2()
}`);
    const symbols = index.getFileSymbols('file:///Two.kt');
    const first = symbols.find(s => s.name === 'first');
    const second = symbols.find(s => s.name === 'second');
    // first body should end before second
    let found = false;
    let endLine = first!.line + 100;
    for (const s of symbols) {
      if (!found) { if (s.line === first!.line && s.name === first!.name) found = true; continue; }
      if (s.depth <= first!.depth) { endLine = s.line - 1; break; }
    }
    expect(endLine).toBeLessThan(second!.line);
  });
});
