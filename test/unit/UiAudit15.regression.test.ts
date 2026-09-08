import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KotlinRenameProvider } from '../../src/providers/RenameProvider';
import { AutoImportProvider } from '../../src/providers/AutoImportProvider';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';
import { scanForUsages } from '../../src/providers/FindUsagesEngine';
import { resolveLocalScope, findLocalUsages } from '../../src/providers/DefinitionProvider';
import { extractReceiver, expandPostfix } from '../../src/providers/PostfixCompletionProvider';
import { buildLocalScopeIndex } from '../../src/util/LocalScopeIndex';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { CodeActionTriggerKind, Position, workspace } from './__mocks__/vscode';

// Audit 15 : renommage, imports, Find Usages, postfix.

const token = { isCancellationRequested: false } as any;
let _id = 0;
const fresh = (ext = 'kt') => `file:///A15_${_id++}.${ext}`;

function withFiles(files: Record<string, string>) {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(files)) index.add(parse(uri, code));
  index.finalize();
  workspace.fs.readFile = async (uri: any) => {
    const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
    return Buffer.from(files[s] ?? '') as any;
  };
  (workspace as any).openTextDocument = async (uri: any) => {
    const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
    return mockDocument(s, files[s] ?? '');
  };
  return index;
}

const edits = (edit: any) => edit.entries().map((e: any) => `${e.uri.toString().split('/').pop()}:${e.range.start.line}:${e.range.start.character}`);

let origReadFile: any, origOpen: any;
beforeEach(() => { origReadFile = workspace.fs.readFile; origOpen = (workspace as any).openTextDocument; });
afterEach(() => { workspace.fs.readFile = origReadFile; (workspace as any).openTextDocument = origOpen; });

describe('Renommage local borné à la fonction', () => {
  const code = [
    'package p',
    'class ProfileViewModel(private val repo: Repo) {',
    '    val user = User("a")',
    '    fun load() {',
    '        val user = repo.get()',
    '        println(user)',
    '    }',
    '    fun show(user: User) { Text(user.name) }',
    '    fun other() { println(this.user.name); println(user) }',
    '}',
  ].join('\n');

  it('renommer le val local de load() ne touche ni show(user) ni this.user', async () => {
    const uri = fresh();
    const index = withFiles({ [uri]: code });
    const doc = mockDocument(uri, code);
    const edit: any = await new KotlinRenameProvider(index).provideRenameEdits(doc, new Position(4, 13), 'account', token);
    expect(edits(edit)).toEqual([`${uri.split('/').pop()}:4:12`, `${uri.split('/').pop()}:5:16`]);
  });

  it('findLocalUsages s\'arrête à la fin de la fonction', () => {
    const doc = mockDocument(fresh(), code);
    const usages = findLocalUsages(doc, new Position(4, 12), 'user');
    expect(usages.map(u => u.range.start.line)).toEqual([5]);
  });
});

