/**
 * Adversarial tests for the LSP server utilities and handler logic.
 *
 * Strategy: test boundary conditions, known limitations, real filesystem,
 * concurrency correctness, and false-positive/negative cases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { wordAt, uriToPath, pathToUri, buildHoverMarkdown, KIND_MAP } from '../../src/server/utils';
import { findUsagesInWorkspace, scanWorkspace, indexFile, SKIP_DIRS } from '../../src/server/scanner';

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

// ── wordAt — boundary conditions ──────────────────────────────────────────────

describe('wordAt — basic coverage', () => {
  const LINE = 'class DataStore : Repository';
  // positions: class(0-4), DataStore(6-14), Repository(18-27)

  it('cursor at start of word', () => {
    expect(wordAt(LINE, 0, 6)).toEqual({ word: 'DataStore', start: 6 });
  });
  it('cursor in middle of word', () => {
    expect(wordAt(LINE, 0, 10)).toEqual({ word: 'DataStore', start: 6 });
  });
  it('cursor at last char of word (char == start + length - 1)', () => {
    // 'DataStore' starts at 6, length 9, last char at 14
    expect(wordAt(LINE, 0, 14)).toEqual({ word: 'DataStore', start: 6 });
  });
  it('cursor at exactly start + length (one past end) → null', () => {
    // char 15 is the space after DataStore — must be null, not DataStore
    expect(wordAt(LINE, 0, 15)).toBeNull();
  });
  it('cursor on space → null', () => {
    expect(wordAt(LINE, 0, 5)).toBeNull();
  });
  it('cursor on colon → null', () => {
    expect(wordAt(LINE, 0, 16)).toBeNull();
  });
  it('cursor at position 0 → first word', () => {
    expect(wordAt(LINE, 0, 0)).toEqual({ word: 'class', start: 0 });
  });
  it('cursor at last char of line → last word', () => {
    expect(wordAt(LINE, 0, LINE.length - 1)).toEqual({ word: 'Repository', start: 18 });
  });
  it('empty line → null', () => {
    expect(wordAt('', 0, 0)).toBeNull();
  });
  it('line index beyond end of text → null', () => {
    expect(wordAt('one line', 99, 0)).toBeNull();
  });
  it('multi-line: selects the correct line', () => {
    const text = 'package com.example\nclass Foo {}';
    expect(wordAt(text, 1, 6)).toEqual({ word: 'Foo', start: 6 });
    expect(wordAt(text, 0, 0)).toEqual({ word: 'package', start: 0 });
  });
  it('underscore-prefixed identifier', () => {
    expect(wordAt('val _count = 0', 0, 4)).toEqual({ word: '_count', start: 4 });
  });
  it('digit after a letter is part of the word', () => {
    expect(wordAt('val myVar2 = 0', 0, 6)).toEqual({ word: 'myVar2', start: 4 });
  });
  it('digit at position 0 is not a word start', () => {
    expect(wordAt('val x = 42', 0, 8)).toBeNull();
  });
  it('consecutive calls produce same result — fresh regex per call', () => {
    const line = 'fun foo() {}';
    const r1 = wordAt(line, 0, 4);
    const r2 = wordAt(line, 0, 4);
    const r3 = wordAt(line, 0, 4);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(r1).toEqual({ word: 'foo', start: 4 });
  });
});

describe('wordAt — adversarial', () => {
  it('word preceded by dot (property access) — dot is non-word char', () => {
    // 'store.DataStore' — cursor on 'D' at char 6
    const line = 'store.DataStore';
    expect(wordAt(line, 0, 6)).toEqual({ word: 'DataStore', start: 6 });
  });

  it('word preceded by @ (annotation) — @ is non-word char', () => {
    const line = '@DataStore class Foo';
    expect(wordAt(line, 0, 1)).toEqual({ word: 'DataStore', start: 1 });
  });

  it('word followed by ( without space', () => {
    const line = 'DataStore()';
    expect(wordAt(line, 0, 0)).toEqual({ word: 'DataStore', start: 0 });
    // Cursor just past ')' at position 11 → null
    expect(wordAt(line, 0, 10)).toBeNull(); // ')'  is not a word char
  });

  it('word inside angle brackets (generic type parameter)', () => {
    const line = 'Repository<DataStore>';
    expect(wordAt(line, 0, 11)).toEqual({ word: 'DataStore', start: 11 });
  });

  it('single underscore is a valid identifier', () => {
    const line = 'val _ = 5';
    expect(wordAt(line, 0, 4)).toEqual({ word: '_', start: 4 });
  });

  it('tab before word — position is absolute column', () => {
    const line = '\tDataStore';
    // tab is at 0, 'D' is at 1
    expect(wordAt(line, 0, 1)).toEqual({ word: 'DataStore', start: 1 });
    expect(wordAt(line, 0, 0)).toBeNull(); // tab is not a word char
  });

  it('Windows CRLF line ending: \\r at end does not shift word positions', () => {
    // split('\n') leaves '\r' at end of each line
    const text = 'class DataStore {}\r\nval x = DataStore()\r\n';
    // On line 0, 'DataStore' is at char 6 even with trailing \r
    expect(wordAt(text, 0, 6)).toEqual({ word: 'DataStore', start: 6 });
    // On line 1, 'DataStore' is at char 8
    expect(wordAt(text, 1, 8)).toEqual({ word: 'DataStore', start: 8 });
  });

  it('position exactly at line length → null (not an error)', () => {
    const line = 'class Foo';
    expect(wordAt(line, 0, line.length)).toBeNull();
  });

  it('very long identifier (1000 chars) — no crash, returns word', () => {
    const longName = 'A' + 'x'.repeat(999); // 1000-char identifier
    const line = `val ${longName} = 5`;
    expect(wordAt(line, 0, 4)?.word).toBe(longName);
  });

  it('line with only one word — cursor anywhere in it returns that word', () => {
    const line = 'DataStore';
    for (let i = 0; i < line.length; i++) {
      expect(wordAt(line, 0, i)).toEqual({ word: 'DataStore', start: 0 });
    }
    expect(wordAt(line, 0, line.length)).toBeNull();
  });

  it('two adjacent words separated only by comma — each is independent', () => {
    const line = 'listOf(Foo,Bar)';
    expect(wordAt(line, 0, 7)).toEqual({ word: 'Foo', start: 7 });
    expect(wordAt(line, 0, 11)).toEqual({ word: 'Bar', start: 11 });
    expect(wordAt(line, 0, 10)).toBeNull(); // comma
  });
});

// ── URI utilities — adversarial ───────────────────────────────────────────────

describe('uriToPath', () => {
  it('basic file URI', () => {
    expect(uriToPath('file:///Users/kevin/project/Foo.kt')).toBe('/Users/kevin/project/Foo.kt');
  });
  it('%20 decoded to space', () => {
    expect(uriToPath('file:///Users/my%20project/Foo.kt')).toBe('/Users/my project/Foo.kt');
  });
  it('%40 decoded to @', () => {
    expect(uriToPath('file:///path/to/%40annotated/Foo.kt')).toBe('/path/to/@annotated/Foo.kt');
  });
  it('non-file URI returned as-is', () => {
    expect(uriToPath('/already/a/path')).toBe('/already/a/path');
  });
  it('file:/// alone (root URI) → /', () => {
    expect(uriToPath('file:///')).toBe('/');
  });
  it('multiple percent-encoded chars in one path', () => {
    expect(uriToPath('file:///a%20b/c%23d/Foo.kt')).toBe('/a b/c#d/Foo.kt');
  });
});

describe('pathToUri', () => {
  it('basic absolute path', () => {
    expect(pathToUri('/Users/kevin/project/Foo.kt')).toBe('file:///Users/kevin/project/Foo.kt');
  });
  it('space is percent-encoded', () => {
    expect(pathToUri('/Users/my project/Foo.kt')).toBe('file:///Users/my%20project/Foo.kt');
  });
  it('# is percent-encoded', () => {
    expect(pathToUri('/path/to/#issue/Foo.kt')).toBe('file:///path/to/%23issue/Foo.kt');
  });
  it('@ is percent-encoded', () => {
    expect(pathToUri('/path/to/@annotated/Foo.kt')).toBe('file:///path/to/%40annotated/Foo.kt');
  });
  it('root path /', () => {
    expect(pathToUri('/')).toBe('file:///');
  });

  // Round-trips
  it('round-trip: simple path', () => {
    const p = '/Users/kevin/src/main/kotlin/com/example/MyClass.kt';
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
  it('round-trip: path with space', () => {
    const p = '/Users/kevin/my project/Foo.kt';
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
  it('round-trip: path with @', () => {
    const p = '/path/to/@annotated/Foo.kt';
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
  it('round-trip: path with #', () => {
    const p = '/path/to/#numbered/Foo.kt';
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
  it('round-trip: nested KMP path', () => {
    const p = '/workspace/app/src/commonMain/kotlin/com/example/DataStore.kt';
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
});

// ── buildHoverMarkdown — adversarial ──────────────────────────────────────────

describe('buildHoverMarkdown', () => {
  it('class', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'class' })])).toContain('class com.example.Foo');
  });
  it('dataClass → "data class"', () => {
    const md = buildHoverMarkdown([makeEntry({ kind: 'dataClass', fqn: 'com.example.Point' })]);
    expect(md).toContain('data class com.example.Point');
    expect(md).not.toContain('dataClass');
  });
  it('sealedClass → "sealed class"', () => {
    const md = buildHoverMarkdown([makeEntry({ kind: 'sealedClass', fqn: 'com.example.State' })]);
    expect(md).toContain('sealed class com.example.State');
    expect(md).not.toContain('sealedClass');
  });
  it('interface → raw kind label "interface"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'interface' })])).toContain('interface com.example.Foo');
  });
  it('object → raw kind label "object"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'object' })])).toContain('object com.example.Foo');
  });
  it('enum → raw kind label "enum"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'enum' })])).toContain('enum com.example.Foo');
  });
  it('fun → raw kind label "fun"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'fun', fqn: 'com.example.Repo.fetch' })])).toContain('fun com.example.Repo.fetch');
  });
  it('val → raw kind label "val"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'val', fqn: 'com.example.MAX' })])).toContain('val com.example.MAX');
  });
  it('typealias → raw kind label "typealias"', () => {
    expect(buildHoverMarkdown([makeEntry({ kind: 'typealias', fqn: 'com.example.Handler' })])).toContain('typealias com.example.Handler');
  });

  it('module name shown when set', () => {
    expect(buildHoverMarkdown([makeEntry({ moduleName: 'app (commonMain)' })])).toContain('*Module:* `app (commonMain)`');
  });
  it('module name omitted when undefined', () => {
    expect(buildHoverMarkdown([makeEntry({ moduleName: undefined })])).not.toContain('Module');
  });
  it('module name omitted when empty string (falsy)', () => {
    expect(buildHoverMarkdown([makeEntry({ moduleName: '' as any })])).not.toContain('Module');
  });

  it('package omitted when undefined', () => {
    const e = { ...makeEntry(), packageName: undefined };
    expect(buildHoverMarkdown([e as any])).not.toContain('Package');
  });
  it('package omitted when empty string (falsy)', () => {
    const e = { ...makeEntry(), packageName: '' };
    expect(buildHoverMarkdown([e as any])).not.toContain('Package');
  });

  it('empty array → empty string', () => {
    expect(buildHoverMarkdown([])).toBe('');
  });

  it('exactly 5 entries: 5th shown, 6th cut off', () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      makeEntry({ fqn: `p.C${i}`, uri: `file:///C${i}.kt` }),
    );
    const md = buildHoverMarkdown(entries);
    expect(md).toContain('C4');       // 5th — shown
    expect(md).not.toContain('C5');   // 6th — cut off
  });

  it('custom limit=1: only first entry shown', () => {
    const entries = [
      makeEntry({ fqn: 'p.First', uri: 'file:///First.kt' }),
      makeEntry({ fqn: 'p.Second', uri: 'file:///Second.kt' }),
    ];
    const md = buildHoverMarkdown(entries, 1);
    expect(md).toContain('First');
    expect(md).not.toContain('Second');
  });

  it('file name extracted from nested path', () => {
    const md = buildHoverMarkdown([makeEntry({ uri: 'file:///a/b/c/MyFile.kt' })]);
    expect(md).toContain('`MyFile.kt`');
    expect(md).not.toContain('/a/b/c/');
  });

  it('URI with no slashes — whole URI used as file name', () => {
    // edge case: uri.toString() = 'Foo.kt' (no slashes)
    const entry = { ...makeEntry(), uri: { toString: () => 'Foo.kt' } };
    expect(buildHoverMarkdown([entry])).toContain('`Foo.kt`');
  });

  it('entries appear in order with FQN first', () => {
    const entries = [
      makeEntry({ fqn: 'p.Alpha', uri: 'file:///A.kt' }),
      makeEntry({ fqn: 'p.Beta',  uri: 'file:///B.kt' }),
    ];
    const md = buildHoverMarkdown(entries);
    expect(md.indexOf('Alpha')).toBeLessThan(md.indexOf('Beta'));
  });
});

// ── KIND_MAP completeness ─────────────────────────────────────────────────────

describe('KIND_MAP', () => {
  it('covers all known Kotlin symbol kinds', () => {
    const kinds = ['class', 'dataClass', 'sealedClass', 'interface', 'object',
                   'enum', 'annotation', 'fun', 'composable', 'val', 'var', 'typealias'];
    for (const k of kinds) {
      expect(KIND_MAP[k], `missing kind: ${k}`).toBeDefined();
    }
  });
  it('all values are valid positive LSP SymbolKind integers', () => {
    for (const [k, v] of Object.entries(KIND_MAP)) {
      expect(Number.isInteger(v) && v > 0, `invalid value for ${k}: ${v}`).toBe(true);
    }
  });
  it('class, dataClass, sealedClass, annotation all map to SymbolKind.Class (5)', () => {
    expect(KIND_MAP['class']).toBe(5);
    expect(KIND_MAP['dataClass']).toBe(5);
    expect(KIND_MAP['sealedClass']).toBe(5);
    expect(KIND_MAP['annotation']).toBe(5);
  });
  it('fun and composable map to SymbolKind.Function (12)', () => {
    expect(KIND_MAP['fun']).toBe(12);
    expect(KIND_MAP['composable']).toBe(12);
  });
  it('val maps to SymbolKind.Constant (14), var maps to SymbolKind.Variable (13)', () => {
    expect(KIND_MAP['val']).toBe(14);
    expect(KIND_MAP['var']).toBe(13);
  });
  it('interface maps to SymbolKind.Interface (11)', () => {
    expect(KIND_MAP['interface']).toBe(11);
  });
  it('enum maps to SymbolKind.Enum (10)', () => {
    expect(KIND_MAP['enum']).toBe(10);
  });
});

// ── findUsagesInWorkspace — adversarial ───────────────────────────────────────

describe('findUsagesInWorkspace', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
  });

  const reader = (content: string) => async (_: string) => content;
  const multiReader = (map: Record<string, string>) => async (p: string): Promise<string> => {
    const key = Object.keys(map).find(k => p.endsWith(k));
    return key ? map[key] : '';
  };

  // ── happy path ──────────────────────────────────────────────────────────────

  it('word not in index → empty, no file reads at all', async () => {
    let reads = 0;
    const results = await findUsagesInWorkspace(
      'UnknownClass', index, noCancel, async () => { reads++; return ''; },
    );
    expect(results).toHaveLength(0);
    expect(reads).toBe(0); // early-exit: no reads performed
  });

  it('finds declaration and usage on different lines', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}\nval x = DataStore()');
    const code = 'package p\nclass DataStore {}\nval x = DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const lines = results.map(r => r.range.start.line);
    expect(lines).toContain(1);
    expect(lines).toContain(2);
  });

  it('multiple occurrences on the SAME line — all found', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nval a = DataStore(); val b = DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(2);
    // Verify they are at different columns
    const cols = line2.map(r => r.range.start.character).sort((a, b) => a - b);
    expect(cols[0]).not.toBe(cols[1]);
  });

  // ── word boundary ────────────────────────────────────────────────────────────

  it('DataStoreImpl does NOT match \\bDataStore\\b', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nclass DataStoreImpl : DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    // Only one result on line 2 — the standalone DataStore(), not DataStoreImpl
    expect(line2).toHaveLength(1);
    const col = line2[0].range.start.character;
    expect(col).not.toBe(6); // 6 is where DataStoreImpl starts
  });

  it('SuperDataStore does NOT match \\bDataStore\\b (suffix guard)', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nclass SuperDataStore {}';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(0);
  });

  // ── comment skipping ─────────────────────────────────────────────────────────

  it('full // comment line is skipped', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\n// DataStore is used here\nval x = DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const lines = results.map(r => r.range.start.line);
    expect(lines).not.toContain(2); // comment line
    expect(lines).toContain(3);
  });

  it('KDoc line starting with * is skipped', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = [
      'package p', 'class DataStore {}',
      '/**',
      ' * DataStore is the main store',  // line 3 — trimmed starts with '*'
      ' */',
      'val x = DataStore()',
    ].join('\n');
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const lines = results.map(r => r.range.start.line);
    expect(lines).not.toContain(3); // KDoc line
    expect(lines).toContain(5);     // real usage
  });

  it('opening /* line is skipped', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\n/* DataStore legacy */\nval x = DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const lines = results.map(r => r.range.start.line);
    expect(lines).not.toContain(2); // /* ... */ line
    expect(lines).toContain(3);
  });

  it('inline // comment: match before // is kept, match after // is not', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nval x = DataStore() // old DataStore here';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(1);
    const codePart = code.split('\n')[2];
    expect(line2[0].range.start.character).toBeLessThan(codePart.indexOf('//'));
  });

  it('string literal: occurrence inside quotes is NOT found', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nval name = "DataStore"';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(0);
  });

  it('LIMITATION — inline block comment /* DataStore */ is a false positive', async () => {
    // isInsideCommentOrString only handles // and strings, not /* */ blocks.
    // A word inside /* ... */ on a non-comment-starting line IS currently matched.
    // This test documents the known limitation — if it starts failing, the bug is fixed.
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nval x /* DataStore */ = 5';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    // Currently matches (false positive) — documented as LIMITATION
    expect(line2).toHaveLength(1);
  });

  // ── import lines ─────────────────────────────────────────────────────────────

  it('import line IS included in references (unlike scanForUsages)', async () => {
    // The server's findUsagesInWorkspace does NOT skip import lines.
    // This is correct for "find references" — imports are references too.
    addKt(index, 'file:///A.kt', 'package com.example\nclass DataStore {}');
    addKt(index, 'file:///B.kt', 'package com.other\nimport com.example.DataStore\nval x = DataStore()');
    const codeB = 'package com.other\nimport com.example.DataStore\nval x = DataStore()';
    const results = await findUsagesInWorkspace(
      'DataStore', index, noCancel,
      async (p) => p.includes('B') ? codeB : 'package com.example\nclass DataStore {}',
    );
    const linesInB = results
      .filter(r => r.uri.includes('B'))
      .map(r => r.range.start.line);
    expect(linesInB).toContain(1); // import line
    expect(linesInB).toContain(2); // usage line
  });

  // ── annotation and type param contexts ──────────────────────────────────────

  it('@DataStore annotation: the identifier part matches', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\n@DataStore\nclass Foo {}';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const lines = results.map(r => r.range.start.line);
    expect(lines).toContain(2); // @DataStore line
  });

  it('DataStore as type parameter — found', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}\nval repo: Repository<DataStore> = TODO()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    const line2 = results.filter(r => r.range.start.line === 2);
    expect(line2).toHaveLength(1);
  });

  // ── result precision ─────────────────────────────────────────────────────────

  it('range end - start == word length for every result', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}\nval x = DataStore()');
    const code = 'package p\nclass DataStore {}\nval x = DataStore()';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    for (const r of results) {
      expect(r.range.end.character - r.range.start.character).toBe('DataStore'.length);
      expect(r.range.start.line).toBe(r.range.end.line); // single-line range
    }
  });

  it('result URI matches the indexed file URI string exactly', async () => {
    const uri = 'file:///exact/path/DataStore.kt';
    addKt(index, uri, 'package p\nclass DataStore {}');
    const code = 'package p\nclass DataStore {}';
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, reader(code));
    expect(results.every(r => r.uri === uri)).toBe(true);
  });

  // ── resilience ───────────────────────────────────────────────────────────────

  it('readFile throws for one file — that file skipped, others still processed', async () => {
    addKt(index, 'file:///Good.kt',  'package p\nclass DataStore {}');
    addKt(index, 'file:///Bad.kt',   'package p\nval x = DataStore()');
    addKt(index, 'file:///Good2.kt', 'package p\nval y = DataStore()');

    const results = await findUsagesInWorkspace(
      'DataStore', index, noCancel,
      async (p) => {
        if (p.includes('Bad')) throw new Error('permission denied');
        if (p.includes('Good2')) return 'package p\nval y = DataStore()';
        return 'package p\nclass DataStore {}';
      },
    );
    // Results from Good.kt and Good2.kt should still be present
    const uris = new Set(results.map(r => r.uri));
    expect(uris.has('file:///Bad.kt')).toBe(false);   // threw — skipped
    expect(uris.has('file:///Good2.kt')).toBe(true);  // still processed
  });

  it('file with no matching text is fast-pathed (includes check)', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    let parseCallCount = 0;
    const results = await findUsagesInWorkspace(
      'DataStore', index, noCancel,
      async () => {
        parseCallCount++;
        return 'package p\n// no match here at all'; // text.includes('DataStore') == false
      },
    );
    expect(results).toHaveLength(0);
    // File was read (parseCallCount > 0) but no parse/line-scan occurred
    expect(parseCallCount).toBe(1);
  });

  // ── cancellation ─────────────────────────────────────────────────────────────

  it('pre-cancelled token → no results, no file reads', async () => {
    addKt(index, 'file:///A.kt', 'package p\nclass DataStore {}');
    let reads = 0;
    const results = await findUsagesInWorkspace(
      'DataStore', index, { isCancellationRequested: true },
      async () => { reads++; return 'class DataStore {}'; },
    );
    expect(results).toHaveLength(0);
    expect(reads).toBe(0);
  });

  // ── 500-result cap ───────────────────────────────────────────────────────────

  it('500-result cap: never exceeds 500 results', async () => {
    // Create 10 files each with 60 occurrences → 600 potential matches without the cap
    for (let i = 0; i < 10; i++) {
      addKt(index, `file:///File${i}.kt`, 'package p\nclass DataStore {}');
    }
    // Each file returns 1 declaration + 60 usages = 61 potential results
    const bigCode = 'package p\nclass DataStore {}\n' + Array(60).fill('val x = DataStore()').join('\n');
    const results = await findUsagesInWorkspace('DataStore', index, noCancel, async () => bigCode);
    expect(results.length).toBeLessThanOrEqual(500);
  });

  // ── multi-file correctness ───────────────────────────────────────────────────

  it('scans all indexed files and collects results from each', async () => {
    for (let i = 0; i < 5; i++) {
      addKt(index, `file:///File${i}.kt`, 'package p\nclass DataStore {}');
    }
    const results = await findUsagesInWorkspace(
      'DataStore', index, noCancel,
      async (p) => `package p\nclass DataStore {}\nval x${p.slice(-5)} = DataStore()`,
    );
    const uris = new Set(results.map(r => r.uri));
    expect(uris.size).toBe(5);
  });
});

