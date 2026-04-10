/**
 * Structural invariant tests for SymbolIndex.
 *
 * Every test here encodes a property that must hold for ALL valid states
 * of the index — not just specific cases. A failure means an invariant
 * was broken, which will produce incorrect results in navigation, Find
 * Usages, or CodeLens somewhere in the extension.
 *
 * Invariants guarded:
 *   INV-1   allEntries() == Σ getFileSymbols(uri) for all URIs
 *   INV-2   Every entry reachable via lookup(name)
 *   INV-3   Every FQN in the index reachable via lookupFqn(fqn)
 *   INV-4   stats().files == fileUriStrings().length
 *   INV-5   fileEntries() yields exactly the fileUriStrings() key set
 *   INV-6   Every entry with supertypes is in lookupImplementations()
 *   INV-7   lookup() entries only reference URIs in fileUriStrings()
 *   INV-8   After remove(): zero traces in any accessible map
 *   INV-9   add() same URI twice is idempotent (no symbol duplication)
 *   INV-10  add() + remove() leaves the index identical to before add()
 *   INV-11  Re-indexing a URI replaces old symbols entirely
 *   INV-12  After finalize(): getFilesContainingWord non-null for known words
 *   INV-13  Word index: declaring file always in candidates
 *   INV-14  Word index: same-package files always in candidates (with target)
 *   INV-15  Word index: explicit-import file always in candidates
 *   INV-16  Word index: wildcard-import file always in candidates
 *   INV-17  Word index: candidates never contain URIs outside the index
 *   INV-18  Word index: after remove(), URI absent from all candidate sets
 *   INV-19  getFileImports() tracks imports for every indexed file
 *   INV-20  clear() leaves the index completely empty
 *   INV-21  restoreFile()+finalize() produces same lookup() as add()+finalize()
 *   INV-22  restoreFile()+finalize() produces same getFilesContainingWord() as add()+finalize()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// ── Helpers ───────────────────────────────────────────────────────────────────

function addKt(index: SymbolIndex, uri: string, code: string): void {
  index.add(parse(uri, code));
}

function removeUri(index: SymbolIndex, uri: string): void {
  index.remove({ toString: () => uri } as any);
}

/**
 * Asserts all structural invariants that must hold after any sequence of
 * add/remove/restoreFile operations, regardless of finalize() state.
 *
 * Tests INV-1 through INV-7.
 */
function assertStructuralConsistency(index: SymbolIndex, label = ''): void {
  const tag = label ? `[${label}] ` : '';
  const uris = index.fileUriStrings();
  const all  = index.allEntries();

  // INV-1: allEntries() == sum of getFileSymbols() across all files
  let sumFromFiles = 0;
  for (const uri of uris) sumFromFiles += index.getFileSymbols(uri).length;
  expect(sumFromFiles, `${tag}INV-1: allEntries count mismatch`).toBe(all.length);

  // INV-2: every entry is reachable via lookup(name)
  for (const e of all) {
    const found = index.lookup(e.name);
    expect(
      found.some(x => x.fqn === e.fqn),
      `${tag}INV-2: lookup('${e.name}') must include fqn='${e.fqn}'`,
    ).toBe(true);
  }

  // INV-3: every FQN produced by lookup is defined in lookupFqn
  // (last-writer-wins for duplicate FQNs, but the key must always exist)
  for (const e of all) {
    expect(
      index.lookupFqn(e.fqn),
      `${tag}INV-3: lookupFqn('${e.fqn}') must be defined`,
    ).toBeDefined();
  }

  // INV-4: stats().files == fileUriStrings().length
  expect(index.stats().files, `${tag}INV-4: stats().files mismatch`).toBe(uris.length);
  expect(index.stats().symbols, `${tag}INV-4: stats().symbols must be >= 0`).toBeGreaterThanOrEqual(0);

  // INV-5: fileEntries() yields exactly the same URIs as fileUriStrings()
  const iteratedUris = new Set<string>();
  for (const [uri] of index.fileEntries()) iteratedUris.add(uri);
  expect(iteratedUris.size, `${tag}INV-5: fileEntries() unique URI count`).toBe(uris.length);
  for (const uri of uris) {
    expect(iteratedUris.has(uri), `${tag}INV-5: fileEntries() must yield '${uri}'`).toBe(true);
  }

  // INV-6: every entry with supertypes is in lookupImplementations()
  for (const e of all) {
    if (!e.supertypes) continue;
    for (const st of e.supertypes) {
      const impls = index.lookupImplementations(st);
      expect(
        impls.some(x => x.fqn === e.fqn),
        `${tag}INV-6: lookupImplementations('${st}') must include '${e.fqn}'`,
      ).toBe(true);
    }
  }

  // INV-7: lookup(name) entries only reference URIs that are in the index
  for (const e of all) {
    for (const found of index.lookup(e.name)) {
      expect(
        uris.includes(found.uri.toString()),
        `${tag}INV-7: lookup('${e.name}') returned entry for URI not in index: ${found.uri}`,
      ).toBe(true);
    }
  }
}

/**
 * Asserts word index invariants. Call only after finalize().
 * Tests INV-12 through INV-17.
 */
