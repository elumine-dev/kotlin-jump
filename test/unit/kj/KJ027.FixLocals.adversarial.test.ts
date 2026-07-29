import { describe, it, expect } from 'vitest';
import { findUnusedLocals } from '../../../src/providers/UnusedLocalProvider';

/** KJ-027 — application réelle des éditions, comparaison de chaînes exactes. */

function apply(text: string, name: string): string {
  const u = findUnusedLocals(text).find(x => x.name === name);
  if (!u) throw new Error(`« ${name} » non flagué`);
  if (u.fix === 'none') throw new Error(`« ${name} » sans fix`);
  return text.slice(0, u.fixStart) + u.fixText + text.slice(u.fixEnd);
}

describe('KJ-027 adversarial — éditions', () => {
  it('littéral pur : la ligne entière part, les voisines intactes', () => {
    const text = 'fun f() {\n  val keep1 = 1\n  val dead = 5\n  println(keep1)\n}\n';
    expect(apply(text, 'dead')).toBe('fun f() {\n  val keep1 = 1\n  println(keep1)\n}\n');
  });

  it('factory pure listOf : la ligne part', () => {
    const text = 'fun f() {\n  val labels = listOf("a", "b")\n  println(1)\n}\n';
    expect(apply(text, 'labels')).toBe('fun f() {\n  println(1)\n}\n');
  });

  it('commentaire de fin de ligne emporté avec la ligne', () => {
    const text = 'fun f() {\n  val n = 5 // stale\n  println(1)\n}\n';
    expect(apply(text, 'n')).toBe('fun f() {\n  println(1)\n}\n');
  });

  it('initialiseur appel : seul « val r = » part, indentation conservée', () => {
    const text = 'fun f() {\n  val r = doSomething()\n  println(1)\n}\n';
    expect(apply(text, 'r')).toBe('fun f() {\n  doSomething()\n  println(1)\n}\n');
  });

  it('appel multi-lignes : le préfixe part, tous les arguments restent', () => {
    const text = [
      'fun f() {',
      '  val r = build(',
      '    first = 1,',
      '    second = 2,',
      '  )',
      '  println(1)',
      '}',
      '',
    ].join('\n');
    const out = apply(text, 'r');
    expect(out).toContain('  build(');
    expect(out).toContain('first = 1,');
    expect(out).toContain('second = 2,');
    expect(out).not.toContain('val r');
  });

  it('accès à une propriété : l’expression est conservée, jamais supprimée', () => {
    const text = 'fun f() {\n  val cached = registry.snapshot\n  println(1)\n}\n';
    expect(apply(text, 'cached')).toBe('fun f() {\n  registry.snapshot\n  println(1)\n}\n');
  });

  it('param de lambda : seul le nom devient _', () => {
    const text = 'fun f(rows: List<Int>) {\n  rows.forEachIndexed { index, row -> println(row) }\n}\n';
    expect(apply(text, 'index')).toContain('{ _, row -> println(row) }');
  });

  it('second param mort : le premier n’est pas touché', () => {
    const text = 'fun f(m: Map<String, Int>) {\n  m.forEach { key, value -> println(key) }\n}\n';
    expect(apply(text, 'value')).toContain('{ key, _ -> println(key) }');
  });

  it('binding catch : catch (_: Type)', () => {
    const text = 'fun f() {\n  try { s() } catch (e: IOException) { g() }\n}\n';
    expect(apply(text, 'e')).toContain('catch (_: IOException)');
  });

  it('by lazy : aucune édition proposée', () => {
    const text = 'fun f() {\n  val d by lazy { heavy() }\n  println(1)\n}\n';
    expect(() => apply(text, 'd')).toThrow(/sans fix/);
  });

  it('fichier sans newline final : édition propre quand même', () => {
    const text = 'fun f() {\n  println(1)\n  val dead = 5\n}';
    expect(apply(text, 'dead')).toBe('fun f() {\n  println(1)\n}');
  });

  it('une édition ne touche jamais la déclaration voisine du même nom-préfixe', () => {
    const text = 'fun f() {\n  val total = 1\n  val totalCount = 2\n  println(total)\n}\n';
    expect(apply(text, 'totalCount')).toBe('fun f() {\n  val total = 1\n  println(total)\n}\n');
  });
});