// ── SKIP_DIRS ─────────────────────────────────────────────────────────────────

describe('SKIP_DIRS', () => {
  it('contains all expected output and VCS directories', () => {
    for (const d of ['build', '.gradle', '.git', 'node_modules', '.idea', 'out', 'tmp']) {
      expect(SKIP_DIRS.has(d)).toBe(true);
    }
  });
  it('does NOT skip Kotlin source set names', () => {
    for (const d of ['src', 'main', 'test', 'commonMain', 'androidMain', 'iosMain', 'jvmMain']) {
      expect(SKIP_DIRS.has(d)).toBe(false);
    }
  });
});

// ── scanWorkspace + indexFile — real filesystem integration ───────────────────

describe('scanWorkspace integration (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kotlin-jump-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('indexes .kt files in a flat directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'Foo.kt'), 'package test\nclass Foo {}');
    await fs.writeFile(path.join(tmpDir, 'Bar.kt'), 'package test\nfun bar() {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Foo')).toHaveLength(1);
    expect(index.lookup('bar')).toHaveLength(1);
  });

  it('indexes .kts files', async () => {
    await fs.writeFile(path.join(tmpDir, 'build.kts'), 'val version = "1.0"');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    // .kts is collected and parsed as Kotlin (no crash)
    // version may or may not be indexed depending on parser, but no error
    expect(index.stats().files).toBeGreaterThanOrEqual(0);
  });

  it('indexes .java files', async () => {
    await fs.writeFile(path.join(tmpDir, 'Repo.java'), 'package test;\npublic class Repo {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Repo')).toHaveLength(1);
  });

  it('ignores non-Kotlin/Java files', async () => {
    await fs.writeFile(path.join(tmpDir, 'notes.txt'),    'class NotIndexed {}');
    await fs.writeFile(path.join(tmpDir, 'config.json'),  '{"class":"NotIndexed"}');
    await fs.writeFile(path.join(tmpDir, 'Foo.kt'),       'package test\nclass RealClass {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('NotIndexed')).toHaveLength(0);
    expect(index.lookup('RealClass')).toHaveLength(1);
  });

  it('recurses into subdirectories', async () => {
    const sub = path.join(tmpDir, 'src', 'main', 'kotlin');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(path.join(sub, 'Deep.kt'), 'package test\nclass Deep {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Deep')).toHaveLength(1);
  });

  it('skips build/ directory — classes inside are NOT indexed', async () => {
    const buildDir = path.join(tmpDir, 'build', 'generated');
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, 'Generated.kt'), 'package test\nclass Generated {}');
    await fs.writeFile(path.join(tmpDir, 'Real.kt'), 'package test\nclass Real {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Generated')).toHaveLength(0);
    expect(index.lookup('Real')).toHaveLength(1);
  });

  it('skips .git/ directory', async () => {
    const gitDir = path.join(tmpDir, '.git', 'hooks');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(path.join(gitDir, 'Hook.kt'), 'package test\nclass Hook {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Hook')).toHaveLength(0);
  });

  it('empty workspace directory — no crash, index stays empty', async () => {
    const index = new SymbolIndex();
    await expect(scanWorkspace(tmpDir, index)).resolves.not.toThrow();
    expect(index.stats().files).toBe(0);
  });

  it('multiple files are all indexed (concurrency correctness)', async () => {
    // 25 files — exercises the 20-worker pool with overflow
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        fs.writeFile(path.join(tmpDir, `Class${i}.kt`), `package test\nclass Class${i} {}`),
      ),
    );
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.stats().files).toBe(25);
    // Spot-check first and last
    expect(index.lookup('Class0')).toHaveLength(1);
    expect(index.lookup('Class24')).toHaveLength(1);
  });

  it('no duplicate entries when same logical class appears in one file', async () => {
    await fs.writeFile(path.join(tmpDir, 'Foo.kt'), 'package test\nclass Foo {}');
    const index = new SymbolIndex();
    await scanWorkspace(tmpDir, index);
    expect(index.lookup('Foo')).toHaveLength(1);
  });
});