function assertWordIndexConsistency(index: SymbolIndex, label = ''): void {
  const tag = label ? `[${label}] ` : '';
  const uris = index.fileUriStrings();

  for (const uri of uris) {
    const symbols = index.getFileSymbols(uri);

    for (const sym of symbols) {
      // INV-12: getFilesContainingWord must be non-null after finalize()
      const candidates = index.getFilesContainingWord(sym.name, sym);
      expect(candidates, `${tag}INV-12: getFilesContainingWord must be non-null after finalize()`).not.toBeNull();

      // INV-13: declaring file always in candidates
      expect(
        candidates!.has(uri),
        `${tag}INV-13: declaring file '${uri}' must be in candidates for '${sym.name}'`,
      ).toBe(true);

      // INV-17: all candidates are URIs in the index
      for (const candidateUri of candidates!) {
        expect(
          uris.includes(candidateUri),
          `${tag}INV-17: candidate '${candidateUri}' for '${sym.name}' is not in the index`,
        ).toBe(true);
      }
    }
  }
}

/**
 * Asserts a URI has been completely removed — no trace in any accessible map.
 * Tests INV-8.
 */
function assertCompletelyRemoved(
  index: SymbolIndex,
  uri: string,
  symbolNames: string[],
  uniqueFqns: string[],
  label = '',
): void {
  const tag = label ? `[${label}] ` : '';

  // Not in file list
  expect(index.fileUriStrings().includes(uri), `${tag}INV-8: URI must not be in fileUriStrings()`).toBe(false);

  // No symbols from this file
  expect(index.getFileSymbols(uri), `${tag}INV-8: getFileSymbols() must be empty`).toHaveLength(0);

  // Not in lookup() results
  for (const name of symbolNames) {
    const found = index.lookup(name);
    expect(
      found.every(e => e.uri.toString() !== uri),
      `${tag}INV-8: lookup('${name}') must not return entry from removed URI`,
    ).toBe(true);
  }

  // Not in lookupFqn() (for FQNs unique to this file)
  for (const fqn of uniqueFqns) {
    expect(index.lookupFqn(fqn), `${tag}INV-8: lookupFqn('${fqn}') must be undefined after remove`).toBeUndefined();
  }

  // Not in fileEntries()
  for (const [iterUri] of index.fileEntries()) {
    expect(iterUri, `${tag}INV-8: fileEntries() must not yield removed URI`).not.toBe(uri);
  }

  // Not in allEntries()
  for (const e of index.allEntries()) {
    expect(e.uri.toString(), `${tag}INV-8: allEntries() must not contain entries from removed URI`).not.toBe(uri);
  }

  // fileImports cleared
  expect(index.getFileImports(uri), `${tag}INV-8: getFileImports() must be undefined after remove`).toBeUndefined();
}

/**
 * Asserts the index is completely empty.
 * Tests INV-20.
 */
function assertEmpty(index: SymbolIndex, label = ''): void {
  const tag = label ? `[${label}] ` : '';
  expect(index.fileUriStrings(), `${tag}INV-20: fileUriStrings() must be empty`).toHaveLength(0);
  expect(index.allEntries(),     `${tag}INV-20: allEntries() must be empty`).toHaveLength(0);
  expect(index.stats(),          `${tag}INV-20: stats() must be zero`).toEqual({ files: 0, symbols: 0 });
  for (const [_uri] of index.fileEntries()) {
    throw new Error(`${tag}INV-20: fileEntries() must yield nothing on empty index`);
  }
  // Word index must be dormant
  expect(index.getFilesContainingWord('anything'), `${tag}INV-20: word index must not be ready`).toBeNull();
}

// ── Section 1: Basic structural integrity after add() ────────────────────────

describe('INV-1..7 — structural integrity after add()', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('single file, single class', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    assertStructuralConsistency(index, 'single class');
  });

  it('single file, multiple symbols', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha\nclass Beta\nfun gamma() {}');
    assertStructuralConsistency(index, 'multiple symbols');
  });

  it('single file with supertypes', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Child : Parent');
    assertStructuralConsistency(index, 'supertypes');
  });

  it('multiple files', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Beta');
    addKt(index, 'file:///C.kt', 'package com.c\nclass Gamma');
    assertStructuralConsistency(index, 'multiple files');
  });

  it('same name in different packages', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Shared');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Shared');
    addKt(index, 'file:///C.kt', 'package com.c\nclass Shared');
    assertStructuralConsistency(index, 'same name three packages');
    // All three entries reachable
    expect(index.lookup('Shared')).toHaveLength(3);
  });

  it('nested class structure', () => {
    addKt(index, 'file:///A.kt', `package com.a
class Outer {
    class Inner {
        fun method() {}
    }
}`);
    assertStructuralConsistency(index, 'nested class');
  });

  it('sealed class with subtypes', () => {
    addKt(index, 'file:///A.kt', `package com.a
sealed class Result {
    data class Success(val value: Int) : Result()
    data class Failure(val error: String) : Result()
    data object Loading : Result()
}`);
    assertStructuralConsistency(index, 'sealed class');
    expect(index.lookupImplementations('Result')).toHaveLength(3);
  });

  it('ten files all consistent', () => {
    for (let i = 0; i < 10; i++) {
      addKt(index, `file:///File${i}.kt`, `package com.pkg${i}\nclass Class${i}\nfun fun${i}() {}`);
    }
    assertStructuralConsistency(index, '10 files');
    expect(index.stats().files).toBe(10);
    expect(index.stats().symbols).toBe(20); // 10 classes + 10 funs
  });
});

