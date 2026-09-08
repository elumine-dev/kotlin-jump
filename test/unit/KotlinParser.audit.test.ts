import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { buildSnapshotFile, restoreSnapshotFile } from '../../src/indexer/SnapshotFormat';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { mockDocument } from './helpers';
import { SymbolKind } from './__mocks__/vscode';

// Audit du parseur (session UI/perf) : déclarations perdues ou mal placées
// dans l'Outline, colonnes fausses, profondeur qui dérive.

const syms = (code: string) => parse('file:///a.kt', code).symbols;
const names = (code: string) => syms(code).map(s => s.name);

function outline(code: string, uri = 'file:///o.kt') {
  const index = new SymbolIndex();
  index.add(parse(uri, code));
  return new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(mockDocument(uri, code), {} as any);
}

describe('KotlinParser audit — annotations sur la même ligne', () => {
  it('@AndroidEntryPoint class / @Entity(...) data class / @Parcelize data class sont indexées', () => {
    const code = [
      '@AndroidEntryPoint class MainActivity : AppCompatActivity()',
      '@Entity(tableName = "users") data class User(val id: Int)',
      '@Parcelize data class Point(val x: Int) : Parcelable',
      '@Serializable @JvmInline value class Meters(val v: Int)',
    ].join('\n');
    const s = syms(code);
    expect(s.find(x => x.name === 'MainActivity')?.kind).toBe('class');
    expect(s.find(x => x.name === 'MainActivity')?.supertypes).toEqual(['AppCompatActivity']);
    expect(s.find(x => x.name === 'User')?.kind).toBe('dataClass');
    expect(s.find(x => x.name === 'Point')?.supertypes).toEqual(['Parcelable']);
    expect(s.find(x => x.name === 'Meters')?.kind).toBe('class');
    // Paramètres du constructeur inline toujours extraits
    expect(s.find(x => x.name === 'id')?.isPrimaryCtorParam).toBe(true);
    expect(s.find(x => x.name === 'v')?.depth).toBe(1);
  });

  it('@Inject lateinit var et @field:SerializedName val (constructeur multi-lignes)', () => {
    const code = [
      'class Repo @Inject constructor(',
      '  @field:SerializedName("user_name") val userName: String,',
      '  @ColumnInfo(name = "age") private val age: Int,',
      ') {',
      '  @Inject lateinit var api: Api',
      '  @get:JvmName("isReady") val ready: Boolean = true',
      '}',
    ].join('\n');
    const s = syms(code);
    const userName = s.find(x => x.name === 'userName');
    expect(userName?.isPrimaryCtorParam).toBe(true);
    expect(userName?.depth).toBe(1);
    expect(s.find(x => x.name === 'age')?.isPrivate).toBe(true);
    const api = s.find(x => x.name === 'api');
    expect(api?.kind).toBe('var');
    expect(api?.isLateinit).toBe(true);
    expect(api?.depth).toBe(1);
    expect(s.find(x => x.name === 'ready')?.kind).toBe('val');
  });

  it('la colonne pointe le nom, pas sa copie dans la chaîne de l\'annotation', () => {
    const cls = syms('@SerializedName("Foo") class Foo')[0];
    expect(cls.character).toBe('@SerializedName("Foo") class '.length);
    const fn = syms('@JvmName("getFoo") fun getFoo() = 1')[0];
    expect(fn.character).toBe('@JvmName("getFoo") fun '.length);
    const prop = syms('@Json(name = "value") val value: Int = 1')[0];
    expect(prop.name).toBe('value');
    expect(prop.character).toBe('@Json(name = "value") val '.length);
  });

  it('@Deprecated / @RunWith / @HiltViewModel sur la même ligne posent le drapeau', () => {
    expect(syms('@Deprecated("old") class Old')[0].isDeprecated).toBe(true);
    expect(syms('@RunWith(AndroidJUnit4::class) class T')[0].isTestClass).toBe(true);
    expect(syms('@HiltViewModel class VM : ViewModel()')[0].isHiltViewModel).toBe(true);
    expect(syms('@Deprecated("x") val old = 1')[0].isDeprecated).toBe(true);
  });

  it('final est un modificateur connu (class, fun, val)', () => {
    const s = syms('final class F\nfinal override fun g() {}\nfinal val v = 1');
    expect(s.map(x => x.name)).toEqual(['F', 'g', 'v']);
  });
});

