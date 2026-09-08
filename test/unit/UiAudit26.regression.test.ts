import { describe, it, expect, vi, afterEach } from 'vitest';
import { Uri, workspace } from './__mocks__/vscode';
import { afterAnnotations, multiLineAnnotationStart } from '../../src/util/kotlinScan';
import { collectKeepGlobs, dynamicallyLookedUpKinds } from '../../src/util/xmlRefs';
import { findUnusedSymbols, currentRemovalExtent } from '../../src/providers/unusedSymbols';
import { findUnusedParameters } from '../../src/providers/unusedParameters';
import { findUnusedResources } from '../../src/providers/UnusedResourceProvider';
import { findUnusedResourceKeys } from '../../src/providers/unusedResourceKeys';
import { collectValueKeyDeclarations } from '../../src/indexer/ValueResourceScanner';
import { findUnusedEnumEntries } from '../../src/providers/unusedEnumEntries';
import { findUnusedDtoFields } from '../../src/providers/unusedDtoFields';
import { findUnusedRemoteConfigKeys } from '../../src/providers/unusedRemoteConfigKeys';
import { ResourceCorpus, LIBRARY_PLUGIN_RE, PUBLISHED_MODULE_RE } from '../../src/indexer/ResourceCorpus';
import { DeadWeightActionProvider } from '../../src/providers/DeadWeightActionProvider';

// Audit 26 : famille code mort et quick fixes de suppression.

afterEach(() => vi.restoreAllMocks());

const MAIN = '/proj/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const TEST_SETS: string[] = [];

describe('Étendue de suppression et annotations', () => {
  it('afterAnnotations et multiLineAnnotationStart', () => {
    expect(afterAnnotations('@Deprecated("Use the val instead")')).toBe('');
    expect(afterAnnotations('@Inject lateinit var analytics: Analytics')).toBe('lateinit var analytics: Analytics');
    expect(afterAnnotations('@A(1) @B val x = 1')).toBe('val x = 1');
    const lines = ['@Deprecated(', '    message = "gone",', '    replaceWith = ReplaceWith("Other"),', ')', 'class Ghost'];
    expect(multiLineAnnotationStart(lines, 3)).toBe(0);
    expect(multiLineAnnotationStart(['val y = foo(', '    1,', ')', 'class Z'], 2)).toBe(-1);
    expect(multiLineAnnotationStart(['}', 'class Z'], 0)).toBe(-1);
  });

  it('une annotation multi-ligne ou avec un mot-clé dans son argument part avec la déclaration', () => {
    const text = [
      'package com.x',
      '',
      '@Deprecated(',
      '    message = "gone",',
      '    replaceWith = ReplaceWith("Other"),',
      ')',
      'class Ghost',
      '',
      '@Deprecated("Use the val instead")',
      'fun ghostly() = 1',
      '',
      'class Kept',
      'fun keep() = Kept()',
    ].join('\n');
    const findings = findUnusedSymbols({ sources: [f(`${MAIN}/A.kt`, text), f(`${MAIN}/B.kt`, 'package com.x\nfun main() { keep() }')], testSourceSets: TEST_SETS });
    const ghost = findings.find(x => x.name === 'Ghost')!;
    expect(text.slice(ghost.removeStart, ghost.removeEnd)).toBe('@Deprecated(\n    message = "gone",\n    replaceWith = ReplaceWith("Other"),\n)\nclass Ghost\n');
    const ghostly = findings.find(x => x.name === 'ghostly')!;
    expect(text.slice(ghostly.removeStart, ghostly.removeEnd)).toBe('@Deprecated("Use the val instead")\nfun ghostly() = 1\n');
  });

  it('currentRemovalExtent suit une édition non sauvegardée au-dessus de la déclaration', () => {
    const before = 'package com.x\nval label = "hi"\nclass Ghost {\n    fun x() = 1\n}\n';
    const after = 'package com.x\nval label = "hello there, longer"\nclass Ghost {\n    fun x() = 1\n}\n';
    const ext = currentRemovalExtent(`${MAIN}/A.kt`, after, 'Ghost', 'class')!;
    expect(after.slice(ext.removeStart, ext.removeEnd)).toBe('class Ghost {\n    fun x() = 1\n}\n');
    expect(currentRemovalExtent(`${MAIN}/A.kt`, before.replace('Ghost', 'Renamed'), 'Ghost', 'class')).toBeUndefined();
  });

  it('une classe de test Kotlin hors source set de test n\'est pas signalée', () => {
    const findings = findUnusedSymbols({
      sources: [f('/proj/app/src/e2e/kotlin/com/x/LoginFlow.kt', 'package com.x\n\nclass LoginFlow {\n    @Test\n    fun logsIn() {}\n}\n')],
      testSourceSets: TEST_SETS,
    });
    expect(findings.map(x => x.name)).toEqual([]);
  });
});

