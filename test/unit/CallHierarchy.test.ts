import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Helpers: simulate Call Hierarchy logic ───────────────────────────────────

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

function getFunctionBodyEnd(index: SymbolIndex, uri: string, entry: any): number {
  const symbols = index.getFileSymbols(uri);
  let found = false;
  for (const s of symbols) {
    if (!found) {
      if (s.line === entry.line && s.name === entry.name) found = true;
      continue;
    }
    if (s.depth <= entry.depth) return s.line - 1;
  }
  return 999;
}

// ── Test data ───────────────────────────────────────────────────────────────

const CALLER_FILE = `package com.example

fun helperA() {
    println("hello")
}

fun helperB() {
    helperA()
    validate()
}

fun main() {
    helperA()
    helperB()
    val result = process()
}

fun validate() {
    checkNotNull("test")
}

fun process(): String {
    validate()
    return helperA().toString()
}`;

const SERVICE_FILE = `package com.example

class UserService {
    fun loadUser(id: String) {
        val user = fetchUser(id)
        validate()
        cache(user)
    }

    private fun fetchUser(id: String): User {
        return api.getUser(id)
    }

    private fun cache(user: User) {
        store.put(user)
    }
}`;

const COMPOSE_FILE = `package com.example

@Composable
fun HomeScreen(viewModel: ViewModel) {
    val state = viewModel.collectAsState()
    UserList(users = state.users)
    FloatingButton(onClick = { viewModel.refresh() })
}

@Composable
fun UserList(users: List<User>) {
    users.forEach { user ->
        UserCard(user = user)
    }
}

@Composable
fun UserCard(user: User) {
    Text(text = user.name)
}

@Composable
fun FloatingButton(onClick: () -> Unit) {
    Button(onClick = onClick)
}`;

// ── Tests: outgoing calls extraction ────────────────────────────────────────

describe('Call Hierarchy — outgoing call extraction', () => {
  it('simple function calls', () => {
    const body = ['    helperA()', '    validate()'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('helperA');
    expect(calls).toContain('validate');
  });

  it('skips keywords', () => {
    const body = ['    if (x > 0) {', '    return validate()', '    for (i in list) {'];
    const calls = extractOutgoingCalls(body);
    expect(calls).not.toContain('if');
    expect(calls).not.toContain('return');
    expect(calls).not.toContain('for');
    expect(calls).toContain('validate');
  });

  it('skips calls in comments', () => {
    const body = ['    // validate()', '    helperA() // helperB()'];
    const calls = extractOutgoingCalls(body);
    expect(calls).not.toContain('validate');
    expect(calls).toContain('helperA');
    expect(calls).not.toContain('helperB');
  });

  it('skips calls in strings', () => {
    const body = ['    val msg = "helperA() was called"', '    validate()'];
    const calls = extractOutgoingCalls(body);
    expect(calls).not.toContain('helperA');
    expect(calls).toContain('validate');
  });

  it('detects trailing lambda calls (Kotlin)', () => {
    const body = ['    users.forEach {', '        process(it)', '    }'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('forEach');
    expect(calls).toContain('process');
  });

  it('detects generic function calls', () => {
    const body = ['    listOf<String>("a", "b")'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('listOf');
  });

  it('detects chained calls', () => {
    const body = ['    list.filter { it > 0 }.map { it.toString() }.first()'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('filter');
    expect(calls).toContain('map');
    expect(calls).toContain('toString');
    expect(calls).toContain('first');
  });

  it('detects constructor calls', () => {
    const body = ['    val user = User("john")', '    val list = ArrayList<String>()'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('User');
    expect(calls).toContain('ArrayList');
  });

  it('deduplicates calls', () => {
    const body = ['    validate()', '    validate()', '    validate()'];
    const calls = extractOutgoingCalls(body);
    expect(calls.filter(c => c === 'validate')).toHaveLength(1);
  });

  it('empty body returns no calls', () => {
    expect(extractOutgoingCalls([])).toHaveLength(0);
  });

  it('expression body function', () => {
    const body = ['fun double(x: Int) = multiply(x, 2)'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('multiply');
  });
});

// ── Tests: find containing function ─────────────────────────────────────────

describe('Call Hierarchy — find containing function', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///app.kt', CALLER_FILE);
  });

  it('call inside helperB → containing function is helperB', () => {
    // helperA() is called at line 7 (inside helperB which starts at line 6)
    const container = findContainingFunction(index, 'file:///app.kt', 7);
    expect(container?.name).toBe('helperB');
  });

  it('call inside main → containing function is main', () => {
    // helperA() at line 12 (inside main which starts at line 11)
    const container = findContainingFunction(index, 'file:///app.kt', 12);
    expect(container?.name).toBe('main');
  });

  it('call at function declaration line → returns that function', () => {
    const container = findContainingFunction(index, 'file:///app.kt', 2);
    expect(container?.name).toBe('helperA');
  });
});

// ── Tests: function body end detection ──────────────────────────────────────

describe('Call Hierarchy — function body end', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///app.kt', CALLER_FILE);
  });

  it('helperA body ends before helperB', () => {
    const entry = index.getFileSymbols('file:///app.kt').find(s => s.name === 'helperA');
    const end = getFunctionBodyEnd(index, 'file:///app.kt', entry);
    const helperB = index.getFileSymbols('file:///app.kt').find(s => s.name === 'helperB');
    expect(end).toBeLessThan(helperB!.line);
  });

  it('main body ends before validate', () => {
    const entry = index.getFileSymbols('file:///app.kt').find(s => s.name === 'main');
    const end = getFunctionBodyEnd(index, 'file:///app.kt', entry);
    const validate = index.getFileSymbols('file:///app.kt').find(s => s.name === 'validate');
    expect(end).toBeLessThan(validate!.line);
  });
});

