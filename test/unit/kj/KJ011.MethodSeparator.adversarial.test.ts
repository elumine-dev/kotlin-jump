import { describe, it, expect } from 'vitest';
import { computeSeparatorLines } from '../../../src/providers/MethodSeparatorProvider';

/** KJ-011 — tentatives de casse au-delà du contrat. */

describe('KJ-011 adversarial', () => {
  it('fonctions top-level SANS classe : aucun filet', () => {
    const text = 'fun a() {}\n\nfun b() {}\n\nfun c() {}\n';
    expect(computeSeparatorLines(text)).toEqual([]);
  });

  it('membres INTERNES du companion pas séparés (seul le companion l’est)', () => {
    const text = [
      'class C {',
      '    fun first() {}',
      '',
      '    companion object {',
      '        fun inside1() {}',
      '        fun inside2() {}',
      '    }',
      '}',
    ].join('\n');
    const seps = computeSeparatorLines(text);
    expect(seps).toContain(3);   // le companion
    expect(seps).not.toContain(4);
    expect(seps).not.toContain(5);
  });

  it('membres d’interface (sans corps) séparés', () => {
    const text = [
      'interface Repo {',
      '    fun load(): String',
      '    fun save(v: String)',
      '}',
    ].join('\n');
    expect(computeSeparatorLines(text)).toEqual([2]);
  });

  it('membre annoté : filet AU-DESSUS de l’annotation (spec Kevin 2026-07-25)', () => {
    const text = [
      'class C {',
      '    fun a() {}',
      '',
      '    @Deprecated("x")',
      '    fun b() {}',
      '}',
    ].join('\n');
    expect(computeSeparatorLines(text)).toEqual([3]);
  });

  it('bloc commentaire + annotation empilés : filet au sommet du bloc', () => {
    const text = [
      'class C {',
      '    fun a() {}',
      '    // doc de b',
      '    // suite',
      '    @Deprecated("x")',
      '    fun b() {}',
      '}',
    ].join('\n');
    expect(computeSeparatorLines(text)).toEqual([2]);
  });

  it('accolades équilibrées sur une ligne (fun c() = run { x })', () => {
    const text = [
      'class C {',
      '    fun a() = run { 1 }',
      '    fun b() = run { 2 }',
      '}',
    ].join('\n');
    expect(computeSeparatorLines(text)).toEqual([2]);
  });

  it('fichier vide / sans accolades : pas de crash', () => {
    expect(computeSeparatorLines('')).toEqual([]);
    expect(computeSeparatorLines('val x = 1')).toEqual([]);
  });
});