describe('ResourceCorpus', () => {
  it('un éditeur modifié depuis le scan rend le cache périmé', () => {
    const corpus = new ResourceCorpus();
    const scanned = { sources: [{ path: '/proj/A.kt', text: 'old' }] } as any;
    const orig = (workspace as any).textDocuments;
    (workspace as any).textDocuments = [{ isDirty: true, uri: { fsPath: '/proj/A.kt' }, getText: () => 'new' }];
    try {
      expect((corpus as any).cacheIsStale(scanned)).toBe(true);
      (workspace as any).textDocuments = [{ isDirty: true, uri: { fsPath: '/proj/A.kt' }, getText: () => 'old' }];
      expect((corpus as any).cacheIsStale(scanned)).toBe(false);
      (workspace as any).textDocuments = [{ isDirty: false, uri: { fsPath: '/proj/A.kt' }, getText: () => 'new' }];
      expect((corpus as any).cacheIsStale(scanned)).toBe(false);
    } finally {
      (workspace as any).textDocuments = orig;
    }
  });

  it('reconnaît les alias de catalogue et les convention plugins', () => {
    expect(LIBRARY_PLUGIN_RE.test('alias(libs.plugins.android.library)')).toBe(true);
    expect(LIBRARY_PLUGIN_RE.test('id("com.android.library")')).toBe(true);
    expect(LIBRARY_PLUGIN_RE.test('id("com.android.application")')).toBe(false);
    for (const line of ['alias(libs.plugins.vanniktech.maven.publish)', 'alias(libs.plugins.maven.publish)', 'id("myconvention.android.library.publish")', 'publishing {', 'apply plugin: "maven-publish"']) {
      expect(PUBLISHED_MODULE_RE.test(line), line).toBe(true);
    }
    expect(PUBLISHED_MODULE_RE.test('id("com.android.application")')).toBe(false);
  });
});

describe('Manifeste : un listage plafonné n\'offre pas de suppression', () => {
  const manifest = '<manifest package="com.x"><application>\n<activity android:name=".LiveActivity" />\n</application></manifest>';
  it('la suppression d\'un composant est retenue quand les sources sont tronquées', async () => {
    const origFind = workspace.findFiles;
    workspace.findFiles = (async () => []) as any;
    try {
      const provider = new DeadWeightActionProvider();
      const mLines = manifest.split('\n');
      const doc = {
        uri: { fsPath: '/proj/app/src/main/AndroidManifest.xml', toString: () => 'file:///proj/app/src/main/AndroidManifest.xml', path: '/proj/app/src/main/AndroidManifest.xml' },
        getText: () => manifest,
        lineCount: mLines.length,
        lineAt: (n: number) => ({ text: mLines[n] ?? '', range: { start: { line: n, character: 0 }, end: { line: n, character: (mLines[n] ?? '').length } } }),
      } as any;
      const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } } as any;
      (provider as any)._sources = { at: Date.now(), value: [], truncated: false };
      const offered = await provider.provideCodeActions(doc as any, range);
      expect(offered.map(a => a.title)).toEqual(['Remove .LiveActivity (class not found)']);
      (provider as any)._sources = { at: Date.now(), value: [], truncated: true };
      expect(await provider.provideCodeActions(doc as any, range)).toEqual([]);
    } finally {
      workspace.findFiles = origFind;
    }
  });
});

describe('KJ-025 : constructeur d\'inflation', () => {
  it('attrs: AttributeSet? n\'est jamais un paramètre inutile', () => {
    const text = [
      'package com.x',
      'class MyView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : FrameLayout(context) {',
      '    private fun helper(unusedArg: Int) = 1',
      '}',
    ].join('\n');
    expect(findUnusedParameters(text).map(p => p.name)).toEqual(['unusedArg']);
  });
});

