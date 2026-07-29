import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/UnusedDeclarationProvider';

/** KJ-026 — tentatives de casse de la DÉTECTION au-delà du contrat. */

const names = (text: string) => findUnusedDeclarations(text).map(u => u.name);

describe('KJ-026 adversarial — détection', () => {
  it('private fun top-level morte, corps en bloc : flaggée', () => {
    const text = 'private fun gone(x: Int): Int {\n  return x + 1\n}\nfun main() { println(2) }\n';
    expect(names(text)).toEqual(['gone']);
  });

  it('private val membre morte flaggée, la voisine utilisée non', () => {
    const text = 'class A {\n  private val dead = 1\n  private val used = 2\n  fun f() = used\n}\n';
    expect(names(text)).toEqual(['dead']);
  });

  it('private class morte avec corps : flaggée', () => {
    const text = 'private class Gone {\n  fun inner() = 1\n}\nfun main() { println(1) }\n';
    expect(names(text)).toEqual(['Gone']);
  });

  it('récursion seule ne sauve pas une fun (son propre corps est blanchi)', () => {
    const text = 'class A {\n  private fun loop(n: Int) {\n    if (n > 0) loop(n - 1)\n  }\n  fun f() = 1\n}\n';
    expect(names(text)).toEqual(['loop']);
  });

  it('private object mort (non companion) : flaggé', () => {
    const text = 'private object Registry {\n  val entries = 3\n}\nfun main() { println(1) }\n';
    expect(names(text)).toEqual(['Registry']);
  });

  it('mention seulement en commentaire ou en string : flaggée quand même', () => {
    const text = 'class A {\n  private fun ghost() = 1\n  // ghost is important\n  val s = "call ghost later"\n  fun f() = s\n}\n';
    expect(names(text)).toEqual(['ghost']);
  });

  it('référence ::helper : vivante', () => {
    const text = 'class A {\n  private fun helper(x: Int) = x\n  val cb = ::helper\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('usages via "$name" et "${name()}" : vivants', () => {
    const text = 'class A {\n  private val fmt = "x"\n  private fun stamp() = 1\n  val a = "v: $fmt"\n  val b = "s: ${stamp()}"\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('conventions : operator own-line ET invoke/component1/getValue inline-body jamais flaggés', () => {
    const ownLine = 'class A {\n  private operator fun plus(o: A): A = o\n}\n';
    expect(names(ownLine)).toEqual([]);
    const inline = 'class B { private fun invoke() = 1 }\nclass C { private fun component1() = 2 }\nclass D { private fun getValue() = 3 }\n';
    expect(names(inline)).toEqual([]);
  });

  it('classe annotée : val membre skippé MAIS fun morte flaggée', () => {
    const text = '@Persisted\nclass Dto(val id: String) {\n  private val mirror = id\n  private fun compute() = 42\n}\n';
    expect(names(text)).toEqual(['compute']);
  });

  it('@Composable morte flaggée (bénigne) ; @Deprecated morte jamais', () => {
    expect(names('@Composable\nprivate fun DeadChip() { Text("x") }\nfun main() { println(1) }\n')).toEqual(['DeadChip']);
    expect(names('@Deprecated("old")\nprivate fun legacy() = 1\nfun main() { println(1) }\n')).toEqual([]);
  });

  it('companions : membre de companion anonyme utilisé depuis la classe = vivant ; companion nommé jamais nommé = jamais flaggé', () => {
    const anon = 'class A {\n  fun total() = SHARED\n  companion object {\n    private val SHARED = 1\n  }\n}\n';
    expect(names(anon)).toEqual([]);
    const named = 'class B {\n  private companion object Factory {\n    val seed = 1\n  }\n  fun f() = seed\n}\n';
    expect(names(named)).toEqual([]);
  });

  it('overloads du même nom : jamais flaggés même si un seul est appelé', () => {
    const text = 'class A {\n  private fun parse(v: Int) = v.toString()\n  private fun parse(v: String) = v\n  fun f() = parse(1)\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('locale du même nom qu’un membre mort : membre non flaggé (règle des doublons)', () => {
    const text = 'class A {\n  private val cache = 1\n  fun f() { val cache = 2; println(cache) }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('PIÈGE FP : private val + init block en dernière classe du fichier → vivant', () => {
    const text = 'class Last {\n  private val helper = 1\n  init { println(helper) }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('fun morte en corps-expression object : flaggée une seule fois', () => {
    const text = 'class T {\n  private fun make(id: String) = object : Runnable {\n    override fun run() = println(id)\n  }\n  fun f() = 1\n}\n';
    const found = findUnusedDeclarations(text);
    expect(found.map(u => u.name)).toEqual(['make']);
    const removed = text.slice(found[0].removeStart, found[0].removeEnd);
    expect(removed).toContain('override fun run()');
  });

  it('@file:Suppress("unused") → rien ; @Suppress décl-level → skippée', () => {
    expect(names('@file:Suppress("unused")\nprivate fun gone() = 1\n')).toEqual([]);
    expect(names('@Suppress("unused")\nprivate fun kept() = 1\nfun main() { println(1) }\n')).toEqual([]);
  });

  it('grab bag jamais flaggé : backticks, _prefixe, main, serialVersionUID, expect/actual/external/abstract, point-virgule, braces cassées', () => {
    expect(names('private fun `weird name`() = 1\n')).toEqual([]);
    expect(names('private val _internal = 1\n')).toEqual([]);
    expect(names('private fun main() { println(1) }\n')).toEqual([]);
    expect(names('class A { private val serialVersionUID = 1L }\n')).toEqual([]);
    expect(names('private external fun nat(): Int\nfun main() { println(1) }\n')).toEqual([]);
    expect(names('private val a = 1; val b = a\n')).toEqual([]);
    expect(() => findUnusedDeclarations('class A { private fun broken( {')).not.toThrow();
  });

  it('BUG-HUNT-I : classe sans corps n’avale pas le corps de la fonction suivante', () => {
    const text = 'private class Boom : Exception()\n\ninternal fun log() {\n  throw Boom()\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-I : classe sans corps réellement morte reste flaggée', () => {
    const text = 'private class Boom : Exception()\n\ninternal fun log() {\n  println(1)\n}\n';
    expect(names(text)).toEqual(['Boom']);
  });

  it('BUG-HUNT-I : supertypes sur plusieurs lignes, le corps est bien trouvé', () => {
    const text = 'private class Multi :\n  Base(),\n  Marker {\n  fun inner() = 1\n}\nfun main() { println(Multi()) }\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-J : @Preview est un point d’entrée du renderer, jamais flaggé', () => {
    const text = '@Preview\n@Composable\nprivate fun MyPreview() { Text("x") }\nfun main() { println(1) }\n';
    expect(names(text)).toEqual([]);
    const dark = '@Preview(name = "dark", uiMode = 32)\n@Composable\nprivate fun DarkPreview() { Text("x") }\nfun main() { println(1) }\n';
    expect(names(dark)).toEqual([]);
  });

  it('BUG-HUNT-L : classe Serializable/Parcelable — val privé lu par la sérialisation, jamais flaggé', () => {
    const ser = 'class Dto : Serializable {\n  private val hidden: Int = 0\n}\nfun main() { println(Dto()) }\n';
    expect(names(ser)).toEqual([]);
    const parcel = 'class P : Parcelable {\n  private val hidden: Int = 0\n}\nfun main() { println(P()) }\n';
    expect(names(parcel)).toEqual([]);
    // les fonctions restent flaggables même là
    const withFun = 'class Dto : Serializable {\n  private val hidden: Int = 0\n  private fun compute() = 1\n}\nfun main() { println(Dto()) }\n';
    expect(names(withFun)).toEqual(['compute']);
  });

  it('BUG-HUNT-K : les private val de constructeur restent à KJ-025 (pas de double warning)', () => {
    const text = 'class Vm(\n  private val repo: Repo,\n  private val tracker: Tracker\n) {\n  fun load() = 1\n}\n';
    expect(names(text)).toEqual([]);
    const singleLine = 'class Vm(private val repo: Repo) {\n  fun load() = 1\n}\n';
    expect(names(singleLine)).toEqual([]);
  });

  it('fichier sans private → [] sans parse', () => {
    expect(findUnusedDeclarations('fun main() { println(1) }')).toEqual([]);
    expect(findUnusedDeclarations('')).toEqual([]);
  });

  it('gros fichier : 300 classes < 300 ms', () => {
    const text = Array.from({ length: 300 }, (_, i) =>
      `class C${i} {\n  private val dead${i} = 1\n  private val used${i} = 2\n  fun f${i}() = used${i}\n}`,
    ).join('\n');
    const start = performance.now();
    expect(findUnusedDeclarations(text)).toHaveLength(300);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
