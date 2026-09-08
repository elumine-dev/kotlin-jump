import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Position, Range, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { scanForUsagesWithTarget, fileCouldReference, withoutDeclaration } from '../../src/providers/FindUsagesEngine';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import {
  buildTestFilters, getJvmClassName, quoteForCmd, displayNameOf, resultFor,
} from '../../src/testing/GradleTestRunner';
import { KotlinTestController } from '../../src/testing/KotlinTestController';
import { NullLogger } from '../../src/util/logger';

// Audit 22 : lenses, panneau d'usages, tests Gradle, inlay hints.

let seq = 0;
const freshUri = (tag: string) => `file:///a22/${tag}_${seq++}.kt`;
const token = { isCancellationRequested: false } as any;

afterEach(() => vi.restoreAllMocks());

// ── Inlay hints ───────────────────────────────────────────────────────────────

async function hintsFor(declCode: string, callCode: string) {
  const declUri = freshUri('decl');
  const callUri = freshUri('call');
  const index = new SymbolIndex();
  index.add(parse(declUri, declCode));
  vi.spyOn(workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, declCode) as any);
  const provider = new KotlinInlayHintsProvider(index);
  const lines = callCode.split('\n');
  const range = new Range(new Position(0, 0), new Position(lines.length - 1, lines[lines.length - 1].length));
  const hints = await provider.provideInlayHints(mockDocument(callUri, callCode), range, token);
  return hints.map(h => ({ line: h.position.line, col: h.position.character, label: (h.label as any[])[0].value }));
}

describe('InlayHints: positions des arguments', () => {
  it('une virgule dans une string ne coupe pas un argument (le hint restait dans la string)', async () => {
    const hints = await hintsFor('fun send(csv: String, count: Int) {}', 'send("a, b", 3)');
    expect(hints).toEqual([
      { line: 0, col: 'send('.length, label: 'csv:' },
      { line: 0, col: 'send("a, b", '.length, label: 'count:' },
    ]);
  });

  it('un commentaire bloc dans les arguments est ignoré', async () => {
    const hints = await hintsFor('fun send(csv: String, count: Int) {}', 'send(x /* a, b */, 3)');
    expect(hints.map(h => h.col)).toEqual(['send('.length, 'send(x /* a, b */, '.length]);
  });

  it('un commentaire de ligne après un argument est ignoré sur un appel multi-ligne', async () => {
    const hints = await hintsFor('fun send(csv: String, count: Int) {}', 'send(1, // x, y\n     2)');
    expect(hints).toEqual([
      { line: 0, col: 5, label: 'csv:' },
      { line: 1, col: 5, label: 'count:' },
    ]);
  });

  it('un template ${…} avec virgule et string imbriquée reste un seul argument', async () => {
    const hints = await hintsFor('fun send(csv: String, count: Int) {}', 'send("${listOf("a", "b").joinToString(", ")}", 3)');
    expect(hints.map(h => h.col)).toEqual([5, 'send("${listOf("a", "b").joinToString(", ")}", '.length]);
  });

  it('une raw string multi-ligne en argument ne produit pas de hint dans son texte', async () => {
    const hints = await hintsFor('fun send(csv: String, count: Int) {}', 'send("""\n  a, b\n""", 3)');
    expect(hints).toEqual([
      { line: 0, col: 5, label: 'csv:' },
      { line: 2, col: 5, label: 'count:' },
    ]);
  });
});

describe('InlayHints: commentaires bloc et imports', () => {
  it('un appel à l\'intérieur d\'un commentaire bloc multi-ligne ne reçoit pas de hint', async () => {
    const code = '/* explanation\n   send(1, 2)\n   more */\nsend(3, 4)';
    const hints = await hintsFor('fun send(a: Int, b: Int) {}', code);
    expect(hints.map(h => h.line)).toEqual([3, 3]);
  });

  it('un import explicite vers une bibliothèque bloque le repli sur l\'homonyme du workspace', async () => {
    const decl = 'package com.app\nfun launch(a: Int, b: Int) {}';
    const lib = await hintsFor(decl, 'import kotlinx.coroutines.launch\n\nfun main() {\n    launch(1, 2)\n}');
    expect(lib).toEqual([]);
    const own = await hintsFor(decl, 'import com.app.launch\n\nfun main() {\n    launch(1, 2)\n}');
    expect(own.map(h => h.label)).toEqual(['a:', 'b:']);
  });
});

