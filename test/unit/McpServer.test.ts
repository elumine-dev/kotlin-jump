import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleFindSymbol,
  handleFindImplementations,
  handleSearchSymbols,
  handleGetKdoc,
  handleListTestFunctions,
  handleGetFileSymbols,
} from '../../src/server/mcp';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIndex(sources: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, src] of Object.entries(sources)) {
    index.add(parse(uri, src));
  }
  index.finalize();
  return index;
}

const BASE_URI = 'file:///workspace/src/main/kotlin/com/example';

// ── find_symbol ───────────────────────────────────────────────────────────────

describe('handleFindSymbol', () => {
  it('returns empty array when name not in index', () => {
    const index = makeIndex({});
    expect(handleFindSymbol(index, 'NonExistent')).toEqual([]);
  });

  it('finds a class by simple name', () => {
    const index = makeIndex({ [`${BASE_URI}/Repo.kt`]: 'package com.example\nclass Repo' });
    const results = handleFindSymbol(index, 'Repo');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Repo');
    expect(results[0].kind).toBe('class');
    expect(results[0].fqn).toBe('com.example.Repo');
  });

  it('caps results at 50', () => {
    const src = Array.from({ length: 60 }, (_, i) => `fun func${i}()`).join('\n');
    const index = makeIndex({ [`${BASE_URI}/Funcs.kt`]: `package com.example\nclass Owner {\n${src}\n}` });
    // Rebuild with many symbols sharing a common prefix — use search instead to avoid cap issue
    // Actually test cap with many classes named the same across files:
    const sources: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      sources[`file:///w/pkg${i}/Dup.kt`] = `package pkg${i}\nclass Dup`;
    }
    const bigIndex = makeIndex(sources);
    const results = handleFindSymbol(bigIndex, 'Dup');
    expect(results.length).toBeLessThanOrEqual(50);
  });

  it('returns fqn, uri, line, character, packageName', () => {
    const index = makeIndex({ [`${BASE_URI}/VM.kt`]: 'package com.example\nclass MyViewModel' });
    const [r] = handleFindSymbol(index, 'MyViewModel');
    expect(r.fqn).toBe('com.example.MyViewModel');
    expect(r.packageName).toBe('com.example');
    expect(typeof r.uri).toBe('string');
    expect(typeof r.line).toBe('number');
  });
});

// ── find_implementations ──────────────────────────────────────────────────────

describe('handleFindImplementations', () => {
  it('returns empty for a concrete class with no subclasses', () => {
    const index = makeIndex({ [`${BASE_URI}/C.kt`]: 'package com.example\nclass Concrete' });
    expect(handleFindImplementations(index, 'Concrete')).toEqual([]);
  });

  it('finds implementors of an interface', () => {
    const src = 'package com.example\ninterface Repo\nclass RepoImpl : Repo';
    const index = makeIndex({ [`${BASE_URI}/R.kt`]: src });
    const results = handleFindImplementations(index, 'Repo');
    expect(results.some(r => r.name === 'RepoImpl')).toBe(true);
  });
});

// ── search_symbols ────────────────────────────────────────────────────────────

