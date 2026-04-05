import { describe, it, expect } from 'vitest';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { SymbolKind, SymbolTag } from './__mocks__/vscode';

function provide(code: string, uri = 'file:///test.kt') {
  const index = new SymbolIndex();
  index.add(parse(uri, code));
  const provider = new KotlinDocumentSymbolProvider(index);
  const doc = mockDocument(uri, code);
  return provider.provideDocumentSymbols(doc, {} as any);
}

// ── Empty file ────────────────────────────────────────────────────────────────

describe('empty file', () => {
  it('returns empty array', () => {
    expect(provide('')).toEqual([]);
  });
});

// ── Root-level symbols ────────────────────────────────────────────────────────

describe('root-level symbols', () => {
  it('emits a class at the root', () => {
    const syms = provide('class Foo {}');
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Foo');
    expect(syms[0].kind).toBe(SymbolKind.Class);
  });

  it('emits a data class as Struct', () => {
    const syms = provide('data class User(val name: String)');
    expect(syms[0].kind).toBe(SymbolKind.Struct);
  });

  it('emits a sealed class as Class', () => {
    expect(provide('sealed class Result')[0].kind).toBe(SymbolKind.Class);
  });

  it('emits an interface as Interface', () => {
    expect(provide('interface Repo')[0].kind).toBe(SymbolKind.Interface);
  });

  it('emits an object as Object', () => {
    expect(provide('object Singleton')[0].kind).toBe(SymbolKind.Object);
  });

  it('emits a top-level fun as Function', () => {
    expect(provide('fun greet() {}')[0].kind).toBe(SymbolKind.Function);
  });

  it('emits a top-level val as Constant', () => {
    expect(provide('val VERSION = "1.0"')[0].kind).toBe(SymbolKind.Constant);
  });

  it('emits a top-level var as Variable', () => {
    expect(provide('var counter = 0')[0].kind).toBe(SymbolKind.Variable);
  });
});

// ── Symbol kind mapping ───────────────────────────────────────────────────────

describe('symbol kind mapping', () => {
  const CODE = `
class Foo {
    fun doWork() {}
    val name: String = ""
    private val secret: Int = 0
    var count: Int = 0
    private var mutable: Int = 0
}
enum class Color { RED, GREEN }
`.trim();

  it('member fun → Method', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.children.find(c => c.name === 'doWork')?.kind).toBe(SymbolKind.Method);
  });

  it('public member val → Property', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.children.find(c => c.name === 'name')?.kind).toBe(SymbolKind.Property);
  });

  it('private member val → Field', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.children.find(c => c.name === 'secret')?.kind).toBe(SymbolKind.Field);
  });

  it('public member var → Property', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.children.find(c => c.name === 'count')?.kind).toBe(SymbolKind.Property);
  });

  it('private member var → Field', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.children.find(c => c.name === 'mutable')?.kind).toBe(SymbolKind.Field);
  });

  it('enum class → Enum', () => {
    const syms = provide(CODE);
    expect(syms.find(s => s.name === 'Color')?.kind).toBe(SymbolKind.Enum);
  });

  it('enum entries → EnumMember nested inside Enum', () => {
    const syms = provide(CODE);
    const color = syms.find(s => s.name === 'Color')!;
    expect(color.children.find(c => c.name === 'RED')?.kind).toBe(SymbolKind.EnumMember);
    expect(color.children.find(c => c.name === 'GREEN')?.kind).toBe(SymbolKind.EnumMember);
  });
});

// ── Hierarchy (children) ──────────────────────────────────────────────────────

describe('hierarchy', () => {
  const CODE = `
class Outer {
    class Inner {
        fun method() {}
    }
    fun outerFun() {}
}
class Sibling {}
`.trim();

  it('nests Inner inside Outer', () => {
    const syms = provide(CODE);
    const outer = syms.find(s => s.name === 'Outer')!;
    expect(outer.children.map(c => c.name)).toContain('Inner');
    expect(outer.children.map(c => c.name)).toContain('outerFun');
  });

  it('nests method inside Inner', () => {
    const syms = provide(CODE);
    const inner = syms.find(s => s.name === 'Outer')!.children.find(c => c.name === 'Inner')!;
    expect(inner.children.map(c => c.name)).toContain('method');
  });

  it('Sibling is a root, not a child of Outer', () => {
    const syms = provide(CODE);
    expect(syms.map(s => s.name)).toContain('Sibling');
    const outer = syms.find(s => s.name === 'Outer')!;
    expect(outer.children.map(c => c.name)).not.toContain('Sibling');
  });
});

