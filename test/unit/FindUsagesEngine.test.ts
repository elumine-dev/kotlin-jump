import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileCouldReference, escapeRegex, resolveSearchTarget, scanForUsages } from '../../src/providers/FindUsagesEngine';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { workspace } from './__mocks__/vscode';
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

// ── resolveSearchTarget — same-file tiebreak ─────────────────────────────────
//
// Regression suite for the "clickStream" pattern: two classes in the same
// package each declare a `private val clickStream`. Without the same-file
// tiebreak, resolveSearchTarget returns undefined (ambiguous), which prevents
// the private-only restriction from kicking in.

describe('resolveSearchTarget — same-file tiebreak (clickStream pattern)', () => {
  const URI_A = 'file:///vm/LoginViewModel.kt';
  const URI_B = 'file:///vm/ProfileViewModel.kt';
  const URI_C = 'file:///other/SomeConsumer.kt';
  const PKG   = 'com.example.vm';

  const CODE_A = `package ${PKG}
class LoginViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
    fun login() { clickStream.tryEmit(Unit) }
}`;
  const CODE_B = `package ${PKG}
class ProfileViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
    fun profile() { clickStream.tryEmit(Unit) }
}`;

  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI_A, CODE_A));
    index.add(parse(URI_B, CODE_B));
  });

  it('cursor in file A → resolves to LoginViewModel.clickStream', () => {
    const doc = mockDocument(URI_A, CODE_A);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_A);
  });

  it('cursor in file B → resolves to ProfileViewModel.clickStream', () => {
    const doc = mockDocument(URI_B, CODE_B);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_B);
  });

  it('cursor in file C (different package, no import) → undefined (both unreachable)', () => {
    // Neither private symbol can be referenced from a different package.
    // fileCouldReference returns false for both → candidates.length = 0 → undefined.
    const doc = mockDocument(URI_C, `package com.example.other\nclass SomeConsumer`);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result).toBeUndefined();
  });

  it('only one declaration exists → resolves directly without tiebreak', () => {
    const freshIndex = new SymbolIndex();
    freshIndex.add(parse(URI_A, CODE_A));
    const doc = mockDocument(URI_A, CODE_A);
    const result = resolveSearchTarget('clickStream', doc, freshIndex);
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_A);
  });

  it('non-existent word → undefined', () => {
    const doc = mockDocument(URI_A, CODE_A);
    expect(resolveSearchTarget('nonExistentSymbol', doc, index)).toBeUndefined();
  });

  it('resolved entry from file A has isPrivate=true', () => {
    const doc = mockDocument(URI_A, CODE_A);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result?.isPrivate).toBe(true);
  });

  it('resolved entry from file B has isPrivate=true', () => {
    const doc = mockDocument(URI_B, CODE_B);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result?.isPrivate).toBe(true);
  });

  it('three-way same-package collision: tiebreak picks the declaring file', () => {
    const URI_C2 = 'file:///vm/SettingsViewModel.kt';
    const CODE_C2 = `package ${PKG}
class SettingsViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
}`;
    index.add(parse(URI_C2, CODE_C2));
    // Cursor in URI_C2 → should tiebreak to SettingsViewModel
    const doc = mockDocument(URI_C2, CODE_C2);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_C2);
  });

  it('four-way same-package collision: tiebreak still picks the exact declaring file', () => {
    const URI_D = 'file:///vm/SettingsViewModel.kt';
    const URI_E = 'file:///vm/SearchViewModel.kt';
    const CODE_D = `package ${PKG}\nclass SettingsViewModel {\n    private val clickStream = MutableSharedFlow<Unit>()\n}`;
    const CODE_E = `package ${PKG}\nclass SearchViewModel {\n    private val clickStream = MutableSharedFlow<Unit>()\n}`;
    index.add(parse(URI_D, CODE_D));
    index.add(parse(URI_E, CODE_E));
    // Now 4 same-package clickStream symbols. Cursor in URI_D → should pick URI_D.
    const doc = mockDocument(URI_D, CODE_D);
    const result = resolveSearchTarget('clickStream', doc, index);
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_D);
  });

  it('public symbol with same name → NOT tiebroken, resolved via explicit import', () => {
    const URI_PUB = 'file:///shared/EventBus.kt';
    index.add(parse(URI_PUB, `package com.example.shared
class EventBus {
    val clickStream = MutableSharedFlow<Unit>()
}`));
    // A consumer that imports EventBus explicitly
    const consumerCode = `package com.example.consumer
import com.example.shared.EventBus
class Consumer {
    val bus = EventBus()
    fun listen() = bus.clickStream
}`;
    const doc = mockDocument(URI_C, consumerCode);
    const result = resolveSearchTarget('clickStream', doc, index);
    // fileCouldReference: consumer imports EventBus → can reference EventBus.clickStream
    //                     consumer in different pkg, no import of LoginVM/ProfileVM → cannot reference those
    // candidates.length === 1 → EventBus.clickStream
    expect(result).toBeDefined();
    expect(result!.uri.toString()).toBe(URI_PUB);
    expect(result!.isPrivate).toBeFalsy();
  });
});

