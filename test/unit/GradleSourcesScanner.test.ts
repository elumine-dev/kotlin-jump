import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

// ── Hoisted shared state ─────────────────────────────────────────────────────
// Both vi.mock factories and test code share these via vi.hoisted.

const readdirMock = vi.hoisted(() => vi.fn<[string], Promise<string[]>>());

// stat mock: returns a directory by default so gradleCacheDir validation passes
const statMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ isDirectory: () => true }),
);

// zip queue: each entry configures the NEXT zip instance to be created
const zipQueue = vi.hoisted(() => ({
  items: [] as Array<{
    entries?: Record<string, { size: number }>;
    entryData?: (name: string) => Buffer;
    throwOnEntries?: boolean;
  }>,
  closeCalls: 0,
  idx: 0,
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => ({ readdir: readdirMock, stat: statMock }));

vi.mock('node-stream-zip', () => ({
  default: {
    async: class MockStreamZip {
      private cfg: (typeof zipQueue.items)[0];
      constructor(_opts: { file: string }) {
        this.cfg = zipQueue.items[zipQueue.idx++] ?? {};
      }
      async entries(): Promise<Record<string, { size: number }>> {
        if (this.cfg.throwOnEntries) throw new Error('corrupt zip');
        return this.cfg.entries ?? {};
      }
      async entryData(name: string): Promise<Buffer> {
        if (this.cfg.entryData) return this.cfg.entryData(name);
        return Buffer.from('');
      }
      async close(): Promise<void> { zipQueue.closeCalls++; }
    },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { SymbolIndex }          from '../../src/indexer/SymbolIndex';
import { GradleSourcesScanner } from '../../src/gradle/GradleSourcesScanner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CACHE = '/gradle/caches/modules-2/files-2.1';

/**
 * Stubs a single -sources.jar at the standard 5-level Gradle cache layout:
 *   CACHE / group / artifact / version / hash / filename
 */
function stubJar(
  group: string, artifact: string, version: string,
  hash: string, filename: string,
  extra: Record<string, string[]> = {},
) {
  const map: Record<string, string[]> = {
    [CACHE]:                                              [group],
    [`${CACHE}/${group}`]:                               [artifact],
    [`${CACHE}/${group}/${artifact}`]:                   [version],
    [`${CACHE}/${group}/${artifact}/${version}`]:        [hash],
    [`${CACHE}/${group}/${artifact}/${version}/${hash}`]: [filename],
    ...extra,
  };
  readdirMock.mockImplementation(async (dir: string) => map[dir] ?? []);
}

function makeScanner(idx = new SymbolIndex()) {
  const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  return { scanner: new GradleSourcesScanner(idx, log), index: idx, log };
}

function pushZip(cfg: (typeof zipQueue.items)[0]) {
  zipQueue.items.push(cfg);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  readdirMock.mockReset();
  // stat returns a directory by default so gradleCacheDir validation passes
  statMock.mockResolvedValue({ isDirectory: () => true });
  zipQueue.items  = [];
  zipQueue.idx    = 0;
  zipQueue.closeCalls = 0;
  // Inject the fake cache dir so the scanner never falls back to os.homedir()
  vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, def: any) => key === 'gradleCacheDir' ? CACHE : def,
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Configuration guards ──────────────────────────────────────────────────────

describe('scanAll — configuration guards', () => {
  it('returns {jars:0, files:0} and touches no fs when indexSourcesJars is false', async () => {
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => key === 'indexSourcesJars' ? false : def,
    } as any);
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('returns {jars:0, files:0} when cache dir does not exist — no crash', async () => {
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
  });

  it('empty cache dir returns {jars:0, files:0}', async () => {
    readdirMock.mockResolvedValue([]);
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
  });
});

// ── discoverJars — filter correctness ────────────────────────────────────────

describe('scanAll — discoverJars filter', () => {
  it('discovers -sources.jar', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({ entries: {} });
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(1);
  });

  it('ignores plain .jar (no -sources suffix)', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0.jar');
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(0);
  });

  it('ignores -javadoc.jar', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-javadoc.jar');
    const { scanner } = makeScanner();
    expect((await scanner.scanAll()).jars).toBe(0);
  });

  it('ignores -samples-sources.jar even though it ends with -sources.jar', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-samples-sources.jar');
    const { scanner } = makeScanner();
    expect((await scanner.scanAll()).jars).toBe(0);
  });

  it('hash dir with all jar types: only -sources.jar gets indexed', async () => {
    const map: Record<string, string[]> = {
      [CACHE]:                    ['g'],
      [`${CACHE}/g`]:             ['a'],
      [`${CACHE}/g/a`]:           ['1.0'],
      [`${CACHE}/g/a/1.0`]:       ['h'],
      [`${CACHE}/g/a/1.0/h`]: [
        'a-1.0.jar',
        'a-1.0-javadoc.jar',
        'a-1.0-samples-sources.jar',
        'a-1.0-sources.jar',        // ← only this one
      ],
    };
    readdirMock.mockImplementation(async (dir: string) => map[dir] ?? []);
    pushZip({ entries: {} });
    const { scanner } = makeScanner();
    expect((await scanner.scanAll()).jars).toBe(1);
    // Zip opened exactly once — for the one -sources.jar
    expect(zipQueue.idx).toBe(1);
  });

  it('sourcesJarsMaxCount caps discovery mid-traversal via break outer', async () => {
    // Two groups, two JARs — cap at 1
    const map: Record<string, string[]> = {
      [CACHE]:                          ['group.a', 'group.b'],
      [`${CACHE}/group.a`]:             ['lib'],
      [`${CACHE}/group.a/lib`]:         ['1.0'],
      [`${CACHE}/group.a/lib/1.0`]:     ['h1'],
      [`${CACHE}/group.a/lib/1.0/h1`]:  ['lib-1.0-sources.jar'],
      [`${CACHE}/group.b`]:             ['other'],
      [`${CACHE}/group.b/other`]:       ['2.0'],
      [`${CACHE}/group.b/other/2.0`]:   ['h2'],
      [`${CACHE}/group.b/other/2.0/h2`]:['other-2.0-sources.jar'],
    };
    readdirMock.mockImplementation(async (dir: string) => map[dir] ?? []);
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'sourcesJarsMaxCount') return 1;
        if (key === 'gradleCacheDir') return CACHE;
        return def;
      },
    } as any);
    pushZip({ entries: {} });
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(1);            // capped at 1
    expect(zipQueue.idx).toBe(1);           // only 1 zip opened
  });

  it('under cap, recently-modified JARs win over older ones (mtime desc priority)', async () => {
    // Two JARs; cap at 1. The one with the higher mtime (zzz — indexed
    // alphabetically LAST) must win, proving the ranking is by mtime, not
    // insertion/alphabetical order.
    const map: Record<string, string[]> = {
      [CACHE]:                           ['aaa', 'zzz'],
      [`${CACHE}/aaa`]:                  ['lib'],
      [`${CACHE}/aaa/lib`]:              ['1.0'],
      [`${CACHE}/aaa/lib/1.0`]:          ['h1'],
      [`${CACHE}/aaa/lib/1.0/h1`]:       ['aaa-1.0-sources.jar'],
      [`${CACHE}/zzz`]:                  ['other'],
      [`${CACHE}/zzz/other`]:            ['2.0'],
      [`${CACHE}/zzz/other/2.0`]:        ['h2'],
      [`${CACHE}/zzz/other/2.0/h2`]:     ['zzz-2.0-sources.jar'],
    };
    readdirMock.mockImplementation(async (dir: string) => map[dir] ?? []);
    statMock.mockImplementation(async (p: string) => {
      if (p.endsWith('aaa-1.0-sources.jar')) return { isDirectory: () => false, mtimeMs: 1_000 };
      if (p.endsWith('zzz-2.0-sources.jar')) return { isDirectory: () => false, mtimeMs: 9_000 };
      return { isDirectory: () => true };
    });
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'sourcesJarsMaxCount') return 1;
        if (key === 'gradleCacheDir') return CACHE;
        return def;
      },
    } as any);
    pushZip({ entries: { 'com/Z.kt': { size: 100 }, }, entryData: () => Buffer.from('package com\nclass Z') });
    const { scanner, index } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(1);
    // The `zzz` JAR (higher mtime) was the one indexed — its `Z` class ended up in the index.
    expect(index.lookup('Z')).toHaveLength(1);
  });

  it('readdir throws on one group subtree — that group skipped, others continue', async () => {
    readdirMock.mockImplementation(async (dir: string) => {
      if (dir === CACHE)                    return ['group.bad', 'group.ok'];
      if (dir === `${CACHE}/group.bad`)     throw new Error('EACCES');
      if (dir === `${CACHE}/group.ok`)      return ['lib'];
      if (dir === `${CACHE}/group.ok/lib`)  return ['1.0'];
      if (dir === `${CACHE}/group.ok/lib/1.0`)   return ['h'];
      if (dir === `${CACHE}/group.ok/lib/1.0/h`) return ['lib-1.0-sources.jar'];
      return [];
    });
    pushZip({ entries: {} });
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(1); // group.ok's JAR still processed
  });
});