describe('Renommage d\'un paramètre et arguments nommés', () => {
  const code = [
    'package p',
    '@Composable',
    'fun Screen(title: String) {',
    '    TopAppBar(',
    '        title = { Text(title) },',
    '    )',
    '}',
    '@Preview fun P() { Screen(title = "x") }',
    'fun q() = Screen(',
    '    title = "y",',
    ')',
  ].join('\n');

  it('le label title = de TopAppBar reste, Text(title) et les appels Screen(title = …) changent', async () => {
    const uri = fresh();
    const index = withFiles({ [uri]: code });
    const doc = mockDocument(uri, code);
    const edit: any = await new KotlinRenameProvider(index).provideRenameEdits(doc, new Position(2, 12), 'heading', token);
    const got = edits(edit).map((s: string) => s.slice(s.indexOf(':') + 1)).sort();
    expect(got).toEqual(['2:11', '4:23', '7:26', '9:4']);
  });

  it('les appels dans un autre fichier sont couverts quand la fonction est unique', async () => {
    const a = fresh(), b = fresh();
    const other = 'package p\nfun nav() { Screen(title = "z") }\nfun notIt() { Other(title = "w") }';
    const index = withFiles({ [a]: code, [b]: other });
    const doc = mockDocument(a, code);
    const edit: any = await new KotlinRenameProvider(index).provideRenameEdits(doc, new Position(2, 12), 'heading', token);
    const inB = edits(edit).filter((s: string) => s.startsWith(b.split('/').pop()!));
    expect(inB).toEqual([`${b.split('/').pop()}:1:19`]);
  });

  it('un val local ou un paramètre de lambda ne déclenche pas de réécriture de labels', async () => {
    const uri = fresh();
    const src = 'package p\nfun f() {\n    val title = 1\n    Screen(title = title)\n}\nfun g(items: List<Int>) = items.map { title -> Screen(title = title) }';
    const index = withFiles({ [uri]: src });
    const doc = mockDocument(uri, src);
    const p = new KotlinRenameProvider(index);
    const e1: any = await p.provideRenameEdits(doc, new Position(2, 8), 'x', token);
    expect(edits(e1).map((s: string) => s.slice(s.indexOf(':') + 1))).toEqual(['2:8', '3:19']);
    const e2: any = await p.provideRenameEdits(doc, new Position(5, 39), 'x', token);
    expect(edits(e2).map((s: string) => s.slice(s.indexOf(':') + 1))).toEqual(['5:38', '5:62']);
  });
});

describe('Organize Imports', () => {
  it('garde getValue/setValue et un opérateur importé, retire un vrai inutilisé', () => {
    const text = [
      'package p',
      '',
      'import androidx.compose.runtime.getValue',
      'import androidx.compose.runtime.setValue',
      'import com.app.util.plus',
      'import com.app.util.Unused',
      '',
      'var count by remember { mutableStateOf(0) }',
      'val total = a + b',
    ].join('\n');
    const r = organizeImports(text)!;
    expect(r.removed).toEqual(['import com.app.util.Unused']);
    expect(r.replacement.split('\n')).toEqual([
      'import androidx.compose.runtime.getValue',
      'import androidx.compose.runtime.setValue',
      'import com.app.util.plus',
    ]);
  });

  it('trie un bloc d\'imports Java (avec ;)', () => {
    const text = 'package com.app;\n\nimport java.util.List;\nimport android.os.Bundle;\n\nclass A { Bundle b; List<String> l; }';
    const r = organizeImports(text)!;
    expect(r).not.toBeNull();
    expect(r.replacement.split('\n')).toEqual(['import android.os.Bundle;', 'import java.util.List;']);
  });
});

describe('Find Usages : mots-clés soft comme identifiants', () => {
  it('data : déclaration, comparaison et accès qualifié ; pas `data class`', async () => {
    const uri = fresh();
    const code = [
      'package p',
      'sealed class Resource<T> {',
      '    data class Success<T>(val data: T) : Resource<T>() {',
      '        fun isEmpty() = data == null',
      '    }',
      '}',
      'fun <T> Resource<T>.orNull() = (this as? Resource.Success)?.data',
    ].join('\n');
    const index = withFiles({ [uri]: code });
    const doc = mockDocument(uri, code);
    const hits = await scanForUsages('data', doc, index, [uri], token);
    expect(hits.map(h => `${h.line}:${h.character}`)).toEqual(['2:30', '3:24', '6:60']);
  });

  it('actual : `assertEquals(expected, actual)` compte, `actual fun` non', async () => {
    const uri = fresh();
    const code = 'package p\nval actual = compute()\nfun t() { assertEquals(expected, actual) }\nactual fun platform() = 1';
    const index = withFiles({ [uri]: code });
    const hits = await scanForUsages('actual', mockDocument(uri, code), index, [uri], token);
    expect(hits.map(h => h.line)).toEqual([1, 2]);
  });

  it('value : F2 renomme la déclaration et $value', async () => {
    const uri = fresh();
    const code = 'package p\nclass Setting(val value: String) {\n    fun show() = "k=$value" + value.isBlank()\n}\n@JvmInline value class Meters(val v: Int)';
    const index = withFiles({ [uri]: code });
    const doc = mockDocument(uri, code);
    const edit: any = await new KotlinRenameProvider(index).provideRenameEdits(doc, new Position(1, 19), 'raw', token);
    expect(edits(edit).map((s: string) => s.slice(s.indexOf(':') + 1)).sort()).toEqual(['1:18', '2:21', '2:30']);
  });
});

