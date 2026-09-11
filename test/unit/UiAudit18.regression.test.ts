import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';
import { ResourceDiagnosticProvider } from '../../src/providers/ResourceDiagnosticProvider';
import { catalogRootOf, includedBuildDirs } from '../../src/providers/unusedGradleDependencies';
import { parseCatalog } from '../../src/indexer/VersionCatalogIndex';
import { DependencyResolver } from '../../src/http/DependencyResolver';
import { definitionFromPath } from '../../src/providers/ResourceShadowingProvider';
import { findUnheardEvents } from '../../src/providers/unheardEvents';

// Audit 18 : ressources Android, catalogues de versions, détecteurs.

afterEach(() => vi.restoreAllMocks());

const uri = (s: string) => ({ toString: () => s });

describe('StringResourceIndex', () => {
  it('ignore une ressource commentée, lit name en 2e position, une balise auto-fermante et <item type="string">', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(uri('file:///app/src/main/res/values/strings.xml'), [
      '<resources>',
      '    <!-- <string name="old_title">Old title</string> -->',
      '    <string translatable="false" name="app_name">MyApp</string>',
      '    <string name="empty"/>',
      '    <item type="string" name="legacy">Legacy</item>',
      '</resources>',
    ].join('\n'));
    expect(idx.getValue('old_title')).toBeUndefined();
    expect(idx.getValue('app_name')?.value).toBe('MyApp');
    expect(idx.getValue('app_name')?.line).toBe(2);
    expect(idx.getValue('empty')?.value).toBe('');
    expect(idx.getValue('legacy')?.value).toBe('Legacy');
    expect(idx.allKeys().sort()).toEqual(['app_name', 'empty', 'legacy']);
  });

  it('décode les entités numériques et les échappements Android', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(uri('file:///app/src/main/res/values/strings.xml'),
      '<resources><string name="greeting">Don\\\'t panic&#8230; %1$s\\nnext &amp; &#x41;</string></resources>');
    expect(idx.getValue('greeting')?.value).toBe("Don't panic… %1$s\nnext & A");
  });

  it('préfère la définition du module du fichier appelant', () => {
    const idx = new StringResourceIndex();
    idx.reindexFile(uri('file:///P/core/ui/src/main/res/values/strings.xml'), '<resources><string name="error_generic">core</string></resources>');
    idx.reindexFile(uri('file:///P/app/src/main/res/values/strings.xml'), '<resources><string name="error_generic">app</string></resources>');
    expect(idx.getValue('error_generic', '/P/app/src/main/kotlin/Login.kt')?.value).toBe('app');
    expect(idx.getValue('error_generic', '/P/core/ui/src/main/kotlin/X.kt')?.value).toBe('core');
    // Locale par défaut avant un qualificatif, même hors module.
    idx.reindexFile(uri('file:///P/app/src/main/res/values-fr/strings.xml'), '<resources><string name="only_fr">fr</string></resources>');
    idx.reindexFile(uri('file:///P/lib/src/main/res/values/strings.xml'), '<resources><string name="only_fr">base</string></resources>');
    expect(idx.getValue('only_fr', '/P/other/src/main/kotlin/Y.kt')?.value).toBe('base');
  });
});

describe('ColorResourceIndex', () => {
  it('ignore une couleur commentée et lit name après un autre attribut', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(uri('file:///app/src/main/res/values/colors.xml'),
      '<resources>\n<!-- <color name="old">#000</color> -->\n<color tools:ignore="x" name="brand">#FF0000</color>\n</resources>');
    expect(idx.getValue('old')).toBeUndefined();
    expect(idx.getValue('brand')?.value).toBe('#FF0000');
  });
});

describe('ResourceDiagnosticProvider', () => {
  function diagsFor(lines: string[]) {
    vi.spyOn(vscodeMock.workspace, 'onDidOpenTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
    const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
    const doc = { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }), uri: { toString: () => 'file:///Test.kt', path: '/Test.kt' } };
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([{ document: doc }] as any);
    new ResourceDiagnosticProvider(new StringResourceIndex(), new ColorResourceIndex());
    const calls = collection.set.mock.calls;
    return calls.length > 0 ? (calls.at(-1)?.[1] as any[]) : [];
  }

  it('un R qualifié par une bibliothèque et une clé générée par un SDK ne sont pas des erreurs', () => {
    expect(diagsFor(['val a = com.other.lib.R.string.lib_title'])).toEqual([]);
    expect(diagsFor(['val b = getString(R.string.default_web_client_id)'])).toEqual([]);
    expect(diagsFor(['val c = getString(R.string.google_app_id)'])).toEqual([]);
    const d = diagsFor(['val d = getString(R.string.truly_missing)']);
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe(vscodeMock.DiagnosticSeverity.Error);
  });
});