describe('KJ-029 / KJ-031 : keep rules et getIdentifier', () => {
  it('collectKeepGlobs lit les jokers de tools:keep', () => {
    const globs = collectKeepGlobs('<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/ic_dyn_*,@layout/keep_me" />');
    expect(globs.some(g => g.test('drawable/ic_dyn_a'))).toBe(true);
    expect(globs.some(g => g.test('layout/keep_me'))).toBe(true);
    expect(globs.some(g => g.test('drawable/other'))).toBe(false);
  });

  it('raw/keep.xml et les ressources qu\'il protège ne sont pas signalés', () => {
    const module = '/proj/app';
    const variant = (path: string) => ({ path, qualifier: path.split('/').slice(-2)[0], moduleDir: module });
    const keepXml = `${module}/src/main/res/raw/keep.xml`;
    const findings = findUnusedResources({
      entries: [
        { kind: 'raw', name: 'keep', variants: [variant(keepXml)] },
        { kind: 'drawable', name: 'ic_dyn_a', variants: [variant(`${module}/src/main/res/drawable/ic_dyn_a.xml`)] },
        { kind: 'drawable', name: 'ic_other', variants: [variant(`${module}/src/main/res/drawable/ic_other.xml`)] },
      ] as any,
      sources: [
        f(keepXml, '<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="@drawable/ic_dyn_*" />'),
        f(`${module}/src/main/kotlin/A.kt`, 'package com.x\nclass A'),
      ],
      modulesWithCode: [module],
      includeDrawables: true,
    });
    expect(findings.map(x => `${x.kind}/${x.name}`)).toEqual(['drawable/ic_other']);
  });

  it('une clé cherchée par getIdentifier avec un type littéral n\'est pas signalée', () => {
    const module = '/proj/app';
    const xmlPath = `${module}/src/main/res/values/strings.xml`;
    const xml = '<resources>\n    <string name="kj_dyn">dyn</string>\n    <string name="kj_dead">dead</string>\n    <color name="kj_color">#fff</color>\n</resources>';
    const declarations = collectValueKeyDeclarations(xmlPath, xml, [module]);
    const sources = [f(xmlPath, xml), f(`${module}/src/main/kotlin/A.kt`, 'package com.x\nfun t(res: Resources, key: String, pkg: String) = res.getIdentifier(key, "string", pkg)')];
    const flagged = findUnusedResourceKeys({ declarations, sources, modulesWithCode: [module] }).map(k => `${k.kind}/${k.name}`);
    expect(flagged).toEqual(['color/kj_color']);
    expect(dynamicallyLookedUpKinds('res.getIdentifier(name, type, pkg)')).toBeNull();
  });
});

describe('KJ-039 / KJ-044 / KJ-040', () => {
  it('un enum stocké par une @Entity Room n\'est pas signalé', () => {
    const sources = [
      f(`${MAIN}/Status.kt`, 'package com.x\n\nenum class Status { ACTIVE, ARCHIVED }\n'),
      f(`${MAIN}/Row.kt`, 'package com.x\n\n@Entity\ndata class Row(@PrimaryKey val id: Int, val status: Status)\n'),
      f(`${MAIN}/Use.kt`, 'package com.x\n\nfun use() = Status.ACTIVE\n'),
    ];
    expect(findUnusedEnumEntries({ sources, testSourceSets: TEST_SETS }).map(e => e.name)).toEqual([]);
  });

  it('une destructuration par type inféré retire le fix mais garde le verdict', () => {
    const sources = [
      f(`${MAIN}/ProfileResponse.kt`, 'package com.x\n\ndata class ProfileResponse(\n    val id: Int,\n    val name: String,\n    val avatarUrl: String,\n)\n'),
      f(`${MAIN}/Repo.kt`, 'package com.x\n\nclass Repo { fun profile(): ProfileResponse = api.profile() }\n'),
      f(`${MAIN}/Vm.kt`, 'package com.x\n\nfun render(repo: Repo) {\n    val (id, name, url) = repo.profile()\n    println("$id $name $url")\n}\n'),
    ];
    const findings = findUnusedDtoFields({ sources, testSourceSets: TEST_SETS });
    const avatar = findings.find(x => x.name === 'avatarUrl')!;
    expect(avatar).toBeDefined();
    expect(avatar.removeStart).toBe(-1);
  });

  it('une entrée commentée n\'est pas une déclaration, et getAll() garde toutes les clés', () => {
    const defaults = `${MAIN.replace('/kotlin/com/x', '')}/res/xml/remote_config_defaults.xml`;
    const xml = '<defaults>\n<!-- <entry><key>old_flag</key><value>1</value></entry> -->\n<entry><key>feature_a</key><value>1</value></entry>\n</defaults>';
    const noReader = [f(defaults, xml), f(`${MAIN}/A.kt`, 'package com.x\nval rc = FirebaseRemoteConfig.getInstance()\n')];
    expect(findUnusedRemoteConfigKeys({ sources: noReader }).map(k => k.name)).toEqual(['feature_a']);
    const iterates = [f(defaults, xml), f(`${MAIN}/Admin.kt`, 'package com.x\nfun dump(rc: FirebaseRemoteConfig) = rc.all.forEach { println(it) }\n')];
    expect(findUnusedRemoteConfigKeys({ sources: iterates })).toEqual([]);
  });
});