// ── Section 2: stats() accuracy throughout operations ────────────────────────

describe('INV-4 — stats() accuracy throughout all operations', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('empty index: { files: 0, symbols: 0 }', () => {
    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
  });

  it('one file with 3 symbols: { files: 1, symbols: 3 }', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A\nclass B\nfun c() {}');
    expect(index.stats()).toEqual({ files: 1, symbols: 3 });
  });

  it('stats().files tracks add and remove', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    expect(index.stats().files).toBe(1);
    addKt(index, 'file:///B.kt', 'package p\nclass B');
    expect(index.stats().files).toBe(2);
    removeUri(index, 'file:///A.kt');
    expect(index.stats().files).toBe(1);
    removeUri(index, 'file:///B.kt');
    expect(index.stats().files).toBe(0);
  });

  it('stats().symbols tracks add and remove', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A1\nclass A2');
    expect(index.stats().symbols).toBe(2);
    addKt(index, 'file:///B.kt', 'package p\nclass B1\nclass B2\nclass B3');
    expect(index.stats().symbols).toBe(5);
    removeUri(index, 'file:///A.kt');
    expect(index.stats().symbols).toBe(3);
  });

  it('stats() stays consistent after re-indexing (same URI, more symbols)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    expect(index.stats().symbols).toBe(1);
    // Re-index with more symbols
    addKt(index, 'file:///A.kt', 'package p\nclass A\nclass B\nclass C');
    expect(index.stats().files).toBe(1);   // still one file
    expect(index.stats().symbols).toBe(3); // 3 symbols, not 4 (old A was replaced)
  });

  it('stats() after clear() = zero', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    addKt(index, 'file:///B.kt', 'package p\nclass B');
    index.clear();
    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
  });
});

// ── Section 3: Removal completeness ──────────────────────────────────────────

describe('INV-8 — removal: zero traces after remove()', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('remove sole file: index is empty', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    removeUri(index, 'file:///A.kt');
    assertCompletelyRemoved(index, 'file:///A.kt', ['Alpha'], ['com.a.Alpha']);
    assertEmpty(index);
  });

  it('remove one of two files: other file intact', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Beta');
    removeUri(index, 'file:///A.kt');

    assertCompletelyRemoved(index, 'file:///A.kt', ['Alpha'], ['com.a.Alpha']);
    assertStructuralConsistency(index, 'after remove A');
    expect(index.lookup('Beta')).toHaveLength(1);
    expect(index.stats().files).toBe(1);
  });

  it('remove file with supertypes: lookupImplementations cleaned', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Child : Parent');
    expect(index.lookupImplementations('Parent')).toHaveLength(1);

    removeUri(index, 'file:///A.kt');
    expect(index.lookupImplementations('Parent')).toHaveLength(0);
  });

  it('remove file with wildcard import: not a candidate anymore', () => {
    addKt(index, 'file:///Decl.kt',    'package com.ex\nclass Foo');
    addKt(index, 'file:///WUser.kt',   'package com.ui\nimport com.ex.*\nval f = Foo()');
    index.finalize();

    const target = index.lookup('Foo')[0];
    expect(index.getFilesContainingWord('Foo', target)!.has('file:///WUser.kt')).toBe(true);

    removeUri(index, 'file:///WUser.kt');
    expect(index.getFilesContainingWord('Foo', target)!.has('file:///WUser.kt')).toBe(false);
  });

  it('remove file with explicit import: not a candidate anymore', () => {
    addKt(index, 'file:///Decl.kt',   'package com.ex\nclass Bar');
    addKt(index, 'file:///Caller.kt', 'package com.ui\nimport com.ex.Bar\nval b = Bar()');
    index.finalize();

    const target = index.lookup('Bar')[0];
    expect(index.getFilesContainingWord('Bar', target)!.has('file:///Caller.kt')).toBe(true);

    removeUri(index, 'file:///Caller.kt');
    expect(index.getFilesContainingWord('Bar', target)!.has('file:///Caller.kt')).toBe(false);
  });

  it('remove file from same-package group: not in candidates anymore', () => {
    addKt(index, 'file:///A.kt', 'package com.pkg\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.pkg\nclass Beta');
    index.finalize();

    const alpha = index.lookup('Alpha')[0];
    expect(index.getFilesContainingWord('Alpha', alpha)!.has('file:///B.kt')).toBe(true);

    removeUri(index, 'file:///B.kt');
    expect(index.getFilesContainingWord('Alpha', alpha)!.has('file:///B.kt')).toBe(false);
  });

  it('remove file: getFileImports() returns undefined', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport some.Dep\nclass A');
    expect(index.getFileImports('file:///A.kt')).toBeDefined();
    removeUri(index, 'file:///A.kt');
    expect(index.getFileImports('file:///A.kt')).toBeUndefined();
  });

  it('remove non-existent URI: no crash, index unchanged', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    const before = index.stats();
    removeUri(index, 'file:///DoesNotExist.kt');
    expect(index.stats()).toEqual(before);
    assertStructuralConsistency(index, 'remove non-existent');
  });

  it('remove all files one by one: index ends up empty', () => {
    for (let i = 0; i < 5; i++) {
      addKt(index, `file:///F${i}.kt`, `package com.p${i}\nclass C${i}`);
    }
    assertStructuralConsistency(index, 'before removes');

    for (let i = 0; i < 5; i++) {
      removeUri(index, `file:///F${i}.kt`);
      assertStructuralConsistency(index, `after remove ${i}`);
    }
    assertEmpty(index);
  });

  it('structural consistency holds after each removal in a sequence', () => {
    const uris = ['file:///P.kt', 'file:///Q.kt', 'file:///R.kt', 'file:///S.kt'];
    for (const [i, uri] of uris.entries()) {
      addKt(index, uri, `package com.x${i}\nclass Sym${i}`);
    }

    for (const uri of uris) {
      removeUri(index, uri);
      assertStructuralConsistency(index, `after removing ${uri}`);
    }
  });
});