describe('Catalogues de versions', () => {
  it('deux catalogues déclarés avec from(files()) gardent chacun leur racine', () => {
    const settings = [
      'dependencyResolutionManagement {',
      '  versionCatalogs {',
      '    create("libs")     { from(files("gradle/libs.versions.toml")) }',
      '    create("testLibs") { from(files("gradle/testLibs.versions.toml")) }',
      '  }',
      '}',
    ].join('\n');
    expect(catalogRootOf('/p/gradle/libs.versions.toml', [{ path: '/p/settings.gradle.kts', text: settings }])).toBe('libs');
    expect(catalogRootOf('/p/gradle/testLibs.versions.toml', [{ path: '/p/settings.gradle.kts', text: settings }])).toBe('testLibs');
    expect(catalogRootOf('/p/gradle/deps.versions.toml', [{ path: '/p/settings.gradle.kts', text: 'versionCatalogs { create("deps") { from(files("gradle/deps.versions.toml")) } }' }])).toBe('deps');
  });

  it('includeBuild("gradle/plugins") est un dossier de plugins de convention', () => {
    expect(includedBuildDirs(['rootProject.name = "x"\nincludeBuild("gradle/plugins")\nincludeBuild(\'./tooling/\')'])).toEqual(['gradle/plugins', 'tooling']);
  });

  it('une version riche avec des crochets dans la chaîne ne rend pas le catalogue illisible', () => {
    const toml = [
      '[versions]',
      'okhttp = { strictly = "[4.0, 5.0[", prefer = "4.12.0" }',
      '[libraries]',
      'okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }',
      'compose-bom = {',
      '  module = "androidx.compose:compose-bom",',
      '  version = "2024.01.00"',
      '}',
    ].join('\n');
    const c = parseCatalog(toml, 'libs');
    expect(c.unparsed).toBe(false);
    const bom = c.aliases.find(a => a.raw === 'compose-bom')!;
    expect(bom.line).toBe(4);
    expect(bom.coordinate).toBe('androidx.compose:compose-bom');
  });

  it('parseGradle ignore une coordonnée avec un template $version', () => {
    const r = new DependencyResolver();
    const coords = r.parseGradle('dependencies {\n  implementation("com.foo:bar:$fooVersion")\n  implementation("com.squareup.okhttp3:okhttp:4.12.0")\n}', new Map());
    expect(coords.map(c => `${c.group}:${c.artifact}:${c.version}`)).toEqual(['com.squareup.okhttp3:okhttp:4.12.0']);
  });
});

describe('Shadowing et événements collants', () => {
  it('le dossier app est l\'application, pas une bibliothèque', () => {
    expect(definitionFromPath('file:///MyProject/app/src/main/res/values/strings.xml', 'x', 'MyProject')?.moduleType).toBe('app');
    expect(definitionFromPath('file:///MyProject/core/ui/src/main/res/values/strings.xml', 'x', 'MyProject')?.moduleType).toBe('library');
  });

  it('un postSticky lu par getStickyEvent(X::class.java) est entendu', () => {
    const MAIN = '/w/app/src/main/kotlin/com/x';
    const f = (path: string, text: string) => ({ path, text });
    const bus = f(`${MAIN}/BusOwner.kt`, 'package com.x\n\nclass BusOwner {\n    fun start() { EventBus.getDefault().register(this) }\n}\n');
    const listener = f(`${MAIN}/AnyListener.kt`, 'package com.x\n\nclass AnyListener {\n    @Subscribe\n    fun on(event: HeardEvent) {}\n}\n');
    const heard = f(`${MAIN}/HeardEvent.kt`, 'package com.x\n\nclass HeardEvent\n');
    const session = f(`${MAIN}/SessionEvent.kt`, 'package com.x\n\nclass SessionEvent\n');
    const writer = f(`${MAIN}/Writer.kt`, 'package com.x\n\nfun write() { EventBus.getDefault().postSticky(SessionEvent()) }\n');
    const reader = f(`${MAIN}/Reader.kt`, 'package com.x\n\nfun read() = EventBus.getDefault().getStickyEvent(SessionEvent::class.java)\n');
    const names = (sources: any[]) => findUnheardEvents({ sources, testSourceSets: ['test/java', 'test/kotlin', 'androidTest'] }).events.map(e => e.name);
    expect(names([bus, listener, heard, session, writer])).toEqual(['SessionEvent']);
    expect(names([bus, listener, heard, session, writer, reader])).toEqual([]);
  });
});