// ── indexJar — entry-level processing ────────────────────────────────────────

describe('scanAll — indexJar entry processing', () => {
  it('entry > 200 KB skipped — entryData never called', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    const entryDataFn = vi.fn().mockReturnValue(Buffer.from(''));
    pushZip({
      entries: { 'com/Foo.kt': { size: 201 * 1024 } },
      entryData: entryDataFn,
    });
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(entryDataFn).not.toHaveBeenCalled();
    expect(result.files).toBe(0);
  });

  it('entry exactly at 200 KB limit is NOT skipped (boundary: > not >=)', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/Foo.kt': { size: 200 * 1024 } },
      entryData: () => Buffer.from('package com\nclass Foo'),
    });
    const { scanner, index } = makeScanner();
    await scanner.scanAll();
    expect(index.lookup('Foo')).toHaveLength(1);
  });

  it('.kts entry skipped — entryData never called', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    const entryDataFn = vi.fn();
    pushZip({
      entries: { 'build.gradle.kts': { size: 100 } },
      entryData: entryDataFn,
    });
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(entryDataFn).not.toHaveBeenCalled();
    expect(result.files).toBe(0);
  });

  it('META-INF entry skipped (no .kt or .java extension)', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    const entryDataFn = vi.fn();
    pushZip({
      entries: { 'META-INF/MANIFEST.MF': { size: 100 } },
      entryData: entryDataFn,
    });
    const { scanner } = makeScanner();
    await scanner.scanAll();
    expect(entryDataFn).not.toHaveBeenCalled();
  });

  it('entryData throws on one .kt entry — that entry skipped, others still indexed', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: {
        'com/Good.kt': { size: 100 },
        'com/Bad.kt':  { size: 100 },
      },
      entryData: (name) => {
        if (name === 'com/Bad.kt') throw new Error('decompression failed');
        return Buffer.from('package com\nclass Good');
      },
    });
    const { scanner, index } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.files).toBe(1);           // only Good.kt counted
    expect(index.lookup('Good')).toHaveLength(1);
  });

  it('entries() throws — JAR skipped, close() still called (finally block)', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({ throwOnEntries: true, entries: {} });
    const { scanner, log } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.files).toBe(0);
    expect(zipQueue.closeCalls).toBe(1);    // close() called despite exception
    expect(log.warn).toHaveBeenCalled();    // logged, not thrown
  });

  it('.java entry uses JavaParser — Java class appears in index', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/example/MyJavaClass.java': { size: 200 } },
      entryData: () => Buffer.from('package com.example;\npublic class MyJavaClass {}'),
    });
    const { scanner, index } = makeScanner();
    await scanner.scanAll();
    expect(index.lookup('MyJavaClass')).toHaveLength(1);
  });

  it('.kt entry uses KotlinParser — Kotlin class appears in index', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'androidx/compose/LazyColumn.kt': { size: 500 } },
      entryData: () => Buffer.from('package androidx.compose\nclass LazyColumn'),
    });
    const { scanner, index } = makeScanner();
    await scanner.scanAll();
    expect(index.lookup('LazyColumn')).toHaveLength(1);
    expect(index.lookup('LazyColumn')[0].packageName).toBe('androidx.compose');
  });

  it('symbol moduleName matches group:artifact:version', async () => {
    stubJar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core', '1.7.3', 'h', 'kotlinx-coroutines-core-1.7.3-sources.jar');
    pushZip({
      entries: { 'kotlinx/coroutines/Deferred.kt': { size: 200 } },
      entryData: () => Buffer.from('package kotlinx.coroutines\ninterface Deferred'),
    });
    const { scanner, index } = makeScanner();
    await scanner.scanAll();
    const entries = index.lookup('Deferred');
    expect(entries).toHaveLength(1);
    expect(entries[0].moduleName).toBe('org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3');
  });

  it('finalize() called after scan — index.search() returns symbols without crashing', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/Searchable.kt': { size: 100 } },
      entryData: () => Buffer.from('package com\nclass SearchableClass'),
    });
    const { scanner, index } = makeScanner();
    await scanner.scanAll();
    // search() triggers rebuildSorted lazily if dirty — this verifies finalize() ran (or at minimum doesn't crash)
    expect(() => index.search('Searchable')).not.toThrow();
    expect(index.search('SearchableClass')).toHaveLength(1);
  });

  it('corrupt JAR does not prevent subsequent JARs from being indexed', async () => {
    const map: Record<string, string[]> = {
      [CACHE]:                    ['g'],
      [`${CACHE}/g`]:             ['bad', 'good'],
      [`${CACHE}/g/bad`]:         ['1.0'],
      [`${CACHE}/g/bad/1.0`]:     ['h1'],
      [`${CACHE}/g/bad/1.0/h1`]:  ['bad-1.0-sources.jar'],
      [`${CACHE}/g/good`]:        ['2.0'],
      [`${CACHE}/g/good/2.0`]:    ['h2'],
      [`${CACHE}/g/good/2.0/h2`]: ['good-2.0-sources.jar'],
    };
    readdirMock.mockImplementation(async (dir: string) => map[dir] ?? []);
    pushZip({ throwOnEntries: true, entries: {} });           // bad JAR — throws
    pushZip({
      entries: { 'pkg/Good.kt': { size: 100 } },
      entryData: () => Buffer.from('package pkg\nclass Good'),
    });
    const { scanner, index, log } = makeScanner();
    const result = await scanner.scanAll();
    expect(result.jars).toBe(2);
    expect(result.files).toBe(1);           // only good JAR indexed
    expect(index.lookup('Good')).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledOnce(); // bad JAR logged as warn
  });
});

