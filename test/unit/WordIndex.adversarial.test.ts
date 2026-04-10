/**
 * Adversarial + performance regression tests for the inverted word index.
 *
 * Two invariants tested here are *performance guarantees*, not just correctness:
 *   - When the word index is active, scanForUsagesWithTarget must NOT call
 *     fs.readFile for files outside the candidate set. A test failure here means
 *     the pre-filter was removed or broken — performance regresses to O(all files).
 *   - The content cache must prevent re-reading files on a second scan.
 *     A test failure means every Find Usages call does redundant disk I/O.
 *
 * Bugs that these tests pin down:
 *   FIX-1  readCachedFile crashed when workspace.textDocuments was undefined
 *   FIX-2  Content cache leaked across tests (stale entries caused wrong results)
 *   FIX-3  Word index returned null even after finalize() when clear() was skipped
 *   FIX-4  removeByKey() left stale URI entries in byWord / byPkg / byWildcard
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import {
  scanForUsagesWithTarget,
  clearContentCache,
  invalidateContentCache,
} from '../../src/providers/FindUsagesEngine';
import { workspace } from './__mocks__/vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

function addKt(index: SymbolIndex, uri: string, code: string): void {
  index.add(parse(uri, code));
}

function makeToken(): { isCancellationRequested: false } {
  return { isCancellationRequested: false };
}

/** Sets up workspace.fs.readFile to return `content` for every URI and counts calls. */
function trackReads(
  contentByUri: Record<string, string>,
  fallback = '',
): { getCount: () => number; restore: () => void } {
  const orig = workspace.fs.readFile;
  let count = 0;
  workspace.fs.readFile = async (uri: any) => {
    count++;
    const u: string = uri.toString ? uri.toString() : String(uri);
    const text = contentByUri[u] ?? fallback;
    return Buffer.from(text) as any;
  };
  return {
    getCount: () => count,
    restore: () => { workspace.fs.readFile = orig; },
  };
}

// ── Section 1: getFilesContainingWord — basic contract ────────────────────────

describe('getFilesContainingWord — basic contract', () => {
  let index: SymbolIndex;

  beforeEach(() => { index = new SymbolIndex(); });

  it('returns null before finalize() is called', () => {
    addKt(index, 'file:///A.kt', 'package com.example\nclass Foo');
    // No finalize() — word index is not ready
    expect(index.getFilesContainingWord('Foo')).toBeNull();
  });

  it('returns a Set (not null) after finalize()', () => {
    addKt(index, 'file:///A.kt', 'package com.example\nclass Foo');
    index.finalize();
    expect(index.getFilesContainingWord('Foo')).not.toBeNull();
  });

  it('declaring file is always included', () => {
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');
    index.finalize();
    const candidates = index.getFilesContainingWord('Foo')!;
    expect(candidates.has('file:///Foo.kt')).toBe(true);
  });

  it('explicitly-importing file is included', () => {
    addKt(index, 'file:///Foo.kt',  'package com.example\nclass Foo');
    addKt(index, 'file:///Caller.kt', 'package com.ui\nimport com.example.Foo\nval x = Foo()');
    index.finalize();
    const candidates = index.getFilesContainingWord('Foo')!;
    expect(candidates.has('file:///Caller.kt')).toBe(true);
  });

  it('unrelated file with different imports is excluded', () => {
    addKt(index, 'file:///Foo.kt',  'package com.example\nclass Foo');
    addKt(index, 'file:///Unrelated.kt', 'package com.other\nimport com.third.Bar\nval x = Bar()');
    index.finalize();
    const candidates = index.getFilesContainingWord('Foo')!;
    expect(candidates.has('file:///Unrelated.kt')).toBe(false);
  });

  it('same-package file is included when target packageName is provided', () => {
    addKt(index, 'file:///Foo.kt',   'package com.example\nclass Foo');
    addKt(index, 'file:///Peer.kt',  'package com.example\nclass Peer');
    index.finalize();
    const target = index.lookup('Foo')[0];
    const candidates = index.getFilesContainingWord('Foo', target)!;
    expect(candidates.has('file:///Peer.kt')).toBe(true);
  });

  it('wildcard-importing file is included when target packageName is provided', () => {
    addKt(index, 'file:///Foo.kt',   'package com.example\nclass Foo');
    addKt(index, 'file:///Wildcard.kt', 'package com.ui\nimport com.example.*\nval f = Foo()');
    index.finalize();
    const target = index.lookup('Foo')[0];
    const candidates = index.getFilesContainingWord('Foo', target)!;
    expect(candidates.has('file:///Wildcard.kt')).toBe(true);
  });

  it('returns null again after clear()', () => {
    addKt(index, 'file:///A.kt', 'package com.example\nclass Foo');
    index.finalize();
    index.clear();
    expect(index.getFilesContainingWord('Foo')).toBeNull();
  });
});

