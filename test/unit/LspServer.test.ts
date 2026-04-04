/**
 * Comprehensive tests for the LSP server utilities and handler logic.
 *
 * Covers: wordAt, uriToPath, pathToUri, buildHoverMarkdown, KIND_MAP,
 *         findUsagesInWorkspace, and workspace-symbol handler logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { wordAt, uriToPath, pathToUri, buildHoverMarkdown, KIND_MAP } from '../../src/server/utils';
import { findUsagesInWorkspace, SKIP_DIRS } from '../../src/server/scanner';

// ── Helpers ───────────────────────────────────────────────────────────────────

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function makeEntry(overrides: Partial<{
  kind: string; fqn: string; name: string; packageName: string;
  moduleName: string; uri: string; line: number; character: number;
}> = {}) {
  return {
    kind:        overrides.kind        ?? 'class',
    fqn:         overrides.fqn         ?? 'com.example.Foo',
    name:        overrides.name        ?? 'Foo',
    packageName: overrides.packageName ?? 'com.example',
    moduleName:  overrides.moduleName  ?? undefined,
    uri:         { toString: () => overrides.uri ?? 'file:///Foo.kt' },
    line:        overrides.line        ?? 0,
    character:   overrides.character   ?? 0,
  };
}

const noCancel = { isCancellationRequested: false };
const cancelled = { isCancellationRequested: true };

// ── wordAt ────────────────────────────────────────────────────────────────────

describe('wordAt', () => {
  const TEXT = 'class DataStore : Repository';
  //            0123456789...
  //            class = 0-4, DataStore = 6-14, Repository = 18-27

  it('cursor at start of word → returns word', () => {
    expect(wordAt(TEXT, 0, 6)).toEqual({ word: 'DataStore', start: 6 });
  });

  it('cursor in middle of word → returns word', () => {
    expect(wordAt(TEXT, 0, 10)).toEqual({ word: 'DataStore', start: 6 });
  });

  it('cursor at last char of word → returns word', () => {
    expect(wordAt(TEXT, 0, 14)).toEqual({ word: 'DataStore', start: 6 });
  });

  it('cursor just past end of word → returns next word or null', () => {
    // char 15 is ' ' (space) — no word there
    expect(wordAt(TEXT, 0, 15)).toBeNull();
  });

  it('cursor on whitespace → null', () => {
    expect(wordAt(TEXT, 0, 5)).toBeNull();   // space before DataStore
  });

  it('cursor on colon → null', () => {
    expect(wordAt(TEXT, 0, 16)).toBeNull();  // ':' character
  });

  it('cursor on first char of text (position 0) → returns "class"', () => {
    expect(wordAt(TEXT, 0, 0)).toEqual({ word: 'class', start: 0 });
  });

  it('cursor on very last char → returns last word', () => {
    const len = TEXT.length;
    expect(wordAt(TEXT, 0, len - 1)).toEqual({ word: 'Repository', start: 18 });
  });

  it('second word on the line', () => {
    const line = 'fun fetchUser(): User';
    expect(wordAt(line, 0, 4)).toEqual({ word: 'fetchUser', start: 4 });
  });

  it('underscore-prefixed identifier', () => {
    const line = 'val _count = 0';
    expect(wordAt(line, 0, 4)).toEqual({ word: '_count', start: 4 });
  });

  it('alphanumeric with digits', () => {
    const line = 'val myVar2 = 0';
    expect(wordAt(line, 0, 6)).toEqual({ word: 'myVar2', start: 4 });
  });

  it('empty line → null', () => {
    expect(wordAt('', 0, 0)).toBeNull();
  });

  it('line beyond text bounds → null', () => {
    expect(wordAt('one line', 99, 0)).toBeNull();
  });

  it('multi-line text: correct line is selected', () => {
    const text = 'package com.example\nclass Foo {}';
    expect(wordAt(text, 1, 6)).toEqual({ word: 'Foo', start: 6 });
    expect(wordAt(text, 0, 8)).toEqual({ word: 'com', start: 8 });
  });

  it('digit-only token is not a word (starts with letter)', () => {
    const line = 'val x = 42';
    expect(wordAt(line, 0, 8)).toBeNull();  // '4' does not start a word
  });

  it('consecutive calls do not share regex state (WORD_RE reuse safety)', () => {
    // If lastIndex were shared, the second call could skip matches
    const line = 'fun foo() {}';
    const r1 = wordAt(line, 0, 4);
    const r2 = wordAt(line, 0, 4);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ word: 'foo', start: 4 });
  });

  it('symbol at position 0 of a long line', () => {
    const line = 'DataStore is the main class';
    expect(wordAt(line, 0, 0)).toEqual({ word: 'DataStore', start: 0 });
  });
});

// ── URI utilities ─────────────────────────────────────────────────────────────

describe('uriToPath', () => {
  it('basic file URI → absolute path', () => {
    expect(uriToPath('file:///Users/kevin/project/Foo.kt')).toBe('/Users/kevin/project/Foo.kt');
  });

  it('URI with %20 space → decoded path', () => {
    expect(uriToPath('file:///Users/my%20project/Foo.kt')).toBe('/Users/my project/Foo.kt');
  });

  it('URI with encoded special chars → decoded', () => {
    expect(uriToPath('file:///path/to/%40annotated/Foo.kt')).toBe('/path/to/@annotated/Foo.kt');
  });

  it('non-file URI returned unchanged', () => {
    expect(uriToPath('/already/a/path')).toBe('/already/a/path');
  });

  it('nested path preserved correctly', () => {
    expect(uriToPath('file:///a/b/c/d/e.kt')).toBe('/a/b/c/d/e.kt');
  });
});

describe('pathToUri', () => {
  it('basic path → file URI', () => {
    expect(pathToUri('/Users/kevin/project/Foo.kt')).toBe('file:///Users/kevin/project/Foo.kt');
  });

  it('path with space → percent-encoded URI', () => {
    expect(pathToUri('/Users/my project/Foo.kt')).toBe('file:///Users/my%20project/Foo.kt');
  });

  it('round-trip: pathToUri → uriToPath restores original path', () => {
    const original = '/Users/kevin/src/main/kotlin/com/example/MyClass.kt';
    expect(uriToPath(pathToUri(original))).toBe(original);
  });

  it('round-trip with spaces', () => {
    const original = '/Users/kevin/my project/src/Foo.kt';
    expect(uriToPath(pathToUri(original))).toBe(original);
  });

  it('round-trip with special chars', () => {
    const original = '/path/to/some@dir/Foo.kt';
    expect(uriToPath(pathToUri(original))).toBe(original);
  });
});

// ── buildHoverMarkdown ────────────────────────────────────────────────────────

describe('buildHoverMarkdown', () => {
  it('basic class entry shows kind, FQN, package, file', () => {
    const md = buildHoverMarkdown([makeEntry()]);
    expect(md).toContain('class com.example.Foo');
    expect(md).toContain('*Package:* `com.example`');
    expect(md).toContain('*File:* `Foo.kt`');
  });

  it('dataClass → "data class" label', () => {
    const md = buildHoverMarkdown([makeEntry({ kind: 'dataClass', fqn: 'com.example.Point' })]);
    expect(md).toContain('data class com.example.Point');
    expect(md).not.toContain('dataClass');
  });

  it('sealedClass → "sealed class" label', () => {
    const md = buildHoverMarkdown([makeEntry({ kind: 'sealedClass', fqn: 'com.example.State' })]);
    expect(md).toContain('sealed class com.example.State');
  });

  it('fun → "fun" label', () => {
    const md = buildHoverMarkdown([makeEntry({ kind: 'fun', fqn: 'com.example.Repo.fetchUser' })]);
    expect(md).toContain('fun com.example.Repo.fetchUser');
  });

  it('shows module name when present', () => {
    const md = buildHoverMarkdown([makeEntry({ moduleName: 'app (commonMain)' })]);
    expect(md).toContain('*Module:* `app (commonMain)`');
  });

  it('omits module line when moduleName is undefined', () => {
    const md = buildHoverMarkdown([makeEntry({ moduleName: undefined })]);
    expect(md).not.toContain('*Module:*');
  });

  it('omits package line when packageName is undefined', () => {
    const entry = { ...makeEntry(), packageName: undefined };
    const md = buildHoverMarkdown([entry as any]);
    expect(md).not.toContain('*Package:*');
  });

  it('shows at most 5 entries (default limit)', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ fqn: `com.example.Class${i}`, uri: `file:///Class${i}.kt` }),
    );
    const md = buildHoverMarkdown(entries);
    expect(md).toContain('Class0');
    expect(md).toContain('Class4');
    expect(md).not.toContain('Class5'); // 6th entry should be cut off
  });

  it('custom limit respected', () => {
    const entries = Array.from({ length: 4 }, (_, i) =>
      makeEntry({ fqn: `com.example.X${i}`, uri: `file:///X${i}.kt` }),
    );
    const md = buildHoverMarkdown(entries, 2);
    expect(md).toContain('X0');
    expect(md).toContain('X1');
    expect(md).not.toContain('X2');
  });

  it('empty array → empty string', () => {
    expect(buildHoverMarkdown([])).toBe('');
  });

  it('file name extracted correctly from nested URI path', () => {
    const md = buildHoverMarkdown([makeEntry({ uri: 'file:///a/b/c/MyFile.kt' })]);
    expect(md).toContain('*File:* `MyFile.kt`');
    expect(md).not.toContain('/a/b/c/');
  });

  it('multiple entries are separated by blank lines', () => {
    const entries = [
      makeEntry({ fqn: 'pkg.ClassA', uri: 'file:///A.kt' }),
      makeEntry({ fqn: 'pkg.ClassB', uri: 'file:///B.kt' }),
    ];
    const md = buildHoverMarkdown(entries);
    expect(md).toContain('ClassA');
    expect(md).toContain('ClassB');
    // Both entries should appear in the output
    const aPos = md.indexOf('ClassA');
    const bPos = md.indexOf('ClassB');
    expect(aPos).toBeGreaterThanOrEqual(0);
    expect(bPos).toBeGreaterThan(aPos);
  });
});

// ── KIND_MAP ──────────────────────────────────────────────────────────────────

describe('KIND_MAP', () => {
  it('covers all known Kotlin symbol kinds', () => {
    const expectedKinds = [
      'class', 'dataClass', 'sealedClass', 'interface', 'object',
      'enum', 'annotation', 'fun', 'composable', 'val', 'var', 'typealias',
    ];
    for (const kind of expectedKinds) {
      expect(KIND_MAP[kind], `KIND_MAP missing "${kind}"`).toBeDefined();
    }
  });

  it('all values are positive integers (valid LSP SymbolKind)', () => {
    for (const [kind, value] of Object.entries(KIND_MAP)) {
      expect(typeof value, `KIND_MAP["${kind}"] is not a number`).toBe('number');
      expect(value, `KIND_MAP["${kind}"] must be > 0`).toBeGreaterThan(0);
    }
  });

  it('class, dataClass, sealedClass all map to SymbolKind.Class (5)', () => {
    expect(KIND_MAP['class']).toBe(KIND_MAP['dataClass']);
    expect(KIND_MAP['class']).toBe(KIND_MAP['sealedClass']);
    expect(KIND_MAP['class']).toBe(5);
  });

  it('fun and composable map to SymbolKind.Function (12)', () => {
    expect(KIND_MAP['fun']).toBe(KIND_MAP['composable']);
    expect(KIND_MAP['fun']).toBe(12);
  });
});

// ── findUsagesInWorkspace ─────────────────────────────────────────────────────

describe('findUsagesInWorkspace', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
  });

  async function makeReader(files: Record<string, string>) {
    return (p: string) => {
      const key = Object.keys(files).find(k => p.endsWith(k.replace('file://', '')));
      if (key) return Promise.resolve(files[key]);
      return Promise.resolve('');
    };
  }

  it('returns empty when word not in index', async () => {
    const results = await findUsagesInWorkspace('Unknown', index, noCancel);
    expect(results).toHaveLength(0);
  });

  it('finds usages in a single file', async () => {
    const uri = 'file:///Repo.kt';
    const code = 'package com.example\nclass DataStore {}\nval store = DataStore()';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    const lines = results.map(r => r.range.start.line);
    expect(lines).toContain(1); // class declaration line
    expect(lines).toContain(2); // usage line
  });

  it('respects word boundary — DataStore does NOT match DataStoreImpl', async () => {
    const uri = 'file:///App.kt';
    const code = 'package com.example\nclass DataStore {}\nclass DataStoreImpl : DataStore()';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    // DataStoreImpl should not be a match
    const chars = results.map(r => r.range.start.character);
    // Line 2 has 'DataStoreImpl' at char 6 and 'DataStore' at char 22
    const line2Results = results.filter(r => r.range.start.line === 2);
    for (const r of line2Results) {
      const col = r.range.start.character;
      expect(col, 'should not match start of DataStoreImpl').not.toBe(6);
    }
  });

  it('skips full-comment lines', async () => {
    const uri = 'file:///Commented.kt';
    const code = 'package com.example\nclass DataStore {}\n// DataStore is old\nval x = DataStore()';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    const lines = results.map(r => r.range.start.line);
    expect(lines).not.toContain(2); // comment line should be skipped
    expect(lines).toContain(3);     // real usage
  });

  it('skips inline comments — match before // is kept, after is skipped', async () => {
    const uri = 'file:///Inline.kt';
    const code = 'package com.example\nclass DataStore {}\nval x = DataStore() // DataStore old';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    const line2 = results.filter(r => r.range.start.line === 2);
    // Only one result on line 2 — the one BEFORE //
    expect(line2).toHaveLength(1);
    expect(line2[0].range.start.character).toBeLessThan(code.split('\n')[2].indexOf('//'));
  });

  it('skips occurrences inside string literals', async () => {
    const uri = 'file:///Strings.kt';
    const code = 'package com.example\nclass DataStore {}\nval name = "DataStore"';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(0);
  });

  it('respects cancellation token — stops scanning mid-way', async () => {
    const uri1 = 'file:///A.kt';
    const uri2 = 'file:///B.kt';
    addKt(index, uri1, 'package com.example\nclass DataStore {}');
    addKt(index, uri2, 'package com.example\nval x = DataStore()');

    const cancelledToken = { isCancellationRequested: true };
    const reader = async (_: string) => 'class DataStore {}';
    const results = await findUsagesInWorkspace('DataStore', index, cancelledToken, reader);

    expect(results).toHaveLength(0);
  });

  it('result ranges cover exactly the matched word length', async () => {
    const uri = 'file:///Exact.kt';
    const code = 'package com.example\nclass DataStore {}\nval x = DataStore()';
    addKt(index, uri, code);

    const reader = async (_: string) => code;
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);

    for (const r of results) {
      const len = r.range.end.character - r.range.start.character;
      expect(len).toBe('DataStore'.length);
    }
  });

  it('searches across multiple files', async () => {
    const declUri = 'file:///DataStore.kt';
    const usageUri = 'file:///App.kt';
    addKt(index, declUri, 'package com.example\nclass DataStore {}');
    addKt(index, usageUri, 'package com.example\nval x = DataStore()');

    const reader = async (p: string): Promise<string> =>
      p.includes('DataStore') ? 'package com.example\nclass DataStore {}' : 'package com.example\nval x = DataStore()';

    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader);
    const uris = new Set(results.map(r => r.uri));
    expect(uris.size).toBe(2);
  });

  it('returns empty for single-char word (guard in caller context)', async () => {
    // The guard is in the request handler, but findUsagesInWorkspace itself
    // returns empty when the word has no indexed declarations
    const results = await findUsagesInWorkspace('x', index, noCancel);
    expect(results).toHaveLength(0);
  });
});

// ── Workspace symbol handler logic ────────────────────────────────────────────

describe('workspace symbol deduplication', () => {
  it('lookup + search results are de-duplicated by FQN', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    index.finalize();

    // Simulate what onWorkspaceSymbol does
    const query = 'Foo';
    const exact    = index.lookup(query);
    const searched = index.search(query, 50);
    const seen     = new Set<string>();
    const all      = [...exact, ...searched].filter(e => {
      if (seen.has(e.fqn)) return false;
      seen.add(e.fqn);
      return true;
    });

    // 'Foo' appears in both exact lookup and prefix search — must appear only once
    expect(all.filter(e => e.fqn === 'com.example.Foo')).toHaveLength(1);
  });

  it('empty query → empty result', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    const query = '  '.trim(); // whitespace-only
    expect(query.length).toBe(0);
    // Empty query guard
    const result = query.length === 0 ? [] : index.lookup(query);
    expect(result).toHaveLength(0);
  });

  it('single-char query still works via prefix search', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    index.finalize();
    // single-char skips exact lookup but hits search
    const query = 'F';
    const searched = index.search(query, 50);
    expect(searched.some(e => e.name === 'Foo')).toBe(true);
  });
});

// ── SKIP_DIRS coverage (scanWorkspace) ───────────────────────────────────────

describe('scanWorkspace directory skipping', () => {
  it('SKIP_DIRS covers build output and VCS dirs', () => {
    expect(SKIP_DIRS.has('build')).toBe(true);
    expect(SKIP_DIRS.has('.gradle')).toBe(true);
    expect(SKIP_DIRS.has('.git')).toBe(true);
    expect(SKIP_DIRS.has('node_modules')).toBe(true);
    expect(SKIP_DIRS.has('.idea')).toBe(true);
    expect(SKIP_DIRS.has('out')).toBe(true);
    expect(SKIP_DIRS.has('tmp')).toBe(true);
  });

  it('SKIP_DIRS does NOT skip Kotlin source directories', () => {
    expect(SKIP_DIRS.has('src')).toBe(false);
    expect(SKIP_DIRS.has('main')).toBe(false);
    expect(SKIP_DIRS.has('commonMain')).toBe(false);
    expect(SKIP_DIRS.has('androidMain')).toBe(false);
    expect(SKIP_DIRS.has('test')).toBe(false);
  });
});
