/**
 * Algebraic / model-based property tests for SymbolIndex.
 *
 * Each test verifies a mathematical property by building the SAME index state
 * via two DIFFERENT operation sequences and asserting all observable queries
 * produce identical results. This technique finds bugs that sequential tests
 * miss because sequential tests only exercise one path through the state machine.
 *
 * A failure here means the index is path-dependent in a way it shouldn't be —
 * the same logical state produces different answers depending on how it was built.
 *
 * Properties verified:
 *   MOD-1  remove(F) + add(F) = fresh add(F)       (state independence from history)
 *   MOD-2  add(F,v1) + add(F,v2) = fresh add(F,v2) (re-index idempotency)
 *   MOD-3  add(A,B) + remove(A) = fresh add(B)      (mutation isolation)
 *   MOD-4  insertion order is irrelevant for distinct files (commutativity)
 *   MOD-5  allEntries() = ⋃ getFileSymbols(uri) for all fileUriStrings()
 *   MOD-6  finalize() is idempotent (N calls = 1 call)
 *   MOD-7  word index remains correct after mutations post-finalize()
 *   MOD-8  clear() + add(F) = fresh index with add(F)
 */

import { describe, it, expect } from 'vitest';
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
 * Captures the full observable state of an index as sorted strings.
 * Two indices are semantically equal iff all four fields match.
 */
function snap(index: SymbolIndex): { files: string; entries: string; fqnMap: string; stats: string } {
  const uris    = [...index.fileUriStrings()].sort();
  const entries = index.allEntries().sort((a, b) => a.fqn.localeCompare(b.fqn) || a.uri.toString().localeCompare(b.uri.toString()));

  // FQN → winner URI (last-writer-wins)
  const uniqueFqns = [...new Set(entries.map(e => e.fqn))].sort();
  const fqnMap = uniqueFqns.map(fqn => {
    const winner = index.lookupFqn(fqn);
    return `${fqn}→${winner?.uri ?? 'MISSING'}`;
  }).join('\n');

  const { files, symbols } = index.stats();

  return {
    files:   uris.join(','),
    entries: entries.map(e => `${e.fqn}@${e.uri}`).join('\n'),
    fqnMap,
    stats:   `files=${files} symbols=${symbols}`,
  };
}

function assertEqual(a: ReturnType<typeof snap>, b: ReturnType<typeof snap>, ctx: string): void {
  expect(a.files,   `${ctx} — files`).toBe(b.files);
  expect(a.entries, `${ctx} — allEntries`).toBe(b.entries);
  expect(a.fqnMap,  `${ctx} — fqnMap`).toBe(b.fqnMap);
  expect(a.stats,   `${ctx} — stats`).toBe(b.stats);
}

// ── File stubs ────────────────────────────────────────────────────────────────
// Non-colliding FQNs unless explicitly stated. Packages are distinct per file.

const A = 'file:///A.kt';
const B = 'file:///B.kt';
const C = 'file:///C.kt';
const D = 'file:///D.kt';

const A1 = `package com.p\nclass Alpha`;
const A2 = `package com.p\nclass Alpha\nfun helper()`; // A with extra symbol

const B_SRC = `package com.q\nimport com.p.Alpha\nclass Beta : Alpha`;
const C_SRC = `package com.r\nimport com.q.*\nclass Gamma`;
const D_SRC = `package com.s\nimport com.p.Alpha\nimport com.q.Beta\nclass Delta`;

// ── MOD-1: history independence — remove + readd = fresh add ─────────────────

describe('MOD-1 — remove+readd produces identical state as fresh add', () => {
  it('single file: add → remove → add', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A1);

    const mut = new SymbolIndex();
    addKt(mut, A, A1);
    removeUri(mut, A);
    addKt(mut, A, A1);

    assertEqual(snap(ref), snap(mut), 'single file remove+readd');
  });

  it('5 add/remove cycles are idempotent', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A1);

    const mut = new SymbolIndex();
    for (let i = 0; i < 5; i++) {
      addKt(mut, A, A1);
      if (i < 4) removeUri(mut, A);
    }

    assertEqual(snap(ref), snap(mut), '5-cycle idempotency');
  });

  it('multi-file: add two, remove both, readd both', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A1); addKt(ref, B, B_SRC);

    const mut = new SymbolIndex();
    addKt(mut, A, A1); addKt(mut, B, B_SRC);
    removeUri(mut, A); removeUri(mut, B);
    addKt(mut, A, A1); addKt(mut, B, B_SRC);

    assertEqual(snap(ref), snap(mut), 'two-file remove+readd');
  });

  it('interleaved add/remove of unrelated files leaves no cross-contamination', () => {
    // Add A, add B, remove A, readd A — B must be unchanged
    const ref = new SymbolIndex();
    addKt(ref, A, A1); addKt(ref, B, B_SRC);

    const mut = new SymbolIndex();
    addKt(mut, B, B_SRC);
    addKt(mut, A, A1);
    removeUri(mut, A);
    addKt(mut, A, A1);

    assertEqual(snap(ref), snap(mut), 'interleaved remove+readd');
  });
});