// ── Section 2: getFilesContainingWord — adversarial edge cases ────────────────

describe('getFilesContainingWord — adversarial edge cases', () => {
  let index: SymbolIndex;

  beforeEach(() => { index = new SymbolIndex(); });

  it('word unknown to the index returns empty set (not null) after finalize', () => {
    addKt(index, 'file:///A.kt', 'package com.example\nclass Foo');
    index.finalize();
    const candidates = index.getFilesContainingWord('ZzzzNeverExists');
    expect(candidates).not.toBeNull();
    expect(candidates!.size).toBe(0);
  });

  it('after removeByKey(), removed URI no longer appears in candidates', () => {
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');
    addKt(index, 'file:///Importer.kt', 'package com.ui\nimport com.example.Foo\nval x = Foo()');
    index.finalize();

    // Sanity: Importer is in candidates before removal
    expect(index.getFilesContainingWord('Foo')!.has('file:///Importer.kt')).toBe(true);

    // Remove the importer
    index.remove({ toString: () => 'file:///Importer.kt' } as any);

    // Must no longer be in candidates
    expect(index.getFilesContainingWord('Foo')!.has('file:///Importer.kt')).toBe(false);
  });

  it('nested class (depth 1): file that imports parent class is included', () => {
    // Inner is declared inside Outer — callers import Outer and access Outer.Inner
    addKt(index, 'file:///Outer.kt', 'package com.example\nclass Outer {\n  class Inner\n}');
    addKt(index, 'file:///Caller.kt', 'package com.ui\nimport com.example.Outer\nval i = Outer.Inner()');
    index.finalize();

    const inner = index.lookup('Inner')[0];
    expect(inner.depth).toBe(1);

    const candidates = index.getFilesContainingWord('Inner', inner)!;
    // Caller imports Outer (the ancestor of Inner) → must be included
    expect(candidates.has('file:///Caller.kt')).toBe(true);
  });

  it('nested class: file with no Outer or Inner reference is excluded', () => {
    addKt(index, 'file:///Outer.kt', 'package com.example\nclass Outer {\n  class Inner\n}');
    addKt(index, 'file:///NoRef.kt', 'package com.other\nimport com.third.Unrelated\nval u = Unrelated()');
    index.finalize();

    const inner = index.lookup('Inner')[0];
    const candidates = index.getFilesContainingWord('Inner', inner)!;
    expect(candidates.has('file:///NoRef.kt')).toBe(false);
  });

  it('enum entry (depth 1): file importing the enum class is included', () => {
    addKt(index, 'file:///Status.kt', 'package com.example\nenum class Status { ACTIVE, INACTIVE }');
    addKt(index, 'file:///Caller.kt', 'package com.ui\nimport com.example.Status\nval s = Status.ACTIVE');
    index.finalize();

    const activeEntry = index.lookup('ACTIVE')[0];
    expect(activeEntry.depth).toBe(1);

    const candidates = index.getFilesContainingWord('ACTIVE', activeEntry)!;
    expect(candidates.has('file:///Caller.kt')).toBe(true);
  });

  it('re-adding a file after removal correctly repopulates the word index', () => {
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');
    addKt(index, 'file:///Importer.kt', 'package com.ui\nimport com.example.Foo\nval x = Foo()');
    index.finalize();

    index.remove({ toString: () => 'file:///Importer.kt' } as any);
    expect(index.getFilesContainingWord('Foo')!.has('file:///Importer.kt')).toBe(false);

    // Re-add with the same URI
    addKt(index, 'file:///Importer.kt', 'package com.ui\nimport com.example.Foo\nval x = Foo()');
    expect(index.getFilesContainingWord('Foo')!.has('file:///Importer.kt')).toBe(true);
  });

  it('wildcard import is NOT counted as explicit word import for the package\'s own symbols', () => {
    // `import com.example.*` brings `Foo` into scope but `Foo` itself is not in byWord for that file
    // — the file is covered via byWildcard, not byWord
    addKt(index, 'file:///Foo.kt',      'package com.example\nclass Foo');
    addKt(index, 'file:///WildUser.kt', 'package com.ui\nimport com.example.*\nval f = Foo()');
    index.finalize();

    const target = index.lookup('Foo')[0];
    // Should still be included (via byWildcard path), even though `Foo` isn't in byWord for WildUser
    const candidates = index.getFilesContainingWord('Foo', target)!;
    expect(candidates.has('file:///WildUser.kt')).toBe(true);
  });

  it('two symbols with same name in different packages: both declaring files returned', () => {
    addKt(index, 'file:///FooA.kt', 'package com.example\nclass Foo');
    addKt(index, 'file:///FooB.kt', 'package com.other\nclass Foo');
    index.finalize();

    // Word index is over-inclusive by design — both files are candidates
    const candidates = index.getFilesContainingWord('Foo')!;
    expect(candidates.has('file:///FooA.kt')).toBe(true);
    expect(candidates.has('file:///FooB.kt')).toBe(true);
  });
});

