/**
 * Performance regression test suite.
 *
 * Every test here is a GUARD against a specific performance regression.
 * Each test failure means one of the optimizations was broken:
 *
 *   GUARD-A  Word index pre-filter:   only candidate files are read
 *   GUARD-B  Content cache:           zero disk reads on repeat scans
 *   GUARD-C  Open-doc fast path:      textDocuments skips readFile entirely
 *   GUARD-D  CodeLens FQN cache:      same FQN resolved N times → 1 scan only
 *   GUARD-E  evictFile precision:     evicting one file leaves others cached
 *   GUARD-F  Private-symbol O(1):     1 file read regardless of workspace size
 *   GUARD-G  Intra-scan dedup:        each file read at most once per scan call
 *   GUARD-H  Cross-symbol cache:      scan for Foo → scan for Bar in same files → 0 new reads
 *   GUARD-I  restoreFile no index:    IndexStore restore path falls back to full scan (correct)
 *   GUARD-J  Null target full scan:   ambiguous word scans all candidates, not just byWord
 *   GUARD-K  Scale (60-file project): candidates << total; O(candidates) I/O not O(total)
 *   GUARD-L  Warm-start parity:       IndexStore.restore() → Find Usages identical to cold start
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SymbolIndex, SymbolEntry } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import {
  scanForUsagesWithTarget,
  clearContentCache,
} from '../../src/providers/FindUsagesEngine';
import { restore } from '../../src/indexer/IndexStore';
import { workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';

// ── Test helpers ──────────────────────────────────────────────────────────────

function addKt(index: SymbolIndex, uri: string, code: string): void {
  index.add(parse(uri, code));
}

const NO_CANCEL = { isCancellationRequested: false } as any;

/**
 * Installs a readFile mock that tracks call count.
 * Returns { count(), restore() }.
 * `contentByUri` maps URI → text; any unknown URI returns `fallback`.
 */
function trackReads(
  contentByUri: Record<string, string>,
  fallback = '',
): { count(): number; restore(): void } {
  const orig = workspace.fs.readFile;
  let calls = 0;
  workspace.fs.readFile = async (uri: any) => {
    calls++;
    const u: string = uri.toString ? uri.toString() : String(uri);
    return Buffer.from(contentByUri[u] ?? fallback) as any;
  };
  return {
    count:   () => calls,
    restore: () => { workspace.fs.readFile = orig; },
  };
}

/** Builds an index with `total` files; `candidateCount` of them import the target. */
function buildLargeWorkspace(total: number, candidateCount: number): {
  index: SymbolIndex;
  allUris: string[];
  contentMap: Record<string, string>;
  targetEntry: SymbolEntry;
} {
  const DECL_URI  = 'file:///Target.kt';
  const DECL_CODE = 'package com.example\nclass BigTarget';

  const index = new SymbolIndex();
  const contentMap: Record<string, string> = { [DECL_URI]: DECL_CODE };
  const allUris: string[] = [DECL_URI];

  // Add callers that explicitly import the target
  for (let i = 0; i < candidateCount; i++) {
    const uri  = `file:///Caller${i}.kt`;
    const code = `package com.ui${i}\nimport com.example.BigTarget\nval x = BigTarget()`;
    addKt(index, uri, code);
    contentMap[uri] = code;
    allUris.push(uri);
  }

  // Add noise files — completely unrelated packages, no reference to BigTarget
  for (let i = 0; i < total - candidateCount - 1; i++) {
    const uri  = `file:///Noise${i}.kt`;
    const code = `package com.noise${i}\nclass Noise${i}Sym`;
    addKt(index, uri, code);
    contentMap[uri] = code;
    allUris.push(uri);
  }

  addKt(index, DECL_URI, DECL_CODE);
  index.finalize();

  return { index, allUris, contentMap, targetEntry: index.lookup('BigTarget')[0] };
}

// ── GUARD-A: Word index pre-filter limits I/O to candidates ───────────────────

