import { describe, it, expect } from 'vitest';
import { findWriteOnlyVariables } from '../../../src/providers/WriteOnlyProvider';
import { findUnusedLocals } from '../../../src/providers/UnusedLocalProvider';

/** KJ-028 — tentatives de casse de la CLASSIFICATION lecture/écriture. */

const names = (text: string) => findWriteOnlyVariables(text).map(v => v.name);

describe('KJ-028 adversarial — classification', () => {
  it('x++ seul est une écriture, y = x++ et f(x++) sont des lectures', () => {
    expect(names('fun f() {\n  var n = 0\n  n++\n  println(1)\n}\n')).toEqual(['n']);
    expect(names('fun f() {\n  var n = 0\n  val y = n++\n  println(y)\n}\n')).toEqual([]);
    expect(names('fun f() {\n  var n = 0\n  g(n++)\n}\n')).toEqual([]);
  });

  it('préfixe ++x seul est une écriture, dans une expression c’est une lecture', () => {
    expect(names('fun f() {\n  var n = 0\n  ++n\n  println(1)\n}\n')).toEqual(['n']);
    expect(names('fun f() {\n  var n = 0\n  g(++n)\n}\n')).toEqual([]);
  });

  it('accumulation en += sans jamais lire : write-only', () => {
    expect(names('fun f(l: List<Int>) {\n  var t = 0\n  for (x in l) { t += x }\n}\n')).toEqual(['t']);
    expect(names('fun f(l: List<Int>) {\n  var t = 0\n  for (x in l) { t += x }\n  println(t)\n}\n')).toEqual([]);
  });

  it('x.field = 1 et x[0] = 1 sont des lectures de x', () => {
    expect(names('fun f(o: O) {\n  var b = o\n  b.field = 1\n}\n')).toEqual([]);
    expect(names('fun f(a: IntArray) {\n  var b = a\n  b[0] = 1\n}\n')).toEqual([]);
  });

  it('usage dans un template "$x" ou "${x}" est une lecture', () => {
    expect(names('fun f() {\n  var n = 0\n  n = 1\n  println("v: $n")\n}\n')).toEqual([]);
    expect(names('fun f() {\n  var n = 0\n  n = 1\n  println("v: ${n + 1}")\n}\n')).toEqual([]);
  });

  it('comparaisons == >= != sont des lectures', () => {
    for (const op of ['==', '>=', '!=', '<=']) {
      const text = `fun f() {\n  var n = 0\n  n = 1\n  if (n ${op} 1) println(2)\n}\n`;
      expect(names(text), `« ${op} » doit être une lecture`).toEqual([]);
    }
  });

  it('this.x est une écriture, other.x ne l’est pas', () => {
    expect(names('class C {\n  private var n = 0\n  fun a() { this.n = 1 }\n}\n')).toEqual(['n']);
    expect(names('class C {\n  private var n = 0\n  fun a(o: C) { o.n = 1 }\n}\n')).toEqual([]);
  });

  it('écriture dans un apply/run/with : receveur possible, donc lecture', () => {
    expect(names('fun f(o: O) {\n  var count = 0\n  o.apply { count = 1 }\n}\n')).toEqual([]);
    expect(names('fun f(o: O) {\n  var count = 0\n  with(o) { count = 1 }\n}\n')).toEqual([]);
    // let/also lient `it`, pas un receveur : l’écriture reste la nôtre
    expect(names('fun f(o: O) {\n  var count = 0\n  o.let { count = 1 }\n}\n')).toEqual(['count']);
  });

  it('argument nommé sur sa propre ligne n’est pas une écriture', () => {
    const text = 'fun f() {\n  var x = 0\n  x = 1\n  build(\n    x = 2\n  )\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('écriture dans une lambda et lecture dehors, et l’inverse', () => {
    expect(names('fun f(l: List<Int>) {\n  var n = 0\n  l.forEach { n = it }\n  println(n)\n}\n')).toEqual([]);
    expect(names('fun f(l: List<Int>) {\n  var n = 0\n  n = 1\n  l.forEach { println(n) }\n}\n')).toEqual([]);
  });

  it('DISJONCTION avec KJ-027 : une var jamais rementionnée appartient à KJ-027', () => {
    const text = 'fun f() {\n  var n = 0\n  println(1)\n}\n';
    expect(names(text)).toEqual([]);
    expect(findUnusedLocals(text).map(u => u.name)).toEqual(['n']);
    // et l’inverse : une var écrite appartient à KJ-028 seulement
    const written = 'fun f() {\n  var n = 0\n  n = 1\n  println(2)\n}\n';
    expect(names(written)).toEqual(['n']);
    expect(findUnusedLocals(written).map(u => u.name)).toEqual([]);
  });

  it('shadowing : deux déclarations du même nom, jamais flagué', () => {
    const text = 'fun f() {\n  var n = 0\n  n = 1\n  run { var n = 2; n = 3 }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('lateinit var jamais flagué', () => {
    expect(names('class C {\n  private lateinit var s: String\n  fun a() { s = "x" }\n}\n')).toEqual([]);
  });

  it('var déléguée jamais flaguée (l’écriture est l’effet recherché)', () => {
    const text = 'class C {\n  private var n by Delegates.observable(0) { _, _, _ -> }\n  fun a() { n = 1 }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('@Volatile et autres annotations protègent la déclaration', () => {
    expect(names('class C {\n  @Volatile\n  private var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
    expect(names('class C {\n  @JvmField\n  private var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
  });

  it('classe Serializable : jamais flaguée ; la même sans le supertype l’est', () => {
    const ser = 'class S : Serializable {\n  private var v = 0\n  fun a() { v = 1 }\n}\n';
    expect(names(ser)).toEqual([]);
    const plain = 'class S {\n  private var v = 0\n  fun a() { v = 1 }\n}\n';
    expect(names(plain)).toEqual(['v']);
  });

  it('membre non privé jamais flagué', () => {
    expect(names('class C {\n  var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
    expect(names('class C {\n  internal var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
  });

  it('membre avec setter custom jamais flagué', () => {
    const text = 'class C {\n  private var n = 0\n    set(value) { field = value * 2 }\n  fun a() { n = 1 }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('override et abstract jamais flagués', () => {
    expect(names('class C : B() {\n  private override var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
  });

  it('@Suppress local et fichier', () => {
    expect(names('class C {\n  @Suppress("unused")\n  private var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
    expect(names('@file:Suppress("unused")\nclass C {\n  private var n = 0\n  fun a() { n = 1 }\n}\n')).toEqual([]);
  });

  it('écriture dans une branche when et lecture dans une autre : vivante', () => {
    const text = 'fun f(k: Int) {\n  var n = 0\n  when (k) {\n    1 -> n = 1\n    else -> println(n)\n  }\n}\n';
    expect(names(text)).toEqual([]);
  });

  it('x = x + 1 est une lecture (faux négatif assumé)', () => {
    expect(names('fun f() {\n  var n = 0\n  n = n + 1\n}\n')).toEqual([]);
  });

  it('nom préfixé _, backticks, accolades cassées', () => {
    expect(names('fun f() {\n  var _n = 0\n  _n = 1\n}\n')).toEqual([]);
    expect(() => findWriteOnlyVariables('fun f() {\n  var n = 0\n  n = 1\n')).not.toThrow();
    expect(findWriteOnlyVariables('')).toEqual([]);
    expect(findWriteOnlyVariables('val x = 1')).toEqual([]);
  });

  it('total vs totalCount ne se confondent jamais', () => {
    const text = 'fun f() {\n  var total = 0\n  var totalCount = 0\n  total = 1\n  totalCount = 2\n  println(totalCount)\n}\n';
    expect(names(text)).toEqual(['total']);
  });

  it('une méthode nommée comme une scope function n’est pas une scope function', () => {
    // `fun run() {` déclare une méthode : `this` n'est pas relié. Confondre les
    // deux rendait le détecteur muet dans tout Runnable.run().
    expect(names('class T {\n  fun run() {\n    var n = 0\n    n = 1\n    println(2)\n  }\n}\n')).toEqual(['n']);
    expect(names('class T {\n  fun apply() {\n    var n = 0\n    n = 1\n    println(2)\n  }\n}\n')).toEqual(['n']);
    expect(names('class T {\n  override fun run() {\n    var n = 0\n    n = 1\n    println(2)\n  }\n}\n')).toEqual(['n']);
  });

  it('mais un vrai run { } garde le silence', () => {
    expect(names('fun f() {\n  var n = 0\n  thing.run {\n    n = 1\n  }\n  println(2)\n}\n')).toEqual([]);
    expect(names('fun f() {\n  var n = 0\n  thing.apply {\n    n = 1\n  }\n  println(2)\n}\n')).toEqual([]);
  });

  it('gros fichier : 300 classes < 300 ms', () => {
    const text = Array.from({ length: 300 }, (_, i) =>
      `class C${i} {\n  private var flag${i} = false\n  fun a() { flag${i} = true }\n  fun b() { flag${i} = false }\n}`,
    ).join('\n');
    const start = performance.now();
    expect(findWriteOnlyVariables(text)).toHaveLength(300);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