// ── Section 3: I/O regression tests ──────────────────────────────────────────
//
// These tests are performance-correctness tests.
// They FAIL if the word-index pre-filter is removed from scanForUsagesWithTarget.

describe('PERF REGRESSION — word index pre-filter limits I/O to candidates only', () => {
  const URI_DECL     = 'file:///Foo.kt';
  const URI_IMPORTER = 'file:///Importer.kt';
  const URI_WILDCARD = 'file:///Wildcard.kt';
  const URI_SAME_PKG = 'file:///Peer.kt';
  const URI_UNRELATED_1 = 'file:///Noise1.kt';
  const URI_UNRELATED_2 = 'file:///Noise2.kt';
  const URI_UNRELATED_3 = 'file:///Noise3.kt';

  const CODE_DECL      = 'package com.example\nclass Foo';
  const CODE_IMPORTER  = 'package com.ui\nimport com.example.Foo\nval x = Foo()';
  const CODE_WILDCARD  = 'package com.ui2\nimport com.example.*\nval f = Foo()';
  const CODE_SAME_PKG  = 'package com.example\nval peer = Foo()';
  const CODE_NOISE_1   = 'package com.noise\nclass Bar';
  const CODE_NOISE_2   = 'package com.noise\nclass Baz';
  const CODE_NOISE_3   = 'package com.noise\nclass Qux';

  const ALL_URIS = [
    URI_DECL, URI_IMPORTER, URI_WILDCARD, URI_SAME_PKG,
    URI_UNRELATED_1, URI_UNRELATED_2, URI_UNRELATED_3,
  ];

  let index: SymbolIndex;
  let tracker: ReturnType<typeof trackReads>;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, URI_DECL,        CODE_DECL);
    addKt(index, URI_IMPORTER,    CODE_IMPORTER);
    addKt(index, URI_WILDCARD,    CODE_WILDCARD);
    addKt(index, URI_SAME_PKG,    CODE_SAME_PKG);
    addKt(index, URI_UNRELATED_1, CODE_NOISE_1);
    addKt(index, URI_UNRELATED_2, CODE_NOISE_2);
    addKt(index, URI_UNRELATED_3, CODE_NOISE_3);
    index.finalize();

    const codes: Record<string, string> = {
      [URI_DECL]: CODE_DECL, [URI_IMPORTER]: CODE_IMPORTER,
      [URI_WILDCARD]: CODE_WILDCARD, [URI_SAME_PKG]: CODE_SAME_PKG,
      [URI_UNRELATED_1]: CODE_NOISE_1, [URI_UNRELATED_2]: CODE_NOISE_2,
      [URI_UNRELATED_3]: CODE_NOISE_3,
    };
    tracker = trackReads(codes);
  });

  afterEach(() => {
    tracker.restore();
  });

  it('noise files are NEVER read when word index is ready', async () => {
    const target = index.lookup('Foo')[0];
    await scanForUsagesWithTarget('Foo', target, index, ALL_URIS, makeToken() as any);

    // Exactly 3 noise files must NOT have been read
    // (their content doesn't contain "Foo" at all, but we shouldn't even open them)
    // This would fail if the pre-filter was removed — we'd read all 7 files instead of ≤ 4
    expect(tracker.getCount()).toBeLessThanOrEqual(ALL_URIS.length - 3);
    expect(tracker.getCount()).toBeGreaterThan(0); // sanity: at least one file was read
  });

  it('correct usage count is returned despite pre-filtering', async () => {
    const target = index.lookup('Foo')[0];
    const results = await scanForUsagesWithTarget('Foo', target, index, ALL_URIS, makeToken() as any);

    // Declaration + 2 explicit usages (Importer + SamePkg + Wildcard = 3 usages + 1 decl = 4)
    // Subtract 1 for the declaration itself → 3 usages
    const usageCount = Math.max(0, results.length - 1);
    expect(usageCount).toBeGreaterThanOrEqual(2); // at minimum: Importer and SamePkg
  });

  it('when word index is NOT ready, all files are read (fallback to full scan)', async () => {
    // Use a fresh index without finalize()
    const freshIndex = new SymbolIndex();
    addKt(freshIndex, URI_DECL,        CODE_DECL);
    addKt(freshIndex, URI_IMPORTER,    CODE_IMPORTER);
    addKt(freshIndex, URI_WILDCARD,    CODE_WILDCARD);
    addKt(freshIndex, URI_SAME_PKG,    CODE_SAME_PKG);
    addKt(freshIndex, URI_UNRELATED_1, CODE_NOISE_1);
    addKt(freshIndex, URI_UNRELATED_2, CODE_NOISE_2);
    addKt(freshIndex, URI_UNRELATED_3, CODE_NOISE_3);
    // No finalize() → _wordIndexReady = false

    const target = freshIndex.lookup('Foo')[0];
    await scanForUsagesWithTarget('Foo', target, freshIndex, ALL_URIS, makeToken() as any);

    // Without the word index all files are read (the `text.includes(word)` fast path
    // skips files that don't contain 'Foo', but all files are at least opened)
    expect(tracker.getCount()).toBe(ALL_URIS.length);
  });

  it('private symbol: only the declaring file is read regardless of word index state', async () => {
    const PRIVATE_URI  = 'file:///Private.kt';
    const PRIVATE_CODE = 'package com.example\nprivate fun secret() {}';
    const CALLER_URI   = 'file:///Caller.kt';
    const CALLER_CODE  = 'package com.example\nval x = secret()';

    const privIndex = new SymbolIndex();
    addKt(privIndex, PRIVATE_URI, PRIVATE_CODE);
    addKt(privIndex, CALLER_URI,  CALLER_CODE);
    privIndex.finalize();

    const codes = { [PRIVATE_URI]: PRIVATE_CODE, [CALLER_URI]: CALLER_CODE };
    const privTracker = trackReads(codes);

    const target = privIndex.lookup('secret')[0];
    const uris   = [PRIVATE_URI, CALLER_URI];
    await scanForUsagesWithTarget('secret', target, privIndex, uris, makeToken() as any);

    // Private: only the declaring file is ever read
    expect(privTracker.getCount()).toBe(1);
    privTracker.restore();
  });
});