describe('KotlinParser audit — companion object sans nom', () => {
  const code = [
    'package p',
    'class Foo {',
    '  fun a() {}',
    '  companion object {',
    '    const val TAG = "foo"',
    '    fun create() = Foo()',
    '  }',
    '  private companion object : Factory {',
    '    override fun make() = 1',
    '  }',
    '}',
  ].join('\n');

  it('émet Companion (isCompanion) sur le mot-clé companion, avec ses supertypes', () => {
    const s = syms(code);
    const companions = s.filter(x => x.isCompanion);
    expect(companions).toHaveLength(2);
    expect(companions[0]).toMatchObject({ name: 'Companion', kind: 'object', line: 3, character: 2, depth: 1 });
    expect(companions[1]).toMatchObject({ line: 7, character: 10, isPrivate: true, supertypes: ['Factory'] });
    // Le nom fait 9 caractères comme le mot-clé : la sélection couvre `companion`.
    expect('companion'.length).toBe('Companion'.length);
    expect(s.find(x => x.name === 'TAG')?.depth).toBe(2);
    expect(s.some(x => x.name.startsWith('$anon'))).toBe(false);
  });

  it('les FQN des membres restent Foo.TAG, Companion garde p.Foo.Companion', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///c.kt', code));
    const entries = index.getFileSymbols('file:///c.kt');
    expect(entries.find(e => e.name === 'TAG')?.fqn).toBe('p.Foo.TAG');
    expect(entries.find(e => e.name === 'create')?.fqn).toBe('p.Foo.create');
    expect(entries.find(e => e.name === 'Companion')?.fqn).toBe('p.Foo.Companion');
    expect(entries.find(e => e.name === 'Companion')?.isCompanion).toBe(true);
  });

  it('survit au snapshot : drapeau et FQN identiques après restauration', () => {
    const parsed = parse('file:///c.kt', code);
    const sf = buildSnapshotFile(parsed.symbols, parsed.packageName, undefined, 1, 10, parsed.imports);
    const index = new SymbolIndex();
    restoreSnapshotFile('file:///c.kt', sf, index);
    const entries = index.getFileSymbols('file:///c.kt');
    expect(entries.find(e => e.name === 'TAG')?.fqn).toBe('p.Foo.TAG');
    expect(entries.filter(e => e.isCompanion)).toHaveLength(2);
  });

  it('l\'Outline imbrique TAG sous Companion, pas sous la fonction précédente', () => {
    const roots = outline(code);
    const foo = roots[0];
    expect(foo.name).toBe('Foo');
    expect(foo.children.map(c => c.name)).toEqual(['a', 'Companion', 'Companion']);
    expect(foo.children[0].children).toHaveLength(0);
    expect(foo.children[1].children.map(c => c.name)).toEqual(['TAG', 'create']);
    expect(foo.children[1].kind).toBe(SymbolKind.Object);
    expect(foo.children[2].detail).toBe('private');
  });

  it('companion object { ... } sur une ligne : membres inline extraits', () => {
    const s = syms('class A {\n  companion object { const val X = 1; fun f() = 2 }\n}');
    expect(s.map(x => `${x.name}@${x.depth}`)).toEqual(['A@0', 'Companion@1', 'X@2', 'f@2']);
    expect(s.find(x => x.name === 'X')?.constValue).toBe('1');
  });

  it('companion object Named reste un objet ordinaire (pas de drapeau)', () => {
    const s = syms('class A {\n  companion object Named {}\n}');
    expect(s.find(x => x.name === 'Named')?.isCompanion).toBeUndefined();
    expect(s.filter(x => x.kind === 'object')).toHaveLength(1);
  });
});