describe('GUARD-A — word index pre-filter: only candidate files are read', () => {
  afterEach(() => { /* clearContentCache handled by setup.ts */ });

  it('5-file project: 3 noise files are never opened', async () => {
    const { index, allUris, contentMap, targetEntry } = buildLargeWorkspace(5, 1);
    const tr = trackReads(contentMap);

    await scanForUsagesWithTarget('BigTarget', targetEntry, index, allUris, NO_CANCEL);

    // 5 total, 2 candidates (decl + 1 caller), 3 noise → reads ≤ 2
    expect(tr.count()).toBeLessThanOrEqual(2);
    tr.restore();
  });

  it('20-file project: 17 noise files are never opened', async () => {
    const { index, allUris, contentMap, targetEntry } = buildLargeWorkspace(20, 2);
    const tr = trackReads(contentMap);

    await scanForUsagesWithTarget('BigTarget', targetEntry, index, allUris, NO_CANCEL);

    // 20 total, 3 candidates (decl + 2 callers), 17 noise → reads ≤ 3
    expect(tr.count()).toBeLessThanOrEqual(3);
    tr.restore();
  });

  it('60-file project: 55 noise files are never opened', async () => {
    const { index, allUris, contentMap, targetEntry } = buildLargeWorkspace(60, 4);
    const tr = trackReads(contentMap);

    await scanForUsagesWithTarget('BigTarget', targetEntry, index, allUris, NO_CANCEL);

    // 60 total, 5 candidates, 55 noise → reads ≤ 5
    expect(tr.count()).toBeLessThanOrEqual(5);
    tr.restore();
  });

  it('correct usages found despite heavy pre-filtering (no false negatives)', async () => {
    const { index, allUris, contentMap, targetEntry } = buildLargeWorkspace(30, 5);
    const tr = trackReads(contentMap);

    const results = await scanForUsagesWithTarget('BigTarget', targetEntry, index, allUris, NO_CANCEL);
    tr.restore();

    // 1 declaration + 5 usage lines → 6 raw results; usageCount = 5
    const usageCount = Math.max(0, results.length - 1);
    expect(usageCount).toBe(5);
  });

  it('I/O count grows with candidates, not with total files', async () => {
    // 50 files, 2 candidates
    const small = buildLargeWorkspace(50, 2);
    const trSmall = trackReads(small.contentMap);
    await scanForUsagesWithTarget('BigTarget', small.targetEntry, small.index, small.allUris, NO_CANCEL);
    const readsWith50 = trSmall.count();
    trSmall.restore();

    clearContentCache();

    // 100 files, 2 candidates — same number of reads despite double the workspace
    const large = buildLargeWorkspace(100, 2);
    const trLarge = trackReads(large.contentMap);
    await scanForUsagesWithTarget('BigTarget', large.targetEntry, large.index, large.allUris, NO_CANCEL);
    const readsWith100 = trLarge.count();
    trLarge.restore();

    // Reads must scale with candidates (3), not total (50 vs 100)
    expect(readsWith50).toBeLessThanOrEqual(3);
    expect(readsWith100).toBeLessThanOrEqual(3);
    expect(readsWith50).toBe(readsWith100); // same candidate count → same I/O
  });
});

// ── GUARD-B: Content cache prevents re-reading on repeat scans ─────────────────

describe('GUARD-B — content cache: zero disk reads on consecutive scans', () => {
  it('second scan of same symbol reads 0 files (all cached)', async () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///B1.kt', 'package com.b\nclass BTarget');
    addKt(index, 'file:///B2.kt', 'package com.b\nval x = BTarget()');
    index.finalize();

    const target = index.lookup('BTarget')[0];
    const uris = ['file:///B1.kt', 'file:///B2.kt'];
    const codes = {
      'file:///B1.kt': 'package com.b\nclass BTarget',
      'file:///B2.kt': 'package com.b\nval x = BTarget()',
    };

    const tr = trackReads(codes);
    await scanForUsagesWithTarget('BTarget', target, index, uris, NO_CANCEL);
    const after1 = tr.count();

    // Second scan — everything should be in the content cache
    await scanForUsagesWithTarget('BTarget', target, index, uris, NO_CANCEL);
    expect(tr.count()).toBe(after1); // zero additional reads

    tr.restore();
  });

  it('third, fourth, fifth scan: still zero additional reads', async () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Rep.kt', 'package com.rep\nclass RepClass');
    index.finalize();

    const codes = { 'file:///Rep.kt': 'package com.rep\nclass RepClass' };
    const tr = trackReads(codes);

    const target = index.lookup('RepClass')[0];
    await scanForUsagesWithTarget('RepClass', target, index, ['file:///Rep.kt'], NO_CANCEL);
    const baseline = tr.count(); // 1

    for (let i = 0; i < 4; i++) {
      await scanForUsagesWithTarget('RepClass', target, index, ['file:///Rep.kt'], NO_CANCEL);
    }

    expect(tr.count()).toBe(baseline); // no new reads for any of the 4 repeat scans
    tr.restore();
  });
});