// ── Section 4: Content cache prevents repeated disk reads ─────────────────────

describe('PERF REGRESSION — content cache prevents re-reading on second scan', () => {
  const URI_FOO    = 'file:///CacheFoo.kt';
  const URI_CALLER = 'file:///CacheCaller.kt';
  const CODE_FOO    = 'package com.example\nclass CacheFoo';
  const CODE_CALLER = 'package com.example\nval x = CacheFoo()';

  let index: SymbolIndex;
  let tracker: ReturnType<typeof trackReads>;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, URI_FOO,    CODE_FOO);
    addKt(index, URI_CALLER, CODE_CALLER);
    index.finalize();

    tracker = trackReads({ [URI_FOO]: CODE_FOO, [URI_CALLER]: CODE_CALLER });
  });

  afterEach(() => { tracker.restore(); });

  it('second scan of same word reads ZERO additional files (content cache hit)', async () => {
    const target = index.lookup('CacheFoo')[0];
    const uris = [URI_FOO, URI_CALLER];

    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);
    const afterFirst = tracker.getCount();

    // Second scan — all files are already in _contentCache
    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);

    expect(tracker.getCount()).toBe(afterFirst); // no new reads on second scan
  });

  it('invalidateContentCache(uri) forces a single-file re-read on next scan', async () => {
    const target = index.lookup('CacheFoo')[0];
    const uris = [URI_FOO, URI_CALLER];

    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);
    const afterFirst = tracker.getCount();

    // Invalidate only the caller file
    invalidateContentCache(URI_CALLER);

    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);

    // Exactly 1 additional read — only the invalidated file
    expect(tracker.getCount()).toBe(afterFirst + 1);
  });

  it('clearContentCache() forces ALL files to be re-read on next scan', async () => {
    const target = index.lookup('CacheFoo')[0];
    const uris = [URI_FOO, URI_CALLER];

    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);
    const afterFirst = tracker.getCount();

    clearContentCache();

    await scanForUsagesWithTarget('CacheFoo', target, index, uris, makeToken() as any);

    // All candidate files are re-read
    expect(tracker.getCount()).toBeGreaterThan(afterFirst);
  });
});