describe('KotlinParser audit — propriétés d\'extension et value class', () => {
  it('val List<Int>.sum3 est indexée sous son nom, marquée extension', () => {
    const s = syms('val List<Int>.sum3: Int get() = 3\nval <T> List<T>.lastIdx: Int get() = 0\nval String.Companion.EMPTY: String get() = ""');
    expect(s.map(x => x.name)).toEqual(['sum3', 'lastIdx', 'EMPTY']);
    expect(s.every(x => x.isExtension)).toBe(true);
    expect(s[0].character).toBe('val List<Int>.'.length);
  });

  it('une propriété ordinaire n\'est pas marquée extension', () => {
    expect(syms('val plain: Int = 1')[0].isExtension).toBeUndefined();
  });

  it('const val garde sa valeur avec ou sans type explicite', () => {
    const s = syms('object K {\n  const val TAG = "k"\n  const val N: Int = 5\n  const val URL: String = "a=b" // c\n}');
    expect(s.find(x => x.name === 'TAG')?.constValue).toBe('"k"');
    expect(s.find(x => x.name === 'N')?.constValue).toBe('5');
    expect(s.find(x => x.name === 'URL')?.constValue).toBe('"a=b"');
  });
});

describe('KotlinParser audit — entrées d\'enum annotées et fin de section', () => {
  it('@SerializedName("ACTIVE") ACTIVE : entrée indexée, colonne sur le nom réel', () => {
    const code = 'enum class S {\n  @SerializedName("ACTIVE") ACTIVE,\n  @Json(name = "b") INACTIVE(1), @X DONE;\n}';
    const s = syms(code).filter(x => x.kind === 'enum' && x.depth === 1);
    expect(s.map(x => x.name)).toEqual(['ACTIVE', 'INACTIVE', 'DONE']);
    expect(s[0].character).toBe('  @SerializedName("ACTIVE") '.length);
    expect(s[1].character).toBe('  @Json(name = "b") '.length);
  });

  it('entrées annotées dans un enum inline sur la ligne de déclaration', () => {
    const s = syms('enum class T { @A ONE, @B("TWO") TWO }').filter(x => x.depth === 1);
    expect(s.map(x => x.name)).toEqual(['ONE', 'TWO']);
    expect(s[1].character).toBe('enum class T { @A ONE, @B("TWO") '.length);
  });

  it('après `;` seul sur sa ligne, une continuation en majuscule n\'est plus une entrée', () => {
    const code = [
      'enum class Color(val hex: String) {',
      '  RED("#f00"),',
      '  GREEN("#0f0"),',
      '  ;',
      '  override fun toString() =',
      '    NAME',
      '}',
    ].join('\n');
    const s = syms(code);
    expect(s.filter(x => x.kind === 'enum' && x.depth === 1).map(x => x.name)).toEqual(['RED', 'GREEN']);
    expect(s.find(x => x.name === 'toString')).toBeDefined();
  });

  it('après `GREEN("#0f0");` sur la même ligne, idem', () => {
    const code = 'enum class Color {\n  RED, GREEN;\n  fun f() =\n    OTHER\n}';
    expect(syms(code).filter(x => x.kind === 'enum' && x.depth === 1).map(x => x.name)).toEqual(['RED', 'GREEN']);
  });

  it('l\'enum qui suit un autre enum garde l\'icône Enum dans l\'Outline', () => {
    const roots = outline('enum class A { X, Y }\nenum class B { Z }');
    expect(roots.map(r => r.name)).toEqual(['A', 'B']);
    expect(roots[1].kind).toBe(SymbolKind.Enum);
    expect(roots[1].children[0].kind).toBe(SymbolKind.EnumMember);
  });
});

