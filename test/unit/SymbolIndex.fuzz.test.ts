/**
 * Deterministic fuzz tests for SymbolIndex.
 *
 * A seeded PRNG generates random sequences of operations (add / remove / re-index
 * / finalize / clear). After EVERY operation, a full structural invariant suite
 * checks the index is in a consistent state.
 *
 * Seeds are fixed — failures are always reproducible. On any failure, the error
 * message includes the seed and the full operation sequence for easy replay.
 *
 * Why this finds bugs that hand-crafted tests miss:
 *   - Explores paths through the state machine that no human would write
 *   - Interleaves finalize() with mutations at unexpected moments
 *   - Exercises rapid add/remove cycles on the same URI
 *   - Hits edge cases in per-file maps when files are partially added
 *
 * Invariants checked after every operation:
 *   FZ-1  allEntries() == ⋃ getFileSymbols(uri) (map coherence)
 *   FZ-2  every entry is reachable via lookup(name)
 *   FZ-3  lookupFqn(fqn) defined for every FQN in allEntries()
 *   FZ-4  lookupFqn returns entry with the correct FQN
 *   FZ-5  stats().symbols == |unique FQNs in allEntries()|
 *   FZ-6  stats().files == fileUriStrings().length
 *   FZ-7  no URI in fileUriStrings() has an empty getFileSymbols()
 *   FZ-8  (post-finalize) declaring file is always a word candidate
 *   FZ-9  (post-finalize) word candidates are all known indexed URIs
 */

import { describe, it, expect } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// ── PRNG ─────────────────────────────────────────────────────────────────────
// Mulberry32 — fast, good distribution, deterministic on a fixed seed.

