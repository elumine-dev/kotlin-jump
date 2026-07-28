import { describe, it, expect } from 'vitest';
import { findUnusedParameters } from '../../../src/providers/UnusedParameterProvider';

/** KJ-025 — tentatives de casse de la DÉTECTION au-delà du contrat. */

const names = (text: string) => findUnusedParameters(text).map(u => u.name);

describe('KJ-025 adversarial — détection', () => {
  it('usage UNIQUEMENT via un template simple "$name" : vivant', () => {
    const text = 'class A(name: String) {\n  val s = "Hello $name"\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('usage via "${name.trim()}" : vivant', () => {
    const text = 'class A(name: String) {\n  val s = "x ${name.trim()} y"\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('mention en KDoc @param et en commentaire seulement : flagué', () => {
    const text = '/** @param dead documented but never read */\nclass A(dead: Int) {\n  // dead is important\n  val x = 1\n}\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('mention dans une string sans template : flagué', () => {
    const text = 'class A(dead: Int) {\n  val s = "dead code walking"\n}\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('label d’argument nommé dans le corps : PAS flagué (faux négatif assumé)', () => {
    const text = 'class A(count: Int) {\n  fun f() = other(count = 1)\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('shadowing par une locale du même nom : PAS flagué (faux négatif assumé)', () => {
    const text = 'class A(count: Int) {\n  fun f() { val count = 5; println(count) }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('params morts d’override, de fun publique et d’operator fun : jamais flagués', () => {
    const text = [
      'class A : B() {',
      '  override fun draw(dead: Int) = Unit',
      '  fun publicApi(dead2: Int) = Unit',
      '  private operator fun plus(dead3: Int): A = this',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('fun sans corps (external, abstract, header) : jamais flaguée', () => {
    const text = [
      'abstract class A {',
      '  abstract fun a(dead: Int)',
      '}',
      'private external fun nat(dead2: Int)',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('data class, enum, annotation class, interface, object, value class : jamais', () => {
    const text = [
      'data class P(private val x: Int, y: Int)',
      'enum class E(val hex: Int) { A(1) }',
      'annotation class Anno(val v: String)',
      'interface I { fun f(dead: Int) }',
      'value class V(private val raw: Int)',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('@Suppress sur la fun, la classe et le fichier : rien', () => {
    const onFun = '@Suppress("UNUSED_PARAMETER")\nprivate fun f(dead: Int) = Unit\n';
    const onClass = '@Suppress("unused")\nclass A(dead: Int) { val x = 1 }\n';
    const onFile = '@file:Suppress("unused")\nclass A(dead: Int) { val x = 1 }\n';
    expect(names(onFun)).toEqual([]);
    expect(names(onClass)).toEqual([]);
    expect(names(onFile)).toEqual([]);
  });

  it('param utilisé par la valeur par défaut d’un autre param : vivant', () => {
    const ctor = 'class A(x: Int, y: Int = x) { val z = y }\n';
    expect(names(ctor)).toEqual([]);
    // note : pas de fun nommée « f » — l'indexation du parser confond ce nom
    // avec le f de « fun » et la détection skippe alors la fonction (sans risque)
    const fn = 'private fun calc(a: Int, b: Int = a, dead: Int) = b\n';
    expect(names(fn)).toEqual(['dead']);
  });

  it('param passé au supertype ou consommé par un delegate : vivant', () => {
    const sup = 'class A(x: Int) : Base(x) { val y = 1 }\n';
    expect(names(sup)).toEqual([]);
    const del = 'class B(private val d: Dep) {\n  val svc by lazy { d.make() }\n}\n';
    expect(names(del)).toEqual([]);
  });

  it('ctor multi-lignes avec generics, lambda, param annoté : offsets exacts', () => {
    const text = [
      'class Handler<T : Any>(',
      '    val transform: (T) -> String,',
      '    dead: Map<String, List<T>>,',
      '    @Named("x") tag: String,',
      ') {',
      '  val label = transform.toString()',
      '}',
    ].join('\n');
    const unused = findUnusedParameters(text);
    expect(unused).toHaveLength(1);
    expect(unused[0].name).toBe('dead');
    expect(unused[0].line).toBe(2);
    expect(unused[0].character).toBe(4);
  });

  it('@Inject constructor(dead) flagué ; @Named("x") constructor : classe skippée sans crash', () => {
    const inject = 'class Foo @Inject constructor(dead: Int) { val x = 1 }\n';
    expect(names(inject)).toEqual(['dead']);
    const named = 'class Foo @Named("x") constructor(dead: Int) { val x = 1 }\n';
    expect(names(named)).toEqual([]);
  });

  it('corps-expression, frontière de mot et backticks', () => {
    expect(names('private fun twice(a: Int) = 2\n')).toEqual(['a']);
    expect(names('private fun plusOne(a: Int) = a + 1\n')).toEqual([]);
    expect(names('private fun scanAll(user: Int) { val users = Users.all }\n')).toEqual(['user']);
    expect(names('private fun tick(`in`: Int) = Unit\n')).toEqual([]);
  });

  it('vararg jamais flagué (le retrait d’arguments variadiques n’est pas sûr)', () => {
    expect(names('private fun log(vararg items: Int) { }\n')).toEqual([]);
  });

  it('@Composable est bénin, une autre annotation protège la fun', () => {
    expect(names('@Composable\nprivate fun Chip(dead: Int) { Text("x") }\n')).toEqual(['dead']);
    expect(names('@Subscribe\nprivate fun onEvent(e: Event) { }\n')).toEqual([]);
  });

  it('trailing comma et dernier param mort', () => {
    const text = 'class A(\n  used: Int,\n  dead: Int,\n) {\n  val x = used\n}\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('prop privée d’une classe annotée : skippée (codegen), le ctorParam reste flagué', () => {
    const text = '@Serializable\nclass Dto(private val hidden: Int, dead: Int) { val x = 1 }\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('BUG-HUNT-A : fun sans corps suivie d’une autre fun — le corps voisin ne compte pas', () => {
    const text = 'private external fun nat(dead: Int)\nprivate fun other() { println(1) }\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-E : préfixe _ = intentionnellement inutilisé, jamais flagué', () => {
    expect(names('private fun cb(_event: String, data: String) = data\n')).toEqual([]);
    expect(names('class A(_ignored: Int) { val x = 1 }\n')).toEqual([]);
  });

  it('BUG-HUNT-F : @Suppress multi-lignes au-dessus de la fun respecté', () => {
    const text = '@Suppress(\n  "UNUSED_PARAMETER"\n)\nprivate fun go(dead: Int) { }\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-F : annotation multi-lignes non bénigne protège la fun', () => {
    const text = '@Named(\n  "handler"\n)\nprivate fun go(dead: Int) { }\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-F : @Entity multi-lignes — props skippées, ctorParam gardé', () => {
    const text = '@Entity(\n  tableName = "t"\n)\nclass Dto(private val hidden: Int, dead: Int) { val x = 1 }\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('BUG-HUNT-G : params utilisés dans un object anonyme en corps-expression', () => {
    // patron courant des helpers de test Android : le parser émet l'object
    // anonyme comme sibling de la fun, ce qui tronquait la région de scan
    const text = [
      'class MapperTest {',
      '    private fun city(id: String, name: String): Model =',
      '        object : Model {',
      '            override fun getId() = id',
      '            override fun getName() = name',
      '        }',
      '',
      '    companion object {',
      '        private const val LABEL = "x"',
      '    }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-G : lambda multi-lignes en corps-expression compte aussi', () => {
    const text = [
      'private fun handler(tag: String) = Runnable {',
      '    println(tag)',
      '}',
      'private fun other() { println(2) }',
      '',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-G : le param vraiment mort reste flagué malgré l’object anonyme', () => {
    const text = [
      'class T {',
      '    private fun city(id: String, dead: Int): Model =',
      '        object : Model {',
      '            override fun getId() = id',
      '        }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual(['dead']);
  });

  it('fichier sans classe ni fun → [] sans crash', () => {
    expect(findUnusedParameters('val x = 1')).toEqual([]);
    expect(findUnusedParameters('')).toEqual([]);
  });

  it('gros fichier : 400 classes < 300 ms', () => {
    const text = Array.from({ length: 400 }, (_, i) =>
      `class C${i}(a${i}: Int, dead${i}: Int) {\n  val v${i} = a${i}\n}`,
    ).join('\n');
    const start = performance.now();
    expect(findUnusedParameters(text)).toHaveLength(400);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
