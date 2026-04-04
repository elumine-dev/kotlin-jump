import { describe, it, expect } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// Must stay in sync with FileScanner.ts
const KMP_SOURCE_SET_RE = /[/\\]src[/\\]([a-z]\w+(?:Main|Test))[/\\]/;

/**
 * Replicates FileScanner.moduleFor() for testing.
 * Must stay in sync with the implementation in FileScanner.ts.
 */
function moduleFor(fsPath: string, moduleMap: Map<string, string>): string | undefined {
  for (const [name, rootPath] of moduleMap) {
    if (fsPath.startsWith(rootPath)) {
      const rel = fsPath.slice(rootPath.length);
      const kmp = KMP_SOURCE_SET_RE.exec(rel);
      if (kmp) return `${name} (${kmp[1]})`;
      return name;
    }
  }
  const kmp = KMP_SOURCE_SET_RE.exec(fsPath);
  if (kmp) return kmp[1];
  return undefined;
}

/** Adds a Kotlin file and returns the SymbolEntry for the first symbol. */
function addAndLookup(index: SymbolIndex, fsPath: string, code: string, moduleName?: string) {
  index.add(parse(`file://${fsPath}`, code), moduleName);
  const name = code.match(/class\s+(\w+)/)?.[1] ?? code.match(/fun\s+(\w+)/)?.[1];
  return index.lookup(name!)[0];
}

// ── Regex unit tests ─────────────────────────────────────────────────────────

describe('KMP_SOURCE_SET_RE — paths that MUST match', () => {
  it.each([
    ['/project/src/commonMain/kotlin/Foo.kt',             'commonMain'],
    ['/project/src/androidMain/kotlin/Foo.kt',            'androidMain'],
    ['/project/src/iosMain/kotlin/Foo.kt',                'iosMain'],
    ['/project/src/jvmMain/kotlin/Foo.kt',                'jvmMain'],
    ['/project/src/jsMain/kotlin/Foo.kt',                 'jsMain'],
    ['/project/src/nativeMain/kotlin/Foo.kt',             'nativeMain'],
    ['/project/src/desktopMain/kotlin/Foo.kt',            'desktopMain'],
    ['/project/src/commonTest/kotlin/Foo.kt',             'commonTest'],
    ['/project/src/androidTest/kotlin/Foo.kt',            'androidTest'],
    ['/project/src/iosTest/kotlin/Foo.kt',                'iosTest'],
    // Long platform target names used in KMP Kotlin/Native
    ['/project/src/iosSimulatorArm64Main/kotlin/Foo.kt',  'iosSimulatorArm64Main'],
    ['/project/src/mingwX64Main/kotlin/Foo.kt',           'mingwX64Main'],
    // Deep project hierarchy — source set still detected
    ['/ws/corp/proj/mod/shared/src/commonMain/kotlin/com/ex/Repo.kt', 'commonMain'],
  ])('matches %s → %s', (path, expected) => {
    expect(KMP_SOURCE_SET_RE.exec(path)?.[1]).toBe(expected);
  });
});

describe('KMP_SOURCE_SET_RE — paths that must NOT match', () => {
  it.each([
    // Standard Android source sets — plain names with no KMP-style prefix+suffix
    ['/project/src/main/kotlin/Foo.kt'],
    ['/project/src/test/kotlin/Foo.kt'],
    ['/project/src/debug/kotlin/Foo.kt'],
    ['/project/src/release/kotlin/Foo.kt'],
    // Uppercase start — regex requires [a-z]
    ['/project/src/CommonMain/kotlin/Foo.kt'],
    ['/project/src/IOSMain/kotlin/Foo.kt'],
    // 'srcMain' is NOT '/src/<name>Main' — missing the /src/<seg>/ structure
    ['/project/srcMain/kotlin/Foo.kt'],
    // No src directory at all
    ['/project/Foo.kt'],
    ['/project/kotlin/Foo.kt'],
  ])('does NOT match %s', (path) => {
    expect(KMP_SOURCE_SET_RE.exec(path)).toBeNull();
  });

  it('captured group is the source set name only, never a path segment', () => {
    const m = KMP_SOURCE_SET_RE.exec('/a/b/src/commonMain/kotlin/x/y/Foo.kt');
    expect(m?.[1]).toBe('commonMain');
    expect(m?.[1]).not.toContain('/');
  });

  it('Windows backslash path — commonMain matches', () => {
    expect(KMP_SOURCE_SET_RE.exec('\\project\\src\\commonMain\\kotlin\\Foo.kt')?.[1])
      .toBe('commonMain');
  });

  it('Windows backslash path — plain main does NOT match', () => {
    expect(KMP_SOURCE_SET_RE.exec('\\project\\src\\main\\kotlin\\Foo.kt')).toBeNull();
  });
});

// ── moduleFor logic tests ─────────────────────────────────────────────────────