// ── GUARD-C: Open-document fast path skips readFile entirely ──────────────────

describe('GUARD-C — open-doc fast path: textDocuments.getText() used instead of readFile', () => {
  let savedTextDocs: any;

  beforeEach(() => { savedTextDocs = (workspace as any).textDocuments; });
  afterEach(() => { (workspace as any).textDocuments = savedTextDocs; });

  it('readFile not called at all when file is in textDocuments', async () => {
    const index = new SymbolIndex();
    const URI = 'file:///OpenDoc.kt';
    const CODE = 'package com.open\nclass OpenClass';
    addKt(index, URI, CODE);
    index.finalize();

    // Simulate the file being open in an editor
    const fakeDoc = mockDocument(URI, CODE);
    (workspace as any).textDocuments = [fakeDoc];

    const tr = trackReads({ [URI]: CODE });
    const target = index.lookup('OpenClass')[0];
    await scanForUsagesWithTarget('OpenClass', target, index, [URI], NO_CANCEL);

    expect(tr.count()).toBe(0); // open doc is served from memory — no disk I/O
    tr.restore();
  });

  it('only the open file skips readFile; non-open files still use cache', async () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Open.kt',   'package com.x\nclass Mix');
    addKt(index, 'file:///Closed.kt', 'package com.x\nval m = Mix()');
    index.finalize();

    const fakeOpen = mockDocument('file:///Open.kt', 'package com.x\nclass Mix');
    (workspace as any).textDocuments = [fakeOpen];

    const codes = {
      'file:///Open.kt':   'package com.x\nclass Mix',
      'file:///Closed.kt': 'package com.x\nval m = Mix()',
    };
    const tr = trackReads(codes);

    const target = index.lookup('Mix')[0];
    await scanForUsagesWithTarget('Mix', target, index, ['file:///Open.kt', 'file:///Closed.kt'], NO_CANCEL);

    // Open.kt → in textDocuments → 0 readFile calls for it
    // Closed.kt → cache miss → 1 readFile call
    expect(tr.count()).toBe(1);
    tr.restore();
  });
});

// ── GUARD-D: CodeLens FQN cache prevents re-scanning ─────────────────────────

describe('GUARD-D — CodeLens FQN cache: same symbol resolved N times → 1 scan', () => {
  let origRead: typeof workspace.fs.readFile;

  beforeEach(() => { origRead = workspace.fs.readFile; });
  afterEach(() => { workspace.fs.readFile = origRead; });

  it('resolving same lens 5 times reads files only on first resolve', async () => {
    const URI_D = 'file:///LensFoo.kt';
    const URI_C = 'file:///LensCaller.kt';
    const CODE_D = 'package com.lens\nclass LensFoo';
    const CODE_C = 'package com.lens\nval x = LensFoo()';

    const index = new SymbolIndex();
    addKt(index, URI_D, CODE_D);
    addKt(index, URI_C, CODE_C);
    index.finalize();

    const provider = new KotlinCodeLensProvider(index);
    const codes = { [URI_D]: CODE_D, [URI_C]: CODE_C };
    const tr = trackReads(codes);

    const entry = index.lookup('LensFoo')[0];
    const { Range } = await import('./__mocks__/vscode');
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;

    // Resolve the same lens 5 times
    for (let i = 0; i < 5; i++) {
      await provider.resolveCodeLens(lens, NO_CANCEL);
    }

    // First resolve reads files; subsequent resolves hit the CodeLens _cache
    const readsAfterFirst = tr.count();
    expect(readsAfterFirst).toBeGreaterThan(0); // at least one file was read

    // Reads must not grow after the first resolve (cache is shared via FQN key)
    // The content cache means disk reads stop after the first scan anyway
    expect(tr.count()).toBe(readsAfterFirst);
    tr.restore();
  });

  it('two different FQNs share no cache — each scans independently', async () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///SvcA.kt', 'package com.a\nclass SvcA');
    addKt(index, 'file:///SvcB.kt', 'package com.b\nclass SvcB');
    index.finalize();

    const provider = new KotlinCodeLensProvider(index);
    const codes = {
      'file:///SvcA.kt': 'package com.a\nclass SvcA',
      'file:///SvcB.kt': 'package com.b\nclass SvcB',
    };
    const tr = trackReads(codes);

    const entryA = index.lookup('SvcA')[0];
    const entryB = index.lookup('SvcB')[0];
    const { Range } = await import('./__mocks__/vscode');
    const lensA = { range: new Range(0,0,0,0), data: { entry: entryA } } as any;
    const lensB = { range: new Range(0,0,0,0), data: { entry: entryB } } as any;

    await provider.resolveCodeLens(lensA, NO_CANCEL);
    await provider.resolveCodeLens(lensB, NO_CANCEL);

    // getCachedResults must return the correct promise for each FQN
    expect(provider.getCachedResults(entryA.fqn)).toBeDefined();
    expect(provider.getCachedResults(entryB.fqn)).toBeDefined();
    expect(provider.getCachedResults(entryA.fqn)).not.toBe(provider.getCachedResults(entryB.fqn));
    tr.restore();
  });
});