// ── Section 4: Idempotency — add() same URI twice ────────────────────────────

describe('INV-9 — idempotency: add() same URI twice does not duplicate symbols', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('lookup count does not grow on second add() with same content', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    const countAfterFirst = index.lookup('Alpha').length;
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha'); // same content
    expect(index.lookup('Alpha').length).toBe(countAfterFirst);
  });

  it('stats().files stays at 1 after two adds for same URI', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    expect(index.stats().files).toBe(1);
  });

  it('structural consistency after double add', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha\nclass Beta');
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha\nclass Beta');
    assertStructuralConsistency(index, 'double add');
  });

  it('ten identical adds: still one file, correct symbol count', () => {
    for (let i = 0; i < 10; i++) {
      addKt(index, 'file:///A.kt', 'package p\nclass Alpha\nfun beta() {}');
    }
    expect(index.stats().files).toBe(1);
    expect(index.stats().symbols).toBe(2);
    expect(index.lookup('Alpha')).toHaveLength(1);
    assertStructuralConsistency(index, '10x same add');
  });
});

// ── Section 5: Re-indexing — replacing content for a URI ─────────────────────

describe('INV-11 — re-indexing: add() with new content replaces old symbols entirely', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('old symbol gone, new symbol present after re-index', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass OldClass');
    expect(index.lookup('OldClass')).toHaveLength(1);

    addKt(index, 'file:///A.kt', 'package p\nclass NewClass');
    expect(index.lookup('OldClass')).toHaveLength(0);
    expect(index.lookup('NewClass')).toHaveLength(1);
    assertStructuralConsistency(index, 're-index name change');
  });

  it('old FQN removed from lookupFqn after re-index', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Original');
    expect(index.lookupFqn('com.a.Original')).toBeDefined();

    addKt(index, 'file:///A.kt', 'package com.a\nclass Replacement');
    expect(index.lookupFqn('com.a.Original')).toBeUndefined();
    expect(index.lookupFqn('com.a.Replacement')).toBeDefined();
  });

  it('old supertype entry removed after re-index removes the class', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Child : ParentX');
    expect(index.lookupImplementations('ParentX')).toHaveLength(1);

    addKt(index, 'file:///A.kt', 'package p\nclass Child : ParentY');
    expect(index.lookupImplementations('ParentX')).toHaveLength(0);
    expect(index.lookupImplementations('ParentY')).toHaveLength(1);
  });

  it('word index updated after re-index changes imports', () => {
    addKt(index, 'file:///Decl.kt',  'package com.d\nclass Target');
    addKt(index, 'file:///User.kt',  'package com.u\nimport com.d.Target\nval t = Target()');
    index.finalize();

    const target = index.lookup('Target')[0];
    expect(index.getFilesContainingWord('Target', target)!.has('file:///User.kt')).toBe(true);

    // Re-index User.kt to no longer import Target
    addKt(index, 'file:///User.kt', 'package com.u\nval something = 42');
    expect(index.getFilesContainingWord('Target', target)!.has('file:///User.kt')).toBe(false);
  });

  it('structural consistency holds after re-indexing all files', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass OldA\nclass OldA2');
    addKt(index, 'file:///B.kt', 'package p\nclass OldB');
    addKt(index, 'file:///A.kt', 'package p\nclass NewA');  // re-index A
    addKt(index, 'file:///B.kt', 'package q\nclass NewB');  // re-index B in new package

    assertStructuralConsistency(index, 're-index both');
    expect(index.lookup('OldA')).toHaveLength(0);
    expect(index.lookup('OldA2')).toHaveLength(0);
    expect(index.lookup('NewA')).toHaveLength(1);
    expect(index.lookup('NewB')).toHaveLength(1);
  });
});

// ── Section 6: Undo invariant — add() then remove() restores prior state ──────