describe('moduleFor — module map + KMP source set', () => {
  it('file in commonMain → :module (commonMain)', () => {
    const result = moduleFor(
      '/project/shared/src/commonMain/kotlin/SharedModel.kt',
      new Map([[':shared', '/project/shared']]),
    );
    expect(result).toBe(':shared (commonMain)');
  });

  it('file in androidMain → :module (androidMain)', () => {
    const result = moduleFor(
      '/project/shared/src/androidMain/kotlin/AndroidImpl.kt',
      new Map([[':shared', '/project/shared']]),
    );
    expect(result).toBe(':shared (androidMain)');
  });

  it('file in iosMain → :module (iosMain)', () => {
    expect(moduleFor(
      '/project/shared/src/iosMain/kotlin/IosBridge.kt',
      new Map([[':shared', '/project/shared']]),
    )).toBe(':shared (iosMain)');
  });

  it('file in commonTest → :module (commonTest)', () => {
    expect(moduleFor(
      '/project/shared/src/commonTest/kotlin/SharedTest.kt',
      new Map([[':shared', '/project/shared']]),
    )).toBe(':shared (commonTest)');
  });

  it('file in iosSimulatorArm64Main → :module (iosSimulatorArm64Main)', () => {
    expect(moduleFor(
      '/project/shared/src/iosSimulatorArm64Main/kotlin/IosSimClass.kt',
      new Map([[':shared', '/project/shared']]),
    )).toBe(':shared (iosSimulatorArm64Main)');
  });

  it('file in plain main (standard Android) → module name only, no source set suffix', () => {
    expect(moduleFor(
      '/project/app/src/main/kotlin/MainClass.kt',
      new Map([[':app', '/project/app']]),
    )).toBe(':app');
  });

  it('file in plain test source set → module name only', () => {
    expect(moduleFor(
      '/project/app/src/test/kotlin/FooTest.kt',
      new Map([[':app', '/project/app']]),
    )).toBe(':app');
  });

  it('file outside any module root → falls through to KMP fallback', () => {
    // /other is not under /project/app, but the path contains /src/commonMain/
    expect(moduleFor(
      '/other/src/commonMain/kotlin/Orphan.kt',
      new Map([[':app', '/project/app']]),
    )).toBe('commonMain');
  });

  it('two modules: picks the correct one for each file', () => {
    const map = new Map([
      [':shared', '/project/shared'],
      [':app',    '/project/app'],
    ]);
    expect(moduleFor('/project/shared/src/commonMain/kotlin/S.kt', map))
      .toBe(':shared (commonMain)');
    expect(moduleFor('/project/app/src/androidMain/kotlin/A.kt', map))
      .toBe(':app (androidMain)');
  });

  // Fallback: no module map
  it('no module map, file in commonMain → source set name as module name', () => {
    expect(moduleFor('/project/src/commonMain/kotlin/Foo.kt', new Map())).toBe('commonMain');
  });

  it('no module map, file in plain main → undefined', () => {
    expect(moduleFor('/project/src/main/kotlin/Foo.kt', new Map())).toBeUndefined();
  });

  it('no module map, no src directory → undefined', () => {
    expect(moduleFor('/project/Foo.kt', new Map())).toBeUndefined();
  });

  // Known limitation: Map insertion order determines which module matches first
  it('overlapping module paths: first inserted entry wins', () => {
    const map = new Map([
      [':feature',      '/project/feature'],       // inserted first
      [':feature:auth', '/project/feature/auth'],  // more specific, inserted second
    ]);
    // /project/feature/auth starts with /project/feature → first entry wins
    const result = moduleFor('/project/feature/auth/src/commonMain/kotlin/Foo.kt', map);
    expect(result).toBe(':feature (commonMain)');  // NOT ':feature:auth (commonMain)'
  });
});

// ── End-to-end: moduleName stored on SymbolEntry ─────────────────────────────

describe('moduleName stored correctly on SymbolEntry', () => {
  it('symbol indexed with (commonMain) suffix has correct moduleName', () => {
    const fsPath = '/project/shared/src/commonMain/kotlin/SharedModel.kt';
    const index  = new SymbolIndex();
    const sym    = addAndLookup(index, fsPath, 'package com.example\nclass SharedModel',
      moduleFor(fsPath, new Map([[':shared', '/project/shared']])));
    expect(sym.moduleName).toBe(':shared (commonMain)');
  });

  it('symbol indexed with plain module has no source set suffix', () => {
    const fsPath = '/project/app/src/main/kotlin/MainClass.kt';
    const index  = new SymbolIndex();
    const sym    = addAndLookup(index, fsPath, 'package com.example\nclass MainClass',
      moduleFor(fsPath, new Map([[':app', '/project/app']])));
    expect(sym.moduleName).toBe(':app');
  });

  it('symbol indexed with undefined moduleName has no moduleName', () => {
    const fsPath = '/untracked/Foo.kt';
    const index  = new SymbolIndex();
    const sym    = addAndLookup(index, fsPath, 'package com.example\nclass Foo',
      moduleFor(fsPath, new Map()));
    expect(sym.moduleName).toBeUndefined();
  });

  it('two symbols from different source sets carry distinct module names', () => {
    const map   = new Map([[':shared', '/project/shared']]);
    const index = new SymbolIndex();

    const commonPath = '/project/shared/src/commonMain/kotlin/Common.kt';
    const iosPath    = '/project/shared/src/iosMain/kotlin/IosBridge.kt';

    index.add(parse(`file://${commonPath}`, 'package com.example\nclass Common'),
      moduleFor(commonPath, map));
    index.add(parse(`file://${iosPath}`, 'package com.example\nclass IosBridge'),
      moduleFor(iosPath, map));

    expect(index.lookup('Common')[0].moduleName).toBe(':shared (commonMain)');
    expect(index.lookup('IosBridge')[0].moduleName).toBe(':shared (iosMain)');
  });
});