function mkRng(seed: number): () => number {
  let t = seed >>> 0;
  return function next(): number {
    t += 0x6D2B79F5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ── File pool ────────────────────────────────────────────────────────────────
// 10 source files with intentionally overlapping packages, imports, supertypes,
// and FQN collisions. This stress-tests all 9 maps in SymbolIndex simultaneously.

const POOL: Array<{ uri: string; code: string }> = [
  {
    uri: 'file:///P0.kt',
    code: 'package com.a\nclass Foo : Base',
  },
  {
    uri: 'file:///P1.kt',
    code: 'package com.a\nimport com.b.Bar\nclass Baz : Bar',  // same pkg as P0
  },
  {
    uri: 'file:///P2.kt',
    code: 'package com.b\nclass Bar\nclass Qux',
  },
  {
    uri: 'file:///P3.kt',
    code: 'package com.b\nimport com.a.*\nclass Snap',  // wildcard import of com.a
  },
  {
    uri: 'file:///P4.kt',
    code: 'package com.c\nimport com.a.Foo\nimport com.b.Bar\nfun run()',
  },
  {
    uri: 'file:///P5.kt',
    code: 'package com.d\nclass Foo',  // FQN collision with P0 (both named Foo, different pkg → no collision)
  },
  {
    uri: 'file:///P6.kt',
    code: 'package com.a\nclass Foo',  // FQN collision with P0 (com.a.Foo)
  },
  {
    uri: 'file:///P7.kt',
    code: 'package com.e\nimport com.d.*\nclass Wibble : Foo',
  },
  {
    uri: 'file:///P8.kt',
    code: `package com.f
import com.a.Baz
class Outer {
  class Inner
  fun method()
}`,
  },
  {
    uri: 'file:///P9.kt',
    code: 'package com.g\nimport com.f.Outer\nclass Consumer',
  },
];

// ── Invariant checker ────────────────────────────────────────────────────────

function checkInvariants(index: SymbolIndex, isFinalized: boolean, label: string): void {
  const uris    = index.fileUriStrings();
  const allE    = index.allEntries();
  const { files, symbols } = index.stats();

  // FZ-6: stats.files = fileUriStrings().length
  expect(files, `${label} FZ-6`).toBe(uris.length);

  // FZ-1: allEntries() == union of getFileSymbols()
  const fromFiles = uris.flatMap(u => index.getFileSymbols(u).map(e => e.fqn)).sort();
  const fromAll   = allE.map(e => e.fqn).sort();
  expect(fromAll, `${label} FZ-1`).toEqual(fromFiles);

  // FZ-7: no URI has empty getFileSymbols (empty files not stored)
  for (const uri of uris) {
    expect(index.getFileSymbols(uri).length, `${label} FZ-7 ${uri}`).toBeGreaterThan(0);
  }

  // FZ-2: every entry accessible via lookup(name)
  for (const e of allE) {
    const found = index.lookup(e.name);
    expect(
      found.some(x => x.fqn === e.fqn),
      `${label} FZ-2: lookup('${e.name}') must include '${e.fqn}'`,
    ).toBe(true);
  }

  // FZ-3 + FZ-4: lookupFqn defined and returns correct FQN for every allEntries() FQN
  const seenFqns = new Set<string>();
  for (const e of allE) {
    if (seenFqns.has(e.fqn)) continue;
    seenFqns.add(e.fqn);

    const winner = index.lookupFqn(e.fqn);
    expect(winner, `${label} FZ-3: lookupFqn('${e.fqn}') defined`).toBeDefined();
    expect(winner!.fqn, `${label} FZ-4: fqn roundtrip`).toBe(e.fqn);
  }

  // FZ-5: stats.symbols == |unique FQNs|
  expect(symbols, `${label} FZ-5`).toBe(seenFqns.size);

  // FZ-8 + FZ-9 (post-finalize only)
  if (isFinalized) {
    const knownUris = new Set(uris);

    for (const e of allE) {
      const cands = index.getFilesContainingWord(e.name, e);
      expect(cands, `${label} FZ-8 word index ready`).not.toBeNull();

      // FZ-8: declaring file always a candidate for its own symbol name
      expect(
        cands!.has(e.uri.toString()),
        `${label} FZ-8: declaring file '${e.uri}' must be a candidate for '${e.name}'`,
      ).toBe(true);

      // FZ-9: no unknown URIs in candidates
      for (const u of cands!) {
        expect(
          knownUris.has(u),
          `${label} FZ-9: unknown URI '${u}' in candidates for '${e.name}'`,
        ).toBe(true);
      }
    }
  }
}

// ── Fuzz runner ───────────────────────────────────────────────────────────────

type FuzzOp =
  | { kind: 'add';      idx: number }
  | { kind: 'remove';   idx: number }
  | { kind: 'finalize' }
  | { kind: 'clear' };

function fuzz(seed: number, numOps: number): void {
  const rng     = mkRng(seed);
  const index   = new SymbolIndex();
  const active  = new Set<number>(); // pool indices currently in index
  const history: string[] = [];
  let   isFinalized = false;

  for (let step = 0; step < numOps; step++) {
    const r   = rng();
    let   op: FuzzOp;

    if (r < 0.35) {
      op = { kind: 'add', idx: Math.floor(rng() * POOL.length) };
    } else if (r < 0.55 && active.size > 0) {
      const activeArr = [...active];
      op = { kind: 'remove', idx: activeArr[Math.floor(rng() * activeArr.length)] };
    } else if (r < 0.75) {
      op = { kind: 'finalize' };
    } else {
      op = { kind: 'clear' };
    }

    // Apply
    switch (op.kind) {
      case 'add':
        index.add(parse(POOL[op.idx].uri, POOL[op.idx].code));
        // Only count as active if file has symbols (SymbolIndex skips empty files)
        active.add(op.idx);
        history.push(`add(P${op.idx})`);
        break;
      case 'remove':
        index.remove({ toString: () => POOL[op.idx].uri } as any);
        active.delete(op.idx);
        history.push(`remove(P${op.idx})`);
        break;
      case 'finalize':
        index.finalize();
        isFinalized = true;
        history.push('finalize()');
        break;
      case 'clear':
        index.clear();
        active.clear();
        isFinalized = false;
        history.push('clear()');
        break;
    }

    // Check invariants — on failure, report seed + full sequence
    try {
      checkInvariants(index, isFinalized, `seed=${seed} step=${step} op=${history[history.length - 1]}`);
    } catch (err) {
      const seq = history.join(' → ');
      throw new Error(
        `Fuzz invariant failure:\n` +
        `  seed: ${seed}\n` +
        `  step: ${step}\n` +
        `  sequence: ${seq}\n` +
        `  error: ${(err as Error).message}`,
      );
    }
  }
}

// ── Test cases ────────────────────────────────────────────────────────────────
// Each seed exercises a different random path through the state machine.
// Seeds are chosen to cover distinct structural patterns.

describe('SymbolIndex fuzz — deterministic random operation sequences', () => {
  it('seed 0x1A2B3C4D — 100 ops, general mix', () => {
    fuzz(0x1A2B3C4D, 100);
  });

  it('seed 0xDEADBEEF — 100 ops, tends to cluster on same files', () => {
    fuzz(0xDEADBEEF, 100);
  });

  it('seed 0xCAFEBABE — 120 ops, FQN-collision-heavy (P0 vs P6 both com.a.Foo)', () => {
    fuzz(0xCAFEBABE, 120);
  });

  it('seed 0x00FF00FF — 80 ops, heavy clear/reinit cycles', () => {
    fuzz(0x00FF00FF, 80);
  });

  it('seed 0xABCD1234 — 150 ops, high add/remove churn', () => {
    fuzz(0xABCD1234, 150);
  });

  it('seed 0x12345678 — 200 ops, large session simulation', () => {
    fuzz(0x12345678, 200);
  });
});

// ── Targeted mini-fuzz: specific patterns ─────────────────────────────────────

describe('SymbolIndex targeted mini-fuzz', () => {
  it('50 alternating add/remove on same file — no state leak', () => {
    const index = new SymbolIndex();
    let isFinalized = false;
    for (let i = 0; i < 50; i++) {
      index.add(parse(POOL[0].uri, POOL[0].code));
      checkInvariants(index, isFinalized, `add step ${i}`);
      index.remove({ toString: () => POOL[0].uri } as any);
      checkInvariants(index, isFinalized, `remove step ${i}`);
    }
    expect(index.stats()).toEqual({ files: 0, symbols: 0 });
  });

  it('50 re-indexes on same URI — final state only reflects last add', () => {
    const uri = 'file:///Reindex.kt';
    const v1  = 'package com.x\nclass Foo';
    const v2  = 'package com.x\nclass Bar\nfun helper()';
    const index = new SymbolIndex();
    for (let i = 0; i < 50; i++) {
      index.add(parse(uri, i % 2 === 0 ? v1 : v2));
      checkInvariants(index, false, `re-index step ${i}`);
    }
    // Last add was v1 (i=49, odd → v2... wait, 49%2=1 → v2)
    // i=49 is odd → v2 (Bar + helper)
    index.finalize();
    checkInvariants(index, true, 'after 50 re-indexes');
    expect(index.stats().files).toBe(1);    // only one URI
    expect(index.lookup('Bar')).toHaveLength(1);  // v2 wins
    expect(index.lookup('Foo')).toHaveLength(0);  // v1 fully replaced
  });

  it('FQN collision: add P0 and P6 (both com.a.Foo), remove in various orders', () => {
    // P0 and P6 both declare `com.a.Foo` — last-writer wins in byFqn
    for (const [first, second] of [[0, 6], [6, 0]]) {
      const index = new SymbolIndex();
      index.add(parse(POOL[first].uri, POOL[first].code));
      index.add(parse(POOL[second].uri, POOL[second].code));
      checkInvariants(index, false, `add P${first}+P${second}`);

      // Remove second (current winner) — first must be restored
      index.remove({ toString: () => POOL[second].uri } as any);
      checkInvariants(index, false, `after remove P${second}`);
      const winner = index.lookupFqn('com.a.Foo');
      expect(winner, 'com.a.Foo must be restored to first writer').toBeDefined();
      expect(winner!.uri.toString()).toBe(POOL[first].uri);
    }
  });

  it('finalize() interleaved with rapid mutations — word index stays correct', () => {
    const index = new SymbolIndex();
    let isFinalized = false;

    for (let i = 0; i < 30; i++) {
      const file = POOL[i % POOL.length];
      index.add(parse(file.uri, file.code));

      if (i % 5 === 0) {
        index.finalize();
        isFinalized = true;
      }
      if (i % 7 === 0 && i > 0) {
        const removeIdx = (i - 1) % POOL.length;
        index.remove({ toString: () => POOL[removeIdx].uri } as any);
      }

      checkInvariants(index, isFinalized, `interleaved step ${i}`);
    }
  });

  it('clear() between sessions: no cross-session contamination', () => {
    const index = new SymbolIndex();

    // Session 1
    index.add(parse(POOL[0].uri, POOL[0].code));
    index.add(parse(POOL[1].uri, POOL[1].code));
    index.finalize();
    checkInvariants(index, true, 'session 1');
    const s1Files = index.stats().files;

    // Session 2 — clear and rebuild with different files
    index.clear();
    index.add(parse(POOL[5].uri, POOL[5].code));
    index.add(parse(POOL[6].uri, POOL[6].code));
    index.add(parse(POOL[7].uri, POOL[7].code));
    index.finalize();
    checkInvariants(index, true, 'session 2');

    // Session 1 files must be completely absent
    expect(index.getFileSymbols(POOL[0].uri)).toHaveLength(0);
    expect(index.getFileSymbols(POOL[1].uri)).toHaveLength(0);
    expect(index.stats().files).not.toBe(s1Files + 3); // no accumulation
    expect(index.stats().files).toBe(3);
  });
});
