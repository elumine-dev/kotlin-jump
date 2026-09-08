import { describe, it, expect, vi, afterEach } from 'vitest';
import { Uri, workspace } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { buildSnapshotFile, restoreSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { SNAPSHOT_VERSION } from '../../src/indexer/IndexStore';
import { FileScanner, moduleRootFor } from '../../src/indexer/FileScanner';
import { makeExclusionMatcher } from '../../src/util/pathExclusion';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { NullLogger } from '../../src/util/logger';

// Audit 24 : fraîcheur de l'index, snapshot, Cmd+T, rattachement aux modules, watcher.

vi.mock('../../src/indexer/WorkerPool', () => ({
  WorkerPool: class { available = false; async run(): Promise<never> { throw new Error('unused'); } async destroy() {} },
}));

afterEach(() => vi.restoreAllMocks());

function addKt(index: SymbolIndex, uri: string, code: string, moduleName?: string) {
  index.add(parse(uri, code), moduleName);
}

function snapshotRoundTrip(uri: string, code: string, into: SymbolIndex) {
  const parsed = parse(uri, code);
  const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 10, parsed.imports);
  restoreSnapshotFile(uri, sf, into);
  return sf;
}

describe('SymbolIndex.restoreFile est idempotent', () => {
  it('un fichier scanné puis restauré du snapshot puis rescanné garde une seule entrée par symbole', () => {
    const index = new SymbolIndex();
    const uri = 'file:///proj/Foo.kt';
    const code = 'package com.app\nclass Foo {\n    fun bar() {}\n}';
    addKt(index, uri, code);
    snapshotRoundTrip(uri, code, index);
    addKt(index, uri, code);
    expect(index.lookup('Foo').length).toBe(1);
    expect(index.lookup('bar').length).toBe(1);

    index.remove(Uri.parse(uri) as any);
    addKt(index, uri, 'package com.app\nclass Foo {\n    fun baz() {}\n}');
    expect(index.lookup('bar')).toEqual([]);
    expect(index.lookup('baz').length).toBe(1);

    index.remove(Uri.parse(uri) as any);
    expect(index.lookupFqn('com.app.Foo')).toBeUndefined();
    expect(index.lookup('Foo')).toEqual([]);
  });
});

describe('Snapshot v24 : expect / actual / paramètres de constructeur primaire', () => {
  it('conserve les trois indicateurs', () => {
    expect(SNAPSHOT_VERSION).toBe(24);
    const index = new SymbolIndex();
    const sf = snapshotRoundTrip('file:///proj/User.kt', 'package com.app\ndata class User(val id: Int, val name: String) {\n    val display = name\n}', index);
    expect(Object.keys(sf)).toEqual(expect.arrayContaining(['pc']));
    const byName = (n: string) => index.lookup(n)[0];
    expect(byName('id').isPrimaryCtorParam).toBe(true);
    expect(byName('name').isPrimaryCtorParam).toBe(true);
    expect(byName('display').isPrimaryCtorParam).toBeUndefined();

    snapshotRoundTrip('file:///proj/common/Platform.kt', 'package com.app\nexpect fun platform(): String', index);
    snapshotRoundTrip('file:///proj/jvm/Platform.kt', 'package com.app\nactual fun platform(): String = "jvm"', index);
    const entries = index.lookup('platform');
    expect(entries.map(e => [e.isExpect, e.isActual])).toEqual(expect.arrayContaining([[true, undefined], [undefined, true]]));
  });

  it('lookupFqn préfère actual à expect quel que soit l\'ordre de restauration', () => {
    const expectCode = 'package com.app\nexpect fun platform(): String';
    const actualCode = 'package com.app\nactual fun platform(): String = "jvm"';
    const a = new SymbolIndex();
    snapshotRoundTrip('file:///proj/jvm/Platform.kt', actualCode, a);
    snapshotRoundTrip('file:///proj/common/Platform.kt', expectCode, a);
    expect(a.lookupFqn('com.app.platform')?.uri.path).toBe('/proj/jvm/Platform.kt');
    const b = new SymbolIndex();
    snapshotRoundTrip('file:///proj/common/Platform.kt', expectCode, b);
    snapshotRoundTrip('file:///proj/jvm/Platform.kt', actualCode, b);
    expect(b.lookupFqn('com.app.platform')?.uri.path).toBe('/proj/jvm/Platform.kt');
  });
});