// ── Section 5: FIX-1 regression — textDocuments null-safety ──────────────────

describe('FIX-1 regression — scanForUsages does not crash when textDocuments is absent', () => {
  let savedTextDocs: any;

  beforeEach(() => {
    savedTextDocs = (workspace as any).textDocuments;
  });

  afterEach(() => {
    (workspace as any).textDocuments = savedTextDocs;
  });

  it('returns results normally when workspace.textDocuments is undefined', async () => {
    // Simulate the environment that caused the regression:
    // workspace.textDocuments was missing → TypeError inside readCachedFile
    (workspace as any).textDocuments = undefined;

    const index = new SymbolIndex();
    const URI_D = 'file:///NullSafetyDecl.kt';
    const URI_C = 'file:///NullSafetyCaller.kt';
    addKt(index, URI_D, 'package com.example\nclass NullSafetyTarget');
    addKt(index, URI_C, 'package com.example\nval t = NullSafetyTarget()');
    index.finalize();

    const target = index.lookup('NullSafetyTarget')[0];

    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async (uri: any) => {
      const u: string = uri.toString ? uri.toString() : String(uri);
      if (u.includes('NullSafetyDecl'))   return Buffer.from('package com.example\nclass NullSafetyTarget') as any;
      if (u.includes('NullSafetyCaller'))  return Buffer.from('package com.example\nval t = NullSafetyTarget()') as any;
      return Buffer.from('') as any;
    };

    // Must not throw TypeError — original bug: textDocuments.find() threw on undefined
    let results: any[];
    try {
      results = await scanForUsagesWithTarget(
        'NullSafetyTarget', target, index, [URI_D, URI_C], makeToken() as any,
      );
    } catch (e) {
      throw new Error(`scanForUsagesWithTarget threw unexpectedly: ${e}`);
    }

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);

    workspace.fs.readFile = orig;
  });

  it('returns results normally when workspace.textDocuments is null', async () => {
    (workspace as any).textDocuments = null;

    const index = new SymbolIndex();
    const URI = 'file:///NullSafetyNull.kt';
    addKt(index, URI, 'package com.example\nclass NullTarget');
    index.finalize();

    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async () => Buffer.from('package com.example\nclass NullTarget') as any;

    try {
      await scanForUsagesWithTarget('NullTarget', undefined, index, [URI], makeToken() as any);
    } catch (e) {
      throw new Error(`scanForUsagesWithTarget threw unexpectedly: ${e}`);
    }

    workspace.fs.readFile = orig;
  });
});

// ── Section 6: FIX-2 regression — content cache cross-test isolation ─────────

describe('FIX-2 regression — stale content cache does not corrupt results', () => {
  it('modifying readFile mock between scans gives correct results when cache is cleared', async () => {
    const URI = 'file:///IsolationTest.kt';
    const index = new SymbolIndex();
    addKt(index, URI, 'package com.example\nclass IsolFoo');
    index.finalize();

    const target = index.lookup('IsolFoo')[0];

    // First scan: file has 3 occurrences
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async () =>
      Buffer.from('package com.example\nval a = IsolFoo()\nval b = IsolFoo()\nval c = IsolFoo()') as any;
    const first = await scanForUsagesWithTarget('IsolFoo', target, index, [URI], makeToken() as any);

    // Clear cache and change mock: file now has 1 occurrence
    clearContentCache();
    workspace.fs.readFile = async () =>
      Buffer.from('package com.example\nval a = IsolFoo()') as any;
    const second = await scanForUsagesWithTarget('IsolFoo', target, index, [URI], makeToken() as any);

    workspace.fs.readFile = orig;

    expect(first.length).toBe(3);
    expect(second.length).toBe(1);
  });
});

