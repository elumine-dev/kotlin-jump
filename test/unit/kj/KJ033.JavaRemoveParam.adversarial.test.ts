import { describe, it, expect } from 'vitest';
import { computeCallSiteEdits } from '../../../src/providers/UnusedParameterProvider';

/**
 * KJ-033 — les call sites Java d'un constructeur Kotlin.
 *
 * Le scan inter-fichiers ne lisait que les `.kt`, donc l'extension pouvait
 * proposer de supprimer un paramètre qu'un `new Owner(a, b)` passait encore.
 * Élargir le glob ne suffisait pas : chaque garde de `computeCallSiteEdits`
 * avait été écrite contre la syntaxe Kotlin, et deux d'entre elles cassaient
 * le build en silence sur du Java.
 *
 * Règle : dans le doute, on abandonne le fichier entier. Une suppression
 * partielle est pire que pas de suppression.
 */

const PARAM = { name: 'unusedFlag', paramIndex: 1, ownerName: 'Owner', kind: 'ctorParam' as const };
const java = (text: string) => computeCallSiteEdits(text, PARAM, 'java');
const kotlin = (text: string) => computeCallSiteEdits(text, PARAM);

describe('ce que la branche Java sait éditer', () => {
  it('un new Owner(a, b) est positionnel, donc éditable', () => {
    const res = java([
      'package com.b;',
      'public class Caller {',
      '    Owner make() { return new Owner(first, second); }',
      '}',
    ].join('\n'));
    expect(res.edits).toHaveLength(1);
    expect(res.skipped).toBe(0);
  });

  it('une sous-classe anonyme reste éditable', () => {
    const res = java([
      'public class Caller {',
      '    Owner make() { return new Owner(a, b) { void extra() {} }; }',
      '}',
    ].join('\n'));
    expect(res.edits).toHaveLength(1);
  });

  it('un fichier Java sans mention ne produit rien', () => {
    expect(java('public class Other { void run() {} }').edits).toEqual([]);
  });
});

describe('ce que la branche Java refuse de toucher', () => {
  it('une référence de constructeur Owner::new', () => {
    // supprimer un paramètre change l'interface fonctionnelle satisfaite
    const res = java([
      'import java.util.function.Supplier;',
      'public class Caller {',
      '    Supplier<Owner> s = Owner::new;',
      '    Owner other = new Owner(a, b);',
      '}',
    ].join('\n'));
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it('une sous-classe : le super(a, b) est hors de portée', () => {
    // le pire cas, et il était muet : le paramètre partait, super() en
    // passait toujours deux
    const res = java([
      'public class Sub extends Owner {',
      '    Sub() { super(a, b); }',
      '}',
    ].join('\n'));
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it('un homonyme déclaré dans le fichier, y compris record et @interface', () => {
    for (const decl of [
      'class Owner {}',
      'interface Owner {}',
      'enum Owner { A }',
      'record Owner(int x) {}',
      '@interface Owner {}',
    ]) {
      const res = java(`public class Holder {\n    ${decl}\n    Object o = new Owner(a, b);\n}`);
      expect(res.edits, decl).toEqual([]);
      expect(res.skipped, decl).toBe(1);
    }
  });
});

describe('le chemin Kotlin est inchangé', () => {
  it('le défaut reste kotlin, donc les gardes Java ne s’appliquent pas', () => {
    // `extends Owner` n'existe pas en Kotlin : ce texte ne doit pas déclencher
    // la garde Java quand la langue n'est pas précisée
    const res = kotlin([
      'class Caller {',
      '    val o = Owner(first, second)',
      '}',
    ].join('\n'));
    expect(res.edits).toHaveLength(1);
  });

  it('la garde Kotlin des références :: fonctionne toujours', () => {
    const res = kotlin('class Caller {\n    val f = ::Owner\n    val o = Owner(a, b)\n}');
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(1);
  });
});