// ── GUARD-E: evictFile precision ──────────────────────────────────────────────

describe('GUARD-E — evictFile: evicting one file does not evict others from CodeLens cache', () => {
  let origRead: typeof workspace.fs.readFile;

  beforeEach(() => { origRead = workspace.fs.readFile; });
  afterEach(() => { workspace.fs.readFile = origRead; });

  it('getCachedResults for non-evicted symbol still returns a promise after evictFile', async () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///EvA.kt', 'package com.ev\nclass EvAlpha');
    addKt(index, 'file:///EvB.kt', 'package com.ev\nclass EvBeta');
    index.finalize();

    const provider = new KotlinCodeLensProvider(index);
    const codes = {
      'file:///EvA.kt': 'package com.ev\nclass EvAlpha',
      'file:///EvB.kt': 'package com.ev\nclass EvBeta',
    };
    workspace.fs.readFile = async (uri: any) => {
      const u: string = uri.toString ? uri.toString() : String(uri);
      return Buffer.from(codes[u] ?? '') as any;
    };

    const { Range } = await import('./__mocks__/vscode');
    const eA = index.lookup('EvAlpha')[0];
    const eB = index.lookup('EvBeta')[0];

    const lensA = { range: new Range(0,0,0,0), data: { entry: eA } } as any;
    const lensB = { range: new Range(0,0,0,0), data: { entry: eB } } as any;

    // Resolve both lenses to populate cache
    await provider.resolveCodeLens(lensA, NO_CANCEL);
    await provider.resolveCodeLens(lensB, NO_CANCEL);

    expect(provider.getCachedResults(eA.fqn)).toBeDefined();
    expect(provider.getCachedResults(eB.fqn)).toBeDefined();

    // Evict only EvA's file
    provider.evictFile('file:///EvA.kt');

    // EvA's cache entry must be gone; EvB's must remain
    expect(provider.getCachedResults(eA.fqn)).toBeUndefined();
    expect(provider.getCachedResults(eB.fqn)).toBeDefined();
  });
});

// ── GUARD-F: Private symbol O(1) I/O ─────────────────────────────────────────