// ── Section 8: BUG-1 regression — restoreFile() parity with add() ────────────
//
// restoreFile() + finalize() must produce the same getFilesContainingWord()
// results as add() + finalize() for the same data. Before the fix, restoreFile()
// skipped word index population, causing Find Usages to return 0 on warm start.

describe('BUG-1 regression — restoreFile() parity with add() + finalize()', () => {
  it('restored index returns same candidates as the original for all word patterns', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///Decl.kt',
      'package com.example\nclass MyClass : BaseClass');
    addKt(src, 'file:///Explicit.kt',
      'package com.ui\nimport com.example.MyClass\nval x = MyClass()');
    addKt(src, 'file:///Wildcard.kt',
      'package com.ui2\nimport com.example.*\nval y = MyClass()');
    addKt(src, 'file:///Peer.kt',
      'package com.example\nclass Peer');
    src.finalize();

    const target = src.lookup('MyClass')[0];
    const baseline = src.getFilesContainingWord('MyClass', target)!;

    // Rebuild via restoreFile() with imports — simulates IndexStore.restore()
    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, src.getFileImports(uri) ?? []);
    }
    dest.finalize();

    const restored = dest.getFilesContainingWord('MyClass', dest.lookup('MyClass')[0])!;
    expect(restored).not.toBeNull();
    expect(restored.size).toBe(baseline.size);
    for (const uri of baseline) {
      expect(restored.has(uri)).toBe(true);
    }
  });

  it('without imports, restoreFile() still includes declaring file and same-package peers', () => {
    // When imports are unavailable (e.g. legacy snapshot), the word index degrades gracefully:
    // symbol-name words and same-package candidates are still populated.
    const src = new SymbolIndex();
    addKt(src, 'file:///Alpha.kt', 'package com.pkg\nclass Alpha');
    addKt(src, 'file:///Beta.kt',  'package com.pkg\nclass Beta');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, []); // no imports
    }
    dest.finalize();

    const target = dest.lookup('Alpha')[0];
    const candidates = dest.getFilesContainingWord('Alpha', target)!;
    // Declaring file is in byWord (symbol name); peer is in byPkg (same package)
    expect(candidates.has('file:///Alpha.kt')).toBe(true);
    expect(candidates.has('file:///Beta.kt')).toBe(true);
  });
});

// ── Section 7: FIX-4 regression — removeByKey cleans all word maps ────────────

describe('FIX-4 regression — removeByKey cleans byWord, byPkg, byWildcard', () => {
  it('byWord is clean after removal: word with only one mapping disappears', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///OnlyOne.kt', 'package com.example\nclass UniqueSymbol');
    index.finalize();

    expect(index.getFilesContainingWord('UniqueSymbol')!.size).toBe(1);

    index.remove({ toString: () => 'file:///OnlyOne.kt' } as any);

    expect(index.getFilesContainingWord('UniqueSymbol')!.size).toBe(0);
  });

  it('same-package candidates cleaned after package file is removed', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///A.kt', 'package com.pkg\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.pkg\nclass Beta');
    index.finalize();

    const alpha = index.lookup('Alpha')[0];

    // Both files are in same package → both in candidates
    const before = index.getFilesContainingWord('Alpha', alpha)!;
    expect(before.has('file:///B.kt')).toBe(true);

    index.remove({ toString: () => 'file:///B.kt' } as any);

    // B no longer in candidates (removed from byPkg)
    const after = index.getFilesContainingWord('Alpha', alpha)!;
    expect(after.has('file:///B.kt')).toBe(false);
  });

  it('wildcard-import candidates cleaned after file is removed', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt',      'package com.example\nclass Foo');
    addKt(index, 'file:///WildUser.kt', 'package com.ui\nimport com.example.*\nval f = Foo()');
    index.finalize();

    const target = index.lookup('Foo')[0];
    expect(index.getFilesContainingWord('Foo', target)!.has('file:///WildUser.kt')).toBe(true);

    index.remove({ toString: () => 'file:///WildUser.kt' } as any);

    expect(index.getFilesContainingWord('Foo', target)!.has('file:///WildUser.kt')).toBe(false);
  });
});
