import { describe, it, expect } from 'vitest';
import { findWriteOnlyVariables } from '../../../src/providers/WriteOnlyProvider';

/** KJ-028 — le fix multi-sites : application réelle, chaînes exactes. */

function apply(text: string, name: string): string {
  const v = findWriteOnlyVariables(text).find(x => x.name === name);
  if (!v) throw new Error(`« ${name} » non flagué`);
  if (v.edits.length === 0) throw new Error(`« ${name} » sans fix`);
  let out = text;
  for (const e of [...v.edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

describe('KJ-028 adversarial — éditions multi-sites', () => {
  it('membre avec deux écritures inline : les fun survivent', () => {
    const text = 'class C {\n  private var flag = false\n  fun a() { flag = true }\n  fun b() { flag = false }\n}\n';
    expect(apply(text, 'flag')).toBe('class C {\n  fun a() { }\n  fun b() { }\n}\n');
  });

  it('membre avec écritures sur leurs propres lignes', () => {
    const text = 'class C {\n  private var flag = false\n  fun a() {\n    flag = true\n    println(1)\n  }\n}\n';
    expect(apply(text, 'flag')).toBe('class C {\n  fun a() {\n    println(1)\n  }\n}\n');
  });

  it('locale littérale : déclaration et assignation disparaissent', () => {
    const text = 'fun f() {\n  var n = 0\n  n = 5\n  println(1)\n}\n';
    expect(apply(text, 'n')).toBe('fun f() {\n  println(1)\n}\n');
  });

  it('rhs impur : l’appel survit, l’indentation aussi', () => {
    const text = 'fun f() {\n  var n = 0\n  n = compute()\n  println(1)\n}\n';
    expect(apply(text, 'n')).toBe('fun f() {\n  compute()\n  println(1)\n}\n');
  });

  it('initialiseur impur sur une locale : l’appel survit', () => {
    const text = 'fun f() {\n  var n = compute()\n  n = 5\n  println(1)\n}\n';
    expect(apply(text, 'n')).toBe('fun f() {\n  compute()\n  println(1)\n}\n');
  });

  it('initialiseur impur sur un MEMBRE : aucun fix (expression nue illégale)', () => {
    const text = 'class C {\n  private var n = compute()\n  fun a() { n = 5 }\n}\n';
    const v = findWriteOnlyVariables(text).find(x => x.name === 'n');
    expect(v).toBeDefined();
    expect(v!.edits).toEqual([]);
  });

  it('x++ : la ligne entière part', () => {
    const text = 'fun f() {\n  var n = 0\n  n++\n  println(1)\n}\n';
    expect(apply(text, 'n')).toBe('fun f() {\n  println(1)\n}\n');
  });

  it('+= pur dans une boucle : la boucle reste, vidée', () => {
    const text = 'fun f(l: List<Int>) {\n  var t = 0\n  for (x in l) { t += x }\n}\n';
    expect(apply(text, 't')).toBe('fun f(l: List<Int>) {\n  for (x in l) { }\n}\n');
  });

  it('+= impur : l’appel survit', () => {
    const text = 'fun f() {\n  var t = 0\n  t += compute()\n}\n';
    expect(apply(text, 't')).toBe('fun f() {\n  compute()\n}\n');
  });

  it('rhs multi-lignes : tous les arguments préservés', () => {
    const text = 'fun f() {\n  var n = 0\n  n = build(\n    a = 1,\n    b = 2,\n  )\n  println(1)\n}\n';
    const out = apply(text, 'n');
    expect(out).toContain('build(');
    expect(out).toContain('a = 1,');
    expect(out).toContain('b = 2,');
    expect(out).not.toContain('var n');
    expect(out).not.toContain('n =');
  });

  it('deux instructions sur une ligne : aucun fix', () => {
    const text = 'fun f() {\n  var n = 0\n  n = 1; println(2)\n}\n';
    const v = findWriteOnlyVariables(text).find(x => x.name === 'n');
    expect(v).toBeDefined();
    expect(v!.edits).toEqual([]);
  });

  it('écriture en corps de branche -> : aucun fix', () => {
    const text = 'fun f(k: Int) {\n  var n = 0\n  when (k) {\n    1 -> n = 1\n    else -> n = 2\n  }\n}\n';
    const v = findWriteOnlyVariables(text).find(x => x.name === 'n');
    expect(v).toBeDefined();
    expect(v!.edits).toEqual([]);
  });

  it('trois écritures dans trois fonctions, le reste byte-identique', () => {
    const text = [
      'class C {',
      '  private var flag = false',
      '  fun a() {',
      '    flag = true',
      '    doA()',
      '  }',
      '  fun b() {',
      '    flag = false',
      '    doB()',
      '  }',
      '  fun c() {',
      '    flag = true',
      '  }',
      '}',
      '',
    ].join('\n');
    expect(apply(text, 'flag')).toBe([
      'class C {',
      '  fun a() {',
      '    doA()',
      '  }',
      '  fun b() {',
      '    doB()',
      '  }',
      '  fun c() {',
      '  }',
      '}',
      '',
    ].join('\n'));
  });

  it('fichier sans newline final', () => {
    const text = 'fun f() {\n  var n = 0\n  n = 1\n  println(2)\n}';
    expect(apply(text, 'n')).toBe('fun f() {\n  println(2)\n}');
  });

  it('total et totalCount ne se confondent pas dans les éditions', () => {
    const text = 'fun f() {\n  var total = 0\n  var totalCount = 0\n  total = 1\n  totalCount = 2\n  println(totalCount)\n}\n';
    expect(apply(text, 'total')).toBe('fun f() {\n  var totalCount = 0\n  totalCount = 2\n  println(totalCount)\n}\n');
  });
});
