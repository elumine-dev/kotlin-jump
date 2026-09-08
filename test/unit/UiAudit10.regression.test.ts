// Regression tests for the verification audit (2026-09-08): fixes that were
// incomplete or had a hole.
import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { importBlockBounds } from '../../src/util/importBlock';
import { insertImport } from '../../src/providers/AutoImportProvider';
import { isJavaMethodHeader, buildLocalScopeIndex, latestBinding } from '../../src/util/LocalScopeIndex';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { HexColorFoldingProvider } from '../../src/providers/HexColorFoldingProvider';
import { scanForUsagesWithTarget, clearContentCache } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Import block bounds — multi-line @file: annotation (was: the argument line ended the header and the block was not found)', () => {
  it('skips the annotation arguments and finds the imports below', () => {
    const lines = ['@file:Suppress(', '    "DEPRECATION",', '    "unused"', ')', 'package p', '', 'import a.A', 'import b.B', '', 'class C'];
    expect(importBlockBounds(lines, l => /^\s*import\s/.test(l))).toEqual({ first: 6, last: 7 });
  });
});

describe('insertImport on Java (was: `import x.Y` without the semicolon, so @VisibleForTesting broke the file)', () => {
  it('ends a Java import with a semicolon', () => {
    const doc = Object.assign(mockDocument('file:///A.java', 'package p;\n\nimport a.A;\n\nclass C {}\n'), { languageId: 'java' });
    expect(insertImport(doc as any, 'androidx.annotation.VisibleForTesting').newText).toBe('import androidx.annotation.VisibleForTesting;\n');
    expect(insertImport(mockDocument('file:///A.kt', 'package p\n\nimport a.A\n') as any, 'x.Y').newText).toBe('import x.Y\n');
  });
});

describe('Java scope — annotations with arguments and switch arms', () => {
  it('sees a method header behind an annotation with arguments', () => {
    expect(isJavaMethodHeader('    @SuppressWarnings("unchecked") public void foo(Bundle b) {')).toBe(true);
    expect(isJavaMethodHeader('    @Test(expected = IllegalStateException.class) public void fails() {')).toBe(true);
  });
  it('does not turn `case RED -> paint()` into a binding of RED', () => {
    const idx = buildLocalScopeIndex(['void f(Color c) {', '    switch (c) {', '        case RED -> paint();', '        default -> skip();', '    }', '    use(RED);', '}'], 'java');
    expect(latestBinding(idx, 'RED', 0, 5, 8)).toBeUndefined();
    const withLambda = buildLocalScopeIndex(['void f() {', '    list.forEach(item -> log(item));', '}'], 'java');
    expect(latestBinding(withLambda, 'item', 0, 1, 26)?.line).toBe(1);
  });
});

describe('Version catalog keyed by fsPath (was: a percent-encoded URI never matched a path with a space)', () => {
  it('matches a project directory containing a space', () => {
    const idx = new VersionCatalogIndex();
    const toml = (v: string) => `[versions]\nk = "${v}"\n[libraries]\nk-lib = { module = "g:a", version.ref = "k" }\n`;
    idx.reindexFile(toml('1.0.0'), '/ws/Mes Projets/projA/gradle/libs.versions.toml');
    idx.reindexFile(toml('2.0.0'), '/ws/Mes Projets/projB/gradle/libs.versions.toml');
    expect(idx.getByAccessor('k.lib', '/ws/Mes Projets/projB/app/build.gradle.kts')?.version).toBe('2.0.0');
    expect(idx.getByAccessor('k.lib', '/ws/Mes Projets/projA/app/build.gradle.kts')?.version).toBe('1.0.0');
  });
});

describe('Outline on a dirty Java document (was: parsed with the Kotlin parser, methods and fields vanished while typing)', () => {
  it('uses the Java parser', () => {
    const code = 'package p;\n\npublic class Repo {\n    private int count;\n    public void load() {}\n}\n';
    const doc = Object.assign(mockDocument('file:///Repo.java', code), { isDirty: true, languageId: 'java' });
    const symbols = new KotlinDocumentSymbolProvider(new SymbolIndex()).provideDocumentSymbols(doc as any, { isCancellationRequested: false } as any);
    expect(symbols.map(s => s.name)).toEqual(['Repo']);
    expect(symbols[0]!.children.map(c => c.name).sort()).toEqual(['count', 'load']);
  });
});

describe('Hex swatch in a split (was: the line map belonged to the last editor scanned, not the active one)', () => {
  it('scans the active editor last', () => {
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
    const mk = (line: string) => ({ document: { languageId: 'kotlin', lineCount: 1, lineAt: () => ({ text: line }), uri: { toString: () => line } }, setDecorations: vi.fn() }) as any;
    const active = mk('val a = 0xFF112233');
    const other = mk('val b = 0xFF445566');
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([active, other]);
    (vscodeMock.window as any).activeTextEditor = active;
    const provider = new HexColorFoldingProvider();
    const scanned: unknown[] = [];
    const orig = (provider as any)._fullScan.bind(provider);
    (provider as any)._fullScan = (e: unknown) => { scanned.push(e); return orig(e); };
    provider.invalidateAll();
    expect(scanned.at(-1)).toBe(active);
    expect((provider as any)._editor).toBe(active);
    provider.dispose();
    vi.restoreAllMocks();
  });
});

describe('Template usages — escaped dollar and line comments', () => {
  it('counts "$name" but neither "\\$name" nor a // $name comment', async () => {
    clearContentCache();
    const uri = 'file:///T.kt';
    const code = 'package p\nclass User(val name: String) {\n    fun a() = "Hi $name"\n    fun b() = "Price \\$name"\n    fun c() = 1 // uses $name\n}\n';
    const orig = vscodeMock.workspace.fs.readFile;
    (vscodeMock.workspace.fs as any).readFile = async () => Buffer.from(code);
    try {
      const index = new SymbolIndex();
      index.add(parse(uri, code));
      const hits = await scanForUsagesWithTarget('name', index.lookup('name')[0] ?? null, index, [uri], { isCancellationRequested: false } as any);
      expect(hits.map(h => h.line)).toEqual([1, 2]); // the declaration counts as a hit too (lenses subtract it)
    } finally {
      (vscodeMock.workspace.fs as any).readFile = orig;
    }
  });
});