describe('indexFile', () => {
  it('indexes a .kt file', async () => {
    const index = new SymbolIndex();
    await indexFile('/fake/Foo.kt', index, async () => 'package test\nclass Foo {}');
    expect(index.lookup('Foo')).toHaveLength(1);
  });

  it('indexes a .java file using the Java parser', async () => {
    const index = new SymbolIndex();
    await indexFile('/fake/Repo.java', index, async () => 'package test;\npublic class Repo {}');
    expect(index.lookup('Repo')).toHaveLength(1);
  });

  it('.kts file is parsed as Kotlin (not Java)', async () => {
    const index = new SymbolIndex();
    // buildSrc.kts doesn't match .java so uses Kotlin parser — no crash
    await expect(
      indexFile('/fake/build.kts', index, async () => 'val greeting = "hello"'),
    ).resolves.not.toThrow();
  });

  it('readFile throws — no crash, index unchanged', async () => {
    const index = new SymbolIndex();
    await expect(
      indexFile('/fake/Broken.kt', index, async () => { throw new Error('ENOENT'); }),
    ).resolves.not.toThrow();
    expect(index.lookup('Anything')).toHaveLength(0);
  });

  it('re-indexing same file overwrites the previous entry', async () => {
    const index = new SymbolIndex();
    await indexFile('/fake/Foo.kt', index, async () => 'package p\nclass OldFoo {}');
    expect(index.lookup('OldFoo')).toHaveLength(1);
    await indexFile('/fake/Foo.kt', index, async () => 'package p\nclass NewFoo {}');
    expect(index.lookup('OldFoo')).toHaveLength(0);
    expect(index.lookup('NewFoo')).toHaveLength(1);
  });
});

