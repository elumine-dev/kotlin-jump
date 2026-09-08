// Regression tests for the third display audit (2026-09-07): the per-token
// backward scope walk, caches not evicted on delete, diagnostics frozen
// between saves, ⚡ on homonyms, and non-locale qualifiers in the hover grid.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import * as vscode from 'vscode';
import { resolveLocalScope, buildLocalScopeIndex } from '../../src/providers/DefinitionProvider';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { ResourceDiagnosticProvider } from '../../src/providers/ResourceDiagnosticProvider';
import { SuspendMarkerProvider } from '../../src/providers/SuspendMarkerProvider';
import { StringResourceIndex, isLocaleQualifier } from '../../src/indexer/StringResourceIndex';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('resolveLocalScope — one index per document (was: a backward walk per token, quadratic outside functions)', () => {
  it('answers 5000 queries on a 5000 line object in bounded time', () => {
    const lines: string[] = ['object Tokens {'];
    for (let i = 0; i < 5000; i++) lines.push(`    val color${i} = Color(0xFF000000) + alpha(color${i})`);
    lines.push('}');
    const doc = mockDocument('file:///Bench.kt', lines.join('\n'));
    const t0 = performance.now();
    const scope = buildLocalScopeIndex(lines);
    for (let l = 1; l <= 5000; l++) resolveLocalScope(doc, new vscodeMock.Position(l, 50), 'alpha', scope);
    expect(performance.now() - t0).toBeLessThan(500); // was 13.9 s
  });

  it('gives the same answers as the walk: params, locals, lambdas, shadowing, outside any function', () => {
    const code = [
      'class Repo(private val api: Api) {',
      '  fun load(id: Int): User {',
      '    val user = api.get(id)',
      '    items.forEach { item ->',
      '      println(item)',
      '    }',
      '    for (x in list) { println(x) }',
      '    return user',
      '  }',
      '  val top = id',
      '}',
    ].join('\n');
    const doc = mockDocument('file:///Repo.kt', code);
    const at = (line: number, col: number, word: string) => resolveLocalScope(doc, new vscodeMock.Position(line, col), word);
    expect(at(2, 15, 'api')).toBeUndefined();          // class property, not a fun-local
    expect(at(2, 23, 'id')?.range.start.line).toBe(1); // parameter
    expect(at(7, 11, 'user')?.range.start.line).toBe(2);
    expect(at(4, 14, 'item')?.range.start.line).toBe(3);
    expect(at(6, 30, 'x')).toBeUndefined();            // single-letter names are skipped
    expect(at(9, 12, 'id')).toBeUndefined();           // outside the function: not a local
    expect(at(2, 4, 'user')).toBeUndefined();          // before its own declaration
  });

  it('a nested function shadows the outer one, and a single-expression body is its own scope', () => {
    const code = [
      'fun outer(aa: Int) {',
      '  fun inner(bb: Int) = bb + aa',
      '  println(aa)',
      '}',
    ].join('\n');
    const doc = mockDocument('file:///Nested.kt', code);
    // Inside the single-expression inner fun, `bb` is inner's parameter.
    expect(resolveLocalScope(doc, new vscodeMock.Position(1, 22), 'bb')?.range.start.line).toBe(1);
    // Back in outer's body, `aa` is outer's parameter.
    expect(resolveLocalScope(doc, new vscodeMock.Position(2, 12), 'aa')?.range.start.line).toBe(0);
  });
});

describe('FileWatcher — deleting a file notifies the same listeners as a scan (was: lenses, colours and counts kept the deleted symbols)', () => {
  it('onDeleted runs onFileIndexed for the deleted uri', () => {
    const deleteHandlers: Array<(u: vscode.Uri) => void> = [];
    vi.spyOn(vscodeMock.workspace, 'createFileSystemWatcher').mockImplementation(() => ({
      onDidChange: () => ({ dispose() {} }),
      onDidCreate: () => ({ dispose() {} }),
      onDidDelete: (cb: (u: vscode.Uri) => void) => { deleteHandlers.push(cb); return { dispose() {} }; },
      dispose() {},
    }) as any);
    const indexed: string[] = [];
    const index = new SymbolIndex();
    const watcher = new FileWatcher({ scanFile: async () => {} } as any, index, uri => indexed.push(uri.toString()), undefined);
    const gone = vscodeMock.Uri.parse('file:///proj/Error.kt') as any;
    deleteHandlers[0]!(gone);
    expect(indexed).toEqual(['file:///proj/Error.kt']);
    watcher.dispose();
  });
});