describe('Import aliasé', () => {
  it('le nom nu du fichier importateur n\'est pas réécrit', async () => {
    const model = fresh(), api = fresh();
    const modelCode = 'package com.app.model\nclass User(val name: String)';
    const apiCode = 'package com.app.api\n\nimport com.app.model.User as DomainUser\n\nclass User(val id: Int)\nfun User.toDomain(): DomainUser = DomainUser(id.toString())';
    const index = withFiles({ [model]: modelCode, [api]: apiCode });
    const doc = mockDocument(model, modelCode);
    const edit: any = await new KotlinRenameProvider(index).provideRenameEdits(doc, new Position(1, 8), 'Account', token);
    const inApi = edits(edit).filter((s: string) => s.startsWith(api.split('/').pop()!));
    expect(inApi).toEqual([`${api.split('/').pop()}:2:21`]);
  });
});

describe('Scope local : en-tête de bloc et curseur sur la déclaration', () => {
  it('un fun à corps d\'expression au-dessus d\'une classe n\'englobe pas ses membres', () => {
    const lines = ['fun Int.dp() = this * 2', '', 'class Repo {', '    val cache = mutableMapOf<String, String>()', '    fun get(key: String) = cache[key]', '}'];
    const idx = buildLocalScopeIndex(lines, 'kotlin');
    expect(idx.enclosingFun[3]).toBe(-1);
    expect(idx.enclosingFun[4]).toBe(4);
    const doc = mockDocument(fresh(), lines.join('\n'));
    expect(resolveLocalScope(doc, new Position(4, 28), 'cache')).toBeUndefined();
  });

  it('un fun à corps lambda garde son bloc', () => {
    const lines = ['fun compute() = run {', '    val total = 1', '    total + 1', '}'];
    const idx = buildLocalScopeIndex(lines, 'kotlin');
    expect(idx.enclosingFun[2]).toBe(0);
  });

  it('F2 sur la première lettre d\'un val local reste local', () => {
    const code = 'fun compute() {\n    val count = 1\n    println(count)\n}';
    const doc = mockDocument(fresh(), code);
    expect(resolveLocalScope(doc, new Position(1, 8), 'count')?.range.start.line).toBe(1);
    expect(resolveLocalScope(doc, new Position(1, 10), 'count')?.range.start.line).toBe(1);
  });
});

describe('Auto-import et postfix', () => {
  it('pas de suggestion quand le nom est déjà importé d\'une bibliothèque', () => {
    const lib = fresh(), cur = fresh();
    const index = withFiles({ [lib]: 'package com.app.ui\n@Composable fun Text(s: String) {}' });
    const code = 'package com.app.screens\n\nimport androidx.compose.material3.Text\n\n@Composable fun Screen() { Text("hi") }';
    const doc = mockDocument(cur, code);
    const ctx = { triggerKind: CodeActionTriggerKind.Invoke, diagnostics: [], only: undefined } as any;
    expect(new AutoImportProvider(index).provideCodeActions(doc, { start: positionOf(code, 'Text("hi")') } as any, ctx, {} as any)).toBeUndefined();
  });

  it('une chaîne est un receveur atomique et $ est échappé dans le snippet', () => {
    expect(extractReceiver('"Hello $name".let', 13)).toBe('"Hello $name"');
    expect(extractReceiver('val x = "Hello world".val', 21)).toBe('"Hello world"');
    expect(expandPostfix('let', '"Hello $name"')).toBe('"Hello \\$name".let { $0 }');
    expect(expandPostfix('val', '"Total: ${total}"')).toBe('val ${1:value} = "Total: \\${total\\}"');
    expect(expandPostfix('if', '"a b"')).toBe('if ("a b") {\n    $0\n}');
  });
});