// ── selectionRange ────────────────────────────────────────────────────────────

describe('selectionRange', () => {
  it('covers only the symbol name', () => {
    // "class Foo {}" → name "Foo" starts at char 6
    const syms = provide('class Foo {}');
    const { selectionRange } = syms[0];
    expect(selectionRange.start.character).toBe(6); // after "class "
    expect(selectionRange.end.character).toBe(9);   // "Foo" is 3 chars
  });

  it('start and end are on the same line', () => {
    const { selectionRange } = provide('fun hello() {}')[0];
    expect(selectionRange.start.line).toBe(selectionRange.end.line);
  });
});

// ── Full body range ───────────────────────────────────────────────────────────

describe('full body range', () => {
  const CODE = [
    'class Foo {',        // line 0
    '    fun bar() {',   // line 1
    '        val x = 1', // line 2
    '    }',              // line 3
    '    fun baz() {}',  // line 4
    '}',                  // line 5
    'class Other {}',    // line 6
  ].join('\n');

  it('class range extends to the line before the next sibling', () => {
    const syms = provide(CODE);
    const foo = syms.find(s => s.name === 'Foo')!;
    expect(foo.range.start.line).toBe(0);
    expect(foo.range.end.line).toBe(5); // line before "class Other" (6)
  });

  it('method range extends to just before the next method', () => {
    const syms = provide(CODE);
    const bar = syms.find(s => s.name === 'Foo')!.children.find(c => c.name === 'bar')!;
    expect(bar.range.start.line).toBe(1);
    expect(bar.range.end.line).toBe(3); // line before "fun baz" (4)
  });

  it('last symbol range extends to the document end', () => {
    const syms = provide(CODE);
    const other = syms.find(s => s.name === 'Other')!;
    expect(other.range.end.line).toBe(6); // last line of document
  });

  it('range always starts at or before selectionRange', () => {
    const syms = provide(CODE);
    function check(s: any) {
      expect(s.range.start.line).toBeLessThanOrEqual(s.selectionRange.start.line);
      for (const c of s.children ?? []) check(c);
    }
    syms.forEach(check);
  });
});

// ── Detail field ──────────────────────────────────────────────────────────────

describe('detail field', () => {
  it('empty for plain public symbol', () => {
    expect(provide('class Foo {}')[0].detail).toBe('');
  });

  it('shows visibility', () => {
    const syms = provide('class Outer {\n    private fun secret() {}\n}');
    const secret = syms[0].children.find(c => c.name === 'secret')!;
    expect(secret.detail).toContain('private');
  });

  it('shows suspend modifier', () => {
    const syms = provide('class A {\n    suspend fun fetch() {}\n}');
    expect(syms[0].children[0].detail).toContain('suspend');
  });

  it('shows override modifier', () => {
    const syms = provide('class A {\n    override fun toString() = "A"\n}');
    expect(syms[0].children[0].detail).toContain('override');
  });

  it('shows const modifier', () => {
    const syms = provide('const val MAX = 100');
    expect(syms[0].detail).toContain('const');
  });

  it('shows multiple modifiers together', () => {
    const syms = provide('class A {\n    private suspend override fun go() {}\n}');
    const detail = syms[0].children[0].detail;
    expect(detail).toContain('private');
    expect(detail).toContain('suspend');
    expect(detail).toContain('override');
  });

  it('shows extension modifier', () => {
    const syms = provide('fun String.shout() = uppercase()');
    expect(syms[0].detail).toContain('extension');
  });
});

// ── SymbolTag.Deprecated ──────────────────────────────────────────────────────

describe('SymbolTag.Deprecated', () => {
  it('tags a @Deprecated class', () => {
    const code = '@Deprecated("old")\nclass OldApi {}';
    const syms = provide(code);
    expect(syms[0].tags).toContain(SymbolTag.Deprecated);
  });

  it('tags a @Deprecated fun', () => {
    const code = 'class A {\n    @Deprecated("use newFun")\n    fun oldFun() {}\n}';
    const syms = provide(code);
    const old = syms[0].children.find(c => c.name === 'oldFun')!;
    expect(old.tags).toContain(SymbolTag.Deprecated);
  });

  it('does not tag non-deprecated symbols', () => {
    const syms = provide('class Foo {}');
    expect(syms[0].tags).toBeUndefined();
  });

  it('tags a @Deprecated val', () => {
    const code = '@Deprecated("use newProp")\nval oldProp = 1';
    const syms = provide(code);
    expect(syms[0].tags).toContain(SymbolTag.Deprecated);
  });
});