describe('lookupFqn : le workspace passe avant les JAR', () => {
  const code = 'package com.company.core\nclass Result';
  it('un JAR indexé après le fichier du workspace ne le masque pas, et le remplace quand il disparaît', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///ws/core/src/main/kotlin/Result.kt', code);
    addKt(index, 'kotlin-jar:///cache/core-1.0-sources.jar!/com/company/core/Result.kt', code);
    expect(index.lookupFqn('com.company.core.Result')?.uri.scheme).toBe('file');
    index.remove(Uri.parse('file:///ws/core/src/main/kotlin/Result.kt') as any);
    expect(index.lookupFqn('com.company.core.Result')?.uri.scheme).toBe('kotlin-jar');
    addKt(index, 'file:///ws/core/src/main/kotlin/Result.kt', code);
    expect(index.lookupFqn('com.company.core.Result')?.uri.scheme).toBe('file');
  });

  it('la stdlib embarquée passe avant un JAR ordinaire, et le dernier fichier du workspace gagne toujours', () => {
    const index = new SymbolIndex();
    addKt(index, 'kotlin-stdlib-jar:///stdlib!/kotlin/collections/List.kt', 'package kotlin.collections\ninterface List');
    addKt(index, 'kotlin-jar:///cache/other.jar!/kotlin/collections/List.kt', 'package kotlin.collections\ninterface List');
    expect(index.lookupFqn('kotlin.collections.List')?.uri.scheme).toBe('kotlin-stdlib-jar');
    addKt(index, 'file:///ws/a/Dup.kt', 'package com.p\nclass Dup');
    addKt(index, 'file:///ws/b/Dup.kt', 'package com.p\nclass Dup');
    expect(index.lookupFqn('com.p.Dup')?.uri.path).toBe('/ws/b/Dup.kt');
  });
});

describe('Cmd+T ignore les variables locales', () => {
  it('250 fonctions avec `val item` ne cachent plus ItemRepository', () => {
    const index = new SymbolIndex();
    for (let i = 0; i < 250; i++) {
      addKt(index, `file:///proj/F${i}.kt`, `package com.app\nfun render${i}() {\n    val item = 1\n    var itemCount = 2\n}`);
    }
    addKt(index, 'file:///proj/ItemRepository.kt', 'package com.app\nclass ItemRepository');
    index.finalize();
    const names = index.search('item', undefined, true).map(e => e.name);
    expect(names).toContain('ItemRepository');
    expect(names).not.toContain('item');
    expect(index.filterByKind(new Set(['val']), 200, true)).toEqual([]);
    expect(index.filterByKind(new Set(['val'])).length).toBe(200);
  });
});

describe('moduleRootFor', () => {
  const map = new Map([
    [':app', '/proj/app'],
    [':app-widgets', '/proj/app-widgets'],
    [':feature', '/proj/feature'],
    [':feature:home', '/proj/feature/home'],
    [':core', '/proj/core/'],
  ]);
  it('choisit le module dont la racine est un préfixe de chemin entier, le plus long d\'abord', () => {
    expect(moduleRootFor('/proj/app-widgets/src/main/kotlin/W.kt', map)?.name).toBe(':app-widgets');
    expect(moduleRootFor('/proj/app/src/main/kotlin/A.kt', map)?.name).toBe(':app');
    expect(moduleRootFor('/proj/feature/home/src/main/kotlin/H.kt', map)?.name).toBe(':feature:home');
    expect(moduleRootFor('/proj/feature/src/main/kotlin/F.kt', map)?.name).toBe(':feature');
    expect(moduleRootFor('/proj/apple/src/main/kotlin/X.kt', map)).toBeUndefined();
    expect(moduleRootFor('/proj/core/src/commonMain/kotlin/C.kt', map)?.rel).toBe('/src/commonMain/kotlin/C.kt');
  });
  it('accepte les séparateurs Windows des deux côtés', () => {
    const win = new Map([[':app', 'C:\\proj/app']]);
    expect(moduleRootFor('C:\\proj\\app\\src\\main\\kotlin\\A.kt', win)?.name).toBe(':app');
    expect(moduleRootFor('C:\\proj\\app-widgets\\src\\W.kt', win)).toBeUndefined();
  });
});

