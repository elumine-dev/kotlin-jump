import { describe, it, expect } from 'vitest';
import { parseJava } from '../../src/indexer/JavaParser';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { buildSnapshotFile, restoreSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { buildLocalScopeIndex, isJavaMethodHeader } from '../../src/util/LocalScopeIndex';
import { resolveLocalScope } from '../../src/providers/DefinitionProvider';
import { KotlinSemanticTokensProvider, TOKEN_TYPES, TOKEN_MODIFIERS, computeBlockCommentMask, computeTripleStringMask, inTripleStringMask } from '../../src/providers/SemanticTokensProvider';
import { mockDocument } from './helpers';
import { Position, SemanticTokensLegend } from './__mocks__/vscode';

// Audit 14 : parseur Java, scope local Java/Kotlin, tokens sémantiques.

const jsyms = (code: string) => parseJava('file:///A.java', code).symbols;
const NO_CANCEL = { isCancellationRequested: false } as any;

function tokensOf(index: SymbolIndex, uri: string, code: string) {
  const provider = new KotlinSemanticTokensProvider(index, new SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS) as any);
  const result: any = provider.provideDocumentSemanticTokens(mockDocument(uri, code), NO_CANCEL);
  const data: number[] = Array.from(result.data as Uint32Array);
  const out: { line: number; char: number; len: number; type: string; text: string }[] = [];
  const lines = code.split('\n');
  let line = 0, char = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    out.push({ line, char, len: data[i + 2], type: TOKEN_TYPES[data[i + 3]], text: lines[line].slice(char, char + data[i + 2]) });
  }
  return out;
}

describe('JavaParser audit — champs sans modificateur et annotations', () => {
  it('@Inject / @Mock / @ColumnInfo / constante d\'interface sont indexés', () => {
    const code = [
      'class A {',
      '  @Inject AnalyticsAdapter analytics;',
      '  @Mock UserRepository repository;',
      '  @ColumnInfo(name = "first_name") String firstName;',
      '  String KEY = "k";',
      '  Map<String, List<Integer>> grouped = new HashMap<>();',
      '  int[] counts;',
      '  public void foo() {}',
      '}',
    ].join('\n');
    const s = jsyms(code);
    expect(s.map(x => x.name)).toEqual(['A', 'analytics', 'repository', 'firstName', 'KEY', 'grouped', 'counts', 'foo']);
    expect(s.find(x => x.name === 'firstName')?.character).toBe('  @ColumnInfo(name = "first_name") String '.length);
    expect(s.find(x => x.name === 'analytics')?.depth).toBe(1);
  });

  it('les annotations d\'un champ ne fuient plus sur la méthode suivante', () => {
    const code = 'class A {\n  @Deprecated String legacy;\n  @Ignore @Test int bogus;\n  public void foo() {}\n}';
    const s = jsyms(code);
    expect(s.find(x => x.name === 'legacy')?.isDeprecated).toBe(true);
    const foo = s.find(x => x.name === 'foo');
    expect(foo?.isDeprecated).toBeUndefined();
    expect(foo?.isTest).toBeUndefined();
    expect(foo?.isIgnored).toBeUndefined();
  });

  it('@interface sans modificateur (patron @IntDef) est un type annotation', () => {
    const s = jsyms('@Retention(RetentionPolicy.SOURCE)\n@IntDef({MODE_A, MODE_B})\n@interface Mode {}\n@Retention(RetentionPolicy.SOURCE) @interface Inline {}');
    expect(s.map(x => `${x.kind}:${x.name}`)).toEqual(['annotation:Mode', 'annotation:Inline']);
  });

  it('annotation avec parenthèses imbriquées sur la même ligne (@Query count(*))', () => {
    const code = [
      'interface Dao {',
      '  @Query("SELECT count(*) FROM t") int count();',
      '  @Query("SELECT * FROM t WHERE id IN (:ids)") List<T> byIds(List<Integer> ids);',
      '  @Entity(indices = {@Index("a")}) class Nested {}',
      '}',
    ].join('\n');
    expect(jsyms(code).map(x => x.name)).toEqual(['Dao', 'count', 'byIds', 'Nested']);
  });

  it('un bloc static n\'est pas une méthode', () => {
    const s = jsyms('class C {\n  static { System.loadLibrary("native-lib"); }\n  public void last() {}\n}');
    expect(s.map(x => x.name)).toEqual(['C', 'last']);
  });
});