// ── MOD-2: re-index idempotency — add(F,v2) replaces add(F,v1) ───────────────

describe('MOD-2 — add(F,v2) over add(F,v1) = fresh add(F,v2)', () => {
  it('add v1 then v2 = fresh v2', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A2);

    const mut = new SymbolIndex();
    addKt(mut, A, A1);
    addKt(mut, A, A2);

    assertEqual(snap(ref), snap(mut), 'v1 then v2');
  });

  it('add v1 ten times then v2 = fresh v2', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A2);

    const mut = new SymbolIndex();
    for (let i = 0; i < 10; i++) addKt(mut, A, A1);
    addKt(mut, A, A2);

    assertEqual(snap(ref), snap(mut), '10×v1 then v2');
  });

  it('v1 symbols absent from word candidates after re-index to v2', () => {
    // A2 adds `helper` that A1 lacks. After re-index, `helper` must appear.
    // No ghost entry of A1-only state must survive.
    const index = new SymbolIndex();
    addKt(index, A, A1);
    addKt(index, A, A2);
    index.finalize();

    const cands = index.getFilesContainingWord('helper');
    expect(cands, 'helper after re-index').not.toBeNull();
    expect(cands!.has(A)).toBe(true);
  });

  it('re-indexing with fewer symbols removes the dropped ones', () => {
    // Start with A2 (has `helper`), re-index to A1 (no `helper`)
    const index = new SymbolIndex();
    addKt(index, A, A2);
    addKt(index, A, A1);
    index.finalize();

    const cands = index.getFilesContainingWord('helper');
    expect(cands!.has(A), 'helper must be gone after downgrade re-index').toBe(false);
  });
});

// ── MOD-3: mutation isolation — add(A,B) + remove(A) = fresh add(B) ──────────

describe('MOD-3 — remove(A) leaves index identical to never having added A', () => {
  it('add A then B then remove A = fresh B', () => {
    const ref = new SymbolIndex();
    addKt(ref, B, B_SRC);

    const mut = new SymbolIndex();
    addKt(mut, A, A1); addKt(mut, B, B_SRC); removeUri(mut, A);

    assertEqual(snap(ref), snap(mut), 'remove A leaves B intact');
  });

  it('add B then A then remove B = fresh A', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A1);

    const mut = new SymbolIndex();
    addKt(mut, B, B_SRC); addKt(mut, A, A1); removeUri(mut, B);

    assertEqual(snap(ref), snap(mut), 'remove B leaves A intact');
  });

  it('add A,B,C,D then remove A,B = fresh C,D', () => {
    const ref = new SymbolIndex();
    addKt(ref, C, C_SRC); addKt(ref, D, D_SRC);

    const mut = new SymbolIndex();
    addKt(mut, A, A1); addKt(mut, B, B_SRC);
    addKt(mut, C, C_SRC); addKt(mut, D, D_SRC);
    removeUri(mut, A); removeUri(mut, B);

    assertEqual(snap(ref), snap(mut), 'remove two of four');
  });

  it('alternating add/remove sequence: final state depends only on last add', () => {
    const ref = new SymbolIndex();
    addKt(ref, A, A2); addKt(ref, B, B_SRC);

    const mut = new SymbolIndex();
    // noisy history: add/remove A three times with different versions, then stabilise
    addKt(mut, A, A1); addKt(mut, B, B_SRC); removeUri(mut, A);
    addKt(mut, A, A2); removeUri(mut, A); removeUri(mut, B);
    addKt(mut, B, B_SRC); addKt(mut, A, A2);

    assertEqual(snap(ref), snap(mut), 'alternating add/remove');
  });
});

// ── MOD-4: insertion order commutativity ─────────────────────────────────────
// For files with no FQN collision, adding in any order must produce the same result.