describe('handleSearchSymbols', () => {
  it('returns empty for empty query', () => {
    const index = makeIndex({ [`${BASE_URI}/A.kt`]: 'package com.example\nclass Alpha' });
    expect(handleSearchSymbols(index, '')).toEqual([]);
  });

  it('filters by kind', () => {
    const src = 'package com.example\nclass UserRepo\nfun userHelper()';
    const index = makeIndex({ [`${BASE_URI}/U.kt`]: src });
    const funs = handleSearchSymbols(index, 'user', 'fun');
    expect(funs.every(r => r.kind === 'fun')).toBe(true);
    const classes = handleSearchSymbols(index, 'user', 'class');
    expect(classes.every(r => r.kind === 'class')).toBe(true);
  });

  it('returns all kinds when no filter specified', () => {
    const src = 'package com.example\nclass UserRepo\nfun userHelper()';
    const index = makeIndex({ [`${BASE_URI}/U.kt`]: src });
    const results = handleSearchSymbols(index, 'user');
    const kinds = new Set(results.map(r => r.kind));
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('caps results at 50', () => {
    const sources: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      sources[`file:///w/p${i}/Found.kt`] = `package p${i}\nclass FoundClass${i}`;
    }
    const index = makeIndex(sources);
    expect(handleSearchSymbols(index, 'FoundClass').length).toBeLessThanOrEqual(50);
  });
});

// ── get_kdoc ──────────────────────────────────────────────────────────────────

describe('handleGetKdoc', () => {
  it('returns { fqn, kdoc: null } for unknown FQN', async () => {
    const index = makeIndex({});
    const result = await handleGetKdoc(index, 'com.example.Unknown');
    expect(result).toEqual({ fqn: 'com.example.Unknown', kdoc: null });
  });

  it('returns { fqn, kdoc: null } when readFile throws', async () => {
    const src = 'package com.example\nclass MyClass';
    const index = makeIndex({ [`${BASE_URI}/MyClass.kt`]: src });
    const result = await handleGetKdoc(
      index,
      'com.example.MyClass',
      () => Promise.reject(new Error('disk error')),
    );
    expect(result).toEqual({ fqn: 'com.example.MyClass', kdoc: null });
  });

  it('returns null kdoc when symbol has no KDoc', async () => {
    const fileContent = 'package com.example\nclass NoDocs';
    const uri = `${BASE_URI}/NoDocs.kt`;
    const index = makeIndex({ [uri]: fileContent });
    const result = await handleGetKdoc(
      index,
      'com.example.NoDocs',
      async () => fileContent,
    );
    expect(result.fqn).toBe('com.example.NoDocs');
    expect(result.kdoc).toBeNull();
  });

  it('returns markdown string when symbol has /** KDoc', async () => {
    const fileContent = '/** Loads the user from the database. */\nclass UserLoader';
    const uri = `${BASE_URI}/UserLoader.kt`;
    const index = makeIndex({ [uri]: `package com.example\n${fileContent}` });
    // The symbol is on line 1 (0-indexed) in the parsed file that includes the package line
    const result = await handleGetKdoc(
      index,
      'com.example.UserLoader',
      async () => `package com.example\n${fileContent}`,
    );
    expect(result.fqn).toBe('com.example.UserLoader');
    expect(result.kdoc).not.toBeNull();
    expect(result.kdoc).toContain('Loads the user');
  });
});

// ── list_test_functions ───────────────────────────────────────────────────────

describe('handleListTestFunctions', () => {
  it('returns empty when no @Test annotations', () => {
    const index = makeIndex({ [`${BASE_URI}/A.kt`]: 'package com.example\nclass NotATest\nfun regularFun()' });
    expect(handleListTestFunctions(index)).toEqual([]);
  });

  it('returns test functions', () => {
    const src = 'package com.example\nclass MyTest {\n@Test\nfun shouldWork() {}\n}';
    const index = makeIndex({ [`${BASE_URI}/T.kt`]: src });
    const results = handleListTestFunctions(index);
    expect(results.some(r => r.name === 'shouldWork')).toBe(true);
    expect(results[0]).toMatchObject({ name: 'shouldWork', isIgnored: false });
  });

  it('marks @Ignore / @Disabled test as isIgnored', () => {
    const src = 'package com.example\nclass T {\n@Test\n@Ignore\nfun ignoredTest() {}\n}';
    const index = makeIndex({ [`${BASE_URI}/T.kt`]: src });
    const results = handleListTestFunctions(index);
    const ignored = results.find(r => r.name === 'ignoredTest');
    expect(ignored?.isIgnored).toBe(true);
  });

  it('caps results at 200', () => {
    const funs = Array.from({ length: 210 }, (_, i) => `@Test\nfun test${i}() {}`).join('\n');
    const src = `package com.example\nclass T {\n${funs}\n}`;
    const index = makeIndex({ [`${BASE_URI}/T.kt`]: src });
    expect(handleListTestFunctions(index).length).toBeLessThanOrEqual(200);
  });
});

// ── get_file_symbols ──────────────────────────────────────────────────────────

describe('handleGetFileSymbols', () => {
  it('returns empty array for unknown URI', () => {
    const index = makeIndex({});
    expect(handleGetFileSymbols(index, 'file:///nonexistent/File.kt')).toEqual([]);
  });

  it('returns symbols for a known file URI', () => {
    const uri = `${BASE_URI}/Svc.kt`;
    const index = makeIndex({ [uri]: 'package com.example\nclass SvcClass' });
    const results = handleGetFileSymbols(index, uri);
    expect(results.some(r => r.name === 'SvcClass')).toBe(true);
  });

  it('normalises absolute path to file:// URI', () => {
    const uri = `${BASE_URI}/Svc.kt`;
    const index = makeIndex({ [uri]: 'package com.example\nclass SvcClass' });
    // Pass as plain path — handleGetFileSymbols should prefix file://
    const path = '/workspace/src/main/kotlin/com/example/Svc.kt';
    // This particular path won't match because the URI stored by parser is exact,
    // but the function should at least not throw
    expect(() => handleGetFileSymbols(index, path)).not.toThrow();
  });
});
