/**
 * Tests adversaires pour extractReturnType()
 *
 * Couvre : types simples, nullables, génériques, types fonction, filtrage Unit/Nothing,
 * case-sensitivity, modificateurs, where clause, extensions, lambdas en params,
 * signatures multi-lignes, stripping du corps, context receivers, annotations.
 */

import { describe, it, expect } from 'vitest';
import { extractReturnType } from '../../src/util/SignatureReader';

// ── Groupe 1 : Types simples ──────────────────────────────────────────────────

describe('extractReturnType — types simples', () => {
  it('String', () => expect(extractReturnType('fun foo(): String')).toBe('String'));
  it('Int',    () => expect(extractReturnType('fun foo(): Int')).toBe('Int'));
  it('Boolean',() => expect(extractReturnType('fun foo(): Boolean')).toBe('Boolean'));
  it('Long',   () => expect(extractReturnType('fun foo(): Long')).toBe('Long'));
  it('type custom', () => expect(extractReturnType('fun foo(): User')).toBe('User'));
});

// ── Groupe 2 : Types nullables ────────────────────────────────────────────────

describe('extractReturnType — types nullables', () => {
  it('String?', () => expect(extractReturnType('fun foo(): String?')).toBe('String?'));
  it('List<String>?', () => expect(extractReturnType('fun foo(): List<String>?')).toBe('List<String>?'));

  // Le `?` ne doit pas être mangé par la regex `[{=]` ni `where`
  it('Map<String, Int>?', () => expect(extractReturnType('fun foo(): Map<String, Int>?')).toBe('Map<String, Int>?'));
});

// ── Groupe 3 : Types génériques ───────────────────────────────────────────────

describe('extractReturnType — types génériques', () => {
  it('List<User>', () => expect(extractReturnType('fun foo(): List<User>')).toBe('List<User>'));
  it('Map<String, Int>', () => expect(extractReturnType('fun foo(): Map<String, Int>')).toBe('Map<String, Int>'));
  it('Map<String, List<Int>>', () => expect(extractReturnType('fun foo(): Map<String, List<Int>>')).toBe('Map<String, List<Int>>'));
  it('Pair<String, Boolean>', () => expect(extractReturnType('fun foo(): Pair<String, Boolean>')).toBe('Pair<String, Boolean>'));

  // `>` final ne doit pas déclencher le stripping `[{=]`
  it('Set<Pair<String, Int>>', () => expect(extractReturnType('fun foo(): Set<Pair<String, Int>>')).toBe('Set<Pair<String, Int>>'));
});

// ── Groupe 4 : Types fonction comme type de retour ────────────────────────────

describe('extractReturnType — types fonction (lambda)', () => {
  // `() -> Unit` comme type de retour ≠ `Unit` lui-même
  it('() -> Unit retourne la string, pas null', () =>
    expect(extractReturnType('fun foo(): () -> Unit')).toBe('() -> Unit'));

  it('(Int) -> Boolean', () =>
    expect(extractReturnType('fun foo(): (Int) -> Boolean')).toBe('(Int) -> Boolean'));

  it('(String, Int) -> String', () =>
    expect(extractReturnType('fun foo(): (String, Int) -> String')).toBe('(String, Int) -> String'));

  it('(Int) -> (String) -> Boolean', () =>
    expect(extractReturnType('fun foo(): (Int) -> (String) -> Boolean')).toBe('(Int) -> (String) -> Boolean'));

  // La regex `[{=]` ne doit pas s'emballer sur `->` (contient ni `{` ni `=`)
  it('() -> Unit : anti-régression regex stripping', () =>
    expect(extractReturnType('fun bar(): () -> Unit')).not.toBeNull());
});

// ── Groupe 5 : Cas qui doivent retourner null ─────────────────────────────────

describe('extractReturnType — retour null attendu', () => {
  it('Unit explicite → null', () => expect(extractReturnType('fun foo(): Unit')).toBeNull());
  it('Nothing → null', () => expect(extractReturnType('fun foo(): Nothing')).toBeNull());
  it('pas de type de retour → null', () => expect(extractReturnType('fun foo()')).toBeNull());
  it('val (pas de fun) → null', () => expect(extractReturnType('val x: String')).toBeNull());
  it('var → null', () => expect(extractReturnType('var x: Int')).toBeNull());
  it('class → null', () => expect(extractReturnType('class Foo(val x: Int)')).toBeNull());
  it('typealias → null', () => expect(extractReturnType('typealias CB = () -> Unit')).toBeNull());
  it('signature vide → null', () => expect(extractReturnType('')).toBeNull());
});