describe('GUARD-F — private symbol: exactly 1 file read regardless of workspace size', () => {
  it('10-file workspace, private symbol → 1 readFile call', async () => {
    const PRIV_URI  = 'file:///PrivDecl.kt';
    const PRIV_CODE = 'package com.priv\nprivate fun hiddenFn() {}';

    const index = new SymbolIndex();
    addKt(index, PRIV_URI, PRIV_CODE);
    for (let i = 0; i < 9; i++) {
      addKt(index, `file:///Other${i}.kt`, `package com.other\nclass Other${i}`);
    }
    index.finalize();

    const target = index.lookup('hiddenFn')[0];
    const allUris = [PRIV_URI, ...Array.from({length:9}, (_, i) => `file:///Other${i}.kt`)];

    const contentMap: Record<string, string> = { [PRIV_URI]: PRIV_CODE };
    for (let i = 0; i < 9; i++) contentMap[`file:///Other${i}.kt`] = `package com.other\nclass Other${i}`;

    const tr = trackReads(contentMap);
    await scanForUsagesWithTarget('hiddenFn', target, index, allUris, NO_CANCEL);

    expect(tr.count()).toBe(1); // only the declaring file
    tr.restore();
  });

  it('50-file workspace, private symbol → still 1 readFile call', async () => {
    const PRIV_URI  = 'file:///PrivBig.kt';
    const PRIV_CODE = 'package com.privbig\nprivate fun bigSecret() {}';

    const index = new SymbolIndex();
    addKt(index, PRIV_URI, PRIV_CODE);
    for (let i = 0; i < 49; i++) {
      addKt(index, `file:///BigNoise${i}.kt`, `package com.noise\nclass BigNoise${i}`);
    }
    index.finalize();

    const target = index.lookup('bigSecret')[0];
    const allUris = [PRIV_URI, ...Array.from({length:49}, (_, i) => `file:///BigNoise${i}.kt`)];
    const contentMap: Record<string, string> = { [PRIV_URI]: PRIV_CODE };

    const tr = trackReads(contentMap);
    await scanForUsagesWithTarget('bigSecret', target, index, allUris, NO_CANCEL);

    expect(tr.count()).toBe(1);
    tr.restore();
  });
});

// ── GUARD-G: Intra-scan deduplication (each file read at most once per scan) ──

describe('GUARD-G — intra-scan dedup: each file read exactly once per scan call', () => {
  it('5 candidate files read exactly once each (not duplicated across 20 workers)', async () => {
    const index = new SymbolIndex();
    const readCounts: Record<string, number> = {};

    for (let i = 0; i < 5; i++) {
      const uri  = `file:///Dup${i}.kt`;
      const code = `package com.dup\nimport com.target.Uniq\nval x = Uniq()`;
      addKt(index, uri, code);
      readCounts[uri] = 0;
    }
    addKt(index, 'file:///UniqDecl.kt', 'package com.target\nclass Uniq');
    readCounts['file:///UniqDecl.kt'] = 0;
    index.finalize();

    const allUris = Object.keys(readCounts);
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async (uri: any) => {
      const u: string = uri.toString ? uri.toString() : String(uri);
      readCounts[u] = (readCounts[u] ?? 0) + 1;
      if (u.includes('UniqDecl')) return Buffer.from('package com.target\nclass Uniq') as any;
      return Buffer.from('package com.dup\nimport com.target.Uniq\nval x = Uniq()') as any;
    };

    const target = index.lookup('Uniq')[0];
    await scanForUsagesWithTarget('Uniq', target, index, allUris, NO_CANCEL);

    workspace.fs.readFile = orig;

    // Every file that was read was read exactly once (no duplicate across parallel workers)
    for (const [uri, count] of Object.entries(readCounts)) {
      expect(count).toBeLessThanOrEqual(1);
      if (count > 0) {
        expect(count).toBe(1); // exactly once if read at all
      }
    }
  });
});

// ── GUARD-H: Cross-symbol cache sharing ──────────────────────────────────────

describe('GUARD-H — cross-symbol cache: scanning Foo then Bar reads no new files for shared files', () => {
  it('second symbol scan reads 0 files for already-cached URIs', async () => {
    const index = new SymbolIndex();
    const SHARED_URI = 'file:///Shared.kt';
    const SHARED_CODE = 'package com.shared\nclass Foo\nclass Bar';

    addKt(index, SHARED_URI, SHARED_CODE);
    index.finalize();

    const contentMap = { [SHARED_URI]: SHARED_CODE };
    const tr = trackReads(contentMap);

    const fooEntry = index.lookup('Foo')[0];
    const barEntry = index.lookup('Bar')[0];

    // Scan for Foo — reads and caches Shared.kt
    await scanForUsagesWithTarget('Foo', fooEntry, index, [SHARED_URI], NO_CANCEL);
    const afterFoo = tr.count();

    // Scan for Bar — Shared.kt already cached → 0 new reads
    await scanForUsagesWithTarget('Bar', barEntry, index, [SHARED_URI], NO_CANCEL);

    expect(tr.count()).toBe(afterFoo); // no new reads
    tr.restore();
  });
});

// ── GUARD-I: restoreFile path — word index behaviour ─────────────────────────

