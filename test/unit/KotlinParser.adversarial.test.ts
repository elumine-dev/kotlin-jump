/**
 * Tests adversaires pour KotlinParser — zéro couverture adversaire auparavant.
 *
 * Bugs confirmés par analyse statique de RE_FUN et de la logique de parsing :
 *
 *   BUG Q  — Multi-line raw strings polluent l'index (symboles fantômes)
 *   BUG W  — fun <T : Comparable<T>> non indexé (bornes génériques imbriquées dans RE_FUN)
 *   BUG S  — fun `backtick name`() non indexé (RE_FUN ne gère pas les backticks)
 *   BUG T  — @Deprecated(...) multi-lignes non détecté (annotationWindow effacée)
 *   BUG U  — @Composable fun sur une seule ligne : non indexé du tout
 *   BUG P  — countDepth : raw string avec `"` embarqué avant `{` fausse braceDepth
 *
 * Lancer : npm test -- test/unit/KotlinParser.adversarial.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { handleFindSymbol } from '../../src/server/mcp';

function symbols(code: string) {
  return parse('file:///adv.kt', code).symbols;
}

function findSymbol(code: string, name: string) {
  return symbols(code).find(s => s.name === name);
}

// ── BUG Q : multi-line raw strings polluent l'index ──────────────────────────

describe('BUG Q — raw strings multi-lignes polluent l\'index de symboles', () => {
  it('fun déclarée DANS une raw string est indexée comme symbole réel', () => {
    const code = [
      'val doc = """',
      'fun fakeFunc(x: Int) {}',
      '"""',
    ].join('\n');

    const syms = symbols(code);
    // BUG Q — fakeFunc est dans la raw string, pas du vrai code
    // Actuellement : fakeFunc est ajouté à l'index comme une vraie fonction
    const fakeFunc = syms.find(s => s.name === 'fakeFunc');
    expect(fakeFunc).toBeUndefined(); // ne devrait PAS être indexé
  });

  it('class déclarée dans une raw string crée un symbole fantôme', () => {
    const code = [
      'val template = """',
      '    class FakeClass : Base()',
      '"""',
    ].join('\n');

    // BUG Q — FakeClass indexée comme classe réelle
    expect(findSymbol(code, 'FakeClass')).toBeUndefined();
  });

  it('val déclarée dans une raw string crée une propriété fantôme', () => {
    const code = [
      'val docs = """',
      '    val fakeProperty: Int = 42',
      '"""',
    ].join('\n');

    // BUG Q — fakeProperty indexée comme vraie propriété
    expect(findSymbol(code, 'fakeProperty')).toBeUndefined();
  });

  it('la vraie déclaration (hors raw string) est bien indexée', () => {
    const code = [
      'val doc = """',
      'fun notReal(x: Int) {}',
      '"""',
      'fun realFunc(x: Int) {}',
    ].join('\n');

    const syms = symbols(code);
    // ✓ La vraie fonction doit être indexée
    expect(syms.find(s => s.name === 'realFunc')).toBeDefined();
    // BUG Q — notReal ne devrait PAS être indexée
    expect(syms.find(s => s.name === 'notReal')).toBeUndefined();
  });

  it('raw string sur une seule ligne : contenu non parsé comme déclaration', () => {
    // Sur une ligne, countDepth gère les quotes → pas de BUG Q
    // Ce test documente le comportement CORRECT pour une ligne
    const code = 'val x = """fun fake() {}"""';
    const syms = symbols(code);
    expect(syms.find(s => s.name === 'fake')).toBeUndefined(); // ✓ single-line OK
    expect(syms.find(s => s.name === 'x')).toBeDefined();      // ✓ x indexé
  });
});

// ── BUG W : bornes génériques imbriquées dans RE_FUN ─────────────────────────

describe('BUG W — RE_FUN : bornes génériques imbriquées (fun <T : Comparable<T>>)', () => {
  it('fun <T : Comparable<T>> foo(x: T) — non indexé', () => {
    // BUG W — RE_FUN utilise <[^>]*> qui s'arrête au premier `>`
    // → <T : Comparable<T>> ne match pas → foo non indexé
    expect(findSymbol('fun <T : Comparable<T>> foo(x: T): T = x', 'foo')).toBeDefined();
  });

  it('fun <T : List<String>> process(items: T) — non indexé', () => {
    // BUG W — même cause : List<String> contient un `>` imbriqué
    expect(findSymbol('fun <T : List<String>> process(items: T): Int = 0', 'process')).toBeDefined();
  });

  it('fun <K, V : Map<K, V>> merge(a: V, b: V) — bornes doubles', () => {
    // BUG W — deux paramètres génériques avec bornes imbriquées
    expect(findSymbol('fun <K, V : Map<K, V>> merge(a: V, b: V): V = a', 'merge')).toBeDefined();
  });

  it('fun <T : Any> foo(x: T) — borne simple : ✓ indexé correctement', () => {
    // ✓ Pas de BUG W : <T : Any> est <[^>]*> sans imbrication
    expect(findSymbol('fun <T : Any> foo(x: T) {}', 'foo')).toBeDefined();
  });

  it('fun <T> foo(x: T) — générique simple : ✓ indexé correctement', () => {
    // ✓ Pas de BUG W : <T> est trivial
    expect(findSymbol('fun <T> foo(x: T) {}', 'foo')).toBeDefined();
  });
});

// ── BUG S : noms de fonctions entre backticks ─────────────────────────────────

describe('BUG S — RE_FUN : noms entre backticks non indexés', () => {
  it('fun `should return error when input is invalid`() — non indexé', () => {
    // BUG S — RE_FUN utilise (\w+) pour le nom → ` n'est pas \w → no match
    const code = 'fun `should return error when input is invalid`() {}';
    const syms = symbols(code);
    // Comportement attendu après fix : le symbol existe
    // Actuellement : aucun symbol indexé
    expect(syms.length).toBeGreaterThan(0);
  });

  it('fun `test with spaces`(): Boolean — non indexé', () => {
    // BUG S — pattern courant dans les tests Kotlin
    const code = '@Test\nfun `test with spaces`(): Boolean = true';
    const syms = symbols(code);
    expect(syms.length).toBeGreaterThan(0);
  });

  it('fun `returns null for empty input`() — test function typique', () => {
    // BUG S — JUnit/Kotest tests often use backtick names
    const code = [
      'class MyTest {',
      '    @Test',
      '    fun `returns null for empty input`() {}',
      '}',
    ].join('\n');
    const cls = findSymbol(code, 'MyTest');
    expect(cls).toBeDefined(); // class doit être indexée
    const testFn = symbols(code).find(s => s.name.includes('returns null'));
    // BUG S — testFn n'est pas indexée
    expect(testFn).toBeDefined();
  });
});

// ── BUG T : annotation multi-ligne non détectée ──────────────────────────────

describe('BUG T — annotationWindow : @Deprecated multi-lignes non détecté', () => {
  it('@Deprecated("msg") sur une ligne : isDeprecated = true ✓', () => {
    // ✓ Annotation sur une seule ligne fonctionne
    const code = '@Deprecated("oldApi")\nfun oldFun() {}';
    expect(findSymbol(code, 'oldFun')?.isDeprecated).toBe(true);
  });

  it('@Deprecated("msg", ReplaceWith(...)) multi-lignes : isDeprecated = false', () => {
    const code = [
      '@Deprecated(',
      '  "Use newFun instead",',
      '  ReplaceWith("newFun()")',
      ')',
      'fun oldFun() {}',
    ].join('\n');

    // BUG T — la ligne `"Use newFun instead",` efface annotationWindow
    // → quand `fun oldFun()` est parsé, annotationWindow est vide
    // → isDeprecated = false
    expect(findSymbol(code, 'oldFun')?.isDeprecated).toBe(true);
  });

  it('@Deprecated multi-lignes sur une classe', () => {
    const code = [
      '@Deprecated(',
      '  message = "Do not use",',
      '  level = DeprecationLevel.ERROR',
      ')',
      'class OldClass',
    ].join('\n');

    // BUG T — même problème pour les classes
    expect(findSymbol(code, 'OldClass')?.isDeprecated).toBe(true);
  });

  it('@Preview multi-lignes : isPreview = false', () => {
    const code = [
      '@Preview(',
      '  name = "My Preview",',
      '  backgroundColor = 0xFFFFFF',
      ')',
      '@Composable',
      'fun MyPreview() {}',
    ].join('\n');

    // BUG T — @Preview( sur une ligne + continuation → annotationWindow effacée
    // → isPreview = false même si @Preview est là
    const sym = findSymbol(code, 'MyPreview');
    expect(sym).toBeDefined();
    expect(sym?.isPreview).toBe(true);
  });
});

// ── BUG U : @Composable fun sur une seule ligne ───────────────────────────────

describe('BUG U — @Composable fun sur une seule ligne : symbole non indexé', () => {
  it('@Composable fun MyFun() {} — non indexé du tout', () => {
    const code = '@Composable fun MyFun() {}';
    const syms = symbols(code);
    // BUG U — RE_FUN ne matche pas (modifiers list n'inclut pas @Composable)
    // → le symbole n'est pas du tout dans l'index
    expect(findSymbol(code, 'MyFun')).toBeDefined();
  });

  it('@Composable fun sur une seule ligne : kind incorrect', () => {
    // Si jamais indexé, le kind doit être 'composable'
    const code = '@Composable fun Screen() {}';
    const sym = findSymbol(code, 'Screen');
    if (sym) {
      // BUG U — même si indexé, ne sera pas 'composable'
      expect(sym.kind).toBe('composable');
    }
    // Mais actuellement sym est undefined → aussi un bug
    expect(sym).toBeDefined();
  });

  it('@Composable sur ligne séparée : ✓ fonctionne correctement', () => {
    // ✓ Comportement normal : annotation sur ligne précédente
    const code = '@Composable\nfun Screen() {}';
    const sym = findSymbol(code, 'Screen');
    expect(sym?.kind).toBe('composable');
  });
});

// ── BUG P : countDepth et raw string avec `"` embarqué ───────────────────────

describe('BUG P — countDepth : brace depth faussé par `"` dans raw string', () => {
  it('raw string avec `"` embarqué avant `{` : braceDepth pollué', () => {
    // BUG P — `"""a "b{c" d"""` : le `"` interne clôt le tracking de string
    // dans countDepth → le `{` suivant est compté comme un vrai brace
    const code = [
      'fun outer() {',
      '    val s = """a "b{c" d"""',  // raw string avec `"` + `{` imbriqués
      '    val x = 1',                // doit être à braceDepth=1 (dans outer)
      '}',
    ].join('\n');

    const syms = symbols(code);
    const outer = syms.find(s => s.name === 'outer');
    expect(outer).toBeDefined();
    expect(outer?.depth).toBe(0); // outer est au niveau top-level

    // x devrait avoir depth=1 (membre de outer)
    const x = syms.find(s => s.name === 'x');
    if (x) {
      // BUG P — braceDepth faussé → x pourrait avoir le mauvais depth
      expect(x.depth).toBe(1);
    }
  });

  it('raw string avec JSON imbriqué : les braces JSON n\'affectent pas le depth', () => {
    const code = [
      'class Foo {',
      '    val json = """{"key": "value", "other": {"nested": true}}"""',
      '    fun bar() {}',
      '}',
    ].join('\n');

    const syms = symbols(code);
    const foo = syms.find(s => s.name === 'Foo');
    expect(foo).toBeDefined();
    // bar() doit être à depth=1 (membre de Foo), pas à depth erroné
    const bar = syms.find(s => s.name === 'bar');
    if (bar) {
      // Si les `{` et `}` JSON ont le même nombre, le depth se rétablit par accident
      expect(bar.depth).toBe(1);
    }
  });
});

// ── BUG V : braceDepth faussé par un string régulier avec `{` ────────────────

describe('BUG V — strings régulières avec `{` ne faussent PAS le depth (contrôle)', () => {
  it('"string avec {brace}" : braces dans strings normales ignorées ✓', () => {
    // ✓ countDepth gère les strings " " correctement
    const code = [
      'class Foo {',
      '    val s = "hello {world}"',
      '    fun bar() {}',
      '}',
    ].join('\n');

    const bar = findSymbol(code, 'bar');
    expect(bar?.depth).toBe(1); // ✓ depth correct
  });
});

// ── BUG UNICODE : noms de symboles avec caractères non-ASCII ─────────────────
// Le regex \w en JavaScript ne couvre que [a-zA-Z0-9_].
// Les caractères accentués (é, à, ü) et les alphabets non-latins (cyrillique, etc.)
// ne sont pas matchés par \w → les classes/fonctions avec ces noms sont silencieusement ignorées.

describe('UNICODE — symboles avec caractères non-ASCII', () => {
  it('class avec nom accentué (É) est indexée', () => {
    const code = 'package com.example\nclass Étudiant';
    expect(findSymbol(code, 'Étudiant')).toBeDefined();
  });

  it('fun avec nom accentué est indexée', () => {
    const code = 'fun café(): String = ""';
    expect(findSymbol(code, 'café')).toBeDefined();
  });

  it('class avec nom cyrillique est indexée', () => {
    const code = 'class Пользователь';
    expect(findSymbol(code, 'Пользователь')).toBeDefined();
  });

  it('class avec nom ASCII est correctement indexée (contrôle)', () => {
    const code = 'package com.example\nclass Student';
    expect(findSymbol(code, 'Student')).toBeDefined();
  });

  it('fun avec nom ASCII est correctement indexée (contrôle)', () => {
    const code = 'fun compute(): Int = 0';
    expect(findSymbol(code, 'compute')).toBeDefined();
  });
});

// ── Cascade Bug Q : raw string → faux positif → impact sur get_kdoc ──────────
// Un symbole fantôme issu d'une raw string (Bug Q) est visible dans find_symbol.
// Ce test valide l'impact en cascade sur la couche MCP.

describe('Cascade Bug Q — raw string faux positif → visible dans handleFindSymbol', () => {
  it('fakeFunc dans raw string est retournée par handleFindSymbol (faux positif MCP)', () => {
    const code = [
      'package com.example',
      'val sql = """',
      'fun fakeFunc() {}',
      '"""',
    ].join('\n');

    const index = new SymbolIndex();
    index.add(parse('file:///Q.kt', code));
    index.finalize();

    // BUG Q : fakeFunc est dans la raw string mais apparaît dans l'index
    const results = handleFindSymbol(index, 'fakeFunc');
    // Ce test documente le bug — idealement results devrait être []
    expect(results).toEqual([]); // faux positif si ce test échoue
  });
});

// ── Cascade Bug U : @Composable one-liner → absent de find_symbol ────────────

describe('Cascade Bug U — @Composable one-liner → absent de handleFindSymbol', () => {
  it('HomeScreen défini en one-liner @Composable est introuvable via find_symbol', () => {
    const code = 'package com.example\n@Composable fun HomeScreen() {}';

    const index = new SymbolIndex();
    index.add(parse('file:///U.kt', code));
    index.finalize();

    const results = handleFindSymbol(index, 'HomeScreen');
    // BUG U : HomeScreen devrait être trouvée mais ne l'est pas
    expect(results.length).toBeGreaterThan(0); // échoue → documente le bug
  });
});

// ── Cas limites supplémentaires ───────────────────────────────────────────────

describe('KotlinParser — autres cas limites', () => {
  it('fun avec where clause : fun <T> foo(x: T) where T : Comparable<T>', () => {
    // La clause `where` est après la signature → pas de problème de parsing
    const code = 'fun <T> foo(x: T): T where T : Comparable<T> = x';
    // ✓ Ceci devrait fonctionner car <T> est simple (pas de bound imbriqué dans les angles)
    expect(findSymbol(code, 'foo')).toBeDefined();
  });

  it('fun avec receiver générique imbriqué : fun List<Map<String, Int>>.sum()', () => {
    // Receiver complexe avec génériques imbriqués
    const code = 'fun List<Map<String, Int>>.customSum(): Int = 0';
    // RE_FUN uses (?:\w+(?:<[^<>]*>)?[?]?\.)+ for receiver
    // List<Map<String, Int>> has nested generics — might not match
    const sym = findSymbol(code, 'customSum');
    if (sym) {
      expect(sym.kind).toBe('fun');
      expect(sym.isExtension).toBe(true);
    }
    // Document whether it's found or not
    expect(sym).toBeDefined();
  });

  it('classe avec annotation multi-lignes ET @HiltViewModel', () => {
    const code = [
      '@HiltViewModel',
      '@Suppress(',
      '  "UndocumentedPublicClass"',
      ')',
      'class MyViewModel @Inject constructor() : ViewModel()',
    ].join('\n');

    const vm = findSymbol(code, 'MyViewModel');
    expect(vm).toBeDefined();
    // BUG T variant — @Suppress continuation efface l'annotationWindow
    // → @HiltViewModel pourrait ne pas être détecté
    expect(vm?.isHiltViewModel).toBe(true);
  });

  it('enum entry avec ctor args et commentaire : ACTIVE(1), // comment → INACTIVE(0)', () => {
    const code = [
      'enum class Status {',
      '  ACTIVE(1), // comment',
      '  INACTIVE(0)',
      '}',
    ].join('\n');

    const syms = symbols(code);
    expect(syms.find(s => s.name === 'ACTIVE')).toBeDefined();
    expect(syms.find(s => s.name === 'INACTIVE')).toBeDefined();
  });
});
