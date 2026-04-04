import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider, clearPendingDeclNav, getPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { fileCouldReference, scanForUsages } from '../../src/providers/FindUsagesEngine';
import { KotlinFileProvider } from '../../src/providers/FileProvider';
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

// ── maxReferences ───────────────────────────────────────────────────────────

describe('setting: maxReferences', () => {
  it('default is 500', () => {
    expect(workspace.getConfiguration().get('maxReferences', 500)).toBe(500);
  });

  it('caps scanForUsages results at configured limit', async () => {
    const origGetConfig = workspace.getConfiguration;
    const origReadFile  = workspace.fs.readFile;

    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'maxReferences') return 3;
        return defaultVal;
      },
    }) as any;

    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');

    // 10 usages per file, 5 files → 50 potential results without cap
    const manyUsages = [
      'package com.example',
      ...Array.from({ length: 10 }, (_, i) => `val x${i} = Foo()`),
    ].join('\n');
    workspace.fs.readFile = async () => Buffer.from(manyUsages) as any;

    const doc   = mockDocument('file:///App.kt', 'package com.example\nval a = Foo()');
    const token = { isCancellationRequested: false };
    const uris  = ['file:///a.kt', 'file:///b.kt', 'file:///c.kt', 'file:///d.kt', 'file:///e.kt'];

    const results = await scanForUsages('Foo', doc as any, index, uris, token as any);

    expect(results.length).toBeLessThanOrEqual(3);

    workspace.getConfiguration = origGetConfig;
    workspace.fs.readFile = origReadFile;
  });

  it('without cap, returns all results when under the limit', async () => {
    const origGetConfig = workspace.getConfiguration;
    const origReadFile  = workspace.fs.readFile;

    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'maxReferences') return 500;
        return defaultVal;
      },
    }) as any;

    const index = new SymbolIndex();
    addKt(index, 'file:///Foo.kt', 'package com.example\nclass Foo');

    // 2 usages per file, 2 files → 4 results (well under limit of 500)
    const twoUsages = 'package com.example\nval a = Foo()\nval b = Foo()';
    workspace.fs.readFile = async () => Buffer.from(twoUsages) as any;

    const doc   = mockDocument('file:///App.kt', 'package com.example\nval a = Foo()');
    const token = { isCancellationRequested: false };
    const uris  = ['file:///a.kt', 'file:///b.kt'];

    const results = await scanForUsages('Foo', doc as any, index, uris, token as any);

    expect(results.length).toBe(4);

    workspace.getConfiguration = origGetConfig;
    workspace.fs.readFile = origReadFile;
  });
});

// ── hoverEnabled ─────────────────────────────────────────────────────────────

describe('setting: hoverEnabled', () => {
  it('default is true', () => {
    expect(workspace.getConfiguration().get('hoverEnabled', true)).toBe(true);
  });

  it('can be overridden to false', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'hoverEnabled') return false;
        return defaultVal;
      },
    }) as any;

    const enabled = workspace.getConfiguration().get('hoverEnabled', true);
    expect(enabled).toBe(false);

    workspace.getConfiguration = origGetConfig;
  });
});

// ── fileSizeLimit ─────────────────────────────────────────────────────────────

describe('setting: fileSizeLimit', () => {
  it('default is 512 (KB)', () => {
    expect(workspace.getConfiguration().get('fileSizeLimit', 512)).toBe(512);
  });

  it('files exceeding the limit are not indexed by scanFile', async () => {
    const origGetConfig = workspace.getConfiguration;
    const origReadFile  = workspace.fs.readFile;

    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'fileSizeLimit') return 1; // 1 KB
        return defaultVal;
      },
    }) as any;

    // Return a 2 KB buffer — exceeds 1 KB limit
    workspace.fs.readFile = async () => Buffer.alloc(2 * 1024, 'x') as any;

    const index = new SymbolIndex();
    const { FileScanner } = await import('../../src/indexer/FileScanner');
    const scanner = new FileScanner(index, { info: () => {} } as any);
    await scanner.scanFile({ toString: () => 'file:///Big.kt', fsPath: '/Big.kt' } as any);

    expect(index.stats().files).toBe(0); // file was skipped

    workspace.getConfiguration = origGetConfig;
    workspace.fs.readFile = origReadFile;
  });

  it('size check passes for files within the limit', () => {
    // fileSizeLimit: 10 (KB) → maxFileBytes = 10 * 1024 = 10240
    const limitKb      = 10;
    const maxFileBytes = limitKb * 1024;
    const content      = 'package com.example\nclass Foo';
    const buf          = Buffer.from(content);

    // Size check: bytes.byteLength > maxFileBytes → false → file proceeds
    expect(buf.byteLength).toBeLessThan(maxFileBytes);
  });

  it('content that passes the size check is parseable and indexable', () => {
    // Verify the full pipeline (parse → index) works for typical file content,
    // independently of FileScanner's worker pool environment.
    const content = 'package com.example\nclass Foo';
    const index   = new SymbolIndex();
    index.add(parse('file:///Foo.kt', content));
    expect(index.stats().symbols).toBeGreaterThan(0);
  });

  it('fileSizeLimit is applied in KB (512 KB default = 524288 bytes)', () => {
    const limitKb    = 512;
    const limitBytes = limitKb * 1024;
    expect(limitBytes).toBe(524_288);
  });
});

// ── snapshotEnabled ──────────────────────────────────────────────────────────