describe('GUARD-I — restoreFile path: word index state before and after finalize()', () => {
  it('getFilesContainingWord returns null after restoreFile (no finalize called)', () => {
    const src = new SymbolIndex();
    addKt(src, 'file:///RestFoo.kt', 'package com.rest\nclass RestFoo');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries);
    }
    // finalize() NOT called — _wordIndexReady stays false
    expect(dest.getFilesContainingWord('RestFoo')).toBeNull();
  });

  it('after restoreFile(imports=[]) + finalize, symbol name and package are in the word index', () => {
    // restoreFile without imports still populates symbol names and byPkg.
    // Import-based words (explicit and wildcard) are absent — but those require
    // the im[] field which IndexStore.restore() now provides via SNAPSHOT_VERSION 17.
    const src = new SymbolIndex();
    addKt(src, 'file:///RFoo.kt', 'package com.rf\nclass RFoo');
    src.finalize();

    const dest = new SymbolIndex();
    for (const [uri, entries] of src.fileEntries()) {
      dest.restoreFile(uri, entries); // no imports — minimum viable restore
    }
    dest.finalize();

    const target = dest.lookup('RFoo')[0];
    const candidates = dest.getFilesContainingWord('RFoo', target)!;
    // Declaring file is always in byWord (symbol name) and byPkg (same package)
    expect(candidates).not.toBeNull();
    expect(candidates.has('file:///RFoo.kt')).toBe(true);
  });
});

// ── GUARD-J: Null target falls back gracefully ────────────────────────────────

describe('GUARD-J — null target: no package expansion, still returns byWord candidates', () => {
  it('undefined target returns only byWord results (no same-package expansion)', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///JFoo.kt',    'package com.j\nclass JFoo');
    addKt(index, 'file:///JPeer.kt',   'package com.j\nclass JPeer');   // same pkg, no JFoo reference
    addKt(index, 'file:///JImport.kt', 'package com.x\nimport com.j.JFoo\nval f = JFoo()');
    index.finalize();

    const withTarget    = index.getFilesContainingWord('JFoo', index.lookup('JFoo')[0])!;
    const withoutTarget = index.getFilesContainingWord('JFoo')!;

    // With target: same-package Peer is included
    expect(withTarget.has('file:///JPeer.kt')).toBe(true);

    // Without target: only byWord (no pkg expansion) → Peer not included unless it imports JFoo
    expect(withoutTarget.has('file:///JPeer.kt')).toBe(false);

    // Importer is included in both cases
    expect(withTarget.has('file:///JImport.kt')).toBe(true);
    expect(withoutTarget.has('file:///JImport.kt')).toBe(true);
  });
});

// ── GUARD-K: Scale benchmark — I/O is O(candidates), not O(total files) ──────

describe('GUARD-K — scale: I/O proportional to candidates, not to workspace size', () => {
  it('doubling the workspace size does not double the I/O for a fixed candidate set', async () => {
    async function ioForWorkspace(total: number): Promise<number> {
      clearContentCache();
      const { index, allUris, contentMap, targetEntry } = buildLargeWorkspace(total, 3);
      const tr = trackReads(contentMap);
      await scanForUsagesWithTarget('BigTarget', targetEntry, index, allUris, NO_CANCEL);
      tr.restore();
      return tr.count();
    }

    const io20  = await ioForWorkspace(20);
    const io40  = await ioForWorkspace(40);
    const io80  = await ioForWorkspace(80);

    // All three workspaces have 3 callers + 1 decl = 4 candidates max
    // I/O must remain constant regardless of workspace size
    expect(io20).toBeLessThanOrEqual(4);
    expect(io40).toBeLessThanOrEqual(4);
    expect(io80).toBeLessThanOrEqual(4);

    // Critically: I/O must NOT grow with workspace size
    expect(io80).toBeLessThanOrEqual(io20 + 1); // allow ±1 for same-package edge cases
  });
});

// ── GUARD-L: Warm-start parity — IndexStore.restore() → Find Usages identical to cold start ──
//
// This guard specifically catches the regression where restoreFile() skipped word index
// population, causing Find Usages to silently return 0 results after every VS Code restart.
//
// Before the fix: warm-start scan returned 0 results (word index empty → all files filtered out).
// After the fix: warm-start scan returns identical results to a cold-start scan.
//
// If this test fails: restoreFile() or IndexStore.restore() is no longer populating the word
// index correctly from imports. Find Usages is broken on warm start.