describe('KotlinParser audit — lambdas et constructeur primaire', () => {
  it('un val dans une lambda passée en argument nommé n\'est pas un paramètre de constructeur', () => {
    const code = 'val s = foo(\n  onClick = {\n    val inner = 1\n  }\n)\nfun after() {}';
    const s = syms(code);
    expect(s.find(x => x.name === 'inner')).toBeUndefined();
    expect(s.find(x => x.name === 'after')?.depth).toBe(0);
  });

  it('un constructeur primaire multi-lignes garde ses paramètres', () => {
    const code = 'data class U(\n  val id: Int,\n  var name: String,\n) {\n  val extra = 1\n}';
    const s = syms(code);
    expect(s.find(x => x.name === 'id')).toMatchObject({ depth: 1, isPrimaryCtorParam: true });
    expect(s.find(x => x.name === 'name')).toMatchObject({ depth: 1, isPrimaryCtorParam: true });
    expect(s.find(x => x.name === 'extra')?.isPrimaryCtorParam).toBeUndefined();
  });

  it('une valeur par défaut lambda dans le constructeur ne fait pas remonter ses locales', () => {
    const code = 'class C(\n  val cb: () -> Int = {\n    val t = 1\n    t\n  },\n  val z: Int,\n)';
    const s = syms(code);
    expect(s.find(x => x.name === 't')).toBeUndefined();
    expect(s.find(x => x.name === 'z')?.isPrimaryCtorParam).toBe(true);
  });
});

describe('KotlinParser audit — commentaires de bloc en milieu de ligne', () => {
  it('`/* { */` ne fait pas dériver la profondeur', () => {
    const s = syms('class A { /* { */ }\nfun after() {}\nclass B { /* } */ fun inB() {} }');
    expect(s.find(x => x.name === 'after')?.depth).toBe(0);
    expect(s.find(x => x.name === 'B')?.depth).toBe(0);
  });

  it('un `/*` ouvert en fin de ligne masque les lignes suivantes jusqu\'à `*/`', () => {
    const s = syms('val x = 1 /* start\nfun hidden() {}\n*/\nfun visible() {}');
    expect(s.map(x => x.name)).toEqual(['x', 'visible']);
  });

  it('une accolade après `*/` sur la ligne de fermeture est comptée', () => {
    const s = syms('class A {\n  /* doc\n  */ }\nfun top() {}');
    expect(s.find(x => x.name === 'top')?.depth).toBe(0);
  });

  it('`/*` dans une chaîne n\'ouvre pas de commentaire', () => {
    const s = syms('val glob = "/*"\nfun next() {}');
    expect(s.map(x => x.name)).toEqual(['glob', 'next']);
  });
});

describe('DocumentSymbolProvider audit — visibilité propre à chaque déclaration', () => {
  it('class Foo @Inject constructor(private val x) : la classe n\'est pas privée', () => {
    const roots = outline('class Foo @Inject constructor(private val x: Int)');
    expect(roots[0].detail).toBe('');
    expect(roots[0].children.find(c => c.name === 'x')?.kind).toBe(SymbolKind.Field);
  });

  it('data class A(private val a: Int, val b: Int) : seul a est privé', () => {
    const roots = outline('data class A(private val a: Int, val b: Int)');
    const a = roots[0].children.find(c => c.name === 'a');
    const b = roots[0].children.find(c => c.name === 'b');
    expect(a?.kind).toBe(SymbolKind.Field);
    expect(b?.kind).toBe(SymbolKind.Property);
  });

  it('private class et private fun gardent leur détail', () => {
    const roots = outline('private class P {\n  private fun f() {}\n  internal val v = 1\n}');
    expect(roots[0].detail).toBe('private');
    expect(roots[0].children.map(c => c.detail)).toEqual(['private', 'internal']);
  });
});