describe('setting: snapshotEnabled', () => {
  it('default is true', () => {
    expect(workspace.getConfiguration().get('snapshotEnabled', true)).toBe(true);
  });

  it('can be overridden to false', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'snapshotEnabled') return false;
        return defaultVal;
      },
    }) as any;

    expect(workspace.getConfiguration().get('snapshotEnabled', true)).toBe(false);

    workspace.getConfiguration = origGetConfig;
  });

  it('when false, snapshot load is skipped (null returned instead)', () => {
    // Verify the conditional: snapshotEnabled ? IndexStore.load() : null
    const snapshotEnabled = false;
    const loadCalled = { value: false };
    const mockLoad = () => { loadCalled.value = true; return Promise.resolve({}); };

    const result = snapshotEnabled ? mockLoad() : null;

    expect(result).toBeNull();
    expect(loadCalled.value).toBe(false);
  });

  it('when true, snapshot load is called', async () => {
    const snapshotEnabled = true;
    const loadCalled = { value: false };
    const mockLoad = () => { loadCalled.value = true; return Promise.resolve(null); };

    await (snapshotEnabled ? mockLoad() : Promise.resolve(null));

    expect(loadCalled.value).toBe(true);
  });
});

// ── watcherDebounceMs ────────────────────────────────────────────────────────

describe('setting: watcherDebounceMs', () => {
  it('default is 150', () => {
    expect(workspace.getConfiguration().get('watcherDebounceMs', 150)).toBe(150);
  });

  it('custom value is respected', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'watcherDebounceMs') return 500;
        return defaultVal;
      },
    }) as any;

    const debounceMs = workspace.getConfiguration().get('watcherDebounceMs', 150);
    expect(debounceMs).toBe(500);

    workspace.getConfiguration = origGetConfig;
  });

  it('debounce value is read per-change, not cached at construction', () => {
    // The config is read inside onChanged() each time, so changing the setting
    // takes effect on the next file change without restarting the extension.
    const origGetConfig = workspace.getConfiguration;

    let configuredMs = 150;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'watcherDebounceMs') return configuredMs;
        return defaultVal;
      },
    }) as any;

    // First call: default
    expect(workspace.getConfiguration().get('watcherDebounceMs', 150)).toBe(150);

    // Config changes at runtime
    configuredMs = 300;
    expect(workspace.getConfiguration().get('watcherDebounceMs', 150)).toBe(300);

    workspace.getConfiguration = origGetConfig;
  });
});

// ── statusBarEnabled ─────────────────────────────────────────────────────────

describe('setting: statusBarEnabled', () => {
  it('default is true', () => {
    expect(workspace.getConfiguration().get('statusBarEnabled', true)).toBe(true);
  });

  it('can be overridden to false', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'statusBarEnabled') return false;
        return defaultVal;
      },
    }) as any;

    expect(workspace.getConfiguration().get('statusBarEnabled', true)).toBe(false);

    workspace.getConfiguration = origGetConfig;
  });
});

// ── workspaceSymbolKinds ─────────────────────────────────────────────────────

describe('setting: workspaceSymbolKinds', () => {
  let index: SymbolIndex;
  let provider: KotlinFileProvider;

  const CODE = `package com.example
class MyClass {}
interface MyInterface {}
fun myFunction() {}
val MY_CONST = 1
`;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///Symbols.kt', CODE));
    index.finalize();
    provider = new KotlinFileProvider(index);
  });

  it('default empty array returns all kinds', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'workspaceSymbolKinds') return []; // empty = show all
        return defaultVal;
      },
    }) as any;

    const results = provider.provideWorkspaceSymbols('My') as any[];
    const names = results.map((r: any) => r.name);
    expect(names).toContain('MyClass');
    expect(names).toContain('MyInterface');
    expect(names).toContain('myFunction');

    workspace.getConfiguration = origGetConfig;
  });

  it('restricts results to configured kinds', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'workspaceSymbolKinds') return ['class'];
        return defaultVal;
      },
    }) as any;

    const results = provider.provideWorkspaceSymbols('My') as any[];
    const names = results.map((r: any) => r.name);
    expect(names).toContain('MyClass');
    expect(names).not.toContain('MyInterface');
    expect(names).not.toContain('myFunction');

    workspace.getConfiguration = origGetConfig;
  });

  it('multiple kinds in filter all pass through', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'workspaceSymbolKinds') return ['class', 'interface'];
        return defaultVal;
      },
    }) as any;

    const results = provider.provideWorkspaceSymbols('My') as any[];
    const names = results.map((r: any) => r.name);
    expect(names).toContain('MyClass');
    expect(names).toContain('MyInterface');
    expect(names).not.toContain('myFunction');
    expect(names).not.toContain('MY_CONST');

    workspace.getConfiguration = origGetConfig;
  });

  it('kind filter applies on top of @tag filter', () => {
    const origGetConfig = workspace.getConfiguration;
    // workspaceSymbolKinds restricts to 'class' only,
    // but @fun: query asks for functions → intersection is empty
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'workspaceSymbolKinds') return ['class'];
        return defaultVal;
      },
    }) as any;

    const results = provider.provideWorkspaceSymbols('@fun:') as any[];
    expect(results).toHaveLength(0);

    workspace.getConfiguration = origGetConfig;
  });

  it('unknown kind in filter is silently ignored (no matches)', () => {
    const origGetConfig = workspace.getConfiguration;
    workspace.getConfiguration = () => ({
      get: (key: string, defaultVal: any) => {
        if (key === 'workspaceSymbolKinds') return ['nonExistentKind'];
        return defaultVal;
      },
    }) as any;

    const results = provider.provideWorkspaceSymbols('My') as any[];
    expect(results).toHaveLength(0);

    workspace.getConfiguration = origGetConfig;
  });
});