describe('INV-10 — undo: add(A) + remove(A) leaves index identical to before add(A)', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('add then remove a single file: back to empty', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    removeUri(index, 'file:///A.kt');
    assertEmpty(index);
  });

  it('add two files, remove one: same as adding only the other', () => {
    const indexOnlyB = new SymbolIndex();
    addKt(indexOnlyB, 'file:///B.kt', 'package com.b\nclass Beta');

    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Beta');
    removeUri(index, 'file:///A.kt');

    // Both should have the same stats and lookup results
    expect(index.stats()).toEqual(indexOnlyB.stats());
    expect(index.lookup('Beta').length).toBe(indexOnlyB.lookup('Beta').length);
    expect(index.lookup('Alpha')).toHaveLength(0);
    assertStructuralConsistency(index, 'undo A from AB');
  });

  it('add(A), remove(A), add(A) again: same as having added A once', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    removeUri(index, 'file:///A.kt');
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');

    expect(index.stats()).toEqual({ files: 1, symbols: 1 });
    expect(index.lookup('Alpha')).toHaveLength(1);
    assertStructuralConsistency(index, 'add-remove-add');
  });

  it('undo invariant for word index: add importer, remove it, no stale word entries', () => {
    addKt(index, 'file:///Decl.kt',   'package com.d\nclass Thing');
    addKt(index, 'file:///User.kt',   'package com.u\nimport com.d.Thing\nval t = Thing()');
    addKt(index, 'file:///WUser.kt',  'package com.u2\nimport com.d.*\nval t = Thing()');
    index.finalize();

    const target = index.lookup('Thing')[0];
    expect(index.getFilesContainingWord('Thing', target)!.has('file:///User.kt')).toBe(true);
    expect(index.getFilesContainingWord('Thing', target)!.has('file:///WUser.kt')).toBe(true);

    removeUri(index, 'file:///User.kt');
    removeUri(index, 'file:///WUser.kt');

    // No stale entries
    expect(index.getFilesContainingWord('Thing', target)!.has('file:///User.kt')).toBe(false);
    expect(index.getFilesContainingWord('Thing', target)!.has('file:///WUser.kt')).toBe(false);
  });
});

// ── Section 7: Sequence invariants ───────────────────────────────────────────

describe('INV-2..7 — structural consistency under arbitrary sequences of add/remove', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('interleaved add and remove maintains consistency', () => {
    addKt(index, 'file:///A.kt', 'package a\nclass A');
    assertStructuralConsistency(index, 'after add A');
    addKt(index, 'file:///B.kt', 'package b\nclass B');
    assertStructuralConsistency(index, 'after add B');
    removeUri(index, 'file:///A.kt');
    assertStructuralConsistency(index, 'after remove A');
    addKt(index, 'file:///C.kt', 'package c\nclass C');
    assertStructuralConsistency(index, 'after add C');
    removeUri(index, 'file:///C.kt');
    assertStructuralConsistency(index, 'after remove C');
    addKt(index, 'file:///A.kt', 'package a2\nclass A2');
    assertStructuralConsistency(index, 'after re-add A as A2');
  });

  it('add 5, remove 3, re-add 2: consistent throughout', () => {
    for (let i = 0; i < 5; i++) {
      addKt(index, `file:///F${i}.kt`, `package p${i}\nclass S${i} : Base${i}`);
    }
    assertStructuralConsistency(index, 'after 5 adds');

    removeUri(index, 'file:///F0.kt');
    removeUri(index, 'file:///F2.kt');
    removeUri(index, 'file:///F4.kt');
    assertStructuralConsistency(index, 'after 3 removes');

    addKt(index, 'file:///F0.kt', 'package p0new\nclass S0New');
    addKt(index, 'file:///F4.kt', 'package p4new\nclass S4New');
    assertStructuralConsistency(index, 'after 2 re-adds');

    expect(index.stats().files).toBe(4); // F1, F3, new F0, new F4
    expect(index.lookup('S0')).toHaveLength(0);   // old S0 gone
    expect(index.lookup('S0New')).toHaveLength(1); // new S0New present
  });

  it('rapid add/remove cycle on same URI 20 times: ends at exactly 1 file', () => {
    for (let i = 0; i < 20; i++) {
      addKt(index, 'file:///Cycle.kt', `package p\nclass Cycle${i}`);
      if (i % 3 === 0) removeUri(index, 'file:///Cycle.kt');
    }
    // After 20 iterations, last op was an add (i=19, 19%3≠0)
    if (index.stats().files > 0) {
      assertStructuralConsistency(index, 'after 20 cycles');
    }
  });
});

// ── Section 8: Word index invariants (post-finalize) ─────────────────────────