describe('JavaParser audit — commentaires de bloc et text blocks', () => {
  it('`/*` en fin de ligne masque le code commenté, `/* { */` ne décale pas la profondeur', () => {
    const code = [
      'class A {',
      '  public void a() {} /* TODO',
      '  public void ghost() {}',
      '  */',
      '  int x = 1; /* { */',
      '  /** Example: <pre>{@code',
      '   *  foo(); }</pre> */',
      '  public void b() {}',
      '}',
    ].join('\n');
    const s = jsyms(code);
    expect(s.map(x => x.name)).toEqual(['A', 'a', 'x', 'b']);
    expect(s.find(x => x.name === 'b')?.depth).toBe(1);
  });

  it('un text block """ n\'engendre ni méthode fantôme ni dérive', () => {
    const code = [
      'class C {',
      '  static final String CREATE = """',
      '    CREATE TABLE users (',
      '        id INTEGER PRIMARY KEY',
      '    ) { "json": true }',
      '    """;',
      '  public void afterAll() {}',
      '}',
    ].join('\n');
    const s = jsyms(code);
    expect(s.map(x => x.name)).toEqual(['C', 'CREATE', 'afterAll']);
    expect(s.find(x => x.name === 'afterAll')?.depth).toBe(1);
  });
});

describe('JavaParser audit — entrées d\'enum', () => {
  const code = [
    'public enum Screen {',
    '  Home,',
    '  Settings("s"),',
    '  DETAILS(',
    '    Bar.BAZ,',
    '    OTHER_CONST',
    '  ),',
    '  @Deprecated OLD,',
    '  PLUS("+") {',
    '    int apply() { return 1; }',
    '  };',
    '  private final String s;',
    '  Screen() { s = ""; }',
    '}',
  ].join('\n');

  it('PascalCase complet, arguments multi-lignes ignorés, `};` ferme la liste', () => {
    const s = jsyms(code);
    const entries = s.filter(x => x.kind === 'enum' && x.depth === 1);
    expect(entries.map(x => x.name)).toEqual(['Home', 'Settings', 'DETAILS', 'OLD', 'PLUS']);
    expect(entries.find(x => x.name === 'OLD')?.character).toBe('  @Deprecated '.length);
    expect(s.find(x => x.name === 'apply')?.isDeprecated).toBeUndefined();
    expect(s.filter(x => x.name === 'Screen')).toHaveLength(1);
  });

  it('`;` seul sur sa ligne ferme aussi la liste', () => {
    const s = jsyms('enum E {\n  A,\n  B,\n  ;\n  Helper build() { return null; }\n}');
    expect(s.filter(x => x.kind === 'enum' && x.depth === 1).map(x => x.name)).toEqual(['A', 'B']);
    expect(s.find(x => x.name === 'build')?.kind).toBe('fun');
  });
});