// ── Moteur de recherche d'usages ─────────────────────────────────────────────

function fileSet(files: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(files)) index.add(parse(uri, code));
  workspace.fs.readFile = (async (uri: any) => Buffer.from(files[uri.toString()] ?? '')) as any;
  workspace.openTextDocument = (async (uri: any) => mockDocument(uri.toString(), files[uri.toString()] ?? '')) as any;
  return index;
}

describe('FindUsagesEngine: raw strings, commentaires ouverts, package par défaut', () => {
  let origRead: any;
  let origOpen: any;
  beforeEach(() => { origRead = workspace.fs.readFile; origOpen = workspace.openTextDocument; });
  afterEach(() => { workspace.fs.readFile = origRead; workspace.openTextDocument = origOpen; });

  it('le texte d\'une raw string multi-ligne n\'est pas un usage, ses templates et le code après """ le sont', async () => {
    const declUri = freshUri('raw-decl');
    const useUri = freshUri('raw-use');
    const useCode = [
      'package app',
      'val sql = """',
      '    SELECT userId FROM users',
      '    WHERE x = $userId AND y = ${userId + 1}',
      '""" + userId',
    ].join('\n');
    const index = fileSet({ [declUri]: 'package app\nval userId = 1', [useUri]: useCode });
    const target = index.lookup('userId')[0];
    const hits = await scanForUsagesWithTarget('userId', target, index, [useUri], token);
    expect(hits.map(h => [h.line, h.character])).toEqual([
      [3, '    WHERE x = $'.length],
      [3, '    WHERE x = $userId AND y = ${'.length],
      [4, '""" + '.length],
    ]);
  });

  it('un commentaire bloc ouvert en milieu de ligne cache les lignes suivantes jusqu\'à */', async () => {
    const declUri = freshUri('cmt-decl');
    const useUri = freshUri('cmt-use');
    const useCode = [
      'package app',
      'val x = 1 /* userId here',
      '   and userId there */ val y = userId',
    ].join('\n');
    const index = fileSet({ [declUri]: 'package app\nval userId = 1', [useUri]: useCode });
    const target = index.lookup('userId')[0];
    const hits = await scanForUsagesWithTarget('userId', target, index, [useUri], token);
    expect(hits.map(h => [h.line, h.character])).toEqual([[2, '   and userId there */ val y = '.length]]);
  });

  it('deux fichiers sans package se référencent (le compteur affichait 0 usages)', async () => {
    const declUri = freshUri('pkg-decl');
    const useUri = freshUri('pkg-use');
    const index = fileSet({ [declUri]: 'val helper = 1', [useUri]: 'fun main() { println(helper) }' });
    const target = index.lookup('helper')[0];
    expect(fileCouldReference('fun main() { println(helper) }', target)).toBe(true);
    expect(fileCouldReference('package other\nfun main() { println(helper) }', target)).toBe(false);
    const hits = await scanForUsagesWithTarget('helper', target, index, [useUri], token);
    expect(hits.map(h => h.line)).toEqual([0]);
  });
});

describe('withoutDeclaration', () => {
  const uri = 'file:///a22/Decl.kt';
  const results = [
    { uri: {} as any, uriString: uri, line: 3, character: 4, lineText: '' },
    { uri: {} as any, uriString: uri, line: 3, character: 30, lineText: '' },
    { uri: {} as any, uriString: uri, line: 5, character: 2, lineText: '' },
  ];

  it('retire seulement le jeton de déclaration, l\'appel récursif sur la même ligne reste', () => {
    expect(withoutDeclaration(results, uri, 3, 4).map(r => r.character)).toEqual([30, 2]);
  });

  it('la déclaration n\'est pas toujours le premier jeton de sa ligne', () => {
    // `@JvmName("send") fun send()` : le premier « send » de la ligne est dans
    // l'annotation, la déclaration est le second. En retirant le premier, la
    // déclaration restait comptée comme usage et une vraie mention partait.
    const sameLine = [
      { uri: {} as any, uriString: uri, line: 7, character: 10, lineText: '' },
      { uri: {} as any, uriString: uri, line: 7, character: 21, lineText: '' },
      { uri: {} as any, uriString: uri, line: 9, character: 4, lineText: '' },
    ];
    expect(withoutDeclaration(sameLine, uri, 7, 21).map(r => r.character)).toEqual([10, 4]);
  });

  it('sans colonne exacte, retire le premier résultat de la ligne', () => {
    expect(withoutDeclaration(results, uri, 3, 99).map(r => r.character)).toEqual([30, 2]);
    expect(withoutDeclaration(results, uri, 3).map(r => r.character)).toEqual([30, 2]);
  });

  it('ligne sans résultat: liste inchangée', () => {
    expect(withoutDeclaration(results, uri, 9, 0)).toBe(results);
  });
});