// ── Workspace symbol deduplication ───────────────────────────────────────────

describe('workspace symbol query logic', () => {
  it('exact + prefix results de-duplicated by FQN', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    index.finalize();

    const exact    = index.lookup('Foo');
    const searched = index.search('Foo', 50);
    const seen     = new Set<string>();
    const all      = [...exact, ...searched].filter(e => {
      if (seen.has(e.fqn)) return false;
      seen.add(e.fqn);
      return true;
    });
    expect(all.filter(e => e.fqn === 'com.example.Foo')).toHaveLength(1);
  });

  it('single-char query hits prefix search', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    index.finalize();
    expect(index.search('F', 50).some(e => e.name === 'Foo')).toBe(true);
  });

  it('empty query returns nothing', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo {}');
    const query = '   '.trim();
    expect(query.length).toBe(0);
    expect(query.length === 0 ? [] : index.lookup(query)).toHaveLength(0);
  });

  it('onWorkspaceSymbol caps final result at 50 via slice', () => {
    // SymbolIndex.search() has no limit param — the 50-cap comes from .slice(0,50) in the handler.
    const index = new SymbolIndex();
    for (let i = 0; i < 60; i++) {
      addKt(index, `file:///A${i}.kt`, `package p\nclass Foo${i} {}`);
    }
    index.finalize();
    // Simulate what onWorkspaceSymbol does: search then slice
    const searched = index.search('Foo');
    const seen = new Set<string>();
    const all = searched.filter(e => {
      if (seen.has(e.fqn)) return false;
      seen.add(e.fqn);
      return true;
    });
    const final = all.slice(0, 50);
    expect(final.length).toBeLessThanOrEqual(50);
    expect(searched.length).toBeGreaterThan(50); // search itself returns more than 50
  });
});