// ── Groupe 6 : Filtrage case-sensitive ───────────────────────────────────────

describe('extractReturnType — filtrage case-sensitive', () => {
  // Le filtre est `=== 'Unit'` et `=== 'Nothing'` — pas startsWith ni includes

  it('unit minuscule → retourné (pas filtré)', () =>
    expect(extractReturnType('fun foo(): unit')).toBe('unit'));

  it('UNIT majuscule → retourné (pas filtré)', () =>
    expect(extractReturnType('fun foo(): UNIT')).toBe('UNIT'));

  it('UnitSystem → retourné (pas filtré)', () =>
    expect(extractReturnType('fun foo(): UnitSystem')).toBe('UnitSystem'));

  it('NothingSpecial → retourné (pas filtré)', () =>
    expect(extractReturnType('fun foo(): NothingSpecial')).toBe('NothingSpecial'));

  it('Nothing? nullable → retourné (Nothing? ≠ Nothing exact)', () =>
    expect(extractReturnType('fun foo(): Nothing?')).toBe('Nothing?'));
});

// ── Groupe 7 : Fonctions avec modificateurs ───────────────────────────────────

describe('extractReturnType — modificateurs de fonction', () => {
  it('suspend fun → Flow<String>', () =>
    expect(extractReturnType('suspend fun foo(): Flow<String>')).toBe('Flow<String>'));

  it('private suspend fun', () =>
    expect(extractReturnType('private suspend fun foo(): Deferred<Int>')).toBe('Deferred<Int>'));

  it('override fun', () =>
    expect(extractReturnType('override fun toString(): String')).toBe('String'));

  it('operator fun', () =>
    expect(extractReturnType('operator fun compareTo(other: Foo): Int')).toBe('Int'));

  it('infix fun', () =>
    expect(extractReturnType('infix fun Int.plus(other: Int): Int')).toBe('Int'));

  // Bug candidat : `fun` en PRÉFIXE d'un nom de fonction — `\bfun\b` doit matcher le keyword uniquement
  it('fun funky() — `fun` en préfixe du nom → Int', () =>
    expect(extractReturnType('fun funky(): Int')).toBe('Int'));
});

// ── Groupe 8 : Fonctions génériques + where ───────────────────────────────────

describe('extractReturnType — génériques et where clause', () => {
  it('<T> identity', () => expect(extractReturnType('fun <T> identity(x: T): T')).toBe('T'));

  it('<T : Comparable<T>> max', () =>
    expect(extractReturnType('fun <T : Comparable<T>> max(a: T, b: T): T')).toBe('T'));

  it('where clause strippée', () =>
    expect(extractReturnType('fun <T> foo(): T where T : Comparable<T>, T : Serializable')).toBe('T'));

  it('inline reified', () =>
    expect(extractReturnType('inline fun <reified T> parse(): T')).toBe('T'));

  // Bug candidat : `Nowhere` contient `where` mais pas en mot-clé → ne doit pas être strippé
  it('Nowhere — `where` dans un nom de type → retourné intact', () =>
    expect(extractReturnType('fun foo(): Nowhere')).toBe('Nowhere'));
});

// ── Groupe 9 : Fonctions étendues ─────────────────────────────────────────────

describe('extractReturnType — fonctions étendues', () => {
  it('fun String.toUpperCase(): String', () =>
    expect(extractReturnType('fun String.toUpperCase(): String')).toBe('String'));

  it('fun <T> List<T>.first(): T', () =>
    expect(extractReturnType('fun <T> List<T>.first(): T')).toBe('T'));

  it('fun String?.orEmpty(): String', () =>
    expect(extractReturnType('fun String?.orEmpty(): String')).toBe('String'));
});

// ── Groupe 10 : Lambda en params + type de retour ─────────────────────────────

