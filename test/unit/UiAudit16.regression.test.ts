import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { buildSnapshotFile, restoreSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { bodyEndLine } from '../../src/util/symbolRanges';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';
import { KotlinSelectionRangeProvider } from '../../src/providers/SelectionRangeProvider';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { KotlinCallHierarchyProvider } from '../../src/providers/CallHierarchyProvider';
import { KotlinTypeHierarchyProvider } from '../../src/providers/TypeHierarchyProvider';
import { KotlinDocumentHighlightProvider } from '../../src/providers/DocumentHighlightProvider';
import { mockDocument, positionOf } from './helpers';
import { Position, SymbolKind, workspace } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// Audit 16 : plages (pliage, sélection, outline), locales, supertypes,
// aide à la signature, implémentations, hiérarchies, surlignage.

const token = { isCancellationRequested: false } as any;
let _id = 0;
const fresh = (ext = 'kt') => `file:///A16_${_id++}.${ext}`;
const syms = (code: string) => parse('file:///s.kt', code).symbols;

function indexOf(files: Record<string, string>) {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(files)) index.add(uri.endsWith('.java') ? parseJava(uri, code) : parse(uri, code));
  index.finalize();
  return index;
}

let origReadFile: any;
beforeEach(() => { origReadFile = workspace.fs.readFile; });
afterEach(() => { workspace.fs.readFile = origReadFile; vi.restoreAllMocks(); });

describe('Plages de corps : pliage, sélection, outline', () => {
  const code = [
    'class A {',                    // 0
    '    fun first() { x() }',      // 1
    '    /** doc for last */',      // 2
    '    @Suppress("x")',           // 3
    '    fun last() {',             // 4
    '        y()',                  // 5
    '    }',                        // 6
    '    val a = 1',                // 7
    '    fun expr() =',             // 8
    '        a + 1',                // 9
    '}',                            // 10
    'class B { fun b() {} }',       // 11
  ].join('\n');
  const lines = code.split('\n');

  it('bodyEndLine trouve la vraie accolade fermante ou la fin de l\'instruction', () => {
    const s = syms(code);
    const end = (name: string) => bodyEndLine(lines, s, s.findIndex(x => x.name === name), lines.length - 1);
    expect(end('first')).toBe(1);
    expect(end('last')).toBe(6);
    expect(end('a')).toBe(7);
    expect(end('expr')).toBe(9);
    expect(end('A')).toBe(10);
    expect(end('B')).toBe(11);
    expect(end('b')).toBe(11);
  });

  it('un paramètre de constructeur multi-lignes ne s\'étend pas à la ligne suivante', () => {
    const c = 'class R(\n    private val dao: Dao,\n    private val api: Api,\n) {\n    fun f() {}\n}';
    const s = syms(c);
    expect(bodyEndLine(c.split('\n'), s, s.findIndex(x => x.name === 'dao'), 5)).toBe(1);
  });

  it('le pliage s\'arrête au `}` du membre, pas au `}` de la classe ni à la KDoc du voisin', () => {
    const uri = fresh();
    const index = indexOf({ [uri]: code });
    const ranges = new KotlinFoldingRangeProvider(index).provideFoldingRanges(mockDocument(uri, code), {} as any, token)
      .filter(r => r.kind !== 'Comment' && r.kind !== 1 && (r as any).kind !== 'Imports')
      .map(r => [r.start, r.end]);
    expect(ranges).toContainEqual([0, 10]);
    expect(ranges).toContainEqual([4, 6]);
    expect(ranges).toContainEqual([8, 9]);
    expect(ranges.some(([s]) => s === 1)).toBe(false);
    expect(ranges.some(([s]) => s === 7)).toBe(false);
    expect(ranges.some(([s, e]) => s === 11 && e !== 11)).toBe(false);
  });

  it('Expand selection depuis le corps de last : [4,6] puis [0,10]', () => {
    const uri = fresh();
    const index = indexOf({ [uri]: code });
    const chain: [number, number][] = [];
    let r: any = new KotlinSelectionRangeProvider(index).provideSelectionRanges(mockDocument(uri, code), [new Position(5, 9)], token)[0];
    while (r) { chain.push([r.range.start.line, r.range.end.line]); r = r.parent; }
    expect(chain).toEqual([[4, 6], [0, 10], [0, 11]]);
  });

  it('l\'Outline borne la plage de last à la ligne 6 et cache les locales', () => {
    const c = code + '\nfun g() {\n    val local = 1\n    val other = 2\n}';
    const uri = fresh();
    const index = indexOf({ [uri]: c });
    const roots = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(mockDocument(uri, c), token);
    const A = roots.find(r => r.name === 'A')!;
    expect(A.children.find(ch => ch.name === 'last')!.range.end.line).toBe(6);
    expect(A.range.end.line).toBe(10);
    const g = roots.find(r => r.name === 'g')!;
    expect(g.children).toEqual([]);
  });
});