// ── resolveSearchTarget — isPrivate flag verification ────────────────────────

describe('resolveSearchTarget — isPrivate flag is correctly propagated from parser', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///Vm.kt', `package com.example
class ViewModel {
    private val secret = "hidden"
    internal val config = "cfg"
    val publicProp = "visible"
    private var mutable = 0
    private fun helper() {}
    fun publicFun() {}
}`));
  });

  function resolveFrom(word: string) {
    const doc = mockDocument('file:///Vm.kt', 'package com.example\nclass ViewModel');
    return resolveSearchTarget(word, doc, index);
  }

  it('private val → isPrivate=true', () => {
    expect(resolveFrom('secret')?.isPrivate).toBe(true);
  });

  it('internal val → isPrivate is NOT true', () => {
    expect(resolveFrom('config')?.isPrivate).toBeFalsy();
  });

  it('public val → isPrivate is NOT true', () => {
    expect(resolveFrom('publicProp')?.isPrivate).toBeFalsy();
  });

  it('private var → isPrivate=true', () => {
    expect(resolveFrom('mutable')?.isPrivate).toBe(true);
  });

  it('private fun → isPrivate=true', () => {
    expect(resolveFrom('helper')?.isPrivate).toBe(true);
  });

  it('public fun → isPrivate is NOT true', () => {
    expect(resolveFrom('publicFun')?.isPrivate).toBeFalsy();
  });
});

// ── scanForUsages — private symbol restriction ────────────────────────────────
//
// Core regression: `private val clickStream` in LoginViewModel should produce
// results ONLY from its declaring file, even when 100 other files are passed in.

describe('scanForUsages — private symbol restriction', () => {
  const URI_A = 'file:///vm/LoginViewModel.kt';
  const URI_B = 'file:///vm/ProfileViewModel.kt';
  const URI_C = 'file:///vm/SettingsViewModel.kt';
  const PKG   = 'com.example.vm';

  const CODE_A = `package ${PKG}
class LoginViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
    fun login() { clickStream.tryEmit(Unit) }
}`;
  const CODE_B = `package ${PKG}
class ProfileViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
    fun profile() { clickStream.tryEmit(Unit) }
}`;
  const CODE_C = `package ${PKG}