describe('LocalScopeIndex audit — liaisons dans les chaînes et commentaires', () => {
  const java = [
    'void load(int id, String name) {',
    '    Cursor c = db.rawQuery("SELECT * FROM t WHERE id = ?", null);',
    '    Log.d(TAG, "user name = " + name);',
    '    // default timeout = 30',
    '    /* String ghost = null;',
    '       int timeout = 1; */',
    '    use(id, name, timeout);',
    '    String label = cond',
    '        ? format(id)',
    '        : other(id);',
    '}',
  ];

  it('Java : aucune liaison née d\'une chaîne, d\'un `//` ou d\'un bloc `/* */`', () => {
    const idx = buildLocalScopeIndex(java, 'java');
    expect(idx.bindings.has('timeout')).toBe(false);
    expect(idx.bindings.has('ghost')).toBe(false);
    expect(idx.bindings.get('name')?.map(b => b.line)).toEqual([0]);
    expect(idx.bindings.get('id')?.map(b => b.line)).toEqual([0]);
  });

  it('Java : la continuation d\'un ternaire n\'est pas un en-tête de méthode', () => {
    expect(isJavaMethodHeader('        ? format(id)')).toBe(false);
    expect(isJavaMethodHeader('    String label = cond')).toBe(false);
    expect(isJavaMethodHeader('void f(int value, boolean cond) {')).toBe(true);
    const idx = buildLocalScopeIndex(java, 'java');
    expect(idx.enclosingFun[8]).toBe(0);
    const doc = mockDocument('file:///L.java', java.join('\n'));
    const loc = resolveLocalScope(doc, new Position(8, 19), 'id');
    expect(loc?.range.start.line).toBe(0);
  });

  it('Kotlin : `// val repository = Fake()` au-dessus n\'attrape pas repository', () => {
    const kt = ['fun f() {', '    // val repository = Fake()', '    /* val x = 1', '       val y = 2 */ val z = 3', '    repository.fetch()', '}'];
    const idx = buildLocalScopeIndex(kt, 'kotlin');
    expect([...idx.bindings.keys()]).toEqual(['z']);
    expect(resolveLocalScope(mockDocument('file:///K.kt', kt.join('\n')), new Position(4, 6), 'repository')).toBeUndefined();
  });
});

describe('LocalScopeIndex audit — capture dans une classe anonyme', () => {
  const java = [
    'void setup(Button button, String url) {',
    '    final String title = "t";',
    '    button.setOnClickListener(new View.OnClickListener() {',
    '        @Override public void onClick(View view) {',
    '            open(url, title, view);',
    '        }',
    '    });',
    '}',
    'void other(String url) {}',
  ];

  it('outerFun remonte de onClick à setup', () => {
    const idx = buildLocalScopeIndex(java, 'java');
    expect(idx.enclosingFun[3]).toBe(3);
    expect(idx.outerFun[3]).toBe(0);
    expect(idx.outerFun[0]).toBe(-1);
  });

  it('url (paramètre) et title (locale) de setup résolvent depuis onClick', () => {
    const doc = mockDocument('file:///S.java', java.join('\n'));
    expect(resolveLocalScope(doc, new Position(4, 17), 'url')?.range.start.line).toBe(0);
    expect(resolveLocalScope(doc, new Position(4, 22), 'title')?.range.start.line).toBe(1);
    expect(resolveLocalScope(doc, new Position(4, 29), 'view')?.range.start.line).toBe(3);
  });

  it('Kotlin : object : Listener { override fun onClick() { use(outerVal) } }', () => {
    const kt = [
      'fun bind(outerParam: Int) {',
      '    val outerVal = 1',
      '    view.setListener(object : Listener {',
      '        override fun onClick() {',
      '            use(outerVal, outerParam)',
      '        }',
      '    })',
      '}',
      'fun sibling() = outerVal',
    ];
    const doc = mockDocument('file:///O.kt', kt.join('\n'));
    expect(resolveLocalScope(doc, new Position(4, 16), 'outerVal')?.range.start.line).toBe(1);
    expect(resolveLocalScope(doc, new Position(4, 26), 'outerParam')?.range.start.line).toBe(0);
    // Une fonction voisine ne voit pas les locales de la précédente.
    expect(resolveLocalScope(doc, new Position(8, 16), 'outerVal')).toBeUndefined();
  });
});