describe('Parseur : isLocal et supertypes', () => {
  it('isLocal sur les val/var d\'un corps de fonction ou d\'un initialiseur, pas sur les membres', () => {
    const c = [
      'class A(val ctor: Int) {',
      '    val member = 1',
      '    fun f() {',
      '        val local = 1',
      '        list.forEach {',
      '            val deep = 2',
      '        }',
      '    }',
      '    companion object { val TAG = "a" }',
      '}',
      'val top = 1',
      'val state = flow.map {',
      '    val t = 1',
      '}',
    ].join('\n');
    const byName = Object.fromEntries(syms(c).map(s => [s.name, s.isLocal]));
    expect(byName).toMatchObject({ ctor: undefined, member: undefined, local: true, deep: true, TAG: undefined, top: undefined, t: true });
  });

  it('isLocal survit au snapshot', () => {
    const parsed = parse('file:///l.kt', 'fun f() {\n    val local = 1\n}\nval top = 2');
    const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 10, parsed.imports);
    const index = new SymbolIndex();
    restoreSnapshotFile('file:///l.kt', sf, index);
    const entries = index.getFileSymbols('file:///l.kt');
    expect(entries.find(e => e.name === 'local')?.isLocal).toBe(true);
    expect(entries.find(e => e.name === 'top')?.isLocal).toBeUndefined();
  });

  it('les arguments génériques et de constructeur ne sont pas des supertypes', () => {
    const s = syms([
      'class ItemAdapter : ListAdapter<Item, ItemViewHolder>(DiffCb)',
      'class MainVm : BaseViewModel<UiState>(Dispatchers.IO)',
      'class Multi : B(), C<Int>, D by d',
      'class Adapter2 : RecyclerView.Adapter<VH>()',
      'class Cmp : Comparable<Cmp>',
    ].join('\n'));
    const st = (n: string) => s.find(x => x.name === n)?.supertypes;
    expect(st('ItemAdapter')).toEqual(['ListAdapter']);
    expect(st('MainVm')).toEqual(['BaseViewModel']);
    expect(st('Multi')).toEqual(['B', 'C', 'D']);
    expect(st('Adapter2')).toEqual(['RecyclerView', 'Adapter']);
    expect(st('Cmp')).toEqual(['Comparable']);
    const index = indexOf({ 'file:///h.kt': 'interface UiState\nclass Item\nclass MainVm : BaseViewModel<UiState>(Dispatchers.IO)\nclass ItemAdapter : ListAdapter<Item, VH>(cb)' });
    expect(index.lookupImplementations('UiState')).toEqual([]);
    expect(index.lookupImplementations('Item')).toEqual([]);
  });

  it('une liste de supertypes qui continue sur les lignes suivantes est lue', () => {
    const s = syms([
      'class LongActivity :',
      '    AppCompatActivity(),',
      '    Callback {',
      '    fun a() {}',
      '}',
      'class Wrapped(',
      '    private val a: Int,',
      ') : Base(),',
      '    Callback,',
      '    Other<Int> {',
      '}',
      'class Tail : Base() // trailing',
    ].join('\n'));
    expect(s.find(x => x.name === 'LongActivity')?.supertypes).toEqual(['AppCompatActivity', 'Callback']);
    expect(s.find(x => x.name === 'Wrapped')?.supertypes).toEqual(['Base', 'Callback', 'Other']);
    expect(s.find(x => x.name === 'Tail')?.supertypes).toEqual(['Base']);
    expect(s.find(x => x.name === 'a')?.depth).toBe(1);
  });
});

describe('Aide à la signature', () => {
  const declUri = 'file:///Sig16.kt';
  const declCode = [
    'package p',
    'fun show(title: String, count: Int, extra: Int = 0) {}',
    'fun load(id: Int) {}',
    'fun load(name: String, force: Boolean) {}',
    'class MainViewModel(private val repo: Repo, private val logger: Logger)',
    'data class Ok(override val id: Int, val payload: String)',
    'fun greet(who: String) = 1',
  ].join('\n');
  const javaUri = 'file:///J16.java';
  const javaCode = 'package p;\npublic class J {\n  public static void log(String tag, String msg, int level) {}\n}';
  const ctx = { triggerKind: 1, triggerCharacter: undefined, isRetrigger: false } as any;

  async function help(call: string, line = 0) {
    const index = indexOf({ [declUri]: declCode, [javaUri]: javaCode });
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockImplementation(async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return mockDocument(s, s.endsWith('.java') ? javaCode : declCode) as any;
    });
    const doc = mockDocument('file:///C16.kt', call);
    const lines = call.split('\n');
    return new KotlinSignatureHelpProvider(index).provideSignatureHelp(doc as any, new Position(line, lines[line].length), token, ctx);
  }

  it('virgule dans une chaîne ou des génériques, parenthèse dans une chaîne', async () => {
    expect((await help('show("Hello, world", '))?.activeParameter).toBe(1);
    expect((await help('show(emptyMap<String, Int>(), '))?.activeParameter).toBe(1);
    expect((await help('show(mapOf("a" to 1), ":)", '))?.activeParameter).toBe(2);
    expect((await help('show(a > b, '))?.activeParameter).toBe(1);
  });

  it('un commentaire au-dessus ne fournit pas de `(` fantôme, un template est du code', async () => {
    expect(await help('// TODO: see show(\nval x = 1, ', 1)).toBeNull();
    const h = await help('val s = "${greet(');
    expect(h?.signatures[0].label).toContain('greet');
  });

  it('les surcharges sont toutes listées et la bonne est active', async () => {
    const h1 = await help('load(');
    expect(h1?.signatures.map(s => s.label)).toEqual(['fun load(id: Int)', 'fun load(name: String, force: Boolean)']);
    expect(h1?.activeSignature).toBe(0);
    const h2 = await help('load(1, ');
    expect(h2?.activeSignature).toBe(1);
    expect(h2?.activeParameter).toBe(1);
  });

  it('private val et override val sont des paramètres ; Java aussi', async () => {
    const vm = await help('MainViewModel(FakeRepo(), ');
    expect(vm?.signatures[0].parameters.length).toBe(2);
    expect(vm?.activeParameter).toBe(1);
    const ok = await help('Ok(');
    expect(ok?.signatures[0].parameters.length).toBe(2);
    expect(ok?.activeParameter).toBe(0);
    const j = await help('J.log("T", ');
    expect(j?.signatures[0].parameters.length).toBe(3);
    expect(j?.activeParameter).toBe(1);
  });
});