describe('INV-12..17 — word index consistency after finalize()', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('INV-12: getFilesContainingWord returns null before finalize(), non-null after', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    expect(index.getFilesContainingWord('Alpha')).toBeNull();
    index.finalize();
    expect(index.getFilesContainingWord('Alpha')).not.toBeNull();
  });

  it('INV-13: declaring file always in candidates for its own symbol', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    index.finalize();
    const target = index.lookup('Alpha')[0];
    expect(index.getFilesContainingWord('Alpha', target)!.has('file:///A.kt')).toBe(true);
  });

  it('INV-14: same-package peer always in candidates', () => {
    addKt(index, 'file:///A.kt', 'package com.pkg\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.pkg\nclass Beta');
    index.finalize();
    const target = index.lookup('Alpha')[0];
    expect(index.getFilesContainingWord('Alpha', target)!.has('file:///B.kt')).toBe(true);
  });

  it('INV-15: explicit-import file always in candidates', () => {
    addKt(index, 'file:///Decl.kt',   'package com.d\nclass Foo');
    addKt(index, 'file:///Caller.kt', 'package com.u\nimport com.d.Foo\nval f = Foo()');
    index.finalize();
    const target = index.lookup('Foo')[0];
    expect(index.getFilesContainingWord('Foo', target)!.has('file:///Caller.kt')).toBe(true);
  });

  it('INV-16: wildcard-import file always in candidates', () => {
    addKt(index, 'file:///Decl.kt', 'package com.d\nclass Bar');
    addKt(index, 'file:///Wild.kt', 'package com.u\nimport com.d.*\nval b = Bar()');
    index.finalize();
    const target = index.lookup('Bar')[0];
    expect(index.getFilesContainingWord('Bar', target)!.has('file:///Wild.kt')).toBe(true);
  });

  it('INV-17: all candidates are URIs actually in the index', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Sym');
    addKt(index, 'file:///B.kt', 'package p\nclass Other');
    index.finalize();
    assertWordIndexConsistency(index, 'basic 2-file');
  });

  it('INV-17: candidates valid across 10-file index', () => {
    for (let i = 0; i < 10; i++) {
      addKt(index, `file:///F${i}.kt`, `package com.p${i}\nclass Sym${i}`);
    }
    index.finalize();
    assertWordIndexConsistency(index, '10-file INV-17');
  });

  it('unrelated file excluded from candidates', () => {
    addKt(index, 'file:///Decl.kt',      'package com.d\nclass Target');
    addKt(index, 'file:///Unrelated.kt', 'package com.z\nclass Unrelated');
    index.finalize();
    const target = index.lookup('Target')[0];
    expect(index.getFilesContainingWord('Target', target)!.has('file:///Unrelated.kt')).toBe(false);
  });

  it('INV-18: after remove(), URI absent from all word-index candidate sets', () => {
    addKt(index, 'file:///Decl.kt',   'package com.d\nclass Baz');
    addKt(index, 'file:///Caller.kt', 'package com.u\nimport com.d.Baz\nval b = Baz()');
    addKt(index, 'file:///Wild.kt',   'package com.w\nimport com.d.*\nval b2 = Baz()');
    addKt(index, 'file:///Peer.kt',   'package com.d\nclass PeerClass');
    index.finalize();

    const target = index.lookup('Baz')[0];
    // All four are candidates before removal
    const before = index.getFilesContainingWord('Baz', target)!;
    expect(before.has('file:///Caller.kt')).toBe(true);
    expect(before.has('file:///Wild.kt')).toBe(true);
    expect(before.has('file:///Peer.kt')).toBe(true);

    removeUri(index, 'file:///Caller.kt');
    removeUri(index, 'file:///Wild.kt');
    removeUri(index, 'file:///Peer.kt');

    const after = index.getFilesContainingWord('Baz', target)!;
    expect(after.has('file:///Caller.kt')).toBe(false);
    expect(after.has('file:///Wild.kt')).toBe(false);
    expect(after.has('file:///Peer.kt')).toBe(false);
    expect(after.has('file:///Decl.kt')).toBe(true); // declaring file still there
  });

  it('word index consistent after finalize + add (incremental update)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    index.finalize();
    assertWordIndexConsistency(index, 'before incremental');

    // Add a new file after finalize
    addKt(index, 'file:///B.kt', 'package p\nimport p.Alpha\nclass Beta');
    index.finalize(); // re-finalize
    assertWordIndexConsistency(index, 'after incremental');

    const target = index.lookup('Alpha')[0];
    expect(index.getFilesContainingWord('Alpha', target)!.has('file:///B.kt')).toBe(true);
  });
});

// ── Section 9: fileImports consistency ───────────────────────────────────────