describe('extractReturnType — lambdas en paramètres + type de retour (interaction findMatchingParen)', () => {
  // Si findMatchingParen est modifiée (fix BUG L), ces tests détectent toute régression

  it('lambda simple en param → String', () =>
    expect(extractReturnType('fun foo(block: () -> Unit): String')).toBe('String'));

  it('lambda paramétré en param → List<Int>', () =>
    expect(extractReturnType('fun foo(pred: (Int) -> Boolean): List<Int>')).toBe('List<Int>'));

  it('lambda en param ET type de retour lambda', () =>
    expect(extractReturnType('fun foo(f: (Int) -> String): (String) -> Int')).toBe('(String) -> Int'));

  it('lambda au milieu des params → Boolean', () =>
    expect(extractReturnType('fun foo(a: Int, block: () -> Unit, b: String): Boolean')).toBe('Boolean'));

  it('deux lambdas en params → Pair<Int, String>', () =>
    expect(extractReturnType('fun foo(a: () -> Int, b: () -> String): Pair<Int, String>')).toBe('Pair<Int, String>'));
});

// ── Groupe 11 : Signatures multi-lignes ───────────────────────────────────────

describe('extractReturnType — signatures multi-lignes', () => {
  it('multi-ligne simple', () =>
    expect(extractReturnType('fun foo(\n    x: Int,\n    y: String\n): List<String>')).toBe('List<String>'));

  it('indentation variable', () =>
    expect(extractReturnType('fun foo(\n  x: Int\n  ): Map<String, Int>')).toBe('Map<String, Int>'));

  it('signature tronquée (pas de `)` fermant) → null', () =>
    expect(extractReturnType('fun foo(x: Int, y: String, z:')).toBeNull());
});

// ── Groupe 12 : Stripping du corps ────────────────────────────────────────────

describe('extractReturnType — stripping du corps `=` et `{`', () => {
  it('corps expression `=`', () =>
    expect(extractReturnType('fun foo(): String = "hello"')).toBe('String'));

  it('corps bloc `{`', () =>
    expect(extractReturnType('fun foo(): String { return "hi" }')).toBe('String'));

  it('générique + corps `=`', () =>
    expect(extractReturnType('fun foo(): Map<String, Int> = mapOf()')).toBe('Map<String, Int>'));

  // Bug candidat : `=` dans une valeur par défaut de param ne doit pas déclencher le strip
  // (le `=` est AVANT le closeParen, pas dans l'afterClose)
  it('param avec valeur par défaut, pas de corps → String', () =>
    expect(extractReturnType('fun foo(x: Int = 0): String')).toBe('String'));
});

// ── Groupe 13 : Context receivers ─────────────────────────────────────────────

describe('extractReturnType — context receivers', () => {
  it('context(Logger) fun foo(): String', () =>
    expect(extractReturnType('context(Logger) fun foo(): String')).toBe('String'));

  it('context(Repo, Logger) fun foo(): Int', () =>
    expect(extractReturnType('context(Repo, Logger) fun foo(): Int')).toBe('Int'));
});

// ── Groupe 14 : Annotations sur le type de retour ────────────────────────────

describe('extractReturnType — annotations sur le type de retour', () => {
  it('@Composable () -> Unit', () =>
    expect(extractReturnType('fun foo(): @Composable () -> Unit')).toBe('@Composable () -> Unit'));

  it('@Suppress("X") String', () =>
    expect(extractReturnType('fun foo(): @Suppress("X") String')).toBe('@Suppress("X") String'));

  // Bug : le `=` dans un argument nommé d'annotation déclenchait le strip de corps
  it('@Ann(key = value) String — = dans annotation pas strippé', () =>
    expect(extractReturnType('fun foo(): @Ann(key = "val") String')).toBe('@Ann(key = "val") String'));

  it('@Suppress(names = "X") String — = dans annotation pas strippé', () =>
    expect(extractReturnType('fun foo(): @Suppress(names = "X") String')).toBe('@Suppress(names = "X") String'));
});

// ── Groupe 15 : Fonction nommée `context` ─────────────────────────────────────

describe('extractReturnType — fonction nommée `context` (anti-régression context receiver)', () => {
  // Bug : findParamListStart confondait `fun context(` avec un context receiver
  it('fun context(args: String): String', () =>
    expect(extractReturnType('fun context(args: String): String')).toBe('String'));

  it('fun context(): Int', () =>
    expect(extractReturnType('fun context(): Int')).toBe('Int'));

  it('context(Logger) fun foo(): String — vrai context receiver', () =>
    expect(extractReturnType('context(Logger) fun foo(): String')).toBe('String'));
});
