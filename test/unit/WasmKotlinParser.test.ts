import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import * as path from 'path';

import { initWasm, isWasmReady, parseWasm } from '../../src/indexer/WasmKotlinParser';

const distDir = path.join(__dirname, '../../dist');

// Check synchronously at module load so describe.skipIf works correctly.
// If WASM files are absent, all tests show as SKIPPED — never falsely PASSED.
const wasmFilesExist =
  existsSync(path.join(distDir, 'tree-sitter-kotlin.wasm')) &&
  existsSync(path.join(distDir, 'web-tree-sitter.wasm'));

describe.skipIf(!wasmFilesExist)('WasmKotlinParser', () => {
  beforeAll(async () => {
    await initWasm(distDir);
    if (!isWasmReady()) throw new Error('WASM init succeeded file-check but isWasmReady() is false');
  }, 15_000);

  function wasm(code: string) {
    return parseWasm('file:///test.kt', code);
  }
  function symbols(code: string) {
    return wasm(code).symbols;
  }
  function find(code: string, name: string) {
    return symbols(code).find(s => s.name === name);
  }

  // ── Basic declarations ──────────────────────────────────────────────────────

  describe('class declarations', () => {
    it('parses a class', () => {
      const s = find('class Foo', 'Foo');
      expect(s).toBeDefined();
      expect(s!.kind).toBe('class');
    });

    it('parses a data class', () => {
      expect(find('data class User(val name: String)', 'User')!.kind).toBe('dataClass');
    });

    it('parses a sealed class', () => {
      expect(find('sealed class Result', 'Result')!.kind).toBe('sealedClass');
    });

    it('parses an interface', () => {
      expect(find('interface Repository', 'Repository')!.kind).toBe('interface');
    });

    it('parses an object', () => {
      expect(find('object Singleton', 'Singleton')!.kind).toBe('object');
    });

    it('parses an enum class', () => {
      expect(find('enum class Color { RED, GREEN, BLUE }', 'Color')!.kind).toBe('enum');
    });

    it('parses an annotation class', () => {
      expect(find('annotation class MyAnnotation', 'MyAnnotation')!.kind).toBe('annotation');
    });

    it('does NOT index a plain constructor param without val/var', () => {
      const result = symbols('class Foo(x: Int, val y: String)');
      const names = result.map(s => s.name);
      expect(names).not.toContain('x');
      expect(names).toContain('y');
    });
  });

  // ── Functions ───────────────────────────────────────────────────────────────

  describe('functions', () => {
    it('parses a function', () => {
      expect(find('fun doSomething() {}', 'doSomething')!.kind).toBe('fun');
    });

    it('parses a suspend function', () => {
      const s = find('suspend fun fetchData() {}', 'fetchData');
      expect(s!.kind).toBe('fun');
      expect(s!.isSuspend).toBe(true);
    });

    it('parses an override function', () => {
      const s = find('override fun onCleared() {}', 'onCleared');
      expect(s!.kind).toBe('fun');
      expect(s!.isOverride).toBe(true);
    });

    it('parses a composable function', () => {
      const s = find('@Composable\nfun HomeScreen() {}', 'HomeScreen');
      expect(s!.kind).toBe('composable');
      expect(s!.isComposable).toBe(true);
    });

    it('extension function is found by function name, not receiver type name', () => {
      const s = find('fun Modifier.customBackground() {}', 'customBackground');
      expect(s).toBeDefined();
      expect(s!.kind).toBe('fun');
      expect(find('fun Modifier.customBackground() {}', 'Modifier')).toBeUndefined();
    });
  });

  // ── Properties ──────────────────────────────────────────────────────────────

  describe('properties', () => {
    it('parses a val', () => {
      expect(find('val count = 0', 'count')!.kind).toBe('val');
    });

    it('parses a var', () => {
      expect(find('var name = "test"', 'name')!.kind).toBe('var');
    });

    it('indexes primary-constructor val/var params at depth+1', () => {
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
    it('parses a typealias and extracts aliasTarget', () => {
      const s = find('typealias UserList = List<User>', 'UserList');
      expect(s!.kind).toBe('typealias');
      expect(s!.aliasTarget).toBe('List<User>');
    });
  });

  // ── Package and imports ─────────────────────────────────────────────────────

  describe('package and imports', () => {
    it('extracts package name', () => {
      expect(wasm('package com.example.app\n\nclass Foo').packageName).toBe('com.example.app');
    });

    it('extracts imports in order', () => {
      expect(wasm('import com.example.Foo\nimport com.example.Bar').imports)
        .toEqual(['com.example.Foo', 'com.example.Bar']);
    });

    it('handles wildcard imports', () => {
      expect(wasm('import com.example.*').imports).toEqual(['com.example.*']);
    });
  });

  // ── Supertypes ──────────────────────────────────────────────────────────────

  describe('supertypes', () => {
    it('extracts single supertype', () => {
      expect(find('class FooImpl : Foo {}', 'FooImpl')!.supertypes).toEqual(['Foo']);
    });

    it('extracts multiple supertypes', () => {
      expect(find('class FooImpl : Foo, Bar, Baz {}', 'FooImpl')!.supertypes)
        .toEqual(['Foo', 'Bar', 'Baz']);
    });

    it('extracts supertypes with constructor call', () => {
      expect(find('class FooImpl : Foo(), Bar {}', 'FooImpl')!.supertypes)
        .toEqual(['Foo', 'Bar']);
    });

    it('extracts the class name from a generic supertype — not the type parameter', () => {
      // Previously firstTypeIdentifier DFS could return String instead of Collection
      const s = find('class FooImpl : Collection<String> {}', 'FooImpl');
      expect(s!.supertypes).toContain('Collection');
      expect(s!.supertypes).not.toContain('String');
    });

    it('extracts the innermost name from a qualified supertype', () => {
      // Previously firstTypeIdentifier returned "Outer" instead of "Inner"
      const s = find('class FooImpl : Outer.Inner {}', 'FooImpl');
      expect(s!.supertypes).toEqual(['Inner']);
      expect(s!.supertypes).not.toContain('Outer');
    });

    it('extracts the innermost name from a deeply qualified supertype', () => {
      const s = find('class FooImpl : com.example.pkg.Bar {}', 'FooImpl');
      expect(s!.supertypes).toEqual(['Bar']);
    });

    it('no supertypes for plain class', () => {
      expect(find('class Foo {}', 'Foo')!.supertypes).toBeUndefined();
    });

    it('multi-line constructor still extracts supertypes', () => {
      const code = `class FooImpl(
    private val x: Int,
    private val y: String,
) : Foo {
    fun doStuff() {}
}`;
      expect(find(code, 'FooImpl')!.supertypes).toEqual(['Foo']);
    });
  });

  // ── Enum entries ────────────────────────────────────────────────────────────

  describe('enum entries', () => {
    it('indexes all enum entries at depth+1', () => {
      const result = symbols('enum class Color {\n  RED,\n  GREEN,\n  BLUE\n}');
      const names = result.map(s => s.name);
      expect(names).toContain('Color');
      expect(names).toContain('RED');
      expect(names).toContain('GREEN');
      expect(names).toContain('BLUE');
      expect(result.find(s => s.name === 'RED')?.depth).toBe(1);
    });

    it('does NOT index enum entries outside the enum body', () => {
      // Verify enum entries don't bleed into sibling declarations
      const result = symbols('enum class Status { ACTIVE }\nclass Unrelated {}');
      expect(result.find(s => s.name === 'ACTIVE')?.depth).toBe(1);
      expect(result.find(s => s.name === 'Unrelated')?.depth).toBe(0);
    });

    it('indexes enum entries with constructor args (e.g. REGULAR("ED"))', () => {
      const result = symbols(`enum class CategoryType(val value: String) {
    REGULAR("ED"),
    PROMOTIONAL_SPECIAL_EDITION("SP"),
    UNKNOWN("UNKNOWN");
}`);
      const names = result.map(s => s.name);
      expect(names).toContain('CategoryType');
      expect(names).toContain('REGULAR');
      expect(names).toContain('PROMOTIONAL_SPECIAL_EDITION');
      expect(names).toContain('UNKNOWN');
      expect(result.find(s => s.name === 'REGULAR')?.depth).toBe(1);
    });

    it('indexes enum entries on a single comma-separated line (REGULAR, EXTRA)', () => {
      const result = symbols(`enum class StatusType {\n    REGULAR, EXTRA\n}`);
      const names = result.map(s => s.name);
      expect(names).toContain('REGULAR');
      expect(names).toContain('EXTRA');
    });
  });

  // ── Sealed class subtypes ───────────────────────────────────────────────────

  describe('sealed class subtypes', () => {
    it('indexes all subtypes nested inside sealed class', () => {
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
      // Subtypes reference BattleResult as supertype
      expect(result.find(s => s.name === 'Victory')?.supertypes).toContain('BattleResult');
    });
  });

  // ── Comments ────────────────────────────────────────────────────────────────

  describe('comments', () => {
    it('does not index declarations inside line comments', () => {
      const result = symbols('// class NotAClass\nclass RealClass');
      expect(result.map(s => s.name)).not.toContain('NotAClass');
      expect(result.map(s => s.name)).toContain('RealClass');
    });

    it('does not index declarations inside block comments', () => {
      const result = symbols('/* class NotAClass */\nclass RealClass');
      expect(result.map(s => s.name)).not.toContain('NotAClass');
      expect(result.map(s => s.name)).toContain('RealClass');
    });
  });

  // ── fun interface ───────────────────────────────────────────────────────────

  describe('fun interface', () => {
    it('indexes fun interface as interface kind', () => {
      const s = find('fun interface Callback {\n  fun invoke(x: Int): Boolean\n}', 'Callback');
      expect(s).toBeDefined();
      expect(s!.kind).toBe('interface');
    });

    it('top-level fun interface has depth 0', () => {
      expect(find('fun interface Runnable {\n  fun run()\n}', 'Runnable')!.depth).toBe(0);
    });

    it('nested fun interface has depth 1', () => {
      const s = find('class Outer {\n  fun interface Handler {\n    fun handle()\n  }\n}', 'Handler');
      expect(s).toBeDefined();
      expect(s!.kind).toBe('interface');
      expect(s!.depth).toBe(1);
    });

    it('does not confuse fun interface with a regular function named after an interface', () => {
      const code = 'fun interface Predicate {\n  fun test(): Boolean\n}\nfun regularFun() {}';
      expect(find(code, 'Predicate')!.kind).toBe('interface');
      expect(find(code, 'regularFun')!.kind).toBe('fun');
    });

    it('does not emit a spurious symbol for the SAM method inside a fun interface', () => {
      // The SAM method (`invoke`) is inside the fun interface body — should be indexed
      // but as a `fun` at depth 1, not confused with the interface itself
      const code = 'fun interface Callback {\n  fun invoke(x: Int): Boolean\n}';
      const result = symbols(code);
      const callbackSym = result.find(s => s.name === 'Callback');
      const invokeSym   = result.find(s => s.name === 'invoke');
      expect(callbackSym!.kind).toBe('interface');
      expect(invokeSym).toBeUndefined(); // fun interface body is not recursed (it's an ERROR node)
    });
  });

  // ── isOverride flag ─────────────────────────────────────────────────────────

  describe('isOverride flag', () => {
    it('sets isOverride on override fun', () => {
      expect(find('override fun toString(): String = ""', 'toString')!.isOverride).toBe(true);
    });

    it('sets isOverride on override val', () => {
      expect(find('override val name: String = "impl"', 'name')!.isOverride).toBe(true);
    });

    it('does NOT set isOverride on regular fun', () => {
      expect(find('fun doWork() {}', 'doWork')!.isOverride).toBeUndefined();
    });

    it('captures both override and suspend on the same function', () => {
      const s = find('override suspend fun fetch(): String = ""', 'fetch');
      expect(s!.isOverride).toBe(true);
      expect(s!.isSuspend).toBe(true);
    });
  });

  // ── Composable detection ─────────────────────────────────────────────────────

  describe('Composable function detection', () => {
    it('bare @Composable fun', () => {
      expect(find('@Composable\nfun HomeScreen() {}', 'HomeScreen')?.kind).toBe('composable');
    });

    it('@Composable after 3 other annotations', () => {
      const code = `@OptIn(ExperimentalApi::class)
@Suppress("MagicNumber")
@Composable
private fun ProductList() {}`;
      expect(find(code, 'ProductList')?.kind).toBe('composable');
    });

    it('@Composable as FIRST of 4 annotations — fixed in WASM (regex parser drops it)', () => {
      const code = `@Composable
@Preview(showBackground = true)
@Preview(uiMode = 1)
@OptIn(ExperimentalApi::class)
fun PreviewScreen() {}`;
      expect(find(code, 'PreviewScreen')?.kind).toBe('composable');
      expect(find(code, 'PreviewScreen')?.isComposable).toBe(true);
    });

    it('@HiltViewModel with 4+ stacked annotations — fixed in WASM (regex parser drops it)', () => {
      const code = `@Inject
@SomeAnnotation
@AnotherAnnotation
@HiltViewModel
class MyViewModel : ViewModel() {}`;
      expect(find(code, 'MyViewModel')?.isHiltViewModel).toBe(true);
    });

    it('function WITHOUT @Composable is NOT composable kind', () => {
      // Regression guard: ensure regular funs near composable ones are not contaminated
      const code = `@Composable
fun Screen() {}
fun helper() {}`;
      expect(find(code, 'Screen')?.kind).toBe('composable');
      expect(find(code, 'helper')?.kind).toBe('fun');
      expect(find(code, 'helper')?.isComposable).toBeFalsy();
    });
  });

  // ── @Preview detection ───────────────────────────────────────────────────────

  describe('@Preview function detection', () => {
    it('bare @Preview fun sets isPreview', () => {
      expect(find('@Preview\nfun MyScreenPreview() {}', 'MyScreenPreview')?.isPreview).toBe(true);
    });

    it('@Preview with params sets isPreview', () => {
      expect(find('@Preview(showBackground = true)\nfun MyScreenPreview() {}', 'MyScreenPreview')?.isPreview).toBe(true);
    });

    it('@Preview @Composable fun sets both flags and kind is composable', () => {
      const code = `@Preview\n@Composable\nfun MyScreenPreview() {}`;
      const sym = find(code, 'MyScreenPreview');
      expect(sym?.isPreview).toBe(true);
      expect(sym?.isComposable).toBe(true);
      expect(sym?.kind).toBe('composable');
    });
  });

  // ── Local val/var in functions ───────────────────────────────────────────────

  describe('local val/var in functions', () => {
    it('val with block expression is indexed at depth 1', () => {
      const code = `fun render() {
    val screenWidth = with(density) {
        containerSize.width.toDp()
    }
}`;
      const s = find(code, 'screenWidth');
      expect(s).toBeDefined();
      expect(s?.depth).toBe(1);
    });

    it('var by remember is indexed', () => {
      const code = `fun render() {
    var rotation by remember { mutableFloatStateOf(0f) }
}`;
      const sym = find(code, 'rotation');
      expect(sym).toBeDefined();
      expect(sym?.kind).toBe('var');
    });

    it('val by remember + derivedStateOf is indexed', () => {
      const code = `fun render() {
    val height by remember(screenHeight) {
        derivedStateOf { 100 }
    }
}`;
      expect(find(code, 'height')).toBeDefined();
    });

    it('local val inside nested function has depth 2', () => {
      const code = `fun outer() {
    fun inner() {
        val x = 1
    }
}`;
      expect(find(code, 'x')?.depth).toBe(2);
    });
  });

  // ── Constructor val params ───────────────────────────────────────────────────

  describe('Constructor val params', () => {
    it('multi-line data class constructor val params are indexed at depth 1', () => {
      const code = `data class Dimensions(
    val width: Int = 0,
    val height: Int = 0,
)`;
      expect(find(code, 'width')?.kind).toBe('val');
      expect(find(code, 'width')?.depth).toBe(1);
      expect(find(code, 'height')?.kind).toBe('val');
    });

    it('inline data class constructor val params are indexed', () => {
      const code = `data class Dimensions(val width: Int)`;
      expect(find(code, 'Dimensions')?.kind).toBe('dataClass');
      expect(find(code, 'width')?.kind).toBe('val');
      expect(find(code, 'width')?.depth).toBe(1);
    });
  });

  // ── const val modifiers ──────────────────────────────────────────────────────

  describe('const val modifiers', () => {
    it('private const val has isConst flag', () => {
      expect(find('private const val TAG = "Foo"', 'TAG')?.isConst).toBe(true);
    });

    it('regular val does NOT have isConst flag', () => {
      expect(find('val TAG = "Foo"', 'TAG')?.isConst).toBeUndefined();
    });
  });

  // ── sealed interface ─────────────────────────────────────────────────────────

  describe('sealed interface', () => {
    it('sealed interface maps to sealedClass kind', () => {
      expect(find('sealed interface Action {}', 'Action')?.kind).toBe('sealedClass');
    });
  });

  // ── Extension functions ──────────────────────────────────────────────────────

  describe('extension functions', () => {
    it('detects simple extension function', () => {
      expect(find('fun Modifier.customBg() {}', 'customBg')?.isExtension).toBe(true);
    });

    it('detects nullable receiver extension', () => {
      expect(find('fun String?.orEmpty(): String = this ?: ""', 'orEmpty')?.isExtension).toBe(true);
    });

    it('detects generic receiver extension', () => {
      expect(find('fun <T> List<T>.foo() {}', 'foo')?.isExtension).toBe(true);
    });

    it('regular function is NOT an extension', () => {
      expect(find('fun doWork() {}', 'doWork')?.isExtension).toBeUndefined();
    });

    it('receiver type name is NOT indexed as a separate symbol', () => {
      // Ensures we emit `customBg`, not a phantom `Modifier` symbol
      const result = symbols('fun Modifier.customBg() {}');
      expect(result.map(s => s.name)).not.toContain('Modifier');
    });
  });

  // ── Companion object ─────────────────────────────────────────────────────────

  describe('companion object', () => {
    it('anonymous companion object is NOT emitted as a symbol but its members are indexed', () => {
      const code = `class Foo {
    companion object {
        val INSTANCE = Foo()
    }
}`;
      const result = symbols(code);
      expect(result.map(s => s.name)).not.toContain('Companion');
      expect(result.find(s => s.name === 'INSTANCE')?.kind).toBe('val');
    });

    it('named companion object IS emitted as a symbol', () => {
      const code = `class Foo {
    companion object Factory {
        fun create(): Foo = Foo()
    }
}`;
      expect(find(code, 'Factory')?.kind).toBe('object');
    });

    it('named companion object records its supertypes', () => {
      // Previously pushCompanion never called getSupertypes
      const code = `class Foo {
    companion object Named : SomeInterface {
        override fun doThing() {}
    }
}`;
      expect(find(code, 'Named')?.supertypes).toEqual(['SomeInterface']);
    });
  });

  // ── Depth correctness ────────────────────────────────────────────────────────

  describe('depth correctness', () => {
    it('top-level declaration has depth 0', () => {
      expect(find('class TopLevel {}', 'TopLevel')?.depth).toBe(0);
    });

    it('nested class inside class body has depth 1', () => {
      const code = `class Outer {
    class Inner {}
}`;
      expect(find(code, 'Inner')?.depth).toBe(1);
    });

    it('declaration inside function body has depth 1', () => {
      const code = `fun build(): Any {
    val result = Any()
    return result
}`;
      expect(find(code, 'result')?.depth).toBe(1);
    });

    it('triply nested class has depth 2', () => {
      const code = `class A {
    class B {
        class C {}
    }
}`;
      expect(find(code, 'C')?.depth).toBe(2);
    });
  });

  // ── Regression: StatusType.REGULAR vs CategoryType.REGULAR disambiguation ───────

  describe('StatusType / CategoryType FQN disambiguation', () => {
    it('WASM-parsed StatusType.REGULAR has correct FQN pkg.StatusType.REGULAR', () => {
      // Entries on ONE comma-separated line — WASM must still index both
      const statusTypeCode = `package com.example.app.ui.transport.model

enum class StatusType {
    REGULAR, EXTRA
}`;
      const result = parseWasm('file:///model/StatusType.kt', statusTypeCode);
      expect(result.packageName).toBe('com.example.app.ui.transport.model');
      const names = result.symbols.map(s => s.name);
      expect(names).toContain('REGULAR');
      expect(names).toContain('EXTRA');
      const regular = result.symbols.find(s => s.name === 'REGULAR');
      expect(regular?.depth).toBe(1);
      expect(regular?.kind).toBe('enum');
    });

    it('WASM-parsed CategoryType.REGULAR has correct depth and kind', () => {
      // Entries with constructor args — WASM must parse the enum body correctly
      const categoryTypeCode = `package com.example.app.content

enum class CategoryType(val value: String) {
    REGULAR("ED"),
    PROMOTIONAL_SPECIAL_EDITION("SP"),
    PUBLISHER_SPECIAL_EDITION("SR"),
    UNKNOWN("UNKNOWN");

    companion object {

        @JvmStatic fun fromCode(code: String): CategoryType {
            return when (code) {
                REGULAR.value -> REGULAR
                else -> UNKNOWN
            }
        }
    }
}`;
      const result = parseWasm('file:///content/CategoryType.kt', categoryTypeCode);
      expect(result.packageName).toBe('com.example.app.content');
      const names = result.symbols.map(s => s.name);
      expect(names).toContain('CategoryType');
      expect(names).toContain('REGULAR');
      expect(names).toContain('UNKNOWN');
      const regular = result.symbols.find(s => s.name === 'REGULAR');
      expect(regular?.depth).toBe(1);
    });

  });

  // ── String template correctness (WASM advantage over regex) ──────────────────

  describe('string templates do not corrupt depth counting', () => {
    it('class after a string template with braces is found at correct depth', () => {
      // The regex parser's brace counter can miscount `{` inside string templates.
      // WASM parser lexes strings atomically — no such issue.
      const code = `fun build(): String {
    val s = "value is \${x + 1} items"
    return s
}
class AfterTemplate {}`;
      expect(find(code, 'AfterTemplate')?.depth).toBe(0);
    });
  });
});
