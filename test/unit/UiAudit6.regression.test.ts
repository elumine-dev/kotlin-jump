// Regression tests for the fourth audit (2026-09-08): edits that destroyed
// code, renames that touched the wrong lines, an outline stuck on disk.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { workspace, Position, Range } from './__mocks__/vscode';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';
import { findUnusedImports } from '../../src/providers/unusedImports';
import { insertImport } from '../../src/providers/AutoImportProvider';
import { findUnusedDeclarations } from '../../src/providers/unusedDeclarations';
import { scanForUsagesWithTarget, scanImports, clearContentCache } from '../../src/providers/FindUsagesEngine';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { LifecycleReleaseActionProvider } from '../../src/providers/DiscoverabilityQuickFixes';
import { NamedArgumentsActionProvider } from '../../src/providers/NamedArgumentsActionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const RAW_STRING_FILE = `package com.app

import com.app.Util

class Gen {
    val src = """
import com.app.Other
class X
"""
    fun run() = Util.go()
}
`;

describe('Import block bounds (was: an import inside a raw string ended the block, Organize Imports replaced the class body)', () => {
  it('organizeImports keeps the class body intact', () => {
    const r = organizeImports(RAW_STRING_FILE, { removeUnused: true })!;
    expect(r.firstLine).toBe(2);
    expect(r.lastLine).toBe(2);
    expect(r.replacement).toBe('import com.app.Util');
  });
  it('findUnusedImports does not report the line inside the string', () => {
    expect(findUnusedImports(RAW_STRING_FILE).map(u => u.line)).toEqual([]);
  });
  it('insertImport lands in the header block, not inside the string', () => {
    const edit = insertImport(mockDocument('file:///Gen.kt', RAW_STRING_FILE) as any, 'com.app.Zed');
    expect(edit.range.start.line).toBe(3);
  });
  it('still handles blank lines and comments between imports', () => {
    const text = 'package p\n\nimport a.A\n\n// group\nimport b.B\n\nclass C\n';
    const r = organizeImports(text, { removeUnused: false })!;
    expect([r.firstLine, r.lastLine]).toEqual([2, 5]);
  });
});

describe('Remove unused declaration — KDoc absorption (was: a trailing /* px */ on the line above climbed to the file header)', () => {
  it('starts the removal at the declaration when the line above only ends a code comment', () => {
    const text = ['/** Helpers. */', 'class Util {', '    fun keep() = 1 /* px */', '    private fun dead() = 2', '}'].join('\n');
    const [d] = findUnusedDeclarations(text);
    expect(d).toBeDefined();
    expect(text.slice(0, d!.removeStart).split('\n').length - 1).toBe(3);
  });
  it('still absorbs a real KDoc above the declaration', () => {
    const text = ['class Util {', '    /**', '     * Dead.', '     */', '    private fun dead() = 2', '}'].join('\n');
    const [d] = findUnusedDeclarations(text);
    expect(text.slice(0, d!.removeStart).split('\n').length - 1).toBe(1);
  });
});

describe('Workspace scans (Rename / Find References)', () => {
  const files: Record<string, string> = {};
  let origRead: typeof workspace.fs.readFile;
  beforeEach(() => {
    clearContentCache();
    origRead = workspace.fs.readFile;
    workspace.fs.readFile = async (uri: any) => Buffer.from(files[uri.toString()] ?? '') as any;
  });
  afterEach(() => { workspace.fs.readFile = origRead; });
  const token = { isCancellationRequested: false } as any;

  it('counts $name and ${name} in templates as usages (was: skipped as string content, so the rename left them behind)', async () => {
    const uri = 'file:///User.kt';
    files[uri] = 'package p\nclass User(val name: String) {\n    fun greet() = "Hello $name and ${name}"\n    fun plain() = "name"\n}\n';
    const index = new SymbolIndex();
    index.add(parse(uri, files[uri]));
    const target = index.lookup('name')[0] ?? null;
    const hits = await scanForUsagesWithTarget('name', target, index, [uri], token);
    const onTemplateLine = hits.filter(h => h.line === 2).map(h => h.character);
    expect(onTemplateLine).toHaveLength(2);
    expect(hits.some(h => h.line === 3)).toBe(false);
  });

  it('rewrites only the import of the renamed symbol (was: any import line containing the word)', async () => {
    const decl = 'file:///State.kt';
    const user = 'file:///Screen.kt';
    files[decl] = 'package com.app\nclass State';
    files[user] = 'package com.ui\nimport androidx.compose.runtime.State\nimport com.app.State\nimport com.app.state.Store\nclass Screen';
    const index = new SymbolIndex();
    index.add(parse(decl, files[decl]));
    index.add(parse(user, files[user]));
    const target = index.lookup('State')[0]!;
    const hits = await scanImports('State', index, [user], token, target);
    expect(hits.map(h => [h.line, h.character])).toEqual([[2, 'import com.app.'.length]]);
  });

  it('without a resolved target, only imports whose last segment is the word qualify', async () => {
    const user = 'file:///Screen.kt';
    files[user] = 'package com.ui\nimport com.app.repository.UserRepo\nimport com.app.repository\nclass Screen';
    const index = new SymbolIndex();
    index.add(parse('file:///R.kt', 'package com.app\nval repository = 1'));
    const hits = await scanImports('repository', index, [user], token, null);
    expect(hits.map(h => h.line)).toEqual([2]);
  });
});

describe('Outline on a dirty document (was: index lines from disk, and a deletion at the end of the file emptied the outline)', () => {
  it('parses the live text when the document is dirty', () => {
    const uri = 'file:///Repo.kt';
    const saved = 'package p\nclass Repo {\n    fun load() {}\n}\n';
    const index = new SymbolIndex();
    index.add(parse(uri, saved));
    const dirty = 'package p\n\n\nclass Repo {\n    fun load() {}\n    fun save() {}\n}\n';
    const doc = Object.assign(mockDocument(uri, dirty), { isDirty: true });
    const symbols = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc as any, { isCancellationRequested: false } as any);
    expect(symbols.map(s => s.name)).toEqual(['Repo']);
    expect(symbols[0]!.selectionRange.start.line).toBe(3);
    expect(symbols[0]!.children.map(c => c.name)).toEqual(['load', 'save']);
  });
  it('drops index entries past the end of a shortened clean document instead of throwing', () => {
    const uri = 'file:///Long.kt';
    const saved = 'package p\nclass A\n\n\n\nclass B\n';
    const index = new SymbolIndex();
    index.add(parse(uri, saved));
    const doc = Object.assign(mockDocument(uri, 'package p\nclass A\n'), { isDirty: false });
    const symbols = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc as any, { isCancellationRequested: false } as any);
    expect(symbols.map(s => s.name)).toEqual(['A']);
  });
});

describe('Lifecycle quick fix — indentation (was: 4-space arithmetic put onStop() outside the class with tabs)', () => {
  it('creates the mirror inside the class with the enclosing function\'s indentation, tabs preserved', () => {
    const code = ['class A : Activity() {', '\toverride fun onStart() {', '\t\twakeLock.acquire()', '\t}', '}'].join('\n');
    const doc = mockDocument('file:///A.kt', code);
    const actions = new LifecycleReleaseActionProvider().provideCodeActions(doc as any, new Range(new Position(2, 0), new Position(2, 0)));
    expect(actions).toHaveLength(1);
    const edits = (actions[0]!.edit as any).entries?.() ?? (actions[0]!.edit as any)._edits;
    const inserted = JSON.stringify(edits);
    expect(inserted).toContain('\\toverride fun onStop() {\\n\\t\\tsuper.onStop()\\n\\t\\twakeLock.release()\\n\\t}');
    expect(inserted).toContain('"line":4');
  });
});

describe('Add names to call arguments — resolver receives the document (was: first homonym of the right arity, any package)', () => {
  it('passes the document so the resolver can consult its imports', async () => {
    const seen: unknown[] = [];
    const provider = new NamedArgumentsActionProvider((callee, arity, document) => { seen.push([callee, arity, document !== undefined]); return { params: [{ name: 'message', isVararg: false }, { name: 'duration', isVararg: false }] }; });
    const code = 'show("x", 3)';
    const doc = mockDocument('file:///S.kt', code);
    const actions = await provider.provideCodeActions(doc as any, new Range(new Position(0, 2), new Position(0, 2)));
    expect(actions).toHaveLength(1);
    expect(seen).toEqual([['show', 2, true]]);
  });
});
