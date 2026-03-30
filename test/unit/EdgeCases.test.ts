import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';
import { mockDocument, positionOf } from './helpers';
import { Location } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}
function addJava(index: SymbolIndex, uri: string, code: string) {
  index.add(parseJava(uri, code));
}
function locs(result: any): Location[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ── Same name in different packages ─────────────────────────────────────────

describe('Same name, different packages', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const BUTTON_UI = `package com.example.ui
class Button(val label: String)`;

  const BUTTON_DESIGN = `package com.example.design
class Button(val style: Int)`;

  const SCREEN = `package com.example.app
import com.example.ui.Button

fun render() {
    val btn = Button("Click")
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///ui/Button.kt', BUTTON_UI);
    addKt(index, 'file:///design/Button.kt', BUTTON_DESIGN);
    addKt(index, 'file:///app/Screen.kt', SCREEN);
    provider = new KotlinDefinitionProvider(index);
  });

  it('resolves Button to the imported package, not the other', () => {
    const doc = mockDocument('file:///app/Screen.kt', SCREEN);
    const pos = positionOf(SCREEN, 'Button', 2); // usage, not import
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result).toHaveLength(1);
    expect(result[0].uri.toString()).toBe('file:///ui/Button.kt');
  });
});

describe('Wildcard import resolution', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const BUTTON_UI = `package com.example.ui
class Button(val label: String)`;

  const BUTTON_DESIGN = `package com.example.design
class Button(val style: Int)`;

  const BUTTON_APP = `package com.example.app
class Button(val source: String)`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///ui/Button.kt', BUTTON_UI);
    addKt(index, 'file:///design/Button.kt', BUTTON_DESIGN);
    addKt(index, 'file:///app/Button.kt', BUTTON_APP);
    provider = new KotlinDefinitionProvider(index);
  });

  it('returns both matches when two wildcard imports remain ambiguous', () => {
    const screen = `package com.example.feature
import com.example.ui.*
import com.example.design.*

fun render() {
    val btn = Button()
}`;
    const doc = mockDocument('file:///feature/AmbiguousScreen.kt', screen);
    const pos = positionOf(screen, 'Button', 1);
    const result = locs(provider.provideDefinition(doc, pos));
    const uris = result.map(l => l.uri.toString());

    expect(result).toHaveLength(2);
    expect(uris).toContain('file:///ui/Button.kt');
    expect(uris).toContain('file:///design/Button.kt');
  });

  it('prefers an exact import over wildcard imports', () => {
    const screen = `package com.example.feature
import com.example.design.Button
import com.example.ui.*

fun render() {
    val btn = Button(1)
}`;
    const doc = mockDocument('file:///feature/ExactImportScreen.kt', screen);
    const pos = positionOf(screen, 'Button', 2);
    const result = locs(provider.provideDefinition(doc, pos));

    expect(result).toHaveLength(1);
    expect(result[0].uri.toString()).toBe('file:///design/Button.kt');
  });

  it('prefers the same-package symbol over wildcard imports', () => {
    const screen = `package com.example.app
import com.example.ui.*

fun render() {
    val btn = Button("local")
}`;
    const doc = mockDocument('file:///app/LocalPackageScreen.kt', screen);
    const pos = positionOf(screen, 'Button', 1);
    const result = locs(provider.provideDefinition(doc, pos));

    expect(result).toHaveLength(1);
    expect(result[0].uri.toString()).toBe('file:///app/Button.kt');
  });
});

// ── Interface and implementation in the same file ───────────────────────────

describe('Interface + impl in same file', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const SAME_FILE = `package com.example

interface Repo {
    fun save(item: String)
    fun load(): String
}

class RepoImpl : Repo {
    override fun save(item: String) {}
    override fun load(): String = ""
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Repo.kt', SAME_FILE);
    provider = new KotlinDefinitionProvider(index);
  });

  it('Cmd+Click on interface name → jumps to impl (same file)', () => {
    const doc = mockDocument('file:///Repo.kt', SAME_FILE);
    const pos = positionOf(SAME_FILE, 'Repo');
    const result = locs(provider.provideDefinition(doc, pos));
    const implResult = result.find(l => {
      const line = SAME_FILE.split('\n')[(l.range as any).line];
      return line?.includes('RepoImpl');
    });
    expect(implResult).toBeDefined();
  });

  it('Cmd+Click on save() in interface → jumps to override (same file)', () => {
    const doc = mockDocument('file:///Repo.kt', SAME_FILE);
    const pos = positionOf(SAME_FILE, 'save'); // first occurrence = interface method
    const result = locs(provider.provideDefinition(doc, pos));
    // Should return the override, not the interface method
    expect(result.length).toBeGreaterThan(0);
    const overrideLine = (result[0].range as any).line;
    expect(SAME_FILE.split('\n')[overrideLine]).toContain('override');
  });

  it('Cmd+Click on load() in interface → jumps to override (same file)', () => {
    const doc = mockDocument('file:///Repo.kt', SAME_FILE);
    const pos = positionOf(SAME_FILE, 'load');
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result.length).toBeGreaterThan(0);
    const overrideLine = (result[0].range as any).line;
    expect(SAME_FILE.split('\n')[overrideLine]).toContain('override');
  });
});