class SettingsViewModel {
    private val clickStream = MutableSharedFlow<Unit>()
    fun settings() { clickStream.tryEmit(Unit) }
}`;

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  const codeMap: Record<string, string> = {
    [URI_A]: CODE_A,
    [URI_B]: CODE_B,
    [URI_C]: CODE_C,
  };

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(URI_A, CODE_A));
    index.add(parse(URI_B, CODE_B));
    index.add(parse(URI_C, CODE_C));
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return Buffer.from(codeMap[s] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
  });

  it('from file A: results are ONLY from file A', async () => {
    const doc = mockDocument(URI_A, CODE_A);
    const results = await scanForUsages('clickStream', doc, index, [URI_A, URI_B, URI_C], token as any);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.uriString === URI_A)).toBe(true);
  });

  it('from file B: results are ONLY from file B', async () => {
    const doc = mockDocument(URI_B, CODE_B);
    const results = await scanForUsages('clickStream', doc, index, [URI_A, URI_B, URI_C], token as any);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.uriString === URI_B)).toBe(true);
  });

  it('from file C: results are ONLY from file C', async () => {
    const doc = mockDocument(URI_C, CODE_C);
    const results = await scanForUsages('clickStream', doc, index, [URI_A, URI_B, URI_C], token as any);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.uriString === URI_C)).toBe(true);
  });

  it('file A results include declaration line AND usage inside login()', async () => {
    const doc = mockDocument(URI_A, CODE_A);
    const results = await scanForUsages('clickStream', doc, index, [URI_A, URI_B, URI_C], token as any);
    // Expect at least 2: the `val clickStream = ...` declaration and `clickStream.tryEmit` usage
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('false-positive guard: file B clickStream usages are NOT in file A search results', async () => {
    const doc = mockDocument(URI_A, CODE_A);
    const results = await scanForUsages('clickStream', doc, index, [URI_A, URI_B, URI_C], token as any);
    const uris = results.map(r => r.uriString);
    expect(uris).not.toContain(URI_B);
    expect(uris).not.toContain(URI_C);
  });

  it('extra unrelated URIs in the list are all skipped for private symbols', async () => {
    const URI_UNRELATED1 = 'file:///unrelated/Activity.kt';
    const URI_UNRELATED2 = 'file:///unrelated/Fragment.kt';
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      const extra = `package com.example.unrelated\nclass X { val clickStream = 1 }`;
      return Buffer.from(codeMap[s] ?? extra) as any;
    };
    const doc = mockDocument(URI_A, CODE_A);
    const allUris = [URI_A, URI_B, URI_C, URI_UNRELATED1, URI_UNRELATED2];
    const results = await scanForUsages('clickStream', doc, index, allUris, token as any);
    const uris = new Set(results.map(r => r.uriString));
    expect(uris.has(URI_A)).toBe(true);
    expect(uris.has(URI_UNRELATED1)).toBe(false);
    expect(uris.has(URI_UNRELATED2)).toBe(false);
  });
});

// ── scanForUsages — non-private and internal symbols are NOT restricted ───────

describe('scanForUsages — non-private symbols scan all files', () => {
  const URI_DEF  = 'file:///lib/Repository.kt';
  const URI_USE1 = 'file:///ui/HomeScreen.kt';
  const URI_USE2 = 'file:///ui/DetailScreen.kt';

  const CODE_DEF  = `package com.example.lib
class Repository {
    fun loadData(): List<String> = emptyList()
}`;
  const CODE_USE1 = `package com.example.ui
import com.example.lib.Repository
class HomeScreen {
    fun show() { Repository().loadData() }
}`;
  const CODE_USE2 = `package com.example.ui
import com.example.lib.Repository
class DetailScreen {
    fun show() { Repository().loadData() }
}`;

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  const codeMap: Record<string, string> = {
    [URI_DEF]:  CODE_DEF,
    [URI_USE1]: CODE_USE1,
    [URI_USE2]: CODE_USE2,
  };

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(URI_DEF,  CODE_DEF));
    index.add(parse(URI_USE1, CODE_USE1));
    index.add(parse(URI_USE2, CODE_USE2));
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return Buffer.from(codeMap[s] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
  });

  it('public fun loadData is found in all files that reference it', async () => {
    const doc = mockDocument(URI_DEF, CODE_DEF);
    const results = await scanForUsages('loadData', doc, index, [URI_DEF, URI_USE1, URI_USE2], token as any);
    const uris = new Set(results.map(r => r.uriString));
    // URI_USE1 and URI_USE2 both call loadData()
    expect(uris.has(URI_USE1)).toBe(true);
    expect(uris.has(URI_USE2)).toBe(true);
  });

  it('public symbol: target.isPrivate is falsy', () => {
    const entries = index.lookup('loadData');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].isPrivate).toBeFalsy();
  });
});

describe('scanForUsages — internal modifier does NOT restrict to declaring file', () => {
  const URI_DEF = 'file:///module/Config.kt';
  const URI_USE = 'file:///module/Consumer.kt';
  const PKG     = 'com.example.module';

  const CODE_DEF = `package ${PKG}
class Config {
    internal val apiKey = "key"
}`;
  const CODE_USE = `package ${PKG}
class Consumer {
    val key = Config().apiKey
}`;

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(URI_DEF, CODE_DEF));
    index.add(parse(URI_USE, CODE_USE));
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_DEF) return Buffer.from(CODE_DEF) as any;
      if (s === URI_USE) return Buffer.from(CODE_USE) as any;
      return Buffer.from('') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
  });

  it('internal val → isPrivate is NOT set in index', () => {
    const entries = index.lookup('apiKey');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].isPrivate).toBeFalsy();
  });

  it('internal val → consumer file IS scanned (not restricted)', async () => {
    const doc = mockDocument(URI_DEF, CODE_DEF);
    const results = await scanForUsages('apiKey', doc, index, [URI_DEF, URI_USE], token as any);
    const uris = new Set(results.map(r => r.uriString));
    expect(uris.has(URI_USE)).toBe(true);
  });
});