describe('MOD-4 — insertion order does not affect observable state (no FQN collision)', () => {
  it('add(A,B) = add(B,A): allEntries and stats match', () => {
    const i1 = new SymbolIndex(); addKt(i1, A, A1); addKt(i1, B, B_SRC);
    const i2 = new SymbolIndex(); addKt(i2, B, B_SRC); addKt(i2, A, A1);

    expect(i1.stats()).toEqual(i2.stats());

    const fqns1 = i1.allEntries().map(e => e.fqn).sort();
    const fqns2 = i2.allEntries().map(e => e.fqn).sort();
    expect(fqns1).toEqual(fqns2);
  });

  it('all 6 permutations of {A,B,C} produce the same FQN set', () => {
    const files: Array<[string, string]> = [[A, A1], [B, B_SRC], [C, C_SRC]];
    const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

    const snapshots = perms.map(perm => {
      const idx = new SymbolIndex();
      for (const i of perm) addKt(idx, files[i][0], files[i][1]);
      return idx.allEntries().map(e => e.fqn).sort().join(',');
    });

    const first = snapshots[0];
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i], `permutation ${i} vs 0`).toBe(first);
    }
  });

  it('word candidates after finalize are order-independent', () => {
    const i1 = new SymbolIndex();
    addKt(i1, A, A1); addKt(i1, B, B_SRC); addKt(i1, C, C_SRC); i1.finalize();

    const i2 = new SymbolIndex();
    addKt(i2, C, C_SRC); addKt(i2, A, A1); addKt(i2, B, B_SRC); i2.finalize();

    for (const word of ['Alpha', 'Beta', 'Gamma']) {
      const c1 = [...(i1.getFilesContainingWord(word) ?? [])].sort();
      const c2 = [...(i2.getFilesContainingWord(word) ?? [])].sort();
      expect(c1, `word '${word}' candidates must be order-independent`).toEqual(c2);
    }
  });
});

// ── MOD-5: allEntries() coherence ─────────────────────────────────────────────

describe('MOD-5 — allEntries() = ⋃ getFileSymbols(uri) for every fileUriStrings()', () => {
  function checkCoherence(index: SymbolIndex, label: string): void {
    const allFqns  = new Set(index.allEntries().map(e => e.fqn));
    const fileFqns = new Set(index.fileUriStrings().flatMap(u => index.getFileSymbols(u).map(e => e.fqn)));
    expect([...allFqns].sort(), `${label}: allEntries vs fileSymbols`).toEqual([...fileFqns].sort());
  }

  it('single file', () => {
    const idx = new SymbolIndex(); addKt(idx, A, A1);
    checkCoherence(idx, 'single');
  });

  it('four files', () => {
    const idx = new SymbolIndex();
    addKt(idx, A, A1); addKt(idx, B, B_SRC); addKt(idx, C, C_SRC); addKt(idx, D, D_SRC);
    checkCoherence(idx, 'four files');
  });

  it('after removal', () => {
    const idx = new SymbolIndex();
    addKt(idx, A, A1); addKt(idx, B, B_SRC); addKt(idx, C, C_SRC);
    removeUri(idx, B);
    checkCoherence(idx, 'after remove B');
  });

  it('after re-index', () => {
    const idx = new SymbolIndex();
    addKt(idx, A, A1); addKt(idx, B, B_SRC);
    addKt(idx, A, A2); // re-index A
    checkCoherence(idx, 'after re-index A');
  });
});

// ── MOD-6: finalize() idempotency ────────────────────────────────────────────

describe('MOD-6 — finalize() is idempotent', () => {
  it('5× finalize() produces same word candidates as 1× finalize()', () => {
    const i1 = new SymbolIndex(); addKt(i1, A, A1); addKt(i1, B, B_SRC); i1.finalize();
    const i2 = new SymbolIndex(); addKt(i2, A, A1); addKt(i2, B, B_SRC);
    for (let i = 0; i < 5; i++) i2.finalize();

    assertEqual(snap(i1), snap(i2), 'finalize idempotency');

    for (const word of ['Alpha', 'Beta']) {
      const c1 = [...(i1.getFilesContainingWord(word) ?? [])].sort();
      const c2 = [...(i2.getFilesContainingWord(word) ?? [])].sort();
      expect(c1, `word '${word}'`).toEqual(c2);
    }
  });

  it('finalize() does not mutate observable index state', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); addKt(index, B, B_SRC);
    const before = snap(index);
    index.finalize();
    const after = snap(index);

    assertEqual(before, after, 'finalize must not mutate entries/stats');
  });
});

