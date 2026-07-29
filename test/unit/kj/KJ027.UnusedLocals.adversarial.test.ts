import { describe, it, expect } from 'vitest';
import { findUnusedLocals, isPureInitializer } from '../../../src/providers/UnusedLocalProvider';

/** KJ-027 — tentatives de casse de la DÉTECTION au-delà du contrat. */

const names = (text: string) => findUnusedLocals(text).map(u => u.name);
const fixOf = (text: string, name: string) => findUnusedLocals(text).find(u => u.name === name)?.fix;

describe('KJ-027 adversarial — détection', () => {
  it('shadowing : un nom déclaré deux fois dans le même corps n’est jamais flagué', () => {
    const text = 'fun f() {\n  val x = 1\n  println(x)\n  run { val x = 2 }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('locale lue seulement dans une lambda imbriquée : vivante', () => {
    const text = 'fun f(rows: List<Int>) {\n  val prefix = "p"\n  rows.forEach { r -> println(prefix + r) }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('locale lue seulement dans un template "$x" ou "${x.size}" : vivante', () => {
    expect(names('fun f() {\n  val n = 5\n  println("v: $n")\n}\n')).toEqual([]);
    expect(names('fun f(l: List<Int>) {\n  val items = l\n  println("n: ${items.size}")\n}\n')).toEqual([]);
  });

  it('param de lambda utilisé seulement par la lambda interne : vivant', () => {
    const text = 'fun f(rows: List<Int>) {\n  rows.forEach { row ->\n    listOf(1).forEach { println(row) }\n  }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('« it » n’est jamais flagué, corps vide compris', () => {
    expect(names('fun f(l: List<Int>) { l.map { it * 2 } }\n')).toEqual([]);
    expect(names('fun f(l: List<Int>) { l.forEach { } }\n')).toEqual([]);
  });

  it('« _ » et les noms préfixés _ ne sont jamais flagués, dans les trois positions', () => {
    expect(names('fun f(l: List<Int>) { l.forEachIndexed { _, row -> println(row) } }\n')).toEqual([]);
    expect(names('fun f() { try { s() } catch (_: Exception) { g() } }\n')).toEqual([]);
    expect(names('fun f() {\n  val _unused = 1\n  println(2)\n}\n')).toEqual([]);
  });

  it('binding catch utilisé seulement dans un throw : vivant ; sinon flagué', () => {
    expect(names('fun f() { try { s() } catch (e: Exception) { throw Wrap(e) } }\n')).toEqual([]);
    expect(names('fun f() { try { s() } catch (e: Exception) { g() } }\n')).toEqual(['e']);
  });

  it('initialiseur avec appel : flagué mais fix keepCall (l’appel survit)', () => {
    const text = 'fun f() {\n  val r = doSomething()\n  println(1)\n}\n';
    expect(fixOf(text, 'r')).toBe('keepCall');
  });

  it('locale utilisée après un return anticipé : vivante', () => {
    const text = 'fun f(c: Boolean) {\n  val v = 1\n  if (c) return\n  println(v)\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('destructuring val (a, b) = : ignoré sans crash ni faux positif', () => {
    const text = 'fun f(p: Pair<Int, Int>) {\n  val (a, b) = p\n  println(1)\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('val déclaré dans un if sur une seule ligne : flagué (le parser le raterait)', () => {
    const text = 'fun f(c: Boolean) {\n  if (c) { val y = 1 }\n  println(2)\n}\n';
    expect(names(text)).toEqual(['y']);
  });

  it('fonctions imbriquées : la locale de la fonction interne est bien bornée', () => {
    const text = 'fun outer() {\n  fun inner() {\n    val a = 1\n  }\n  inner()\n}\n';
    expect(names(text)).toEqual(['a']);
  });

  it('lambda dans lambda, les deux params morts : deux flags distincts', () => {
    const text = 'fun f(rows: List<Int>) {\n  rows.forEachIndexed { i, row ->\n    listOf(1).forEachIndexed { j, x -> println(x) }\n  }\n}\n';
    const found = findUnusedLocals(text);
    expect(found.map(u => u.name).sort()).toEqual(['i', 'j', 'row']);
    expect(new Set(found.map(u => u.character)).size).toBe(3);
  });

  it('catch sans type (Kotlin invalide) : ignoré sans crash', () => {
    expect(() => findUnusedLocals('fun f() { try { s() } catch (e) { g() } }\n')).not.toThrow();
    expect(names('fun f() { try { s() } catch (e) { g() } }\n')).toEqual([]);
  });

  it('plusieurs catch dont un seul mort : seul le mort est flagué', () => {
    const text = [
      'fun f() {',
      '  try { s() }',
      '  catch (io: IOException) { throw io }',
      '  catch (e: Exception) { g() }',
      '}',
      '',
    ].join('\n');
    expect(names(text)).toEqual(['e']);
  });

  it('locale dans un init block et dans un accesseur get : flaguée', () => {
    expect(names('class A {\n  init {\n    val t = 1\n  }\n}\n')).toEqual(['t']);
    expect(names('class A {\n  val p: Int\n    get() {\n      val t = 1\n      return 2\n    }\n}\n')).toEqual(['t']);
  });

  it('membre de classe jamais flagué ici (territoire KJ-026)', () => {
    expect(names('class A {\n  val member = 1\n  fun f() = 2\n}\n')).toEqual([]);
    expect(names('class A {\n  private val hidden = 1\n  fun f() = 2\n}\n')).toEqual([]);
  });

  it('when (val r = …) : jamais flagué (ancrage sur les parenthèses)', () => {
    const text = 'fun f(x: Int) {\n  when (val r = compute(x)) {\n    else -> println(1)\n  }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('@Suppress local et @file:Suppress : rien', () => {
    expect(names('fun f() {\n  @Suppress("unused")\n  val kept = 1\n  println(2)\n}\n')).toEqual([]);
    expect(names('@file:Suppress("unused")\nfun f() {\n  val dead = 1\n  println(2)\n}\n')).toEqual([]);
  });

  it('by lazy : flagué mais sans fix (effet d’enregistrement possible)', () => {
    const text = 'fun f() {\n  val d by lazy { heavy() }\n  println(1)\n}\n';
    const found = findUnusedLocals(text).find(u => u.name === 'd');
    expect(found?.fix).toBe('none');
    expect(found?.fixStart).toBe(-1);
  });

  it('leurre when : les branches avec -> ne créent pas de faux params', () => {
    const text = 'fun f(s: String) {\n  when (s) {\n    "a", "b" -> 1\n    else -> 2\n  }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-N : sujet de when avec parenthèses imbriquées', () => {
    const nested = 'fun f(r: Reader) {\n  when (r.peek()) {\n    NULL -> r.skip()\n    else -> r.next()\n  }\n}\n';
    expect(names(nested)).toEqual([]);
    const deeper = 'fun f(r: Reader) {\n  when (map(r.peek(), 2)) {\n    A -> 1\n    else -> 2\n  }\n}\n';
    expect(names(deeper)).toEqual([]);
    const subjectless = 'fun f(x: Int) {\n  when {\n    x > 1 -> 1\n    else -> 2\n  }\n}\n';
    expect(names(subjectless)).toEqual([]);
    // une vraie lambda juste après un when reste détectée
    const stillWorks = 'fun f(l: List<Int>) {\n  when (l.size) { else -> 1 }\n  l.forEachIndexed { i, v -> println(v) }\n}\n';
    expect(names(stillWorks)).toEqual(['i']);
  });

  it('BUG-HUNT-O : sujet de when contenant une lambda (le slab d’en-tête est coupé)', () => {
    const text = [
      'fun f(req: Request) {',
      '  when (req.kind?.let { mapKind(it) }) {',
      '    DFP -> handleDfp()',
      '    else -> handleOther()',
      '  }',
      '}',
      '',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('mention seulement en commentaire ou dans une string : flaguée quand même', () => {
    const text = 'fun f() {\n  val ghost = 1\n  // ghost matters\n  println("ghost")\n}\n';
    expect(names(text)).toEqual(['ghost']);
  });

  it('accolades déséquilibrées ou fichier tronqué : [] sans throw', () => {
    expect(() => findUnusedLocals('fun f() {\n  val x = 1\n')).not.toThrow();
    expect(findUnusedLocals('fun f() {\n  val x = 1\n')).toEqual([]);
    expect(findUnusedLocals('')).toEqual([]);
  });

  it('nom contenant le mot-clé (val validated) : offsets corrects', () => {
    const text = 'fun f() {\n  val validated = 1\n  println(2)\n}\n';
    const found = findUnusedLocals(text)[0];
    expect(found.name).toBe('validated');
    expect(text.split('\n')[found.line].slice(found.character, found.character + 9)).toBe('validated');
  });

  it('type fonctionnel { cb: (Int) -> Unit -> } : ignoré (faux négatif assumé)', () => {
    const text = 'fun f() {\n  register { cb: (Int) -> Unit ->\n    println(1)\n  }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('isPureInitializer : littéraux et factories oui, appels et propriétés non', () => {
    for (const pure of ['5', '"abc"', 'true', 'null', '1 + 2', 'listOf(1, 2)', 'emptyList()', 'other']) {
      expect(isPureInitializer(pure), `« ${pure} » devrait être pur`).toBe(true);
    }
    for (const impure of ['compute()', 'reg.snapshot', 'listOf(compute())', 'obj.method()', 'x::y', 'run { 1 }']) {
      expect(isPureInitializer(impure), `« ${impure} » ne doit pas être pur`).toBe(false);
    }
  });

  it('BUG-HUNT-Q : companion object précédé d’une fun abstraite reste un membre', () => {
    const text = [
      'abstract class Db {',
      '    abstract fun dao(): Dao',
      '',
      '    companion object {',
      '        @JvmField',
      '        val MIGRATION_1_2 = Migration1To2()',
      '    }',
      '}',
      '',
    ].join('\n');
    expect(names(text)).toEqual([]);
    // objet anonyme en corps-expression : membre lui aussi
    const anon = 'class C {\n  fun make() = object : Runnable {\n    val cached = 1\n    override fun run() = Unit\n  }\n}\n';
    expect(names(anon)).toEqual([]);
    // une vraie locale dans une vraie fun reste détectée
    const stillWorks = 'abstract class Db {\n  abstract fun dao(): Dao\n  fun t() {\n    val dead = 1\n    println(2)\n  }\n}\n';
    expect(names(stillWorks)).toEqual(['dead']);
  });

  it('BUG-HUNT-R : @get: dans un constructeur ne transforme pas le corps de classe en accesseur', () => {
    const text = [
      'open class M constructor(',
      '    open val url: String,',
      '    @get:VisibleForTesting(otherwise = NONE)',
      '    val map: Map<String, Int>? = emptyMap(),',
      ') {',
      '',
      '    var bundleId: String? = null',
      '',
      '    fun get(k: String) = map?.get(k)',
      '}',
      '',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('BUG-HUNT-P : initialiseur multi-lignes, l’usage juste après reste visible', () => {
    const ctor = 'fun t() {\n  val vm = Vm(\n    a = 1,\n    b = 2\n  )\n  println(vm)\n}\n';
    expect(names(ctor)).toEqual([]);
    const apply = 'fun draw(w: Float) {\n  val paint = Paint().apply {\n    isAntiAlias = true\n  }\n  drawRect(w, paint)\n}\n';
    expect(names(apply)).toEqual([]);
    const deep = 'fun t() {\n  val v = build(\n    listOf(\n      1,\n      2\n    )\n  )\n  println(v)\n}\n';
    expect(names(deep)).toEqual([]);
    // et le mort multi-lignes reste bien détecté
    const dead = 'fun t() {\n  val vm = Vm(\n    a = 1\n  )\n  println(2)\n}\n';
    expect(names(dead)).toEqual(['vm']);
  });

  it('BUG-HUNT-M : ++ et -- mutent une autre variable, jamais de suppression de ligne', () => {
    for (const mutating of ['a++', '++a', 'a--', '--a', 'a++ + 1']) {
      expect(isPureInitializer(mutating), `« ${mutating} » ne doit pas être pur`).toBe(false);
    }
    const text = 'fun f() {\n  var a = 1\n  val g = a++\n  println(a)\n}\n';
    const found = findUnusedLocals(text).find(u => u.name === 'g');
    expect(found?.fix).toBe('keepCall');
    // l'incrément survit à l'édition
    const out = text.slice(0, found!.fixStart) + found!.fixText + text.slice(found!.fixEnd);
    expect(out).toContain('a++');
  });

  it('gros fichier : 300 fonctions < 300 ms', () => {
    const text = Array.from({ length: 300 }, (_, i) =>
      `fun f${i}(rows: List<Int>) {\n  val dead${i} = ${i}\n  rows.forEachIndexed { idx${i}, row -> println(row) }\n  try { s() } catch (e${i}: Exception) { g() }\n}`,
    ).join('\n');
    const start = performance.now();
    expect(findUnusedLocals(text)).toHaveLength(900);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