// ── CodeLens: annulation partagée ────────────────────────────────────────────

function listenerToken() {
  const listeners: (() => void)[] = [];
  const t: any = {
    isCancellationRequested: false,
    onCancellationRequested: (l: () => void) => { listeners.push(l); return { dispose() {} }; },
  };
  t.cancel = () => { t.isCancellationRequested = true; for (const l of listeners) l(); };
  return t;
}

describe('CodeLens: un scan annulé par une requête ne fausse pas la suivante', () => {
  let origRead: any;
  let origOpen: any;
  beforeEach(() => { origRead = workspace.fs.readFile; origOpen = workspace.openTextDocument; });
  afterEach(() => { workspace.fs.readFile = origRead; workspace.openTextDocument = origOpen; });

  function setup() {
    const declUri = freshUri('lens-decl');
    const useUri = freshUri('lens-use');
    const index = fileSet({
      [declUri]: 'package app\nfun helper() {}',
      [useUri]: 'package app\nfun main() { helper(); helper() }',
    });
    const entry = index.lookup('helper')[0];
    const provider = new KotlinCodeLensProvider(index);
    const lens = () => ({ range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any);
    return { provider, lens, entry };
  }

  it('la première requête annulée en vol, la seconde partage le scan et obtient le vrai compte', async () => {
    const { provider, lens } = setup();
    const first = { isCancellationRequested: false } as any;
    const a = provider.resolveCodeLens(lens(), first);
    const b = provider.resolveCodeLens(lens(), { isCancellationRequested: false } as any);
    first.isCancellationRequested = true;
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.command).toBeUndefined();
    expect(rb.command?.title).toBe('2 usages');
  });

  it('le scan n\'est arrêté que lorsque toutes les requêtes en attente sont annulées', async () => {
    const { provider, lens, entry } = setup();
    const ta = listenerToken();
    const tb = listenerToken();
    const a = provider.resolveCodeLens(lens(), ta);
    const b = provider.resolveCodeLens(lens(), tb);
    ta.cancel();
    const rb = await b;
    await a;
    expect(rb.command?.title).toBe('2 usages');
    expect(provider.getCachedResults(entry.fqn)).toBeDefined();
  });

  it('toutes les requêtes annulées: le scan partiel n\'est pas mis en cache', async () => {
    const { provider, lens, entry } = setup();
    const ta = listenerToken();
    const tb = listenerToken();
    const a = provider.resolveCodeLens(lens(), ta);
    const b = provider.resolveCodeLens(lens(), tb);
    ta.cancel();
    tb.cancel();
    await Promise.all([a, b]);
    expect(provider.getCachedResults(entry.fqn)).toBeUndefined();
    const fresh = await provider.resolveCodeLens(lens(), { isCancellationRequested: false } as any);
    expect(fresh.command?.title).toBe('2 usages');
  });

  it('un appel récursif sur la ligne de déclaration compte comme usage', async () => {
    const declUri = freshUri('rec-decl');
    const index = fileSet({ [declUri]: 'package app\nfun fact(n: Int): Int = if (n <= 1) 1 else n * fact(n - 1)' });
    const entry = index.lookup('fact')[0];
    const provider = new KotlinCodeLensProvider(index);
    const lens = { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any;
    const resolved = await provider.resolveCodeLens(lens, { isCancellationRequested: false } as any);
    expect(resolved.command?.title).toBe('1 usage');
  });
});

// ── Runner Gradle ────────────────────────────────────────────────────────────

const spec = (fqn: string, name: string, packageName: string) =>
  ({ item: {} as any, entry: { fqn, name, packageName } as any });

describe('GradleTestRunner: filtres --tests et quoting Windows', () => {
  it('une classe @Nested est envoyée sous ses deux graphies, Outer.Inner et Outer$Inner', () => {
    expect(buildTestFilters([spec('com.app.OuterTest.InnerTest.works', 'works', 'com.app')])).toEqual([
      '--tests', 'com.app.OuterTest.InnerTest.works',
      '--tests', 'com.app.OuterTest$InnerTest.works',
    ]);
    expect(getJvmClassName(spec('OuterTest.InnerTest.works', 'works', '').entry)).toBe('OuterTest$InnerTest');
  });

  it('une classe de premier niveau garde un seul filtre', () => {
    expect(buildTestFilters([spec('com.app.CalcTest.adds', 'adds', 'com.app')])).toEqual([
      '--tests', 'com.app.CalcTest.adds',
    ]);
  });

  it('quoteForCmd entoure les arguments avec espaces ou parenthèses', () => {
    expect(quoteForCmd('--tests')).toBe('--tests');
    expect(quoteForCmd('com.app.T.returns 404 (not found)')).toBe('"com.app.T.returns 404 (not found)"');
    expect(quoteForCmd('C:\\Users\\John Doe\\init.gradle')).toBe('"C:\\Users\\John Doe\\init.gradle"');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteForCmd('')).toBe('""');
  });
});

