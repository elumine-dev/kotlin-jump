import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

function symbols(code: string) {
  return parse('file:///test.kt', code).symbols;
}

function findSymbol(code: string, name: string) {
  return symbols(code).find(s => s.name === name);
}

// ── Basic declarations ──────────────────────────────────────────────────────

describe('class declarations', () => {
  it('parses a class', () => {
    const s = findSymbol('class Foo', 'Foo');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('class');
  });

  it('parses a data class', () => {
    const s = findSymbol('data class User(val name: String)', 'User');
    expect(s!.kind).toBe('dataClass');
  });

  it('parses a sealed class', () => {
    const s = findSymbol('sealed class Result', 'Result');
    expect(s!.kind).toBe('sealedClass');
  });

  it('parses an interface', () => {
    const s = findSymbol('interface Repository', 'Repository');
    expect(s!.kind).toBe('interface');
  });

  it('parses an object', () => {
    const s = findSymbol('object Singleton', 'Singleton');
    expect(s!.kind).toBe('object');
  });

  it('parses an enum class', () => {
    const s = findSymbol('enum class Color { RED, GREEN, BLUE }', 'Color');
    expect(s!.kind).toBe('enum');
  });

  it('parses an annotation class', () => {
    const s = findSymbol('annotation class MyAnnotation', 'MyAnnotation');
    expect(s!.kind).toBe('annotation');
  });
});

// ── Functions ───────────────────────────────────────────────────────────────

describe('functions', () => {
  it('parses a function', () => {
    const s = findSymbol('fun doSomething() {}', 'doSomething');
    expect(s!.kind).toBe('fun');
  });

  it('parses a suspend function', () => {
    const s = findSymbol('suspend fun fetchData() {}', 'fetchData');
    expect(s!.kind).toBe('fun');
  });

  it('parses an override function', () => {
    const s = findSymbol('override fun onCleared() {}', 'onCleared');
    expect(s!.kind).toBe('fun');
    expect(s!.isOverride).toBe(true);
  });

  it('parses a composable function', () => {
    const s = findSymbol('@Composable\nfun HomeScreen() {}', 'HomeScreen');
    expect(s!.kind).toBe('composable');
    expect(s!.isComposable).toBe(true);
  });

  it('parses extension function by function name', () => {
    const s = findSymbol('fun Modifier.customBackground() {}', 'customBackground');
    expect(s!.kind).toBe('fun');
  });
});

// ── Properties ──────────────────────────────────────────────────────────────

describe('properties', () => {
  it('parses a val', () => {
    const s = findSymbol('val count = 0', 'count');
    expect(s!.kind).toBe('val');
  });

  it('parses a var', () => {
    const s = findSymbol('var name = "test"', 'name');
    expect(s!.kind).toBe('var');
  });

  it('indexes primary-constructor val/var params', () => {
    const result = symbols('class Foo(\n  private val x: Int,\n  val y: String\n)');
    const names = result.map(s => s.name);
    expect(names).toContain('Foo');
    expect(names).toContain('x');
    expect(names).toContain('y');
    expect(result.find(s => s.name === 'x')?.kind).toBe('val');
    expect(result.find(s => s.name === 'x')?.depth).toBe(1);
  });
});

// ── Typealias ───────────────────────────────────────────────────────────────

describe('typealias', () => {
  it('parses a typealias', () => {
    const s = findSymbol('typealias UserList = List<User>', 'UserList');
    expect(s!.kind).toBe('typealias');
    expect(s!.aliasTarget).toBe('List<User>');
  });
});

// ── Package and imports ─────────────────────────────────────────────────────

describe('package and imports', () => {
  it('extracts package name', () => {
    const result = parse('file:///test.kt', 'package com.example.app\n\nclass Foo');
    expect(result.packageName).toBe('com.example.app');
  });

  it('extracts imports', () => {
    const result = parse('file:///test.kt', 'import com.example.Foo\nimport com.example.Bar');
    expect(result.imports).toEqual(['com.example.Foo', 'com.example.Bar']);
  });
});

// ── Supertypes ──────────────────────────────────────────────────────────────

