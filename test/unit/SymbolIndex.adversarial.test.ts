/**
 * Adversarial tests for SymbolIndex — designed to break the implementation.
 *
 * Each section targets a specific failure mode or boundary condition that
 * routine happy-path tests miss. Tests are ordered from most likely to
 * reveal a latent bug to least.
 *
 * Bugs these tests are designed to catch:
 *
 *   ADV-A  FQN orphan after overwriter removed:
 *          add(A, fqn=X), add(B, fqn=X) → remove(B) → lookupFqn(X) must still return A.
 *          Without the fix, byFqn[X] is deleted and A's entry is unreachable.
 *
 *   ADV-B  byWord/byPkg/byWildcard leak: removing the last contributor must delete the
 *          map key entirely (not leave an empty Set that silently grows memory).
 *
 *   ADV-C  Word contributed via multiple paths (symbol + import) in same file:
 *          cleanup must not double-delete or leave stale entries.
 *
 *   ADV-D  Package change on re-index: old byPkg entry must be cleaned, new one created.
 *
 *   ADV-E  Wildcard import prefix boundary: import com.a.b.* → only prefix com.a.b
 *          is added to byWildcard, not com.a or com.
 *
 *   ADV-F  Ancestor expansion for nested symbols: files importing any ancestor class
 *          are candidates, files with no ancestor import are not.
 *
 *   ADV-G  bySuper precision under add/remove: supertype sets stay in sync.
 *
 *   ADV-H  finalize() edge cases: empty index, multiple calls, interleaved with add/remove.
 *
 *   ADV-I  stats().symbols counts unique FQNs (byFqn.size), not allEntries().length.
 *
 *   ADV-J  Shared-word partial removal: removing one contributor leaves others intact.
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

// ── ADV-A: FQN orphan — overwriter removed, first writer must survive ─────────
//
// When two files declare the same FQN, byFqn uses last-writer-wins.
// Removing the last writer must restore byFqn to point at the surviving entry.
// Without the fix: byFqn entry is deleted, first writer's symbol is in byName but
// unreachable via lookupFqn — navigation silently breaks.

describe('ADV-A — FQN survivor restoration after overwriter is removed', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('remove second writer: lookupFqn restored to first writer', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Dup');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Dup'); // same FQN, overwrites byFqn

    // Both entries reachable via lookup
    expect(index.lookup('Dup')).toHaveLength(2);
    expect(index.lookupFqn('com.p.Dup')).toBeDefined(); // points to B (last writer)

    removeUri(index, 'file:///B.kt');

    // A's entry still in byName — it must also be in byFqn
    expect(index.lookup('Dup')).toHaveLength(1);
    expect(index.lookupFqn('com.p.Dup'), 'lookupFqn must be restored to A after B removed').toBeDefined();
    expect(index.lookupFqn('com.p.Dup')!.uri.toString()).toBe('file:///A.kt');
  });

  it('remove first writer: lookupFqn stays pointing at second writer', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Dup');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Dup');

    removeUri(index, 'file:///A.kt');

    // B's entry should still be accessible
    expect(index.lookup('Dup')).toHaveLength(1);
    expect(index.lookupFqn('com.p.Dup')).toBeDefined();
    expect(index.lookupFqn('com.p.Dup')!.uri.toString()).toBe('file:///B.kt');
  });

  it('three files same FQN: remove two, last one still accessible', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Triple');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Triple');
    addKt(index, 'file:///C.kt', 'package com.p\nclass Triple');

    removeUri(index, 'file:///C.kt'); // remove last writer
    expect(index.lookupFqn('com.p.Triple')).toBeDefined();

    removeUri(index, 'file:///B.kt'); // remove middle
    expect(index.lookupFqn('com.p.Triple')).toBeDefined();
    expect(index.lookupFqn('com.p.Triple')!.uri.toString()).toBe('file:///A.kt');

    removeUri(index, 'file:///A.kt'); // remove first
    expect(index.lookupFqn('com.p.Triple')).toBeUndefined();
  });

  it('FQN collision only on some symbols: non-colliding FQNs unaffected', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Dup\nclass UniqueA');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Dup\nclass UniqueB');

    removeUri(index, 'file:///B.kt');

    expect(index.lookupFqn('com.p.Dup')).toBeDefined();   // restored from A
    expect(index.lookupFqn('com.p.UniqueA')).toBeDefined(); // never collided
    expect(index.lookupFqn('com.p.UniqueB')).toBeUndefined(); // gone with B
  });

  it('same name, different packages: removing one does not affect the other FQN', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Foo');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Foo'); // different FQN: com.b.Foo

    removeUri(index, 'file:///A.kt');

    expect(index.lookupFqn('com.a.Foo')).toBeUndefined();
    expect(index.lookupFqn('com.b.Foo')).toBeDefined();
  });
});

// ── ADV-B: Empty Set / Map cleanup — no leaking tombstones ────────────────────
//
// Each map entry must be deleted when its Set becomes empty.
// A leaking empty Set is harmless today but grows memory and could mask bugs
// if code ever checks `has(key)` vs `get(key)?.size > 0`.

describe('ADV-B — no empty Sets leak after last contributor removed', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('byWord: last contributor removed → word entirely absent from candidates', () => {
    addKt(index, 'file:///Only.kt', 'package p\nclass UniqueWord');
    index.finalize();
    expect(index.getFilesContainingWord('UniqueWord')!.size).toBe(1);

    removeUri(index, 'file:///Only.kt');

    // After remove: getFilesContainingWord must return empty Set (word key deleted)
    const result = index.getFilesContainingWord('UniqueWord')!;
    expect(result.size).toBe(0);
  });

  it('byWord: removing one of two contributors leaves the other', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass SharedWord');
    addKt(index, 'file:///B.kt', 'package p\nclass SharedWord'); // same symbol name → same word
    index.finalize();

    removeUri(index, 'file:///A.kt');

    const result = index.getFilesContainingWord('SharedWord')!;
    expect(result.has('file:///A.kt')).toBe(false);
    expect(result.has('file:///B.kt')).toBe(true);
  });

  it('byPkg: last file in package removed → package no longer yields candidates', () => {
    addKt(index, 'file:///Solo.kt', 'package com.solo\nclass SoloClass');
    index.finalize();

    const target = index.lookup('SoloClass')[0];
    expect(index.getFilesContainingWord('SoloClass', target)!.has('file:///Solo.kt')).toBe(true);

    removeUri(index, 'file:///Solo.kt');

    // byPkg['com.solo'] should be gone — candidates should be empty
    const result = index.getFilesContainingWord('SoloClass', target)!;
    expect(result.has('file:///Solo.kt')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('byPkg: remove N-1 of N files in same package: last file still has candidates', () => {
    for (let i = 0; i < 5; i++) {
      addKt(index, `file:///Pkg${i}.kt`, `package com.shared\nclass Sym${i}`);
    }
    index.finalize();

    // Remove files 0..3
    for (let i = 0; i < 4; i++) removeUri(index, `file:///Pkg${i}.kt`);

    const target = index.lookup('Sym4')[0];
    const candidates = index.getFilesContainingWord('Sym4', target)!;
    expect(candidates.has('file:///Pkg4.kt')).toBe(true);
    for (let i = 0; i < 4; i++) {
      expect(candidates.has(`file:///Pkg${i}.kt`)).toBe(false);
    }
  });

  it('byWildcard: last wildcard importer removed → package no longer in candidates via wildcard', () => {
    addKt(index, 'file:///Decl.kt', 'package com.ex\nclass Foo');
    addKt(index, 'file:///Wild.kt', 'package com.u\nimport com.ex.*\nval f = Foo()');
    index.finalize();

    const target = index.lookup('Foo')[0];
    expect(index.getFilesContainingWord('Foo', target)!.has('file:///Wild.kt')).toBe(true);

    removeUri(index, 'file:///Wild.kt');

    expect(index.getFilesContainingWord('Foo', target)!.has('file:///Wild.kt')).toBe(false);
  });

  it('byWildcard: remove one of two wildcard importers: other still a candidate', () => {
    addKt(index, 'file:///Decl.kt', 'package com.ex\nclass Bar');
    addKt(index, 'file:///W1.kt',   'package com.u1\nimport com.ex.*\nval b = Bar()');
    addKt(index, 'file:///W2.kt',   'package com.u2\nimport com.ex.*\nval b2 = Bar()');
    index.finalize();

    const target = index.lookup('Bar')[0];
    removeUri(index, 'file:///W1.kt');

    expect(index.getFilesContainingWord('Bar', target)!.has('file:///W1.kt')).toBe(false);
    expect(index.getFilesContainingWord('Bar', target)!.has('file:///W2.kt')).toBe(true);
  });

  it('bySuper: last implementor removed → bySuper entry gone (no empty Set)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Child : Parent');
    expect(index.lookupImplementations('Parent')).toHaveLength(1);

    removeUri(index, 'file:///A.kt');

    expect(index.lookupImplementations('Parent')).toHaveLength(0);
    // A second add() for Parent should work cleanly (not append to stale Set)
    addKt(index, 'file:///B.kt', 'package p\nclass NewChild : Parent');
    expect(index.lookupImplementations('Parent')).toHaveLength(1);
  });
});

// ── ADV-C: Word contributed via multiple paths in same file ───────────────────
//
// A file can contribute the same word to byWord via multiple sources:
// its own symbol declaration AND its import statement. The Set deduplication
// means the URI appears only once in byWord, but removeByKey must still clean
// it up correctly (not double-delete or leave a stale entry).

describe('ADV-C — word contributed via multiple paths: cleanup correctness', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('file declaring Foo and importing Foo: cleaned up cleanly on remove', () => {
    addKt(index, 'file:///Decl.kt',  'package com.d\nclass Foo');
    // This file declares Foo (symbol) and also imports com.x.Foo (import segment)
    addKt(index, 'file:///Mixed.kt', 'package com.m\nimport com.x.Foo\nclass Foo'); // Foo in both symbol and import
    addKt(index, 'file:///Other.kt', 'package com.o\nimport com.d.Foo\nval f = Foo()');
    index.finalize();

    removeUri(index, 'file:///Mixed.kt');

    // Mixed.kt must be gone from candidates for Foo
    const target = index.lookup('Foo').find(e => e.packageName === 'com.d')!;
    const candidates = index.getFilesContainingWord('Foo', target)!;
    expect(candidates.has('file:///Mixed.kt')).toBe(false);
    // Other.kt still a candidate
    expect(candidates.has('file:///Other.kt')).toBe(true);
  });

  it('file declaring supertype name and importing same name: cleanup correct', () => {
    addKt(index, 'file:///Base.kt', 'package p\nclass Base');
    // This file extends Base AND imports com.x.Base — "Base" contributed as supertype and import
    addKt(index, 'file:///Child.kt', 'package p\nimport com.x.Base\nclass Child : Base');
    index.finalize();

    removeUri(index, 'file:///Child.kt');

    const baseTarget = index.lookup('Base')[0];
    const candidates = index.getFilesContainingWord('Base', baseTarget)!;
    expect(candidates.has('file:///Child.kt')).toBe(false);
    // Base.kt (the declaring file) must still be there
    expect(candidates.has('file:///Base.kt')).toBe(true);
  });

  it('two files both contribute same word: removing both clears word entirely', () => {
    addKt(index, 'file:///A.kt', 'package pa\nclass Common');
    addKt(index, 'file:///B.kt', 'package pb\nclass Common');
    index.finalize();

    removeUri(index, 'file:///A.kt');
    expect(index.getFilesContainingWord('Common')!.has('file:///A.kt')).toBe(false);
    expect(index.getFilesContainingWord('Common')!.has('file:///B.kt')).toBe(true);

    removeUri(index, 'file:///B.kt');
    expect(index.getFilesContainingWord('Common')!.size).toBe(0);
  });
});

// ── ADV-D: Package change on re-index ─────────────────────────────────────────
//
// When a file is re-indexed into a different package:
// - Old byPkg entry must be removed (file no longer in old package)
// - New byPkg entry must be created
// - Candidates for symbols in the old package must not include the moved file
// - Candidates for symbols in the new package must include the moved file

describe('ADV-D — package change on re-index: byPkg updated correctly', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('moved file no longer a same-package candidate for old package', () => {
    addKt(index, 'file:///Anchor.kt', 'package com.old\nclass Anchor');
    addKt(index, 'file:///Moving.kt', 'package com.old\nclass Moving');
    index.finalize();

    const anchor = index.lookup('Anchor')[0];
    expect(index.getFilesContainingWord('Anchor', anchor)!.has('file:///Moving.kt')).toBe(true);

    // Re-index Moving.kt into a different package
    addKt(index, 'file:///Moving.kt', 'package com.new\nclass Moving');

    expect(index.getFilesContainingWord('Anchor', anchor)!.has('file:///Moving.kt')).toBe(false);
  });

  it('moved file becomes a same-package candidate for new package', () => {
    addKt(index, 'file:///NewPeer.kt', 'package com.new\nclass NewPeer');
    addKt(index, 'file:///Moving.kt', 'package com.old\nclass Moving');
    index.finalize();

    const peer = index.lookup('NewPeer')[0];
    expect(index.getFilesContainingWord('NewPeer', peer)!.has('file:///Moving.kt')).toBe(false);

    addKt(index, 'file:///Moving.kt', 'package com.new\nclass Moving');

    expect(index.getFilesContainingWord('NewPeer', peer)!.has('file:///Moving.kt')).toBe(true);
  });

  it('sole file in package: re-index to new package removes old package entirely', () => {
    addKt(index, 'file:///A.kt', 'package com.alone\nclass A');
    index.finalize();

    addKt(index, 'file:///A.kt', 'package com.elsewhere\nclass A');

    // com.alone should no longer yield any candidates
    addKt(index, 'file:///Probe.kt', 'package com.alone\nclass Probe');
    index.finalize();
    // Probe is in com.alone. The re-indexed A is now in com.elsewhere.
    const probe = index.lookup('Probe')[0];
    const candidates = index.getFilesContainingWord('Probe', probe)!;
    expect(candidates.has('file:///A.kt')).toBe(false);
    expect(candidates.has('file:///Probe.kt')).toBe(true);
  });

  it('re-index changes imports: old wildcard candidates removed, new ones added', () => {
    addKt(index, 'file:///Decl.kt',  'package com.d\nclass Target');
    addKt(index, 'file:///User.kt',  'package com.u\nimport com.d.*\nval t = Target()');
    index.finalize();

    const target = index.lookup('Target')[0];
    expect(index.getFilesContainingWord('Target', target)!.has('file:///User.kt')).toBe(true);

    // Re-index User.kt: now imports com.x.* instead of com.d.*
    addKt(index, 'file:///User.kt', 'package com.u\nimport com.x.*\nval something = 1');

    expect(index.getFilesContainingWord('Target', target)!.has('file:///User.kt')).toBe(false);
  });
});

// ── ADV-E: Wildcard import prefix boundary ────────────────────────────────────
//
// `import com.a.b.*` must add ONLY `com.a.b` to byWildcard.
// It must NOT add `com.a` or `com` — that would make files candidates
// for symbols in any sub-package of com.a, producing massive false positives.

describe('ADV-E — wildcard import prefix is exact, not ancestral', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('import com.a.b.* — file is candidate for com.a.b symbol but NOT com.a symbol', () => {
    addKt(index, 'file:///Leaf.kt',    'package com.a.b\nclass LeafSym');
    addKt(index, 'file:///Parent.kt',  'package com.a\nclass ParentSym');
    addKt(index, 'file:///WUser.kt',   'package com.u\nimport com.a.b.*\nval x = LeafSym()');
    index.finalize();

    const leafTarget   = index.lookup('LeafSym')[0];
    const parentTarget = index.lookup('ParentSym')[0];

    // File imports com.a.b.* → candidate for com.a.b symbols
    expect(index.getFilesContainingWord('LeafSym', leafTarget)!.has('file:///WUser.kt')).toBe(true);

    // File does NOT import com.a.* → NOT a candidate for com.a symbols via wildcard
    // (it might still appear if it's same-package or explicit import, but not via byWildcard)
    const parentCandidates = index.getFilesContainingWord('ParentSym', parentTarget)!;
    // WUser.kt is in com.u, not com.a, and has no import of com.a — must not be a candidate
    expect(parentCandidates.has('file:///WUser.kt')).toBe(false);
  });

  it('import com.a.* — file is NOT a candidate for com.a.b.LeafSym via byWildcard', () => {
    addKt(index, 'file:///Deep.kt',  'package com.a.b\nclass DeepSym');
    addKt(index, 'file:///User.kt',  'package com.u\nimport com.a.*\nval x = 1');
    index.finalize();

    const deepTarget = index.lookup('DeepSym')[0]; // packageName = com.a.b
    const candidates = index.getFilesContainingWord('DeepSym', deepTarget)!;
    // User.kt imports com.a.* — covers com.a, not com.a.b
    expect(candidates.has('file:///User.kt')).toBe(false);
  });

  it('multiple levels: import com.a.b.c.* — only com.a.b.c in byWildcard', () => {
    addKt(index, 'file:///A.kt',    'package com.a\nclass SymA');
    addKt(index, 'file:///AB.kt',   'package com.a.b\nclass SymAB');
    addKt(index, 'file:///ABC.kt',  'package com.a.b.c\nclass SymABC');
    addKt(index, 'file:///User.kt', 'package com.u\nimport com.a.b.c.*\nval x = SymABC()');
    index.finalize();

    const targetA   = index.lookup('SymA')[0];
    const targetAB  = index.lookup('SymAB')[0];
    const targetABC = index.lookup('SymABC')[0];

    expect(index.getFilesContainingWord('SymABC', targetABC)!.has('file:///User.kt')).toBe(true);
    expect(index.getFilesContainingWord('SymAB',  targetAB)!.has('file:///User.kt')).toBe(false);
    expect(index.getFilesContainingWord('SymA',   targetA)!.has('file:///User.kt')).toBe(false);
  });
});

// ── ADV-F: Ancestor expansion for nested symbols ──────────────────────────────
//
// For symbols at depth > 0 (nested classes, companion members), the word index
// expands candidates to files importing any ancestor class.
// Files with no ancestor import are NOT candidates.

describe('ADV-F — nested symbol ancestor expansion in getFilesContainingWord', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('file importing Outer class is a candidate for Outer.Inner', () => {
    addKt(index, 'file:///Outer.kt', `package com.p
class Outer {
    class Inner {}
}`);
    addKt(index, 'file:///User.kt', 'package com.u\nimport com.p.Outer\nval x = Outer.Inner()');
    index.finalize();

    const innerEntry = index.lookup('Inner')[0]; // depth=1
    const candidates = index.getFilesContainingWord('Inner', innerEntry)!;
    expect(candidates.has('file:///User.kt')).toBe(true);
  });

  it('file with NO import of any ancestor is NOT a candidate for nested symbol', () => {
    addKt(index, 'file:///Outer.kt', `package com.p
class Outer {
    class Inner {}
}`);
    addKt(index, 'file:///Unrelated.kt', 'package com.z\nclass SomethingElse');
    index.finalize();

    const innerEntry = index.lookup('Inner')[0];
    const candidates = index.getFilesContainingWord('Inner', innerEntry)!;
    expect(candidates.has('file:///Unrelated.kt')).toBe(false);
  });

  it('depth=0 symbol: ancestor expansion not triggered even with same name import', () => {
    addKt(index, 'file:///A.kt',    'package com.p\nclass TopLevel');
    addKt(index, 'file:///User.kt', 'package com.u\nimport com.p.TopLevel\nval t = TopLevel()');
    index.finalize();

    const entry = index.lookup('TopLevel')[0];
    expect(entry.depth).toBe(0);
    const candidates = index.getFilesContainingWord('TopLevel', entry)!;
    // User.kt is a candidate via explicit import (byWord), not ancestor expansion
    expect(candidates.has('file:///User.kt')).toBe(true);
  });

  it('deeply nested: importing any ancestor makes you a candidate', () => {
    addKt(index, 'file:///Deep.kt', `package com.p
class L1 {
    class L2 {
        fun deepMethod() {}
    }
}`);
    addKt(index, 'file:///ImportL1.kt', 'package com.u\nimport com.p.L1\nval x = L1.L2().deepMethod()');
    addKt(index, 'file:///ImportL2.kt', 'package com.v\nimport com.p.L1.L2\nval y = L2().deepMethod()');
    addKt(index, 'file:///NoImport.kt', 'package com.w\nclass Unrelated');
    index.finalize();

    const methodEntry = index.lookup('deepMethod')[0]; // depth >= 2
    const candidates  = index.getFilesContainingWord('deepMethod', methodEntry)!;

    expect(candidates.has('file:///ImportL1.kt')).toBe(true);  // imports L1 (ancestor)
    expect(candidates.has('file:///ImportL2.kt')).toBe(true);  // imports L2 (ancestor)
    expect(candidates.has('file:///NoImport.kt')).toBe(false); // no ancestor import
  });
});

// ── ADV-G: bySuper precision under add/remove/re-index ───────────────────────

describe('ADV-G — bySuper stays in sync under mutations', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('re-index with different supertype: old removed, new added', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A : OldParent');
    expect(index.lookupImplementations('OldParent')).toHaveLength(1);
    expect(index.lookupImplementations('NewParent')).toHaveLength(0);

    addKt(index, 'file:///A.kt', 'package p\nclass A : NewParent');
    expect(index.lookupImplementations('OldParent')).toHaveLength(0);
    expect(index.lookupImplementations('NewParent')).toHaveLength(1);
  });

  it('two implementors, one removed: other survives exactly', () => {
    addKt(index, 'file:///ImplA.kt', 'package p\nclass ImplA : IFace');
    addKt(index, 'file:///ImplB.kt', 'package p\nclass ImplB : IFace');
    expect(index.lookupImplementations('IFace')).toHaveLength(2);

    removeUri(index, 'file:///ImplA.kt');
    const remaining = index.lookupImplementations('IFace');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('ImplB');
  });

  it('re-index adds new supertype without duplication', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A : Parent');
    expect(index.lookupImplementations('Parent')).toHaveLength(1);

    // Re-add same file same content
    addKt(index, 'file:///A.kt', 'package p\nclass A : Parent');
    expect(index.lookupImplementations('Parent')).toHaveLength(1); // still 1, no duplicate
  });

  it('supertype word tracked in byWord: removed when file removed', () => {
    addKt(index, 'file:///Impl.kt', 'package p\nclass Impl : TrackedSupertype');
    addKt(index, 'file:///Other.kt', 'package p\nclass Other');
    index.finalize();

    // TrackedSupertype is in byWord because it's a supertype in Impl.kt
    const candidates = index.getFilesContainingWord('TrackedSupertype')!;
    expect(candidates.has('file:///Impl.kt')).toBe(true);

    removeUri(index, 'file:///Impl.kt');
    expect(index.getFilesContainingWord('TrackedSupertype')!.has('file:///Impl.kt')).toBe(false);
  });
});

// ── ADV-H: finalize() edge cases ─────────────────────────────────────────────

describe('ADV-H — finalize() edge cases', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('finalize() on empty index: getFilesContainingWord returns empty Set (not null)', () => {
    index.finalize();
    const result = index.getFilesContainingWord('anything');
    expect(result).not.toBeNull(); // null means "not ready"; empty Set means "ready but no match"
    expect(result!.size).toBe(0);
  });

  it('multiple finalize() calls are idempotent', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    index.finalize();
    index.finalize();
    index.finalize();

    const target = index.lookup('Alpha')[0];
    const candidates = index.getFilesContainingWord('Alpha', target)!;
    expect(candidates.has('file:///A.kt')).toBe(true);
    expect(candidates.size).toBe(1); // no duplication from multiple finalizes
  });

  it('add() after finalize() updates word index immediately (no second finalize needed)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Existing');
    index.finalize();

    // Add a new file that imports Existing — no second finalize needed for word index
    addKt(index, 'file:///B.kt', 'package q\nimport p.Existing\nval e = Existing()');
    // _wordIndexReady is still true after add(); word index was updated by add()

    const target = index.lookup('Existing')[0];
    const candidates = index.getFilesContainingWord('Existing', target)!;
    expect(candidates.has('file:///B.kt')).toBe(true);
  });

  it('remove() after finalize() keeps word index consistent (no finalize needed)', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    addKt(index, 'file:///B.kt', 'package p\nclass B');
    index.finalize();

    removeUri(index, 'file:///A.kt');

    // Word index should still be ready and correct without re-finalizing
    const bTarget = index.lookup('B')[0];
    const candidates = index.getFilesContainingWord('B', bTarget)!;
    expect(candidates).not.toBeNull();
    expect(candidates.has('file:///A.kt')).toBe(false);
    expect(candidates.has('file:///B.kt')).toBe(true);
  });

  it('clear() resets finalize state: getFilesContainingWord returns null after clear', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass A');
    index.finalize();
    expect(index.getFilesContainingWord('A')).not.toBeNull();

    index.clear();
    expect(index.getFilesContainingWord('A')).toBeNull(); // must be null, not empty Set
  });

  it('finalize() → add() → remove() → sequence: word index stays correct throughout', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass Alpha');
    index.finalize();

    addKt(index, 'file:///B.kt', 'package p\nimport q.Beta\nclass Beta');
    // B added AFTER finalize — _wordIndexReady still true

    const alpha = index.lookup('Alpha')[0];
    const beta  = index.lookup('Beta')[0];

    // Alpha: file A (byWord) + B (same package)
    expect(index.getFilesContainingWord('Alpha', alpha)!.has('file:///A.kt')).toBe(true);
    expect(index.getFilesContainingWord('Alpha', alpha)!.has('file:///B.kt')).toBe(true);

    // Beta: file B (byWord) + A (same package) — and "Beta" import segment also in B
    expect(index.getFilesContainingWord('Beta', beta)!.has('file:///B.kt')).toBe(true);
    expect(index.getFilesContainingWord('Beta', beta)!.has('file:///A.kt')).toBe(true);

    removeUri(index, 'file:///B.kt');

    // B gone — Alpha candidates reduced to just A
    expect(index.getFilesContainingWord('Alpha', alpha)!.has('file:///B.kt')).toBe(false);
  });
});

// ── ADV-I: stats() with FQN collisions ───────────────────────────────────────
//
// stats().symbols == byFqn.size (unique FQNs), not allEntries().length.
// When two files declare the same FQN, byFqn has 1 entry, but allEntries() has 2.

describe('ADV-I — stats().symbols counts unique FQNs, not total entries', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('two files same FQN: stats().symbols = 1, lookup().length = 2', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Collide');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Collide');

    expect(index.stats().files).toBe(2);
    expect(index.stats().symbols).toBe(1);   // byFqn has 1 entry (last-writer-wins)
    expect(index.lookup('Collide')).toHaveLength(2); // byName has both
  });

  it('after removing the overwriter: symbols still 1 (restored to first writer)', () => {
    addKt(index, 'file:///A.kt', 'package com.p\nclass Collide');
    addKt(index, 'file:///B.kt', 'package com.p\nclass Collide');
    removeUri(index, 'file:///B.kt');

    expect(index.stats().files).toBe(1);
    expect(index.stats().symbols).toBe(1); // A's FQN restored
    expect(index.lookup('Collide')).toHaveLength(1);
  });

  it('no FQN collision: symbols == allEntries().length', () => {
    addKt(index, 'file:///A.kt', 'package com.a\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.b\nclass Beta');
    addKt(index, 'file:///C.kt', 'package com.c\nclass Gamma');

    expect(index.stats().symbols).toBe(3);
    expect(index.allEntries()).toHaveLength(3);
  });
});

// ── ADV-J: Shared word, partial removal ──────────────────────────────────────
//
// "word X is contributed by files A, B, C" — removing A should not affect B or C.
// byWord[X] must go from {A, B, C} to {B, C}, not become corrupted.

describe('ADV-J — byWord shared word: partial removal preserves other contributors', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('10 files all contributing the same word: removing 9 leaves exactly 1', () => {
    for (let i = 0; i < 10; i++) {
      addKt(index, `file:///F${i}.kt`, `package pkg${i}\nclass SharedName`);
    }
    index.finalize();

    for (let i = 0; i < 9; i++) removeUri(index, `file:///F${i}.kt`);

    const target = index.lookup('SharedName')[0];
    const candidates = index.getFilesContainingWord('SharedName', target)!;
    expect(candidates.has('file:///F9.kt')).toBe(true);
    for (let i = 0; i < 9; i++) {
      expect(candidates.has(`file:///F${i}.kt`)).toBe(false);
    }
  });

  it('word contributed by explicit import survives after symbol-declaring file is removed', () => {
    addKt(index, 'file:///Decl.kt',   'package com.d\nclass ImportedName');
    addKt(index, 'file:///Importer.kt', 'package com.u\nimport com.d.ImportedName\nval n = ImportedName()');
    index.finalize();

    // "ImportedName" is in byWord for both files (Decl via symbol, Importer via import segment)
    removeUri(index, 'file:///Decl.kt');

    // Importer.kt still references the word via its import — must still be a candidate
    const candidates = index.getFilesContainingWord('ImportedName')!;
    expect(candidates.has('file:///Importer.kt')).toBe(true);
  });

  it('word contributed by wildcard import survives after declaring file is removed', () => {
    addKt(index, 'file:///Decl.kt',  'package com.d\nclass WildName');
    addKt(index, 'file:///User.kt',  'package com.u\nimport com.d.*\nval w = WildName()');
    index.finalize();

    const target = index.lookup('WildName')[0];
    removeUri(index, 'file:///Decl.kt');

    // User.kt is in byWildcard['com.d'] — still a candidate (byWord path no longer has declaring file)
    // but byWildcard still has User.kt since WildName was in com.d
    const candidates = index.getFilesContainingWord('WildName', target)!;
    // Note: target still exists (it was in byName/byFqn for Decl, now removed) —
    // we use the cached target reference, which still has packageName='com.d'
    expect(candidates.has('file:///User.kt')).toBe(true);
  });
});

// ── ADV-K: byName trigram consistency ─────────────────────────────────────────
//
// The trigram index feeds search(). If byName and byTrigram diverge after
// add/remove, search() returns stale results or misses valid ones.

describe('ADV-K — trigram index stays consistent with byName under mutations', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('search() finds re-indexed symbol after name change', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass OldName');
    index.finalize();
    expect(index.search('Old').some(e => e.name === 'OldName')).toBe(true);

    addKt(index, 'file:///A.kt', 'package p\nclass NewName');
    index.finalize();
    expect(index.search('Old').some(e => e.name === 'OldName')).toBe(false);
    expect(index.search('New').some(e => e.name === 'NewName')).toBe(true);
  });

  it('search() returns no results after clear()', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass SearchTarget');
    index.finalize();
    expect(index.search('SearchTarget')).toHaveLength(1);

    index.clear();
    index.finalize();
    expect(index.search('SearchTarget')).toHaveLength(0);
  });

  it('search() does not return entries from removed file', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass RemoveMe');
    addKt(index, 'file:///B.kt', 'package p\nclass KeepMe');
    index.finalize();

    removeUri(index, 'file:///A.kt');
    index.finalize();

    const results = index.search('Me');
    expect(results.some(e => e.name === 'RemoveMe')).toBe(false);
    expect(results.some(e => e.name === 'KeepMe')).toBe(true);
  });
});

// ── ADV-L: filterByKind consistency after mutations ───────────────────────────

describe('ADV-L — filterByKind stays in sync after add/remove', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('removed file entries do not appear in filterByKind', () => {
    addKt(index, 'file:///A.kt', 'package p\nclass ClassA\nfun funA() {}');
    addKt(index, 'file:///B.kt', 'package p\nclass ClassB');

    removeUri(index, 'file:///A.kt');

    const classes = index.filterByKind(new Set(['class']));
    expect(classes.some(e => e.name === 'ClassA')).toBe(false);
    expect(classes.some(e => e.name === 'funA')).toBe(false);
    expect(classes.some(e => e.name === 'ClassB')).toBe(true);
  });

  it('re-indexed file: only new kind appears in filterByKind', () => {
    addKt(index, 'file:///A.kt', 'package p\nfun oldFun() {}');
    addKt(index, 'file:///A.kt', 'package p\nclass NewClass');

    const classes = index.filterByKind(new Set(['class']));
    const funs    = index.filterByKind(new Set(['fun']));

    expect(classes.some(e => e.name === 'NewClass')).toBe(true);
    expect(funs.some(e => e.name === 'oldFun')).toBe(false);
  });
});

// ── ADV-M: Adversarial scale — stress-test cleanup at high volume ─────────────

describe('ADV-M — high-volume add/remove: no corruption at scale', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  it('50 files all same package: remove all, byPkg is clean', () => {
    for (let i = 0; i < 50; i++) {
      addKt(index, `file:///P${i}.kt`, `package com.mass\nclass Mass${i}`);
    }
    index.finalize();

    for (let i = 0; i < 50; i++) removeUri(index, `file:///P${i}.kt`);

    // After removing all files, no same-package candidates should exist
    // (the package itself should be gone from byPkg)
    // Add a probe file in the same package to verify
    addKt(index, 'file:///Probe.kt', 'package com.mass\nclass Probe');
    index.finalize();
    const probe = index.lookup('Probe')[0];
    const candidates = index.getFilesContainingWord('Probe', probe)!;
    // Only Probe.kt itself — none of the removed Mass files
    for (let i = 0; i < 50; i++) {
      expect(candidates.has(`file:///P${i}.kt`)).toBe(false);
    }
  });

  it('50 files all wildcard-importing same package: remove all, byWildcard is clean', () => {
    addKt(index, 'file:///Decl.kt', 'package com.target\nclass T');
    for (let i = 0; i < 50; i++) {
      addKt(index, `file:///W${i}.kt`, `package com.u${i}\nimport com.target.*\nval t${i} = T()`);
    }
    index.finalize();

    const target = index.lookup('T')[0];
    expect(index.getFilesContainingWord('T', target)!.size).toBe(51); // Decl + 50 wildcard importers

    for (let i = 0; i < 50; i++) removeUri(index, `file:///W${i}.kt`);

    const after = index.getFilesContainingWord('T', target)!;
    expect(after.size).toBe(1); // only Decl.kt remains
    expect(after.has('file:///Decl.kt')).toBe(true);
    for (let i = 0; i < 50; i++) {
      expect(after.has(`file:///W${i}.kt`)).toBe(false);
    }
  });

  it('100 add/remove cycles on same URI: index ends in correct state', () => {
    for (let i = 0; i < 100; i++) {
      addKt(index, 'file:///Cycle.kt', `package com.cycle\nclass Rev${i}`);
      if (i % 7 === 0) removeUri(index, 'file:///Cycle.kt');
    }
    // After 100 iterations, last add was Rev99 (99 % 7 ≠ 0)
    // Verify structural consistency
    if (index.fileUriStrings().includes('file:///Cycle.kt')) {
      const symbols = index.getFileSymbols('file:///Cycle.kt');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('Rev99');
    }
  });
});
