import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinDefinitionProvider, clearPendingDeclNav, getPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { mockDocument, positionOf } from './helpers';
import { Location } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function locs(result: any): Location[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ── BUG 1: JavaParser multiline block comments ─────────────────────────────

describe('BUG 1: JavaParser multiline block comments', () => {
  it('should NOT index class inside multiline block comment', () => {
    const code = `package com.example;
/*
 * public class NotReal {}
 */
public class Real {}`;
    const result = parseJava('file:///Test.java', code);
    const names = result.symbols.map(s => s.name);
    expect(names).not.toContain('NotReal');
    expect(names).toContain('Real');
  });
});

// ── BUG 2: countDepth counts braces in trailing comments ────────────────────

describe('BUG 2: countDepth and trailing comments', () => {
  it('trailing // comment with { should not corrupt depth', () => {
    const code = `package com.example

class Outer { // TODO: refactor {
    class Inner {
    }
}

class Next`;
    const result = parse('file:///test.kt', code);
    const outer = result.symbols.find(s => s.name === 'Outer');
    const inner = result.symbols.find(s => s.name === 'Inner');
    const next = result.symbols.find(s => s.name === 'Next');
    expect(outer!.depth).toBe(0);
    expect(inner!.depth).toBe(1);
    expect(next!.depth).toBe(0);
  });

  it('brace inside string literal should not corrupt depth', () => {
    const code = `package com.example

class MyClass {
    val json = "{ \\"key\\": \\"value\\" }"
    fun doStuff() {}
}

class NextClass`;
    const result = parse('file:///test.kt', code);
    const myClass = result.symbols.find(s => s.name === 'MyClass');
    const nextClass = result.symbols.find(s => s.name === 'NextClass');
    expect(myClass!.depth).toBe(0);
    expect(nextClass!.depth).toBe(0);
  });
});

// ── BUG 3: isAtDeclaration only checks line, not character ──────────────────

describe('BUG 3: isAtDeclaration line-only check', () => {
  it('val Foo = Foo() — clicking second Foo should go to definition, not trigger Find Usages', () => {
    const code = `package com.example
class Foo`;
    // "val Foo" declares a property named Foo on line 1, char 4
    // "Foo()" at char 12 is a constructor call — should go to class definition
    const usage = `package com.example
val Foo = Foo()`;
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', code);
    addKt(index, 'file:///usage.kt', usage);
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///usage.kt', usage);
    // Click on the SECOND Foo (the constructor call at char 10)
    const pos = positionOf(usage, 'Foo', 2);
    const result = locs(provider.provideDefinition(doc, pos));
    // Should navigate to Foo.kt (class definition)
    // NOT return self (which would mean isAtDeclaration matched the val Foo on char 4)
    expect(result.length).toBeGreaterThan(0);
    // pendingDeclNav should NOT be set (we're clicking a usage, not a declaration)
    expect(getPendingDeclNav()).toBeUndefined();
  });
});

// ── BUG 4: Java generics extracted as false supertypes ──────────────────────

describe('BUG 4: Java generic params as false supertypes', () => {
  it('extends Foo<String> should only extract Foo, not String', () => {
    const code = 'public class MyList extends ArrayList<String> {}';
    const result = parseJava('file:///test.java', code);
    const myList = result.symbols.find(s => s.name === 'MyList');
    expect(myList!.supertypes).toContain('ArrayList');
    expect(myList!.supertypes).not.toContain('String');
  });

  it('implements Comparable<Integer> should only extract Comparable', () => {
    const code = 'public class Num implements Comparable<Integer> {}';
    const result = parseJava('file:///test.java', code);
    const num = result.symbols.find(s => s.name === 'Num');
    expect(num!.supertypes).toContain('Comparable');
    expect(num!.supertypes).not.toContain('Integer');
  });
});

// ── BUG 5: _pendingDeclNav state leak ───────────────────────────────────────

describe('BUG 5: pendingDeclNav leak', () => {
  it('should clear pending state when navigating to a non-declaration', () => {
    const iface = `package com.example
interface Repo {
    fun save()
}`;
    const impl = `package com.example
class RepoImpl : Repo {
    override fun save() {}
}`;
    const usage = `package com.example
fun main() {
    val repo = RepoImpl()
}`;

    const index = new SymbolIndex();
    addKt(index, 'file:///Repo.kt', iface);
    addKt(index, 'file:///RepoImpl.kt', impl);
    addKt(index, 'file:///main.kt', usage);
    const provider = new KotlinDefinitionProvider(index);

    // First: click on interface declaration → sets pending
    const doc1 = mockDocument('file:///Repo.kt', iface);
    provider.provideDefinition(doc1, positionOf(iface, 'Repo'));
    // pending should be set (interface has implementation, so it returns impls, not pending)
    // Actually for Repo → it has implementation, so it returns impl locations directly
    // Let's use a class with no implementations instead
    clearPendingDeclNav();

    const noImpl = `package com.example
class Standalone {
    fun doWork() {}
}`;
    addKt(index, 'file:///Standalone.kt', noImpl);
    const doc2 = mockDocument('file:///Standalone.kt', noImpl);
    provider.provideDefinition(doc2, positionOf(noImpl, 'Standalone'));
    expect(getPendingDeclNav()).toBeDefined(); // pending is set

    // Now: click on a usage (non-declaration) → pending should be cleared
    const doc3 = mockDocument('file:///main.kt', usage);
    provider.provideDefinition(doc3, positionOf(usage, 'RepoImpl'));
    expect(getPendingDeclNav()).toBeUndefined(); // should be cleared
  });
});
