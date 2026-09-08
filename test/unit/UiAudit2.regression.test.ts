// Regression tests for the second display audit (2026-09-07): caches that
// survived file changes, a hover reading the wrong annotation, a swatch that
// stopped following the active editor, a history entry losing its timestamp,
// two settings toggles with no effect, and a signature read from a dirty file.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { Position, Range } from './__mocks__/vscode';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';
import { GradleTaskLensProvider } from '../../src/providers/GradleTaskLensProvider';
import { KmpExpectActualProvider } from '../../src/providers/KmpExpectActualProvider';
import { readSignature, locateDeclLine } from '../../src/util/SignatureReader';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const token = { isCancellationRequested: false } as any;
let _id = 0;
const freshUri = () => `file:///Audit2_${_id++}.kt`;
const labelOf = (h: any) => Array.isArray(h.label) ? h.label.map((p: any) => p.value).join('') : String(h.label);

afterEach(() => {
  vi.restoreAllMocks();
  (vscodeMock.workspace as any).textDocuments = [];
});

describe('InlayHints — evictFile (was: parameter names and inferred types cached by FQN for the whole session)', () => {
  it('drops the cached signature of the changed file, so a renamed parameter shows under its new name', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const index = new SymbolIndex();
    index.add(parse(declUri, 'fun greet(name: String) {}'));
    const callCode = 'greet("Alice")';
    const spy = vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValue(mockDocument(declUri, 'fun greet(name: String) {}') as any);
    const provider = new KotlinInlayHintsProvider(index);
    const range = new Range(new Position(0, 0), new Position(0, callCode.length));

    const before = await provider.provideInlayHints(mockDocument(callUri, callCode) as any, range, token);
    expect(before.map(labelOf)).toEqual(['name:']);
    expect(provider._cachedFqns()).toContain('greet');

    // Rename on disk + reindex, as the FileWatcher does, then evict.
    index.remove?.(declUri);
    index.add(parse(declUri, 'fun greet(fullName: String) {}'));
    spy.mockResolvedValue(mockDocument(declUri, 'fun greet(fullName: String) {}') as any);
    provider.evictFile(declUri);
    expect(provider._cachedFqns()).not.toContain('greet');

    const after = await provider.provideInlayHints(mockDocument(callUri, callCode) as any, range, token);
    expect(after.map(labelOf)).toEqual(['fullName:']);
  });
});

describe('CodeLens — cross-file usage counts (was: evictFile only dropped the symbols declared in the changed file)', () => {
  it('a new call added in B refreshes the "N usages" of a symbol declared in A', async () => {
    const A = 'file:///cl/A.kt', B = 'file:///cl/B.kt';
    const codeA = 'package p\nfun foo() {}';
    let codeB = 'package p\nfun bar() { foo() }';
    const index = new SymbolIndex();
    index.add(parse(A, codeA));
    index.add(parse(B, codeB));
    const origRead = vscodeMock.workspace.fs.readFile;
    (vscodeMock.workspace.fs as any).readFile = async (uri: any) =>
      Buffer.from(String(uri) === A ? codeA : codeB);
    try {
      const provider = new KotlinCodeLensProvider(index);
      const entry = index.lookup('foo')[0]!;
      const lens = () => ({ range: new Range(entry.line, 0, entry.line, 0), data: { entry } }) as any;
      expect((await provider.resolveCodeLens(lens(), token)).command?.title).toBe('1 usage');

      codeB = 'package p\nfun bar() { foo(); foo() }';
      index.remove?.(B);
      index.add(parse(B, codeB));
      (vscodeMock.workspace as any).textDocuments = [mockDocument(B, codeB)];
      provider.evictFile(B);
      expect((await provider.resolveCodeLens(lens(), token)).command?.title).toBe('2 usages');
    } finally {
      (vscodeMock.workspace.fs as any).readFile = origRead;
    }
  });
});

describe('HexColorFoldingProvider — invalidateAll keeps following the ACTIVE editor', () => {
  it('leaves _editor on the active editor, not on the last visible one', () => {
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
    const mk = (line: string) => ({
      document: { languageId: 'kotlin', lineCount: 1, lineAt: () => ({ text: line }), uri: { toString: () => freshUri() } },
      setDecorations: vi.fn(),
    }) as any;
    const active = mk('val a = 0xFF112233');
    const other  = mk('val b = 0xFF445566');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([active, other]);
    (vscodeMock.window as any).activeTextEditor = active;
    const provider = new HexColorFoldingProvider();
    provider.invalidateAll();
    expect((provider as any)._editor).toBe(active);
    provider.dispose();
  });
});

describe('Gradle task lens and KMP badges — settings toggle fires a refresh (was: no onDidChangeCodeLenses at all)', () => {
  it('both providers expose the event and fireChange() raises it', () => {
    const gradle = new GradleTaskLensProvider();
    const kmp = new KmpExpectActualProvider(new SymbolIndex());
    const fired: string[] = [];
    gradle.onDidChangeCodeLenses(() => fired.push('gradle'));
    kmp.onDidChangeCodeLenses(() => fired.push('kmp'));
    gradle.fireChange();
    kmp.fireChange();
    expect(fired).toEqual(['gradle', 'kmp']);
  });
});

describe('SignatureReader — declaration re-located in a dirty document (was: hover showed the lines above the function)', () => {
  const saved = ['package p', '', 'fun greet(name: String): String {', '  return name', '}'];
  const entryOf = (code: string) => {
    const index = new SymbolIndex();
    index.add(parse('file:///sig/A.kt', code));
    return index.lookup('greet')[0]!;
  };

  it('finds the declaration after lines were inserted above it, and still reads it when nothing moved', () => {
    const entry = entryOf(saved.join('\n')); // indexed at line 2
    const dirty = ['package p', '', 'import a.B', '/** doc */', '', ...saved.slice(2)];
    const doc = mockDocument('file:///sig/A.kt', dirty.join('\n')) as any;
    expect(locateDeclLine(doc, entry)).toBe(5);
    expect(readSignature(doc, entry)).toBe('fun greet(name: String): String');
    expect(readSignature(mockDocument('file:///sig/A2.kt', saved.join('\n')) as any, entry)).toBe('fun greet(name: String): String');
  });

  it('does not jump to a call of the same name', () => {
    const entry = entryOf(saved.join('\n'));
    const dirty = ['package p', '', 'val x = greet("a")', '', 'fun greet(name: String): String {', '}'];
    const doc = mockDocument('file:///sig/A3.kt', dirty.join('\n')) as any;
    expect(locateDeclLine(doc, entry)).toBe(4);
  });
});