describe('GradleTestRunner: @DisplayName', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a22-'));
  const file = path.join(dir, 'CalcTest.kt');
  fs.writeFileSync(file, [
    'package com.app',
    'class CalcTest {',
    '    @Test',
    '    @DisplayName("adds two numbers")',
    '    fun add() {}',
    '',
    '    @Test fun plain() {}',
    '',
    '    @Test',
    '    @DisplayName(value = "handles \\"quotes\\"")',
    '    fun quoted() {}',
    '}',
  ].join('\n'));
  const entryAt = (name: string, line: number) =>
    ({ fqn: `com.app.CalcTest.${name}`, name, packageName: 'com.app', line, uri: { fsPath: file } } as any);

  it('lit le nom d\'affichage sur les lignes d\'annotation au-dessus de la déclaration', () => {
    const cache = new Map();
    expect(displayNameOf(entryAt('add', 4), cache)).toBe('adds two numbers');
    expect(displayNameOf(entryAt('plain', 6), cache)).toBeUndefined();
    expect(displayNameOf(entryAt('quoted', 10), cache)).toBe('handles "quotes"');
    expect(cache.size).toBe(1);
  });

  it('un résultat JUnit publié sous le nom d\'affichage retrouve son entrée', () => {
    const results = new Map<string, any>([
      ['com.app.CalcTest.adds two numbers', { classFqn: 'com.app.CalcTest', methodName: 'adds two numbers', state: 'failed' }],
      ['com.app.CalcTest.plain', { classFqn: 'com.app.CalcTest', methodName: 'plain', state: 'passed' }],
    ]);
    const cache = new Map();
    expect(resultFor(entryAt('add', 4), results, cache)?.state).toBe('failed');
    expect(resultFor(entryAt('plain', 6), results, cache)?.state).toBe('passed');
    expect(resultFor(entryAt('quoted', 10), results, cache)).toBeUndefined();
  });
});

// ── Test Explorer: source sets ───────────────────────────────────────────────

describe('KotlinTestController: détection des source sets de test', () => {
  const KT = 'package com.app\nclass FooTest {\n  @Test\n  fun works() {}\n}';
  function controllerWith(uri: string) {
    const index = new SymbolIndex();
    index.add(parse(uri, KT), ':app');
    const context = {
      subscriptions: [],
      workspaceState: { get: <T>(_k: string, def?: T) => def, update: async () => {} },
    } as unknown as vscode.ExtensionContext;
    const ctrl = new KotlinTestController(index, context, new NullLogger() as any);
    ctrl.refreshFileTests(vscode.Uri.parse(uri));
    return ctrl;
  }

  it('src/testDebug/kotlin et src/screenshotTest suivent la convention Gradle', () => {
    for (const uri of [
      'file:///proj/app/src/testDebug/kotlin/com/app/FooTest.kt',
      'file:///proj/app/src/screenshotTest/kotlin/com/app/FooTest.kt',
      'file:///proj/app/src/test/kotlin/com/app/FooTest.kt',
    ]) {
      expect(controllerWith(uri).findClassItem('com.app.FooTest', uri), uri).toBeDefined();
    }
  });

  it('un segment non borné (contest/java) n\'est plus pris pour test/java', () => {
    const uri = 'file:///proj/contest/java/com/app/FooTest.kt';
    expect(controllerWith(uri).findClassItem('com.app.FooTest', uri)).toBeUndefined();
  });
});