describe('SemanticTokens audit', () => {
  it('un enum class imbriqué est peint `enum`, ses entrées `enumMember`', () => {
    const code = 'package p\nclass Foo {\n    enum class State { ACTIVE, IDLE }\n}\nenum class Top { XRAY }\nfun a(): Foo.State = Foo.State.ACTIVE\nval t = Top.XRAY';
    const index = new SymbolIndex();
    index.add(parse('file:///E.kt', code));
    index.finalize();
    const toks = tokensOf(index, 'file:///E.kt', code);
    const byText = (t: string) => toks.filter(x => x.text === t).map(x => x.type);
    expect(byText('State')).toEqual(['enum', 'enum', 'enum']);
    expect(byText('Top')).toEqual(['enum', 'enum']);
    expect(byText('ACTIVE')).toEqual(['enumMember', 'enumMember']);
    expect(byText('XRAY')).toEqual(['enumMember', 'enumMember']);
    const entries = index.getFileSymbols('file:///E.kt');
    expect(entries.find(e => e.name === 'State')?.isEnumEntry).toBeUndefined();
    expect(entries.find(e => e.name === 'ACTIVE')?.isEnumEntry).toBe(true);
  });

  it('isEnumEntry survit au snapshot', () => {
    const parsed = parse('file:///E.kt', 'class Foo {\n    enum class State { A }\n}');
    const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 10, parsed.imports);
    const index = new SymbolIndex();
    restoreSnapshotFile('file:///E.kt', sf, index);
    const entries = index.getFileSymbols('file:///E.kt');
    expect(entries.find(e => e.name === 'State')?.isEnumEntry).toBeUndefined();
    expect(entries.find(e => e.name === 'A')?.isEnumEntry).toBe(true);
  });

  it('aucun token dans un commentaire de bloc multi-lignes', () => {
    const lib = 'package p\nclass Mega\nfun helper() = 1';
    const code = 'package p\n/*\nval m = Mega()\nhelper()\n*/\nval real = Mega() /* Mega */ + helper()\nval s = "/*" + Mega()';
    const index = new SymbolIndex();
    index.add(parse('file:///Lib.kt', lib));
    index.add(parse('file:///C.kt', code));
    index.finalize();
    const toks = tokensOf(index, 'file:///C.kt', code);
    expect(toks.filter(t => t.line >= 1 && t.line <= 4)).toEqual([]);
    expect(toks.filter(t => t.line === 5 && t.text === 'Mega').map(t => t.char)).toEqual(['val real = '.length]);
    expect(toks.filter(t => t.line === 6 && t.text === 'Mega')).toHaveLength(1);
  });

  it('computeBlockCommentMask ignore `/*` dans une chaîne ou après `//`', () => {
    const lines = ['val a = "/*"', 'val b = 1 // /* not open', 'val c = 2', '/* open', 'still */ val d = 3'];
    const mask = computeBlockCommentMask(lines, computeTripleStringMask(lines));
    expect(inTripleStringMask(mask, 2, 4)).toBe(false);
    expect(inTripleStringMask(mask, 3, 3)).toBe(true);
    expect(inTripleStringMask(mask, 4, 2)).toBe(true);
    expect(inTripleStringMask(mask, 4, 13)).toBe(false);
  });

  it('nom de fonction en backticks : token de déclaration entier, rien sur les mots internes', () => {
    const code = 'package p\nval user = 1\nclass T {\n    @Test fun `returns user when found`() = user\n}';
    const index = new SymbolIndex();
    index.add(parse('file:///T.kt', code));
    index.finalize();
    const sym = index.getFileSymbols('file:///T.kt').find(e => e.name === 'returns user when found');
    expect(sym?.character).toBe('    @Test fun `'.length);
    const toks = tokensOf(index, 'file:///T.kt', code).filter(t => t.line === 3);
    expect(toks.map(t => [t.text, t.type])).toEqual([
      ['returns user when found', 'method'],
      ['user', 'variable'],
    ]);
    expect(toks[1].char).toBe(code.split('\n')[3].lastIndexOf('user'));
  });
});