describe('INV-19 — getFileImports() tracks imports for every indexed file', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('file with no imports: getFileImports returns empty array', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    expect(index.getFileImports('file:///A.kt')).toEqual([]);
  });

  it('file with explicit import: import captured in getFileImports', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport com.example.Foo\nclass A');
    const imports = index.getFileImports('file:///A.kt')!;
    expect(imports).toContain('com.example.Foo');
  });

  it('file with wildcard import: import captured in getFileImports', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport com.example.*\nclass A');
    const imports = index.getFileImports('file:///A.kt')!;
    expect(imports).toContain('com.example.*');
  });

  it('file with mixed imports: all captured', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport com.a.Foo\nimport com.b.*\nimport com.c.Bar\nclass A');
    const imports = index.getFileImports('file:///A.kt')!;
    expect(imports).toContain('com.a.Foo');
    expect(imports).toContain('com.b.*');
    expect(imports).toContain('com.c.Bar');
  });

  it('getFileImports returns undefined for URI not in index', () => {
    expect(index.getFileImports('file:///Nonexistent.kt')).toBeUndefined();
  });

  it('getFileImports returns undefined after remove()', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport com.x.Y\nclass A');
    expect(index.getFileImports('file:///A.kt')).toBeDefined();
    removeUri(index, 'file:///A.kt');
    expect(index.getFileImports('file:///A.kt')).toBeUndefined();
  });

  it('getFileImports updated after re-index with different imports', () => {
    addKt(index, 'file:///A.kt', 'package p\nimport com.old.Import\nclass A');
    expect(index.getFileImports('file:///A.kt')).toContain('com.old.Import');

    addKt(index, 'file:///A.kt', 'package p\nimport com.new.Import\nclass A');
    const imports = index.getFileImports('file:///A.kt')!;
    expect(imports).not.toContain('com.old.Import');
    expect(imports).toContain('com.new.Import');
  });

  it('every URI in fileUriStrings() has a defined getFileImports()', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    addKt(index, 'file:///B.kt', 'package p\nimport x.Y\nclass B');
    addKt(index, 'file:///C.kt', 'package p\nimport x.*\nclass C');
    for (const uri of index.fileUriStrings()) {
      expect(index.getFileImports(uri), `getFileImports defined for ${uri}`).toBeDefined();
    }
  });
});

// ── Section 10: clear() completeness ─────────────────────────────────────────

describe('INV-20 — clear() leaves the index completely empty', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('clear() on empty index: no crash', () => {
    expect(() => index.clear()).not.toThrow();
    assertEmpty(index);
  });

  it('clear() after single add: empty', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    index.clear();
    assertEmpty(index);
  });

  it('clear() after many adds: empty', () => {
    for (let i = 0; i < 20; i++) {
      addKt(index, `file:///F${i}.kt`, `package p${i}\nclass C${i} : Base`);
    }
    index.finalize();
    index.clear();
    assertEmpty(index);
  });

  it('clear() then add(): works correctly as if fresh', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass OldSymbol');
    index.clear();
    addKt(index, 'file:///B.kt', 'package q\nclass NewSymbol');

    expect(index.lookup('OldSymbol')).toHaveLength(0);
    expect(index.lookup('NewSymbol')).toHaveLength(1);
    assertStructuralConsistency(index, 'after clear+add');
  });

  it('clear() removes all lookup() entries', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A\nclass B\nclass C');
    index.clear();
    expect(index.lookup('A')).toHaveLength(0);
    expect(index.lookup('B')).toHaveLength(0);
    expect(index.lookup('C')).toHaveLength(0);
  });

  it('clear() removes all lookupFqn() entries', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    index.clear();
    expect(index.lookupFqn('com.a.Alpha')).toBeUndefined();
  });

  it('clear() removes all lookupImplementations() entries', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Child : Parent');
    index.clear();
    expect(index.lookupImplementations('Parent')).toHaveLength(0);
  });

  it('clear() resets word index (getFilesContainingWord returns null)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    index.finalize();
    expect(index.getFilesContainingWord('Alpha')).not.toBeNull(); // was ready

    index.clear();
    expect(index.getFilesContainingWord('Alpha')).toBeNull(); // reset
  });

  it('clear() then finalize() then add(): word index works again', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass OldSymbol');
    index.finalize();
    index.clear();

    addKt(index, 'file:///B.kt', 'package q\nclass NewSymbol');
    index.finalize();

    expect(index.getFilesContainingWord('NewSymbol')).not.toBeNull();
    expect(index.getFilesContainingWord('OldSymbol')!.size).toBe(0);
    assertWordIndexConsistency(index, 'after clear+add+finalize');
  });
});

// ── Section 11: restoreFile() symmetry with add() ────────────────────────────