describe('supertypes', () => {
  it('extracts single supertype', () => {
    const s = findSymbol('class FooImpl : Foo {', 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo']);
  });

  it('extracts multiple supertypes', () => {
    const s = findSymbol('class FooImpl : Foo, Bar, Baz {', 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo', 'Bar', 'Baz']);
  });

  it('extracts supertypes with constructor call', () => {
    const s = findSymbol('class FooImpl : Foo(), Bar {', 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo', 'Bar']);
  });

  it('extracts supertypes with generics', () => {
    const s = findSymbol('class FooImpl : Foo<String>, Bar {', 'FooImpl');
    expect(s!.supertypes).toContain('Foo');
    expect(s!.supertypes).toContain('Bar');
  });

  it('no supertypes for plain class', () => {
    const s = findSymbol('class Foo {', 'Foo');
    expect(s!.supertypes).toBeUndefined();
  });

  it('interface does NOT get itself as supertype', () => {
    const code = `
interface GameDelegate {
    fun doSomething()
}

class GameDelegateImpl(
    private val service: Service,
) : GameDelegate {
    override fun doSomething() {}
}`;
    const iface = findSymbol(code, 'GameDelegate');
    const impl = findSymbol(code, 'GameDelegateImpl');
    expect(iface!.supertypes).toBeUndefined();
    expect(impl!.supertypes).toEqual(['GameDelegate']);
  });

  it('multi-line constructor: extracts supertypes from ) : Type line', () => {
    const code = `class FooImpl(
    private val x: Int,
    private val y: String,
) : Foo {
    fun doStuff() {}
}`;
    const s = findSymbol(code, 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo']);
  });

  it('does not scan past interface body for supertypes', () => {
    const code = `interface Repo {
    fun save()
}
class RepoImpl(
    val db: Database,
) : Repo {
}`;
    const iface = findSymbol(code, 'Repo');
    const impl = findSymbol(code, 'RepoImpl');
    expect(iface!.supertypes).toBeUndefined();
    expect(impl!.supertypes).toEqual(['Repo']);
  });
});

// ── Enum entries ────────────────────────────────────────────────────────────

describe('enum entries', () => {
  it('parses enum entries (one per line)', () => {
    const result = symbols('enum class Color {\n  RED,\n  GREEN,\n  BLUE\n}');
    const names = result.map(s => s.name);
    expect(names).toContain('Color');
    expect(names).toContain('RED');
    expect(names).toContain('GREEN');
    expect(names).toContain('BLUE');
  });

  // ── Regression: multiple entries on the same line ───────────────────────────
  // Before the fix, RE_ENUM_ENTRY only captured the FIRST entry per line.
  // `REGULAR, EXTRA` on one line → only REGULAR was indexed; EXTRA was invisible.

  it('two entries on same line — both indexed (REGULAR, EXTRA pattern)', () => {
    const result = symbols('enum class RailType {\n    REGULAR, EXTRA\n}');
    const names = result.map(s => s.name);
    expect(names).toContain('REGULAR');
    expect(names).toContain('EXTRA');
  });

  it('three entries on same line — all indexed', () => {
    const result = symbols('enum class Color {\n    RED, GREEN, BLUE\n}');
    const names = result.map(s => s.name);
    expect(names).toContain('RED');
    expect(names).toContain('GREEN');
    expect(names).toContain('BLUE');
  });

  it('entries with constructor args on same line — both indexed', () => {
    const result = symbols('enum class Status(val code: Int) {\n    ACTIVE(1), INACTIVE(0)\n}');
    const names = result.map(s => s.name);
    expect(names).toContain('ACTIVE');
    expect(names).toContain('INACTIVE');
  });

  it('constructor arg with comma inside parens — not split incorrectly', () => {
    // `ACTIVE("hello, world"), INACTIVE` — the comma inside the string is at paren
    // depth 1 and must NOT produce a spurious segment.
    const result = symbols(`enum class Msg {\n    ACTIVE("hello, world"), INACTIVE\n}`);
    const names = result.map(s => s.name);
    expect(names).toContain('ACTIVE');
    expect(names).toContain('INACTIVE');
    // Crucially, no garbage entries from inside the string
    expect(names.filter(n => n !== 'Msg' && n !== 'ACTIVE' && n !== 'INACTIVE')).toHaveLength(0);
  });

  it('last entry followed by semicolon — indexed and stops before methods', () => {
    const code = `enum class Side {\n    LEFT, RIGHT;\n    fun flip() = if (this == LEFT) RIGHT else LEFT\n}`;
    const result = symbols(code);
    const names = result.map(s => s.name);
    expect(names).toContain('LEFT');
    expect(names).toContain('RIGHT');
    expect(names).toContain('flip'); // method after semicolon is also indexed
  });

  it('character position of second same-line entry is correct', () => {
    // `    REGULAR, EXTRA` — EXTRA starts at col 13
    const result = symbols('enum class RailType {\n    REGULAR, EXTRA\n}');
    const extra = result.find(s => s.name === 'EXTRA');
    expect(extra).toBeDefined();
    expect(extra!.character).toBe(13); // 4 spaces + REGULAR(7) + comma(1) + space(1) = 13
  });

  it('single entry with no comma — still indexed', () => {
    const result = symbols('enum class Singleton {\n    ONLY\n}');
    const names = result.map(s => s.name);
    expect(names).toContain('ONLY');
  });

  it('mixed: some entries one-per-line, some grouped', () => {
    const code = `enum class Mixed {\n    FIRST,\n    SECOND, THIRD,\n    FOURTH\n}`;
    const result = symbols(code);
    const names = result.map(s => s.name);
    ['FIRST', 'SECOND', 'THIRD', 'FOURTH'].forEach(n => expect(names).toContain(n));
  });
});

// ── Sealed class subtypes ───────────────────────────────────────────────────

describe('sealed class subtypes', () => {
  it('parses sealed class with subtypes', () => {
    const code = `sealed class BattleResult {
    data class Victory(val winner: String) : BattleResult()
    data class Defeat(val loser: String) : BattleResult()
    data object Draw : BattleResult()
}`;
    const result = symbols(code);
    const names = result.map(s => s.name);
    expect(names).toContain('BattleResult');
    expect(names).toContain('Victory');
    expect(names).toContain('Defeat');
    expect(names).toContain('Draw');
  });
});

// ── Comments and block comments ─────────────────────────────────────────────

describe('comments', () => {
  it('skips line comments', () => {
    const result = symbols('// class NotAClass\nclass RealClass');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('RealClass');
  });

  it('skips block comments', () => {
    const result = symbols('/* class NotAClass */\nclass RealClass');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('RealClass');
  });
});

// ── fun interface ───────────────────────────────────────────────────────────

describe('fun interface', () => {
  it('indexes fun interface as interface kind', () => {
    const s = findSymbol('fun interface Callback {\n  fun invoke(x: Int): Boolean\n}', 'Callback');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('interface');
  });

  it('captures correct line and depth for top-level fun interface', () => {
    const s = findSymbol('fun interface Runnable {\n  fun run()\n}', 'Runnable');
    expect(s!.depth).toBe(0);
  });

  it('indexes nested fun interface', () => {
    const code = 'class Outer {\n  fun interface Handler {\n    fun handle()\n  }\n}';
    const s = findSymbol(code, 'Handler');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('interface');
    expect(s!.depth).toBe(1);
  });

  it('does not confuse fun interface with regular fun', () => {
    const code = 'fun interface Predicate {\n  fun test(): Boolean\n}\nfun regularFun() {}';
    const predicate = findSymbol(code, 'Predicate');
    const regular   = findSymbol(code, 'regularFun');
    expect(predicate!.kind).toBe('interface');
    expect(regular!.kind).toBe('fun');
  });

  it('does not confuse fun interface with regular interface', () => {
    const code = 'fun interface SAM {\n  fun run()\n}\ninterface Regular {\n  fun doIt()\n}';
    expect(findSymbol(code, 'SAM')!.kind).toBe('interface');
    expect(findSymbol(code, 'Regular')!.kind).toBe('interface');
  });
});

// ── isOverride flag ─────────────────────────────────────────────────────────

describe('isOverride flag', () => {
  it('sets isOverride on override fun', () => {
    const s = findSymbol('override fun toString(): String = ""', 'toString');
    expect(s!.isOverride).toBe(true);
  });

  it('sets isOverride on override val', () => {
    const s = findSymbol('override val name: String = "impl"', 'name');
    expect(s!.isOverride).toBe(true);
  });

  it('sets isOverride on override var', () => {
    const s = findSymbol('override var count: Int = 0', 'count');
    expect(s!.isOverride).toBe(true);
  });

  it('does not set isOverride on regular fun', () => {
    const s = findSymbol('fun doWork() {}', 'doWork');
    expect(s!.isOverride).toBeUndefined();
  });

  it('does not set isOverride on regular val', () => {
    const s = findSymbol('val total = 0', 'total');
    expect(s!.isOverride).toBeUndefined();
  });

  it('captures both override and suspend', () => {
    const s = findSymbol('override suspend fun fetch(): String = ""', 'fetch');
    expect(s!.isOverride).toBe(true);
    expect(s!.isSuspend).toBe(true);
  });

  it('captures override inside a class body', () => {
    const code = 'class Impl : Base() {\n  override fun doWork() {}\n  fun extra() {}\n}';
    expect(findSymbol(code, 'doWork')!.isOverride).toBe(true);
    expect(findSymbol(code, 'extra')!.isOverride).toBeUndefined();
  });
});

// ── isPrivate detection ──────────────────────────────────────────────────────
//
// Regression suite for the private-symbol fix.
// The parser must correctly detect the `private` modifier on val, var, fun, and
// class declarations so that Find Usages can restrict scanning to the declaring
// file. Each test also has a mirror case proving non-private declarations are NOT
// flagged — false positives here would incorrectly hide legitimate usages.

describe('isPrivate detection', () => {

  // ── val ──────────────────────────────────────────────────────────────────

  it('private val → isPrivate=true', () => {
    expect(findSymbol('private val clickStream = Subject.create()', 'clickStream')!.isPrivate).toBe(true);
  });

  it('public val → isPrivate=undefined', () => {
    expect(findSymbol('val clickStream = Subject.create()', 'clickStream')!.isPrivate).toBeUndefined();
  });

  it('internal val → isPrivate=undefined (internal ≠ private)', () => {
    expect(findSymbol('internal val repo: Repo = Repo()', 'repo')!.isPrivate).toBeUndefined();
  });

  it('override val without private → isPrivate=undefined', () => {
    expect(findSymbol('override val count: Int = 0', 'count')!.isPrivate).toBeUndefined();
  });

  it('private lateinit var → isPrivate=true', () => {
    expect(findSymbol('private lateinit var adapter: MyAdapter', 'adapter')!.isPrivate).toBe(true);
  });

  it('lateinit var without private → isPrivate=undefined', () => {
    expect(findSymbol('lateinit var adapter: MyAdapter', 'adapter')!.isPrivate).toBeUndefined();
  });

  // ── var ──────────────────────────────────────────────────────────────────

  it('private var → isPrivate=true', () => {
    expect(findSymbol('private var counter = 0', 'counter')!.isPrivate).toBe(true);
  });

  it('var without modifier → isPrivate=undefined', () => {
    expect(findSymbol('var counter = 0', 'counter')!.isPrivate).toBeUndefined();
  });

  // ── fun ──────────────────────────────────────────────────────────────────

  it('private fun → isPrivate=true', () => {
    expect(findSymbol('private fun doInternal() {}', 'doInternal')!.isPrivate).toBe(true);
  });

  it('fun without modifier → isPrivate=undefined', () => {
    expect(findSymbol('fun doWork() {}', 'doWork')!.isPrivate).toBeUndefined();
  });

  it('private suspend fun → isPrivate=true (combines with other modifiers)', () => {
    const s = findSymbol('private suspend fun fetch(): String = ""', 'fetch')!;
    expect(s.isPrivate).toBe(true);
    expect(s.isSuspend).toBe(true);
  });

  it('suspend fun without private → isPrivate=undefined', () => {
    expect(findSymbol('suspend fun fetch(): String = ""', 'fetch')!.isPrivate).toBeUndefined();
  });

  it('private inline fun → isPrivate=true', () => {
    const s = findSymbol('private inline fun <reified T> cast(v: Any): T = v as T', 'cast')!;
    expect(s.isPrivate).toBe(true);
    expect(s.isInline).toBe(true);
  });

  // ── class ─────────────────────────────────────────────────────────────────

  it('private class → isPrivate=true', () => {
    expect(findSymbol('private class Helper', 'Helper')!.isPrivate).toBe(true);
  });

  it('class without modifier → isPrivate=undefined', () => {
    expect(findSymbol('class Helper', 'Helper')!.isPrivate).toBeUndefined();
  });

  it('private data class → isPrivate=true', () => {
    expect(findSymbol('private data class State(val x: Int)', 'State')!.isPrivate).toBe(true);
  });

  // ── Members inside a class body ───────────────────────────────────────────

  it('private val inside a class body → isPrivate=true', () => {
    const code = 'class ViewModel {\n    private val _state = MutableStateFlow("")\n    val state = _state.asStateFlow()\n}';
    expect(findSymbol(code, '_state')!.isPrivate).toBe(true);
    expect(findSymbol(code, 'state')!.isPrivate).toBeUndefined();
  });

  it('private fun inside a class body → isPrivate=true', () => {
    const code = 'class Repo {\n    private fun validate(): Boolean = true\n    fun fetch(): String = ""\n}';
    expect(findSymbol(code, 'validate')!.isPrivate).toBe(true);
    expect(findSymbol(code, 'fetch')!.isPrivate).toBeUndefined();
  });

  // ── Primary constructor params are never private through isPrivate ────────
  // Primary ctor params like `data class Foo(val x: Int)` are never declared
  // `private` explicitly in typical Kotlin — that would make them inaccessible
  // as properties. Verify no false positive.

  it('primary ctor val param → isPrivate=undefined', () => {
    const code = 'data class Point(val x: Int, val y: Int)';
    expect(findSymbol(code, 'x')!.isPrivate).toBeUndefined();
    expect(findSymbol(code, 'y')!.isPrivate).toBeUndefined();
  });
});
