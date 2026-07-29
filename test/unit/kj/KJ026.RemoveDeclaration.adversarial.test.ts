import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/UnusedDeclarationProvider';

/** KJ-026 — extents de suppression : application réelle sur le texte. */

function removeFirst(text: string, name: string): string {
  const dead = findUnusedDeclarations(text).find(u => u.name === name);
  if (!dead) throw new Error(`« ${name} » non flaggé`);
  if (dead.removeStart === -1) throw new Error(`« ${name} » sans removal extent`);
  return text.slice(0, dead.removeStart) + text.slice(dead.removeEnd);
}

describe('KJ-026 adversarial — removal extents', () => {
  it('fun corps-expression une ligne : la ligne part, les voisines restent', () => {
    const text = 'class A {\n  val keep1 = 1\n  private fun gone() = 2\n  val keep2 = 3\n}\n';
    const out = removeFirst(text, 'gone');
    expect(out).toBe('class A {\n  val keep1 = 1\n  val keep2 = 3\n}\n');
  });

  it('fun bloc avec KDoc et annotation au-dessus : tout part', () => {
    const text = [
      'class A {',
      '  /**',
      '   * Legacy path.',
      '   */',
      '  @Composable',
      '  private fun gone(): Int {',
      '    return 1',
      '  }',
      '  fun keep() = 2',
      '}',
      '',
    ].join('\n');
    const out = removeFirst(text, 'gone');
    expect(out).not.toContain('Legacy path');
    expect(out).not.toContain('@Composable');
    expect(out).not.toContain('return 1');
    expect(out).toContain('fun keep() = 2');
  });

  it('val by lazy multi-lignes : le bloc entier part', () => {
    const text = 'class A {\n  private val gone by lazy {\n    heavyInit()\n  }\n  fun keep() = 1\n}\n';
    const out = removeFirst(text, 'gone');
    expect(out).not.toContain('heavyInit');
    expect(out).toContain('fun keep() = 1');
  });

  it('val avec accesseur get() = sur la ligne suivante : les deux lignes partent', () => {
    const text = 'class A {\n  private val gone: Int\n    get() = 42\n  fun keep() = 1\n}\n';
    const out = removeFirst(text, 'gone');
    expect(out).not.toContain('get() = 42');
    expect(out).toContain('fun keep() = 1');
  });

  it('dernière déclaration du fichier sans newline final : extent propre', () => {
    const text = 'fun main() { println(1) }\nprivate fun gone() = 2';
    const out = removeFirst(text, 'gone');
    expect(out).toBe('fun main() { println(1) }\n');
  });

  it('classe morte : le corps entier part, la suivante reste', () => {
    const text = 'private class Gone {\n  fun a() = 1\n  fun b() = 2\n}\nclass Keep {\n  fun c() = 3\n}\n';
    const out = removeFirst(text, 'Gone');
    expect(out).toBe('class Keep {\n  fun c() = 3\n}\n');
  });

  it('val initialisé par une string : quick fix disponible (jugement sur le texte brut)', () => {
    const text = 'class A {\n  private val gone = "done"\n  fun keep() = 1\n}\n';
    expect(removeFirst(text, 'gone')).toBe('class A {\n  fun keep() = 1\n}\n');
  });

  it('const val avec string : quick fix disponible aussi', () => {
    const text = 'private const val GONE = "x@y.com"\nfun main() { println(1) }\n';
    expect(removeFirst(text, 'GONE')).toBe('fun main() { println(1) }\n');
  });

  it('corps-expression multi-lignes SANS accolades : removeStart = -1, diagnostic gardé', () => {
    const text = 'class A {\n  private fun gone() = 1 +\n    2 +\n    3\n  fun keep() = 4\n}\n';
    const dead = findUnusedDeclarations(text).find(u => u.name === 'gone');
    expect(dead).toBeDefined();
    expect(dead!.removeStart).toBe(-1);
  });

  it('membre indenté vs top-level : indentation respectée, pas de ligne vide résiduelle double', () => {
    const member = 'class A {\n  private val gone = 1\n  fun keep() = 2\n}\n';
    expect(removeFirst(member, 'gone')).toBe('class A {\n  fun keep() = 2\n}\n');
    const topLevel = 'private val gone = 1\nfun main() { println(2) }\n';
    expect(removeFirst(topLevel, 'gone')).toBe('fun main() { println(2) }\n');
  });
});