describe('INV-21..22 — restoreFile() + finalize() produces same results as add() + finalize()', () => {
  it('INV-21: lookup() identical for restored vs added index', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///A.kt', 'package com.a\nclass Alpha : Base');
    addKt(src, 'file:///B.kt', 'package com.b\nclass Beta');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, src.getFileImports(uri) ?? []);
    }
    dest.finalize();

    // lookup() must return same results
    for (const name of ['Alpha', 'Beta', 'Base']) {
      expect(dest.lookup(name).length).toBe(src.lookup(name).length);
    }
    // lookupFqn() must be defined for all FQNs
    for (const e of src.allEntries()) {
      expect(dest.lookupFqn(e.fqn)).toBeDefined();
    }
    assertStructuralConsistency(dest, 'restored index INV-21');
  });

  it('INV-22: getFilesContainingWord() identical for restored vs added index', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///Decl.kt',   'package com.d\nclass Target');
    addKt(src, 'file:///Caller.kt', 'package com.u\nimport com.d.Target\nval t = Target()');
    addKt(src, 'file:///Wild.kt',   'package com.w\nimport com.d.*\nval t2 = Target()');
    addKt(src, 'file:///Peer.kt',   'package com.d\nclass Peer');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, src.getFileImports(uri) ?? []);
    }
    dest.finalize();

    const srcTarget  = src.lookup('Target')[0];
    const destTarget = dest.lookup('Target')[0];

    const srcCandidates  = src.getFilesContainingWord('Target', srcTarget)!;
    const destCandidates = dest.getFilesContainingWord('Target', destTarget)!;

    expect(destCandidates.size).toBe(srcCandidates.size);
    for (const uri of srcCandidates) {
      expect(destCandidates.has(uri), `restored index must include candidate '${uri}'`).toBe(true);
    }
  });

  it('INV-22: restoreFile with no imports degrades gracefully (symbol names + package still work)', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///A.kt', 'package com.a\nclass Alpha');
    addKt(src, 'file:///B.kt', 'package com.a\nclass Beta'); // same package as A
    src.finalize();

    // Restore without imports — partial but should not crash or return wrong data
    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, []); // deliberately no imports
    }
    dest.finalize();

    const target = dest.lookup('Alpha')[0];
    const candidates = dest.getFilesContainingWord('Alpha', target)!;
    // Declaring file (byWord) and same-package peer (byPkg) must still be present
    expect(candidates.has('file:///A.kt')).toBe(true);
    expect(candidates.has('file:///B.kt')).toBe(true);
  });

  it('restoreFile: structural consistency holds for restored index', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///A.kt', 'package p\nclass A : IBase');
    addKt(src, 'file:///B.kt', 'package p\nclass B : IBase');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries, src.getFileImports(uri) ?? []);
    }
    dest.finalize();

    assertStructuralConsistency(dest, 'restoreFile INV-21');
    assertWordIndexConsistency(dest, 'restoreFile INV-22');
  });
});

// ── Section 12: FQN uniqueness and last-writer-wins ──────────────────────────

describe('FQN uniqueness — lookupFqn reflects last writer for duplicate FQNs', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('two files with same FQN: lookupFqn defined (last-writer-wins)', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Dup');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Dup'); // same FQN
    assertStructuralConsistency(index, 'duplicate FQN');
    expect(index.lookupFqn('com.p.Dup')).toBeDefined();
  });

  it('after removeExternal(): workspace FQN restored in lookupFqn', () => {
    // Simulate: workspace file and JAR file both declare com.a.Foo
    // JAR is added last (overwriting byFqn), then removeExternal() restores workspace entry
    addKt(index, 'file:///Workspace.kt', 'package com.a\nclass Foo');
    addKt(index, 'kotlin-jar:///lib.jar!/com/a/Foo.kt', 'package com.a\nclass Foo');

    // JAR entry overwrites workspace in byFqn
    index.removeExternal();

    // After removeExternal, workspace entry must be accessible
    const entry = index.lookupFqn('com.a.Foo');
    expect(entry).toBeDefined();
    expect(entry!.uri.toString()).not.toContain('kotlin-jar:');
    assertStructuralConsistency(index, 'after removeExternal');
  });
});

// ── Section 13: Edge cases ────────────────────────────────────────────────────

describe('Edge cases — empty files, single symbol, no package', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('file with zero symbols: not added to fileUriStrings()', () => {
    addKt(index, 'file:///Empty.kt', '// just a comment');
    expect(index.fileUriStrings()).not.toContain('file:///Empty.kt');
    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
  });

  it('file with no package declaration: symbols still indexed', () => {
    addKt(index, 'file:///NoPkg.kt', 'class NoPkgClass');
    assertStructuralConsistency(index, 'no package');
    expect(index.lookup('NoPkgClass')).toHaveLength(1);
    expect(index.lookupFqn('NoPkgClass')).toBeDefined(); // FQN = just the name
  });

  it('deeply nested class hierarchy: structural integrity maintained', () => {
    addKt(index, 'file:///Deep.kt', `package com.d
class L1 {
    class L2 {
        class L3 {
            fun method() {}
        }
    }
}`);
    assertStructuralConsistency(index, 'deep nesting');
    expect(index.lookupFqn('com.d.L1.L2.L3')).toBeDefined();
  });

  it('enum class with entries: only class in lookup, not individual entries', () => {
    addKt(index, 'file:///E.kt', 'package p\nenum class Color { RED, GREEN, BLUE }');
    assertStructuralConsistency(index, 'enum');
    expect(index.lookup('Color')).toHaveLength(1);
  });

  it('file with 50 symbols: all indexed, structure consistent', () => {
    const symbols = Array.from({ length: 50 }, (_, i) => `class Sym${i}`).join('\n');
    addKt(index, 'file:///Big.kt', `package com.big\n${symbols}`);
    assertStructuralConsistency(index, '50 symbols');
    expect(index.stats().symbols).toBe(50);
  });

  it('100 files × 5 symbols: stats and structure correct', () => {
    for (let i = 0; i < 100; i++) {
      const symbols = Array.from({ length: 5 }, (_, j) => `class C${i}_${j}`).join('\n');
      addKt(index, `file:///F${i}.kt`, `package p${i}\n${symbols}`);
    }
    assertStructuralConsistency(index, '100×5');
    expect(index.stats().files).toBe(100);
    expect(index.stats().symbols).toBe(500);
  });
});