// ── Multiple implementations of same interface ──────────────────────────────

describe('Multiple implementations', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const IFACE = `package com.example
interface Logger {
    fun log(msg: String)
}`;
  const IMPL_A = `package com.example
class ConsoleLogger : Logger {
    override fun log(msg: String) { println(msg) }
}`;
  const IMPL_B = `package com.example
class FileLogger : Logger {
    override fun log(msg: String) {}
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Logger.kt', IFACE);
    addKt(index, 'file:///ConsoleLogger.kt', IMPL_A);
    addKt(index, 'file:///FileLogger.kt', IMPL_B);
    provider = new KotlinDefinitionProvider(index);
  });

  it('interface with 2 implementations → returns both', () => {
    const doc = mockDocument('file:///Logger.kt', IFACE);
    const pos = positionOf(IFACE, 'Logger');
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result).toHaveLength(2);
    const uris = result.map(l => l.uri.toString());
    expect(uris).toContain('file:///ConsoleLogger.kt');
    expect(uris).toContain('file:///FileLogger.kt');
  });

  it('log() method → returns overrides from both impls', () => {
    const doc = mockDocument('file:///Logger.kt', IFACE);
    const pos = positionOf(IFACE, 'log');
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result).toHaveLength(2);
  });
});

// ── Sealed class subtypes ───────────────────────────────────────────────────

describe('Sealed class subtypes', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const SEALED = `package com.example

sealed class NetworkState {
    data object Loading : NetworkState()
    data class Success(val data: String) : NetworkState()
    data class Error(val message: String) : NetworkState()
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///NetworkState.kt', SEALED);
    provider = new KotlinDefinitionProvider(index);
  });

  it('Cmd+Click on sealed class → shows all subtypes', () => {
    const doc = mockDocument('file:///NetworkState.kt', SEALED);
    const pos = positionOf(SEALED, 'NetworkState');
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result).toHaveLength(3);
  });
});

// ── Nested classes ──────────────────────────────────────────────────────────