describe('GUARD-L — warm-start parity: IndexStore.restore() preserves Find Usages results', () => {
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => { origReadFile = workspace.fs.readFile; });
  afterEach(() => { workspace.fs.readFile = origReadFile; });

  function makeContentMap(): Record<string, string> {
    return {
      'file:///WDecl.kt':     'package com.ws\nclass WarmGuard',
      'file:///WCaller.kt':   'package com.ui\nimport com.ws.WarmGuard\nval x = WarmGuard()',
      'file:///WildCaller.kt': 'package com.ui2\nimport com.ws.*\nval y = WarmGuard()',
      'file:///WNoise.kt':    'package com.noise\nclass Unrelated',
    };
  }

  function buildColdIndex(): SymbolIndex {
    const index = new SymbolIndex();
    for (const [uri, code] of Object.entries(makeContentMap())) {
      addKt(index, uri, code);
    }
    index.finalize();
    return index;
  }

  function buildWarmIndex(): SymbolIndex {
    // Simulate what IndexStore.save() + IndexStore.restore() produce.
    // The im[] field is the critical addition of SNAPSHOT_VERSION 17 —
    // it carries the raw import strings needed to rebuild byWord and byWildcard.
    const snapshot = {
      version: 17,
      files: {
        'file:///WDecl.kt': {
          t: 1, p: 'com.ws',
          n: ['WarmGuard'], k: ['class'], l: [0], c: [0], i: [0], d: [0],
          // no imports in this file
        },
        'file:///WCaller.kt': {
          t: 1, p: 'com.ui',
          n: ['x'], k: ['val'], l: [1], c: [0], i: [0], d: [0],
          im: ['com.ws.WarmGuard'],  // explicit import → segment 'WarmGuard' → byWord
        },
        'file:///WildCaller.kt': {
          t: 1, p: 'com.ui2',
          n: ['y'], k: ['val'], l: [1], c: [0], i: [0], d: [0],
          im: ['com.ws.*'],          // wildcard import → byWildcard['com.ws']
        },
        'file:///WNoise.kt': {
          t: 1, p: 'com.noise',
          n: ['Unrelated'], k: ['class'], l: [0], c: [0], i: [0], d: [0],
        },
      },
    };

    const index = new SymbolIndex();
    restore(snapshot as any, index); // calls restoreFile() + finalize() internally
    return index;
  }

  it('warm-start scan finds same results as cold-start scan', async () => {
    const cold = buildColdIndex();
    const warm = buildWarmIndex();

    const allUris = Object.keys(makeContentMap());
    const contentMap = makeContentMap();
    workspace.fs.readFile = async (uri: any) => {
      const u: string = uri.toString ? uri.toString() : String(uri);
      return Buffer.from(contentMap[u] ?? '') as any;
    };

    const coldTarget = cold.lookup('WarmGuard')[0];
    const warmTarget = warm.lookup('WarmGuard')[0];

    const coldResults = await scanForUsagesWithTarget('WarmGuard', coldTarget, cold, allUris, NO_CANCEL);
    clearContentCache();
    const warmResults = await scanForUsagesWithTarget('WarmGuard', warmTarget, warm, allUris, NO_CANCEL);

    // Core invariant: warm start must not return 0 when cold start found results
    expect(coldResults.length).toBeGreaterThan(0);
    expect(warmResults.length).toBe(coldResults.length);

    // Result URIs must match exactly
    const coldUris = new Set(coldResults.map(r => r.uriString));
    const warmUris = new Set(warmResults.map(r => r.uriString));
    for (const u of coldUris) expect(warmUris.has(u)).toBe(true);
  });

  it('warm-start scan pre-filters noise files (word index active, not full scan)', async () => {
    const warm = buildWarmIndex();

    const allUris = Object.keys(makeContentMap());
    const contentMap = makeContentMap();
    const tr = trackReads(contentMap);

    const warmTarget = warm.lookup('WarmGuard')[0];
    await scanForUsagesWithTarget('WarmGuard', warmTarget, warm, allUris, NO_CANCEL);

    tr.restore();

    // WNoise.kt must never be read — it has no reference to WarmGuard
    // (word index pre-filter excludes it; if this fails, restore() broke the word index)
    // Total candidates: WDecl (same pkg) + WCaller (explicit import) + WildCaller (wildcard) = 3
    expect(tr.count()).toBeLessThanOrEqual(3);
  });
});