describe('ResourceDiagnosticProvider — follows typing and the setting (was: open/save only)', () => {
  function harness() {
    let changeCb: ((e: any) => void) | undefined;
    let configCb: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.workspace, 'onDidOpenTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockImplementation((cb: any) => { changeCb = cb; return { dispose: vi.fn() }; });
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockImplementation((cb: any) => { configCb = cb; return { dispose: vi.fn() }; });
    const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
    let lines = ['R.string.titel'];
    const doc = { languageId: 'kotlin', get lineCount() { return lines.length; }, lineAt: (i: number) => ({ text: lines[i] }), uri: { toString: () => 'file:///T.kt' } };
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([{ document: doc }] as any);
    const strings = new StringResourceIndex();
    strings.reindexFile({ toString: () => 'file:///res/values/strings.xml' }, '<resources><string name="title">t</string></resources>');
    const provider = new ResourceDiagnosticProvider(strings, new ColorResourceIndex());
    return { provider, collection, doc, setLines: (l: string[]) => { lines = l; }, change: () => changeCb!({ document: doc }), config: (key: string) => configCb!({ affectsConfiguration: (k: string) => k === key }) };
  }

  it('re-scans 300 ms after an edit, so a fixed key loses its error without a save', () => {
    vi.useFakeTimers();
    const h = harness();
    expect(h.collection.set.mock.calls.at(-1)![1]).toHaveLength(1);
    h.setLines(['R.string.title']);
    h.change(); h.change(); h.change();
    vi.advanceTimersByTime(299);
    expect(h.collection.set.mock.calls).toHaveLength(1); // still debouncing
    vi.advanceTimersByTime(1);
    expect(h.collection.set.mock.calls).toHaveLength(2);
    expect(h.collection.set.mock.calls.at(-1)![1]).toHaveLength(0);
    h.provider.dispose();
  });

  it('turning kotlinJump.resourceDiagnostics off clears the open editors right away', () => {
    const h = harness();
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => k === 'resourceDiagnostics' ? false : d } as any);
    h.config('kotlinJump.resourceDiagnostics');
    expect(h.collection.delete).toHaveBeenCalledWith(h.doc.uri);
    h.provider.dispose();
  });
});

describe('SuspendMarkerProvider — a homonym needs an import to earn its ⚡ (was: any suspend overload anywhere marked list.first())', () => {
  function run(code: string, entries: Array<{ name: string; fqn: string; isSuspend: boolean }>) {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => k === 'suspendCallMarkers' ? true : d } as any);
    const index = { lookup: (name: string) => entries.filter(e => e.name === name) } as any;
    const provider = new SuspendMarkerProvider(index);
    const doc = mockDocument(`file:///S${Math.random()}.kt`, code);
    return provider.provideInlayHints(doc, new vscodeMock.Range(0, 0, doc.lineCount - 1, 0), { isCancellationRequested: false } as any);
  }
  const both = [
    { name: 'first', fqn: 'kotlinx.coroutines.flow.first', isSuspend: true },
    { name: 'first', fqn: 'kotlin.collections.first', isSuspend: false },
  ];
  it('items.first() with no import: no marker', () => {
    expect(run('fun f() { items.first() }', both)).toHaveLength(0);
  });
  it('items.first() with import kotlinx.coroutines.flow.first: marker', () => {
    expect(run('import kotlinx.coroutines.flow.first\nfun f() { flow.first() }', both)).toHaveLength(1);
  });
  it('a name that only resolves to suspend declarations keeps its marker without an import', () => {
    expect(run('fun f() { load() }', [{ name: 'load', fqn: 'a.load', isSuspend: true }])).toHaveLength(1);
  });
});

describe('StringResourceIndex — locale grid (was: night, v23, sw600dp, land listed with a ✗)', () => {
  it('isLocaleQualifier accepts language, region and BCP 47 forms only', () => {
    for (const q of ['values', 'values-fr', 'values-fr-rCA', 'values-b+sr+Latn', 'values-zh-rTW']) expect(isLocaleQualifier(q), q).toBe(true);
    for (const q of ['values-night', 'values-v23', 'values-sw600dp', 'values-land', 'values-en-night', 'values-w820dp']) expect(isLocaleQualifier(q), q).toBe(false);
  });
  it('getKnownLocales ignores non-locale qualifiers and locale folders holding no <string>', () => {
    const idx = new StringResourceIndex();
    const add = (dir: string, xml: string) => idx.reindexFile({ toString: () => `file:///app/src/main/res/${dir}/x.xml` }, xml);
    add('values', '<resources><string name="a">a</string></resources>');
    add('values-fr', '<resources><string name="a">a</string></resources>');
    add('values-night', '<resources><style name="T"/></resources>');
    add('values-v23', '<resources><string name="a">a</string></resources>');
    add('values-de', '<resources><dimen name="d">1dp</dimen></resources>');
    expect(idx.getKnownLocales()).toEqual(['values', 'values-fr']);
  });
});