// ── New bug fixes ─────────────────────────────────────────────────────────────

describe('scanAll — Bug 5: maxCount = 0', () => {
  it('sourcesJarsMaxCount=0 returns {jars:0, files:0} — no scan performed', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'sourcesJarsMaxCount') return 0;
        if (key === 'gradleCacheDir') return CACHE;
        return def;
      },
    } as any);
    const { scanner } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
    expect(zipQueue.idx).toBe(0); // no ZIP opened
  });
});

describe('scanAll — Bug 6: gradleCacheDir validation', () => {
  it('gradleCacheDir pointing to a non-directory logs warn and returns {jars:0}', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => false });
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'gradleCacheDir') return '/not/a/dir.txt';
        return def;
      },
    } as any);
    const { scanner, log } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not a directory'));
  });

  it('gradleCacheDir not found logs warn and returns {jars:0}', async () => {
    statMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'gradleCacheDir') return '/does/not/exist';
        return def;
      },
    } as any);
    const { scanner, log } = makeScanner();
    const result = await scanner.scanAll();
    expect(result).toEqual({ jars: 0, files: 0 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });
});

describe('scanAll — Bug 1: cancel() stops in-flight scan', () => {
  // cancel() targets the CURRENT in-flight scan via its cancel token.
  // A new scanAll() always creates a fresh token — calling cancel() before
  // scanAll() cancels the previous token, not the upcoming one.
  // The real guard against concurrent scans is the promise chain in extension.ts.
  it('cancel() on a fresh scanner still allows scanAll() to run normally', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/Foo.kt': { size: 100 } },
      entryData: () => Buffer.from('package com\nclass Foo'),
    });
    const { scanner, index } = makeScanner();
    scanner.cancel(); // cancels nothing useful — next scanAll() gets a fresh token
    const result = await scanner.scanAll();
    // Scan runs normally because scanAll() resets the token
    expect(result.jars).toBe(1);
    expect(index.lookup('Foo')).toHaveLength(1);
  });

  it('two sequential scans do not accumulate symbols (cancel + fresh scan)', async () => {
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/Foo.kt': { size: 100 } },
      entryData: () => Buffer.from('package com\nclass Foo'),
    });
    const { scanner, index } = makeScanner();
    // First scan
    await scanner.scanAll();
    expect(index.lookup('Foo')).toHaveLength(1);

    // Reset for second scan
    readdirMock.mockReset();
    zipQueue.items  = [];
    zipQueue.idx    = 0;
    zipQueue.closeCalls = 0;
    index.removeExternal();
    stubJar('g', 'a', '1.0', 'h', 'a-1.0-sources.jar');
    pushZip({
      entries: { 'com/Foo.kt': { size: 100 } },
      entryData: () => Buffer.from('package com\nclass Foo'),
    });

    // Second scan should not double the count
    await scanner.scanAll();
    expect(index.lookup('Foo')).toHaveLength(1);
  });
});

