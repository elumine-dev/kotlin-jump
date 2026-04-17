/**
 * Sprint 2 — Tests parser pour isConst, constValue, isAbstract (fun + val/var).
 *
 * Attack surface:
 *  1. extractConstValue — délimiteur après RE_PROP, strip du commentaire, troncature 80
 *  2. isConst — ne doit être true que sur `const val`, pas `val` simple
 *  3. isAbstract — fun abstract, val abstract dans interface
 *  4. Type annotation avant `=` — `const val X: Int = 5000`
 *
 * Tests nommés SP2-PARSE-* pour faciliter le grep.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

function syms(code: string) {
  return parse('file:///sprint2.kt', code).symbols;
}

function find(code: string, name: string) {
  return syms(code).find(s => s.name === name);
}

// ── SP2-PARSE-1..5 : constValue extraction ────────────────────────────────────

describe('SP2-PARSE — constValue extraction', () => {
  it('SP2-PARSE-1: const val entier simple', () => {
    const s = find('const val TIMEOUT = 5000', 'TIMEOUT');
    expect(s!.isConst).toBe(true);
    expect(s!.constValue).toBe('5000');
  });

  it('SP2-PARSE-2: const val avec type annoté', () => {
    const s = find('const val TAG: String = "demo"', 'TAG');
    expect(s!.isConst).toBe(true);
    expect(s!.constValue).toBe('"demo"');
  });

  it('SP2-PARSE-3: constValue — commentaire trailing strippé', () => {
    const s = find('const val X = 5000 // milliseconds', 'X');
    expect(s!.constValue).toBe('5000');
  });

  it('SP2-PARSE-4: val sans const — isConst=undefined, constValue=undefined', () => {
    const s = find('val TIMEOUT = 5000', 'TIMEOUT');
    expect(s!.isConst).toBeUndefined();
    expect(s!.constValue).toBeUndefined();
  });

  it('SP2-PARSE-5: const val float', () => {
    const s = find('const val RATE = 0.255f', 'RATE');
    expect(s!.isConst).toBe(true);
    expect(s!.constValue).toBe('0.255f');
  });

  it('SP2-PARSE-5b: const val string avec guillemets doubles', () => {
    const s = find('const val API_URL = "https://api.example.com"', 'API_URL');
    expect(s!.constValue).toBe('"https://api.example.com"');
  });

  it('SP2-PARSE-5c: const val boolean', () => {
    const s = find('const val ENABLED = true', 'ENABLED');
    expect(s!.constValue).toBe('true');
  });

  it('SP2-PARSE-5d: const val Long', () => {
    const s = find('const val MAX_ID = 151L', 'MAX_ID');
    expect(s!.constValue).toBe('151L');
  });

  it('SP2-PARSE-9: const val dans companion object', () => {
    const code = `
class Config {
  companion object {
    const val TIMEOUT_MS = 3000
  }
}`;
    const s = find(code, 'TIMEOUT_MS');
    expect(s!.isConst).toBe(true);
    expect(s!.constValue).toBe('3000');
  });

  it('SP2-PARSE-10: constValue tronquée à 80 chars', () => {
    const longVal = '"' + 'a'.repeat(100) + '"';
    const s = find(`const val LONG_STR = ${longVal}`, 'LONG_STR');
    expect(s!.constValue!.length).toBeLessThanOrEqual(80);
  });

  it('SP2-PARSE-5e: const val avec type Int annoté et expression simple', () => {
    const s = find('const val COUNT: Int = 42', 'COUNT');
    expect(s!.isConst).toBe(true);
    expect(s!.constValue).toBe('42');
  });
});

// ── SP2-PARSE-6..8 : isAbstract sur fun ──────────────────────────────────────

describe('SP2-PARSE — isAbstract sur fun', () => {
  it('SP2-PARSE-6: abstract fun déclaration', () => {
    const s = find('abstract fun fetch(): List<String>', 'fetch');
    expect(s!.isAbstract).toBe(true);
    expect(s!.kind).toBe('fun');
  });

  it('SP2-PARSE-8: fun régulier — isAbstract=undefined', () => {
    const s = find('fun compute(): Int = 0', 'compute');
    expect(s!.isAbstract).toBeUndefined();
  });

  it('SP2-PARSE-6b: abstract suspend fun', () => {
    const s = find('abstract suspend fun loadData()', 'loadData');
    expect(s!.isAbstract).toBe(true);
    expect(s!.isSuspend).toBe(true);
  });

  it('SP2-PARSE-6c: abstract fun dans abstract class body', () => {
    const code = `abstract class Base {
  abstract fun doWork(): String
  fun helper() {}
}`;
    const doWork = find(code, 'doWork');
    const helper = find(code, 'helper');
    expect(doWork!.isAbstract).toBe(true);
    expect(helper!.isAbstract).toBeUndefined();
  });
});

// ── SP2-PARSE-7 : isAbstract sur val/var (interface properties) ───────────────

describe('SP2-PARSE — isAbstract sur val/var', () => {
  it('SP2-PARSE-7: abstract val dans interface', () => {
    const code = `interface Repo {
  val size: Int
}`;
    const s = find(code, 'size');
    expect(s!.isAbstract).toBe(true);
    expect(s!.kind).toBe('val');
  });

  it('SP2-PARSE-7b: abstract var dans interface', () => {
    const code = `interface Config {
  var timeout: Int
}`;
    const s = find(code, 'timeout');
    expect(s!.isAbstract).toBe(true);
    expect(s!.kind).toBe('var');
  });

  it('SP2-PARSE-7c: val dans class body — pas abstract', () => {
    const code = `class MyClass {
  val name: String = "test"
}`;
    const s = find(code, 'name');
    expect(s!.isAbstract).toBeUndefined();
  });

  it('SP2-PARSE-7d: abstract val explicitement annoté', () => {
    const code = `abstract class Base {
  abstract val count: Int
}`;
    const s = find(code, 'count');
    expect(s!.isAbstract).toBe(true);
  });
});

// ── isSuspend — tests de non-régression Sprint 2 ─────────────────────────────

describe('SP2-PARSE — isSuspend non-régression', () => {
  it('suspend fun top-level', () => {
    const s = find('suspend fun fetchData(): String = ""', 'fetchData');
    expect(s!.isSuspend).toBe(true);
  });

  it('override suspend fun combine isOverride + isSuspend', () => {
    const s = find('override suspend fun save()', 'save');
    expect(s!.isSuspend).toBe(true);
    expect(s!.isOverride).toBe(true);
  });

  it('fun normale — isSuspend=undefined', () => {
    const s = find('fun regular() {}', 'regular');
    expect(s!.isSuspend).toBeUndefined();
  });

  it('abstract suspend fun — isAbstract + isSuspend', () => {
    const s = find('abstract suspend fun process(input: String): String', 'process');
    expect(s!.isAbstract).toBe(true);
    expect(s!.isSuspend).toBe(true);
  });
});