describe('Implémentations, hiérarchies et surlignage', () => {
  it('lookupMethodImplementations : conteneur au niveau au-dessus, membres val inclus', () => {
    const repo = 'package p\ninterface Repo {\n    data class Params(val id: Int)\n    val name: String\n    fun load(p: Params): User\n}';
    const impl = 'package p\nclass RepoImpl : Repo {\n    override val name = "r"\n    override fun load(p: Params): User = User()\n}';
    const index = indexOf({ 'file:///Repo.kt': repo, 'file:///RepoImpl.kt': impl });
    expect(index.lookupMethodImplementations('load', 'file:///Repo.kt', 4).map(e => `${e.name}@${e.line}`)).toEqual(['load@3']);
    expect(index.lookupMethodImplementations('name', 'file:///Repo.kt', 3).map(e => `${e.name}@${e.line}`)).toEqual(['name@2']);
  });

  it('hiérarchie d\'appels : un appel dans un initialiseur ou un init a un appelant', async () => {
    const uri = fresh();
    const code = [
      'package p',
      'fun helper() = 1',
      'fun other() = 2',
      'fun third() = 3',
      'class Vm {',
      '    fun a() { helper() }',
      '    val state = flow.map {',
      '        other()',
      '    }',
      '    init { helper() }',
      '    val x = third()',
      '}',
    ].join('\n');
    const index = indexOf({ [uri]: code });
    workspace.fs.readFile = async () => Buffer.from(code) as any;
    const doc = mockDocument(uri, code);
    const provider = new KotlinCallHierarchyProvider(index);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(doc as any);
    const callers = async (name: string, line: number) => {
      const [item] = provider.prepareCallHierarchy(doc, new Position(line, 4)) as any[];
      expect(item?.name).toBe(name);
      const calls = await provider.provideCallHierarchyIncomingCalls(item, token);
      return calls.map(c => `${c.from.name}:${c.from.kind}`).sort();
    };
    expect(await callers('other', 2)).toEqual([`state:${SymbolKind.Property}`]);
    expect(await callers('third', 3)).toEqual([`x:${SymbolKind.Property}`]);
    expect(await callers('helper', 1)).toEqual([`Vm:${SymbolKind.Class}`, `a:${SymbolKind.Method}`]);
  });

  it('hiérarchie de types : un objet anonyme est libellé, pas $anon$N', () => {
    const uri = fresh();
    const code = 'package p\ninterface Callback\nval cb = object : Callback { }';
    const index = indexOf({ [uri]: code });
    const doc = mockDocument(uri, code);
    const provider = new KotlinTypeHierarchyProvider(index);
    const items = provider.prepareTypeHierarchy(doc, new Position(1, 12), token) as any[];
    const subs = provider.provideTypeHierarchySubtypes(items[0], token) as any[];
    // Meme libelle que l'Outline depuis l'audit 60 : `object : Callback`.
    expect(subs.map(s => s.name)).toEqual(['object : Callback']);
    expect(subs[0].range.start.character).toBe(subs[0].range.end.character);
  });

  it('surlignage : ni les lignes internes d\'une KDoc ni le SQL d\'un """', () => {
    const uri = fresh();
    const code = [
      'package p',
      '/**',
      ' * @param name the name to look up',
      ' */',
      '@Query("""',
      '    SELECT * FROM user WHERE name = :name',
      '""")',
      'fun find(name: String): User = byName(name)',
      'val tpl = """$name"""',
    ].join('\n');
    const index = indexOf({ [uri]: code });
    const doc = mockDocument(uri, code);
    const hs = new KotlinDocumentHighlightProvider(index).provideDocumentHighlights(doc, positionOf(code, 'name: String'), token)!;
    expect(hs.map(h => h.range.start.line).sort()).toEqual([7, 7, 8]);
  });
});