describe('makeExclusionMatcher avec les racines du workspace', () => {
  it('un motif relatif comme app/build/** exclut sous chaque racine', () => {
    const excluded = makeExclusionMatcher(['app/build/**', '**/.gradle/**'], ['/proj', '/other/']);
    expect(excluded('/proj/app/build/generated/X.kt')).toBe(true);
    expect(excluded('/other/app/build/generated/X.kt')).toBe(true);
    expect(excluded('/proj/app/src/main/X.kt')).toBe(false);
    expect(excluded('/proj/.gradle/x/X.kt')).toBe(true);
    expect(makeExclusionMatcher(['app/build/**'])('/proj/app/build/X.kt')).toBe(false);
  });
});

describe('FileScanner.rescan sur un fichier devenu trop gros', () => {
  it('retire les anciens symboles au lieu de les garder', async () => {
    const index = new SymbolIndex();
    const uri = 'file:///proj/Big.kt';
    addKt(index, uri, 'package com.app\nclass Old');
    const origRead = workspace.fs.readFile;
    workspace.fs.readFile = (async () => Buffer.alloc(600 * 1024, 32)) as any;
    try {
      const scanner = new FileScanner(index, new NullLogger() as any);
      await scanner.rescan([Uri.parse(uri) as any]);
      expect(index.lookup('Old')).toEqual([]);
      await scanner.scanFile(Uri.parse('file:///proj/build/.kapt_metadata/x.kt') as any);
      expect(index.fileUriStrings()).toEqual([]);
    } finally {
      workspace.fs.readFile = origRead;
    }
  });
});

describe('FileWatcher : dossiers supprimés, renommés, ajoutés', () => {
  function setup() {
    const index = new SymbolIndex();
    addKt(index, 'file:///proj/feature/A.kt', 'package f\nclass A');
    addKt(index, 'file:///proj/feature/sub/B.kt', 'package f\nclass B');
    addKt(index, 'file:///proj/featureX/C.kt', 'package f\nclass C');
    const rescan = vi.fn(async () => {});
    const indexed: string[] = [];
    const watcher = new FileWatcher({ rescan } as any, index, uri => indexed.push(uri.toString()));
    return { index, watcher, rescan, indexed };
  }

  it('removeTree ne retire que les fichiers sous le dossier, et prévient les écouteurs', () => {
    const { index, watcher, indexed } = setup();
    const gone = watcher.removeTree(Uri.parse('file:///proj/feature') as any);
    expect(gone.map(u => u.toString()).sort()).toEqual(['file:///proj/feature/A.kt', 'file:///proj/feature/sub/B.kt']);
    expect(index.fileUriStrings()).toEqual(['file:///proj/featureX/C.kt']);
    expect(index.lookup('A')).toEqual([]);
    expect(indexed.length).toBe(2);
    expect(watcher.removeTree(Uri.parse('file:///proj/featureX/C.kt') as any)).toEqual([]);
    watcher.dispose();
  });

  it('addTree rescanne les sources trouvées sous le nouveau dossier', async () => {
    const { watcher, rescan, indexed } = setup();
    const origFind = workspace.findFiles;
    workspace.findFiles = (async (pattern: any) => {
      expect(pattern.base.toString()).toBe('file:///proj/renamed');
      return [Uri.parse('file:///proj/renamed/A.kt'), Uri.parse('file:///proj/renamed/sub/B.kt')];
    }) as any;
    try {
      const added = await watcher.addTree(Uri.parse('file:///proj/renamed') as any);
      expect(added.length).toBe(2);
      expect(rescan).toHaveBeenCalledTimes(1);
      expect(indexed).toEqual(['file:///proj/renamed/A.kt', 'file:///proj/renamed/sub/B.kt']);
      expect(await watcher.addTree(Uri.parse('file:///proj/renamed/A.kt') as any)).toEqual([]);
    } finally {
      workspace.findFiles = origFind;
      watcher.dispose();
    }
  });
});