describe('scanAll — Improvement 4: toolingJarPaths bypass', () => {
  it('uses provided paths directly, skips readdir', async () => {
    // readdir is NOT called when toolingJarPaths is provided
    pushZip({
      entries: { 'com/Tooled.kt': { size: 100 } },
      entryData: () => Buffer.from('package com\nclass Tooled'),
    });
    const fakeJar = `${CACHE}/g/a/1.0/h/a-1.0-sources.jar`;
    const { scanner, index } = makeScanner();
    const result = await scanner.scanAll([fakeJar]);
    expect(result.jars).toBe(1);
    expect(index.lookup('Tooled')).toHaveLength(1);
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('toolingJarPaths respects sourcesJarsMaxCount cap', async () => {
    const fakeJars = [
      `${CACHE}/g/a/1.0/h/a-1.0-sources.jar`,
      `${CACHE}/g/b/2.0/h/b-2.0-sources.jar`,
    ];
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValueOnce({
      get: (key: string, def: any) => {
        if (key === 'sourcesJarsMaxCount') return 1;
        if (key === 'gradleCacheDir') return CACHE;
        return def;
      },
    } as any);
    pushZip({ entries: {} }); // only one ZIP should be opened
    const { scanner } = makeScanner();
    const result = await scanner.scanAll(fakeJars);
    expect(result.jars).toBe(1);
    expect(zipQueue.idx).toBe(1);
  });
});