describe('Nested classes', () => {
  it('nested class gets correct FQN', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Outer.kt', `package com.example
class Outer {
    class Inner {
        class DeepNested
    }
}`);
    expect(index.lookupFqn('com.example.Outer')).toBeDefined();
    expect(index.lookupFqn('com.example.Outer.Inner')).toBeDefined();
    expect(index.lookupFqn('com.example.Outer.Inner.DeepNested')).toBeDefined();
  });
});

// ── Companion object ────────────────────────────────────────────────────────

describe('Companion object members', () => {
  it('companion member FQN is ClassName.memberName', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Factory.kt', `package com.example
class MyClass {
    companion object {
        fun create(): MyClass = MyClass()
    }
}`);
    const entry = index.lookupFqn('com.example.MyClass.create');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('fun');
  });
});

// ── Typealias follow-through ────────────────────────────────────────────────

describe('Typealias navigation', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const TYPES = `package com.example
data class UserProfile(val name: String)
typealias ProfileList = List<UserProfile>`;

  const USAGE = `package com.example
fun getProfiles(): ProfileList = emptyList()`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Types.kt', TYPES);
    addKt(index, 'file:///Usage.kt', USAGE);
    provider = new KotlinDefinitionProvider(index);
  });

  it('Cmd+Click on typealias usage → shows alias + target type', () => {
    const doc = mockDocument('file:///Usage.kt', USAGE);
    const pos = positionOf(USAGE, 'ProfileList');
    const result = locs(provider.provideDefinition(doc, pos));
    // Should return the typealias AND UserProfile
    expect(result.length).toBeGreaterThanOrEqual(2);
    const uris = result.map(l => l.uri.toString());
    expect(uris).toContain('file:///Types.kt');
  });
});

// ── Java interop ────────────────────────────────────────────────────────────

describe('Java interop', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  const JAVA_IFACE = `package com.example;
public interface Service {
    void execute();
}`;
  const KT_IMPL = `package com.example
class ServiceImpl : Service {
    override fun execute() {}
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addJava(index, 'file:///Service.java', JAVA_IFACE);
    addKt(index, 'file:///ServiceImpl.kt', KT_IMPL);
    provider = new KotlinDefinitionProvider(index);
  });

  it('Java interface → Kotlin implementation', () => {
    const impls = index.lookupImplementations('Service');
    expect(impls).toHaveLength(1);
    expect(impls[0].name).toBe('ServiceImpl');
  });

  it('Java extends supertypes are extracted', () => {
    const index2 = new SymbolIndex();
    addJava(index2, 'file:///Base.java', 'package com.example;\npublic class Base {}');
    addJava(index2, 'file:///Child.java', 'package com.example;\npublic class Child extends Base implements Runnable {}');
    const impls = index2.lookupImplementations('Base');
    expect(impls).toHaveLength(1);
    expect(impls[0].name).toBe('Child');
    const runnableImpls = index2.lookupImplementations('Runnable');
    expect(runnableImpls).toHaveLength(1);
  });
});

// ── Multi-line constructor edge cases ───────────────────────────────────────

describe('Multi-line constructor supertypes', () => {
  it('data class with 5+ params multi-line → extracts supertype', () => {
    const code = `package com.example
data class Config(
    val host: String,
    val port: Int,
    val timeout: Long,
    val retries: Int,
    val debug: Boolean,
) : Serializable {
    fun validate() {}
}`;
    const result = parse('file:///Config.kt', code);
    const config = result.symbols.find(s => s.name === 'Config');
    expect(config!.supertypes).toEqual(['Serializable']);
  });

  it('class with generics in constructor → extracts supertype', () => {
    const code = `class Adapter<T>(
    private val items: List<T>,
) : RecyclerView.Adapter<ViewHolder>() {
}`;
    const result = parse('file:///test.kt', code);
    const adapter = result.symbols.find(s => s.name === 'Adapter');
    expect(adapter!.supertypes).toBeDefined();
    expect(adapter!.supertypes).toContain('RecyclerView');
  });

  it('class without parens or supertypes → no supertypes', () => {
    const result = parse('file:///test.kt', 'class Simple');
    expect(result.symbols[0].supertypes).toBeUndefined();
  });

  it('object implementing interface', () => {
    const result = parse('file:///test.kt', 'object Singleton : MyInterface {');
    expect(result.symbols[0].supertypes).toEqual(['MyInterface']);
  });
});

// ── Parser edge cases ───────────────────────────────────────────────────────