// ── MOD-7: word index correctness after post-finalize mutations ───────────────

describe('MOD-7 — word index stays accurate through mutations after finalize()', () => {
  it('file added post-finalize is a candidate for its own symbol', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); index.finalize();

    // C not added yet — must not be a candidate
    expect(index.getFilesContainingWord('Gamma')!.has(C)).toBe(false);

    addKt(index, C, C_SRC);
    expect(index.getFilesContainingWord('Gamma')!.has(C)).toBe(true);
  });

  it('file removed post-finalize disappears from candidates', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); addKt(index, B, B_SRC); index.finalize();

    expect(index.getFilesContainingWord('Alpha')!.has(B)).toBe(true); // B imports Alpha

    removeUri(index, B);
    expect(index.getFilesContainingWord('Alpha')!.has(B)).toBe(false);
  });

  it('re-indexing post-finalize updates word candidates correctly', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); index.finalize(); // A1 has no `helper`

    expect(index.getFilesContainingWord('helper')!.has(A)).toBe(false);

    addKt(index, A, A2); // A2 adds `helper`
    expect(index.getFilesContainingWord('helper')!.has(A)).toBe(true);

    addKt(index, A, A1); // revert to A1
    expect(index.getFilesContainingWord('helper')!.has(A)).toBe(false);
  });

  it('wildcard import updated correctly on re-index post-finalize', () => {
    // C has `import com.q.*`; D has `import com.p.Alpha`
    const index = new SymbolIndex();
    addKt(index, A, A1); index.finalize();

    const alphaEntry = index.lookupFqn('com.p.Alpha')!;
    expect(alphaEntry).toBeDefined();

    addKt(index, C, C_SRC); // C: import com.q.* — not same-pkg as Alpha
    addKt(index, D, D_SRC); // D: import com.p.Alpha — explicit

    const cands = index.getFilesContainingWord('Alpha', alphaEntry);
    expect(cands!.has(D), 'D explicit-imports Alpha').toBe(true);
  });
});

// ── MOD-8: clear() resets completely ─────────────────────────────────────────

describe('MOD-8 — clear() + add(F) = fresh index with add(F)', () => {
  it('state after clear+readd equals fresh add', () => {
    const ref = new SymbolIndex(); addKt(ref, A, A1); addKt(ref, B, B_SRC);
    const mut = new SymbolIndex();
    addKt(mut, A, A1); addKt(mut, B, B_SRC);
    mut.clear();
    addKt(mut, A, A1); addKt(mut, B, B_SRC);
    assertEqual(snap(ref), snap(mut), 'clear+readd');
  });

  it('finalize() after clear+readd works as if on fresh index', () => {
    const ref = new SymbolIndex(); addKt(ref, A, A1); ref.finalize();
    const mut = new SymbolIndex();
    addKt(mut, A, A1); addKt(mut, B, B_SRC); addKt(mut, C, C_SRC);
    mut.clear();
    addKt(mut, A, A1); mut.finalize();

    assertEqual(snap(ref), snap(mut), 'clear+readd+finalize');

    const w1 = [...(ref.getFilesContainingWord('Alpha') ?? [])].sort();
    const w2 = [...(mut.getFilesContainingWord('Alpha') ?? [])].sort();
    expect(w1).toEqual(w2);
  });

  it('clear() leaves no stale state: all queries return empty/null', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); addKt(index, B, B_SRC); index.finalize();
    index.clear();

    expect(index.stats(),         'stats after clear').toEqual({ files: 0, symbols: 0 });
    expect(index.allEntries(),    'allEntries after clear').toHaveLength(0);
    expect(index.fileUriStrings(), 'fileUriStrings after clear').toHaveLength(0);
    expect(index.lookup('Alpha'), 'lookup after clear').toHaveLength(0);
    expect(index.lookupFqn('com.p.Alpha'), 'lookupFqn after clear').toBeUndefined();
    // Not ready after clear — must return null (triggers full-scan fallback)
    expect(index.getFilesContainingWord('Alpha'), 'word index null after clear').toBeNull();
  });

  it('clear() then finalize() on empty index is safe', () => {
    const index = new SymbolIndex();
    addKt(index, A, A1); index.finalize(); index.clear(); index.finalize();

    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
    expect(index.getFilesContainingWord('Alpha')).not.toBeNull(); // ready but empty
  });
});
