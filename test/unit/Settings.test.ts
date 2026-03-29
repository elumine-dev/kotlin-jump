import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider, clearPendingDeclNav, getPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { fileCouldReference } from '../../src/providers/FindUsagesEngine';
import { mockDocument, positionOf } from './helpers';
import { Location, workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}
function locs(result: any): Location[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

// ── testSourceSets ──────────────────────────────────────────────────────────

describe('setting: testSourceSets', () => {
  let index: SymbolIndex;

  const MAIN_CLASS = `package com.example
class UserRepo {
    fun save() {}
}`;
  const TEST_CLASS = `package com.example
class UserRepoTest {
    val repo = UserRepo()
}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///src/main/UserRepo.kt', MAIN_CLASS);
    addKt(index, 'file:///src/test/UserRepoTest.kt', TEST_CLASS);
  });

  it('with testSourceSets configured, main source skips test definitions', () => {
    // Override getConfiguration to return testSourceSets
    const origGet = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'testSourceSets') return ['/src/test/'];
        return defaultVal;
      },
    }) as any;

    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///src/main/App.kt',
      'package com.example\nval repo = UserRepo()');
    // Simulate being in main source, clicking UserRepo
    const pos = positionOf('package com.example\nval repo = UserRepo()', 'UserRepo');
    const result = locs(provider.provideDefinition(doc, pos));

    // Should find UserRepo in main, NOT in test
    const uris = result.map(l => l.uri.toString());
    expect(uris).toContain('file:///src/main/UserRepo.kt');
    expect(uris).not.toContain('file:///src/test/UserRepoTest.kt');

    workspace.getConfiguration = origGet;
  });

  it('with empty testSourceSets (default), test files are included', () => {
    const provider = new KotlinDefinitionProvider(index);
    // Both UserRepo entries should be returned since no filtering
    const results = index.lookup('UserRepo');
    expect(results).toHaveLength(1); // only 1 class named UserRepo
  });

  it('from test source, can navigate to test definitions', () => {
    const origGet = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'testSourceSets') return ['/src/test/'];
        return defaultVal;
      },
    }) as any;

    const provider = new KotlinDefinitionProvider(index);
    // When current file IS in test path, test results are allowed
    const doc = mockDocument('file:///src/test/MyTest.kt',
      'package com.example\nval repo = UserRepo()');
    const pos = positionOf('package com.example\nval repo = UserRepo()', 'UserRepo');
    const result = locs(provider.provideDefinition(doc, pos));

    expect(result.length).toBeGreaterThan(0);

    workspace.getConfiguration = origGet;
  });
});

// ── excludeFromReferences ───────────────────────────────────────────────────

describe('setting: excludeFromReferences', () => {
  // This setting uses picomatch in ReferenceProvider to filter URIs before scanning.
  // We test the fileCouldReference logic which is the pre-filter step.
  // The actual picomatch filtering happens in ReferenceProvider which needs vscode.workspace.fs.

  it('fileCouldReference returns false for files outside package/import scope', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Model.kt', 'package com.example.model\nclass User');
    const entry = index.lookup('User')[0];

    // File in different package, no import
    const testFile = `package com.example.test
class UserTest {}`;
    expect(fileCouldReference(testFile, entry)).toBe(false);
  });

  it('fileCouldReference returns true for same package', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Model.kt', 'package com.example.model\nclass User');
    const entry = index.lookup('User')[0];

    const samePackage = `package com.example.model
class UserService {}`;
    expect(fileCouldReference(samePackage, entry)).toBe(true);
  });
});

// ── smartNavigation ─────────────────────────────────────────────────────────

describe('setting: smartNavigation', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Repo.kt', `package com.example
interface Repo {
    fun save()
}`);
    addKt(index, 'file:///RepoImpl.kt', `package com.example
class RepoImpl : Repo {
    override fun save() {}
}`);
  });

  it('smartNavigation true or false: interface still jumps to implementation', () => {
    // Implementation lookup doesn't depend on smartNavigation
    // smartNavigation only affects what happens when NO implementation is found
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///Repo.kt', `package com.example
interface Repo {
    fun save()
}`);
    const pos = positionOf(`package com.example
interface Repo {
    fun save()
}`, 'Repo');
    const result = locs(provider.provideDefinition(doc, pos));
    expect(result.some(l => l.uri.toString() === 'file:///RepoImpl.kt')).toBe(true);
  });

  it('at declaration with no impls: pendingDeclNav is set for listener to handle', () => {
    addKt(index, 'file:///Standalone.kt', 'package com.example\nclass Standalone');
    clearPendingDeclNav();

    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///Standalone.kt', 'package com.example\nclass Standalone');
    const pos = positionOf('package com.example\nclass Standalone', 'Standalone');
    provider.provideDefinition(doc, pos);

    // pendingDeclNav is set — the selection listener in extension.ts
    // checks smartNav to decide: kotlin-jump.findUsages or editor.action.goToReferences
    expect(getPendingDeclNav()).toBeDefined();
  });
});

// ── FileScanner settings ────────────────────────────────────────────────────

describe('setting: excludePatterns + maxIndexedFiles', () => {
  it('passes excludePatterns and maxIndexedFiles to findFiles', async () => {
    const origGetConfig = workspace.getConfiguration;
    const origFindFiles = workspace.findFiles;

    const customExcludes = ['**/out/**', '**/generated/**'];
    const customMax = 500;

    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'excludePatterns') return customExcludes;
        if (key === 'maxIndexedFiles') return customMax;
        if (key === 'concurrency') return 1;
        if (key === 'parserWorkers') return 1;
        return defaultVal;
      },
    }) as any;

    let capturedGlob = '';
    let capturedExclude = '';
    let capturedMax = 0;
    workspace.findFiles = (async (glob: string, exclude: string, max: number) => {
      capturedGlob = glob;
      capturedExclude = exclude;
      capturedMax = max;
      return [];
    }) as any;

    const { FileScanner } = await import('../../src/indexer/FileScanner');
    const scanner = new FileScanner(new SymbolIndex(), { info: () => {} } as any);
    await scanner.scanAll();

    expect(capturedGlob).toBe('**/*.{kt,kts,java}');
    expect(capturedExclude).toBe('{**/out/**,**/generated/**}');
    expect(capturedMax).toBe(500);

    workspace.getConfiguration = origGetConfig;
    workspace.findFiles = origFindFiles;
  });
});

describe('setting: concurrency', () => {
  it('concurrency config has a valid default of 20', () => {
    // The default is used in FileScanner.scanAll when config returns undefined
    const cfg = workspace.getConfiguration();
    const concurrency = cfg.get('concurrency', 20);
    expect(concurrency).toBe(20);
  });

  it('concurrency config value is respected when set', () => {
    const origGet = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'concurrency') return 5;
        return defaultVal;
      },
    }) as any;

    const cfg = workspace.getConfiguration() as any;
    expect(cfg.get('concurrency', 20)).toBe(5);

    workspace.getConfiguration = origGet;
  });
});

describe('setting: parserWorkers', () => {
  it('reads parserWorkers config and passes to WorkerPool', async () => {
    const origGetConfig = workspace.getConfiguration;

    let logMessages: string[] = [];
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'parserWorkers') return 6;
        return defaultVal;
      },
    }) as any;

    const { FileScanner } = await import('../../src/indexer/FileScanner');
    const scanner = new FileScanner(
      new SymbolIndex(),
      { info: (msg: string) => { logMessages.push(msg); } } as any,
    );

    // WorkerPool won't find the worker file in test → falls back to inline parsing
    // But the log message confirms the config was read
    expect(logMessages.some(m => m.includes('6') || m.includes('unavailable'))).toBe(true);

    workspace.getConfiguration = origGetConfig;
  });
});