describe('Parser edge cases', () => {
  it('private class', () => {
    const result = parse('file:///test.kt', 'private class Secret');
    expect(result.symbols[0].name).toBe('Secret');
  });

  it('abstract class', () => {
    const result = parse('file:///test.kt', 'abstract class Base');
    expect(result.symbols[0].name).toBe('Base');
    expect(result.symbols[0].kind).toBe('class');
  });

  it('inner class', () => {
    const result = parse('file:///test.kt', 'class Outer {\n    inner class Inner\n}');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('Outer');
    expect(names).toContain('Inner');
  });

  it('open class', () => {
    const result = parse('file:///test.kt', 'open class Base');
    expect(result.symbols[0].name).toBe('Base');
  });

  it('inline fun', () => {
    const result = parse('file:///test.kt', 'inline fun <reified T> convert() {}');
    expect(result.symbols[0].name).toBe('convert');
  });

  it('infix fun', () => {
    const result = parse('file:///test.kt', 'infix fun Int.plus(other: Int) = this + other');
    expect(result.symbols[0].name).toBe('plus');
  });

  it('operator fun', () => {
    const result = parse('file:///test.kt', 'operator fun get(index: Int) {}');
    expect(result.symbols[0].name).toBe('get');
  });

  it('tailrec fun', () => {
    const result = parse('file:///test.kt', 'tailrec fun factorial(n: Int, acc: Int = 1): Int = if (n <= 1) acc else factorial(n - 1, n * acc)');
    expect(result.symbols[0].name).toBe('factorial');
  });

  it('const val', () => {
    const result = parse('file:///test.kt', 'const val MAX_SIZE = 100');
    expect(result.symbols[0].name).toBe('MAX_SIZE');
    expect(result.symbols[0].kind).toBe('val');
  });

  it('lateinit var', () => {
    const result = parse('file:///test.kt', 'lateinit var name: String');
    expect(result.symbols[0].name).toBe('name');
    expect(result.symbols[0].kind).toBe('var');
  });

  it('expect/actual class', () => {
    const result = parse('file:///test.kt', 'expect class Platform');
    expect(result.symbols[0].name).toBe('Platform');
  });

  it('sealed interface', () => {
    const result = parse('file:///test.kt', 'sealed interface State');
    expect(result.symbols[0].name).toBe('State');
    expect(result.symbols[0].kind).toBe('sealedClass');
  });

  it('empty file → no symbols', () => {
    const result = parse('file:///test.kt', '');
    expect(result.symbols).toHaveLength(0);
  });

  it('only package → no symbols', () => {
    const result = parse('file:///test.kt', 'package com.example');
    expect(result.symbols).toHaveLength(0);
  });

  it('multiline block comment skipped', () => {
    const result = parse('file:///test.kt', '/*\nclass NotReal\n*/\nclass Real');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('Real');
  });

  it('string containing class keyword not indexed', () => {
    const result = parse('file:///test.kt', 'val desc = "class Fake"');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('desc');
    expect(names).not.toContain('Fake');
  });
});

// ── Index removal edge cases ────────────────────────────────────────────────

describe('Index integrity on file changes', () => {
  it('re-adding same file replaces old symbols', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');
    expect(index.lookup('Foo')).toHaveLength(1);

    // Re-add with different content
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Bar');
    expect(index.lookup('Foo')).toHaveLength(0);
    expect(index.lookup('Bar')).toHaveLength(1);
  });

  it('re-adding file updates supertypes map', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Impl.kt', 'package com.example\nclass Impl : Foo {');
    expect(index.lookupImplementations('Foo')).toHaveLength(1);

    // Change supertype
    addKt(index, 'file:///Impl.kt', 'package com.example\nclass Impl : Bar {');
    expect(index.lookupImplementations('Foo')).toHaveLength(0);
    expect(index.lookupImplementations('Bar')).toHaveLength(1);
  });

  it('clearing index empties everything', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///A.kt', 'package com.example\nclass A : B {');
    addKt(index, 'file:///B.kt', 'package com.example\ninterface B');
    index.clear();
    expect(index.lookup('A')).toHaveLength(0);
    expect(index.lookup('B')).toHaveLength(0);
    expect(index.lookupImplementations('B')).toHaveLength(0);
    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
  });
});

// ── Supertypes with where clause ────────────────────────────────────────────

describe('Supertypes with where clause', () => {
  it('stops at where keyword', () => {
    const result = parse('file:///test.kt', 'class Box<T> : Container<T> where T : Comparable<T> {');
    const box = result.symbols.find(s => s.name === 'Box');
    expect(box!.supertypes).toContain('Container');
    expect(box!.supertypes).not.toContain('Comparable');
  });
});

// ── Enum entries with complex bodies ────────────────────────────────────────

describe('Enum entries edge cases', () => {
  it('enum entries with constructor args', () => {
    const code = `enum class Planet(val mass: Double) {
    EARTH(5.97),
    MARS(0.642),
    JUPITER(1898.0);
    fun gravity() = mass * 9.8
}`;
    const result = parse('file:///test.kt', code);
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('Planet');
    expect(names).toContain('EARTH');
    expect(names).toContain('MARS');
    expect(names).toContain('JUPITER');
  });
});
