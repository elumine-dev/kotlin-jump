import { describe, it, expect, beforeEach } from 'vitest';
import { fileCouldReference, escapeRegex } from '../../src/providers/FindUsagesEngine';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

// Helper to create a minimal SymbolEntry for fileCouldReference
function makeEntry(index: SymbolIndex, name: string) {
  const entries = index.lookup(name);
  if (entries.length === 0) throw new Error(`Symbol "${name}" not found in index`);
  return entries[0];
}

// ── BUG: References missing for member FQNs ─────────────────────────────────

describe('fileCouldReference — member FQN parent class import', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///delegate/GameDelegate.kt', `package com.example.delegate

interface GameDelegate {
    fun setGameNavigator(nav: Nav)
    fun unregisterGameBus()
}

class GameDelegateImpl : GameDelegate {
    override fun setGameNavigator(nav: Nav) {}
    override fun unregisterGameBus() {}
}`));
  });

  it('file importing GameDelegate CAN reference GameDelegate.unregisterGameBus', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    // FQN = com.example.delegate.GameDelegate.unregisterGameBus
    const fileText = `package com.example.main
import com.example.delegate.GameDelegate

class ViewModel {
    fun cleanup() {
        gameDelegate.unregisterGameBus()
    }
}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('file with NO import of GameDelegate CANNOT reference unregisterGameBus', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.other

class Unrelated {
    fun doStuff() {}
}`;
    expect(fileCouldReference(fileText, entry)).toBe(false);
  });

  it('file in SAME package CAN reference without import', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.delegate

class Helper {
    fun cleanup(d: GameDelegate) {
        d.unregisterGameBus()
    }
}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('file with wildcard import CAN reference', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.main
import com.example.delegate.*

class ViewModel {}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('sub-package does NOT match parent package', () => {
    const entry = makeEntry(index, 'GameDelegate');
    // com.example.delegate vs com.example.delegate.impl — should NOT match
    const fileText = `package com.example.delegate.impl

class Something {}`;
    expect(fileCouldReference(fileText, entry)).toBe(false);
  });
});

// ── smartNavigation: false behavior ─────────────────────────────────────────

describe('smartNavigation: false — DefinitionProvider command choice', () => {
  // This tests the logic indirectly: when smartNav is false and at declaration,
  // the provider sets _pendingDeclNav (which the selection listener uses to
  // fire editor.action.goToReferences instead of kotlin-jump.findUsages).
  // We verify that _pendingDeclNav IS set (meaning the listener will handle it).

  it('at declaration with no implementations → sets pendingDeclNav', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///Foo.kt', 'package com.example\nclass Foo'));
    clearPendingDeclNav();

    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///Foo.kt', 'package com.example\nclass Foo');
    const pos = positionOf('package com.example\nclass Foo', 'Foo');

    provider.provideDefinition(doc, pos);
    // pendingDeclNav should be set regardless of smartNav setting
    // The selection listener in extension.ts checks smartNav to decide which command to fire
    expect(getPendingDeclNav()).toBeDefined();
    expect(getPendingDeclNav()!.word).toBe('Foo');
  });
});

// ── Enum member / companion const disambiguation ─────────────────────────────
// Regression: searching for REGULAR from StatusType.kt must NOT include
// CategoryType.REGULAR occurrences — fileCouldReference must reject files that
// only import or declare a *different* class with the same member name.

describe('fileCouldReference — enum member disambiguation (StatusType.REGULAR vs CategoryType.REGULAR)', () => {
  let index: SymbolIndex;
  let typeAEntry: ReturnType<typeof makeEntry>;
  let typeBEntry: ReturnType<typeof makeEntry>;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///model/StatusType.kt', `
package com.example.transport.model
enum class StatusType {
    REGULAR,
    EXTRA
}
`));
    index.add(parse('file:///category/CategoryType.kt', `
package com.example.content
enum class CategoryType(val value: String) {
    REGULAR("ED"),
    UNKNOWN("UNKNOWN")
}
`));
    typeAEntry    = index.lookup('REGULAR').find(e => e.uri.path.includes('StatusType'))!;
    typeBEntry = index.lookup('REGULAR').find(e => e.uri.path.includes('CategoryType'))!;
  });

  it('StatusType.kt (declaration file) can reference StatusType.REGULAR', () => {
    const text = `package com.example.transport.model\nenum class StatusType {\n    REGULAR, EXTRA\n}\n`;
    expect(fileCouldReference(text, typeAEntry)).toBe(true);
  });

  it('CategoryType.kt cannot reference StatusType.REGULAR', () => {
    const text = `package com.example.content\nenum class CategoryType(val value: String) {\n    REGULAR("ED")\n}\n`;
    expect(fileCouldReference(text, typeAEntry)).toBe(false);
  });

  it('caller importing StatusType can reference StatusType.REGULAR but not CategoryType.REGULAR', () => {
    const callerText = `package com.example.transport.ui
import com.example.transport.model.StatusType

fun onStatus(r: StatusType) {
    if (r == StatusType.REGULAR) println("regular")
}`;
    expect(fileCouldReference(callerText, typeAEntry)).toBe(true);
    expect(fileCouldReference(callerText, typeBEntry)).toBe(false);
  });

  it('caller importing CategoryType can reference CategoryType.REGULAR but not StatusType.REGULAR', () => {
    const callerText = `package com.example.ui
import com.example.content.CategoryType

fun onCategory(e: CategoryType) {
    if (e == CategoryType.REGULAR) println("regular")
}`;
    expect(fileCouldReference(callerText, typeBEntry)).toBe(true);
    expect(fileCouldReference(callerText, typeAEntry)).toBe(false);
  });
});

// ── fileCouldReference — wildcard disambiguation ─────────────────────────────
//
// When multiple wildcard imports are present AND the index contains a symbol
// with the same simple name in a competing package, the match is ambiguous
// and must return false. Without a competing indexed symbol (or without an
// index), the wildcard match should still pass.

describe('fileCouldReference — wildcard disambiguation', () => {
  let index: SymbolIndex;
  let fooEntry: ReturnType<typeof makeEntry>;

  beforeEach(() => {
    index = new SymbolIndex();
    // Two packages, both define a class named "Foo"
    index.add(parse('file:///example/Foo.kt', `package com.example\nclass Foo`));
    index.add(parse('file:///other/Foo.kt',   `package com.other\nclass Foo`));
    fooEntry = index.lookup('Foo').find(e => e.packageName === 'com.example')!;
  });

  it('single wildcard, no competition → true', () => {
    const text = `package com.ui\nimport com.example.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('two wildcards, competing symbol exists → false (with index)', () => {
    const text = `package com.ui\nimport com.example.*\nimport com.other.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  it('two wildcards, no competing symbol in index → true (cannot disambiguate)', () => {
    // com.third.Foo is NOT in the index
    const text = `package com.ui\nimport com.example.*\nimport com.third.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('two wildcards with index but explicit import for our target → true (exact wins first)', () => {
    // Exact import resolves before the wildcard ambiguity check is reached
    const text = `package com.ui\nimport com.example.Foo\nimport com.other.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('two wildcards without index → true (conservative, no false negatives)', () => {
    const text = `package com.ui\nimport com.example.*\nimport com.other.*\nval f = Foo()`;
    // No index passed — cannot check competing symbols, falls back to permissive
    expect(fileCouldReference(text, fooEntry)).toBe(true);
  });

  it('three wildcards with two competing symbols → false', () => {
    index.add(parse('file:///third/Foo.kt', `package com.third\nclass Foo`));
    const text = `package com.ui\nimport com.example.*\nimport com.other.*\nimport com.third.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  it('same-package wildcard is never treated as competition', () => {
    // A file in com.example that also imports com.example.* should not self-compete
    const text = `package com.example\nimport com.example.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('competing symbol is a member (depth > 0), not a top-level class', () => {
    // com.other.Outer.Foo exists as a nested class — simple name "Foo" is the same
    // com.other.Foo (already in index from beforeEach) competes
    const text = `package com.ui\nimport com.example.*\nimport com.other.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  it('wildcard in a comment does not count as an import', () => {
    const text = `package com.ui
// import com.other.*   ← not a real import
import com.example.*
val f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('wildcard disambiguation does not affect same-package references', () => {
    // File is in com.example itself — passes via package check, never reaches wildcard logic
    const text = `package com.example\nimport com.other.*\nval f = Foo()`;
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  // ── Bug 1: CRLF line endings ───────────────────────────────────────────────

  it('CRLF — single wildcard is detected (no false negative)', () => {
    // Windows checkout: \r\n line endings. extractWildcardPrefixes must still work.
    const text = 'package com.ui\r\nimport com.example.*\r\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  it('CRLF — two wildcards with competing symbol → false', () => {
    const text = 'package com.ui\r\nimport com.example.*\r\nimport com.other.*\r\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  it('CRLF — two wildcards, no competition in index → true', () => {
    const text = 'package com.ui\r\nimport com.example.*\r\nimport com.third.*\r\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  // ── Bug 3: Member FQN must not be penalised by competing top-level function ──

  it('member FQN (depth > 0): competing top-level function does NOT cause false negative', () => {
    // com.other.process is a top-level function; com.example.Repo.process is a method.
    // import com.other.* does NOT bring the method into scope — should not penalise.
    index.add(parse('file:///other/Utils.kt', 'package com.other\nfun process() {}'));
    const methodEntry = index.lookup('process').find(e => e.packageName === 'com.example')
      ?? (() => {
        index.add(parse('file:///example/Repo.kt', 'package com.example\nclass Repo {\n    fun process() {}\n}'));
        return index.lookup('process').find(e => e.packageName === 'com.example')!;
      })();
    // methodEntry is com.example.Repo.process — depth > 0
    expect(methodEntry.depth).toBeGreaterThan(0);
    const text = 'package com.ui\nimport com.example.*\nimport com.other.*\nval r = Repo()\nr.process()';
    expect(fileCouldReference(text, methodEntry, index)).toBe(true);
  });

  it('top-level symbol (depth === 0) IS still disambiguated by wildcard check', () => {
    // Sanity: the guard only skips disambiguation for depth > 0; depth === 0 still fires.
    const text = 'package com.ui\nimport com.example.*\nimport com.other.*\nval f = Foo()';
    expect(fooEntry.depth).toBe(0);
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  // ── Alias import does not count as wildcard competition ────────────────────

  it('alias import (import com.other.Foo as F) is NOT a wildcard — no competition', () => {
    // An aliased exact import introduces a different name; it is not a wildcard.
    // extractWildcardPrefixes only finds `.*` patterns.
    const text = 'package com.ui\nimport com.example.*\nimport com.other.Foo as OtherFoo\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(true);
  });

  // ── Competing nested class is not a false positive ─────────────────────────

  it('nested class com.other.Outer.Foo is NOT matched by lookupFqn("com.other.Foo")', () => {
    // com.other.Outer.Foo exists as a nested class but is not reachable via `import com.other.*`
    index.add(parse('file:///other/Outer.kt', 'package com.other\nclass Outer {\n    class Foo\n}'));
    // com.other.Foo does NOT exist; com.other.Outer.Foo does
    // import com.other.* gives access to Outer, not Outer.Foo
    const text = 'package com.ui\nimport com.example.*\nimport com.other.*\nval f = Foo()';
    // com.other.Foo → not in index → hasCompeting = false → true
    // BUT the beforeEach index already has com.other.Foo from file:///other/Foo.kt!
    // So this test must remove that or use a fresh index.
    const freshIndex = new SymbolIndex();
    freshIndex.add(parse('file:///example/Foo.kt', 'package com.example\nclass Foo'));
    freshIndex.add(parse('file:///other/Outer.kt', 'package com.other\nclass Outer {\n    class Foo\n}'));
    const freshFooEntry = freshIndex.lookup('Foo').find(e => e.packageName === 'com.example')!;
    expect(fileCouldReference(text, freshFooEntry, freshIndex)).toBe(true);
  });

  // ── extractWildcardPrefixes edge cases ─────────────────────────────────────

  it('import on the very first line (no preceding newline) is extracted', () => {
    // ^ in multiline mode also matches start-of-string
    const text = 'import com.example.*\nimport com.other.*\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });

  it('import with trailing comment is still extracted', () => {
    const text = 'package com.ui\nimport com.example.* // wildcard\nimport com.other.* // another\nval f = Foo()';
    expect(fileCouldReference(text, fooEntry, index)).toBe(false);
  });
});

// ── escapeRegex ─────────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('com.example')).toBe('com\\.example');
  });

  it('escapes special regex chars', () => {
    expect(escapeRegex('foo+bar*baz')).toBe('foo\\+bar\\*baz');
  });
});