// ── Tests: Compose-specific patterns ────────────────────────────────────────

describe('Call Hierarchy — Compose patterns', () => {
  it('HomeScreen outgoing: collectAsState, UserList, FloatingButton, refresh', () => {
    const body = [
      '    val state = viewModel.collectAsState()',
      '    UserList(users = state.users)',
      '    FloatingButton(onClick = { viewModel.refresh() })',
    ];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('collectAsState');
    expect(calls).toContain('UserList');
    expect(calls).toContain('FloatingButton');
    expect(calls).toContain('refresh');
  });

  it('UserList outgoing: forEach, UserCard', () => {
    const body = [
      '    users.forEach { user ->',
      '        UserCard(user = user)',
      '    }',
    ];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('forEach');
    expect(calls).toContain('UserCard');
  });
});

// ── Tests: class methods ────────────────────────────────────────────────────

describe('Call Hierarchy — class methods', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///service.kt', SERVICE_FILE);
  });

  it('loadUser outgoing calls: fetchUser, validate, cache', () => {
    const body = [
      '        val user = fetchUser(id)',
      '        validate()',
      '        cache(user)',
    ];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('fetchUser');
    expect(calls).toContain('validate');
    expect(calls).toContain('cache');
  });

  it('fetchUser is inside UserService', () => {
    const entry = index.getFileSymbols('file:///service.kt').find(s => s.name === 'fetchUser');
    expect(entry).toBeDefined();
    expect(entry!.depth).toBeGreaterThan(0);
  });
});

// ── Tests: cycle detection ──────────────────────────────────────────────────

describe('Call Hierarchy — cycle detection', () => {
  it('mutual recursion: A calls B, B calls A', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///cycle.kt', `package com.example
fun funcA() { funcB() }
fun funcB() { funcA() }`);

    // funcA outgoing → funcB
    const bodyA = ['fun funcA() { funcB() }'];
    expect(extractOutgoingCalls(bodyA)).toContain('funcB');

    // funcB outgoing → funcA
    const bodyB = ['fun funcB() { funcA() }'];
    expect(extractOutgoingCalls(bodyB)).toContain('funcA');

    // Both exist in index — no infinite loop because lazy loading (one level at a time)
    expect(index.lookup('funcA')).toHaveLength(1);
    expect(index.lookup('funcB')).toHaveLength(1);
  });

  it('self-recursion: A calls A', () => {
    const body = ['    if (n <= 1) return 1', '    return factorial(n - 1)'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('factorial');
  });
});

// ── Tests: edge cases ───────────────────────────────────────────────────────

describe('Call Hierarchy — edge cases', () => {
  it('property access is NOT a call', () => {
    const body = ['    val name = user.name', '    val size = list.size'];
    const calls = extractOutgoingCalls(body);
    expect(calls).not.toContain('name');
    expect(calls).not.toContain('size');
  });

  it('when expression branches are not calls', () => {
    const body = ['    when (x) {', '        1 -> process()', '        else -> fallback()', '    }'];
    const calls = extractOutgoingCalls(body);
    expect(calls).not.toContain('when');
    expect(calls).toContain('process');
    expect(calls).toContain('fallback');
  });

  it('suspend fun calls detected', () => {
    const body = ['    withContext(Dispatchers.IO) {', '        fetchData()', '    }'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('withContext');
    expect(calls).toContain('fetchData');
  });

  it('scope functions detected', () => {
    const body = ['    user.let { validate(it) }', '    config.apply { setup() }'];
    const calls = extractOutgoingCalls(body);
    expect(calls).toContain('let');
    expect(calls).toContain('validate');
    expect(calls).toContain('apply');
    expect(calls).toContain('setup');
  });
});
