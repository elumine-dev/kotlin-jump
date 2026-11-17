import { describe, it, expect } from 'vitest';
import { findWriteOnlyVariables } from '../../../src/providers/writeOnlyVariables';
import { findUnusedLocals } from '../../../src/providers/unusedLocals';

/**
 * KJ-027 / KJ-028 : un `@Suppress` ne fait taire que ce qu il nomme.
 *
 * Sur la reference, `@Suppress("TooManyFunctions")` sur un Fragment et
 * `@SuppressLint("CheckResult")` sur un service eteignaient les deux
 * detecteurs pour la classe entiere : deux champs jamais lus y dormaient.
 */

const writeOnly = (text: string) => findWriteOnlyVariables(text).map(v => v.name);
const locals = (text: string) => findUnusedLocals(text).map(v => v.name);

const member = (annotation: string) =>
  `${annotation}\nclass Screen {\n  private var stored: Any? = null\n  fun keep(c: Any) {\n    stored = c\n  }\n}\n`;
const local = (annotation: string) =>
  `${annotation}\nclass Screen {\n  fun draw() {\n    val dead = 1\n    println(2)\n  }\n}\n`;

describe('un @Suppress sans rapport ne couvre ni les champs ecrits seuls ni les locales mortes', () => {
  for (const annotation of [
    '@Suppress("TooManyFunctions")',
    '@SuppressLint("CheckResult")',
    '@Suppress("LongMethod", "ComplexCondition")',
    '@SuppressWarnings("deprecation")',
    // `unused` suivi d une lettre est un autre diagnostic.
    '@Suppress("UnusedResources")',
    '@Suppress',
  ]) {
    it(`${annotation} sur la classe`, () => {
      expect(writeOnly(member(annotation))).toEqual(['stored']);
      expect(locals(local(annotation))).toEqual(['dead']);
    });
  }

  it('sur la fonction qui porte la locale', () => {
    expect(locals('class S {\n  @Suppress("LongMethod")\n  fun draw() {\n    val dead = 1\n    println(2)\n  }\n}\n')).toEqual(['dead']);
    expect(writeOnly('class S {\n  @Suppress("LongMethod")\n  fun draw() {\n    var n = 0\n    n = 1\n  }\n}\n')).toEqual(['n']);
  });
});

describe('un @Suppress qui nomme le diagnostic couvre toujours sa declaration', () => {
  for (const annotation of [
    '@Suppress("unused")',
    '@Suppress("UNUSED_VARIABLE")',
    '@Suppress("TooManyFunctions", "unused")',
    '@SuppressWarnings("all")',
    '@Suppress(\n  "unused",\n)',
  ]) {
    it(`${annotation.replace(/\s+/g, ' ')} sur la classe`, () => {
      expect(writeOnly(member(annotation))).toEqual([]);
      expect(locals(local(annotation))).toEqual([]);
    });
  }

  it('le silence s arrete a la declaration annotee', () => {
    const text = 'class S {\n  @Suppress("unused")\n  fun a() {\n    val kept = 1\n    println(2)\n  }\n  fun b() {\n    val dead = 1\n    println(2)\n  }\n}\n';
    expect(locals(text)).toEqual(['dead']);
  });
});
