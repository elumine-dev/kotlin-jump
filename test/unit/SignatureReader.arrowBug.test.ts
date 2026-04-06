/**
 * BUG L — `->` dans les types lambda brise splitAtDepthZero et stripDefaultValue
 *
 * Cause racine : dans splitAtDepthZero, stripDefaultValue et findTypeEnd,
 * le caractère `>` est traité comme un bracket fermant d'angle.
 * Pour le token `->` (opérateur "flèche" dans les types lambda), le `>` est
 * rencontré à depth=0 après que la paren fermante `)` de `()` a ramené depth
 * à 0 → depth passe à -1 → toute virgule suivante est ignorée car depth≠0.
 *
 * Conséquences :
 *   - splitAtDepthZero : les paramètres APRÈS un lambda sont absorbés dans le
 *     type du lambda (ex: `() -> Unit, count: Int` n'est pas splitté)
 *   - stripDefaultValue : `= {}` n'est pas trouvé car depth<0 quand `=` est rencontré
 *
 * Ce bug affecte massivement Kotlin/Compose où presque tout param de callback
 * est de type `() -> Unit` ou `(T) -> R`.
 *
 * Lancer : npm test -- test/unit/SignatureReader.arrowBug.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseParams } from '../../src/util/SignatureReader';

// ── BUG L : lambda param suivi d'autres paramètres ───────────────────────────

describe('BUG L — lambda param suivi d\'autres params (splitAtDepthZero)', () => {
  it('fun foo(block: () -> Unit, count: Int)', () => {
    // BUG L — `>` de `->` fait passer depth de 0 à -1
    // → la virgule après Unit est ignorée → count absorbé dans le type de block
    expect(parseParams('fun foo(block: () -> Unit, count: Int)')).toEqual([
      { name: 'block', type: '() -> Unit' },
      { name: 'count', type: 'Int' },
    ]);
  });

  it('fun foo(pred: (Int, String) -> Boolean, count: Int)', () => {
    // BUG L — lambda avec params internes + param suivant
    expect(parseParams('fun foo(pred: (Int, String) -> Boolean, count: Int)')).toEqual([
      { name: 'pred', type: '(Int, String) -> Boolean' },
      { name: 'count', type: 'Int' },
    ]);
  });

  it('fun foo(a: Int, block: () -> Unit, b: Int) — lambda au milieu', () => {
    // BUG L — `a: Int` est correctement séparé (sa virgule précède le `>`)
    // mais `b: Int` est absorbé dans le type de `block`
    expect(parseParams('fun foo(a: Int, block: () -> Unit, b: Int)')).toEqual([
      { name: 'a', type: 'Int' },
      { name: 'block', type: '() -> Unit' },
      { name: 'b', type: 'Int' },
    ]);
  });

  it('fun foo(a: () -> Int, b: () -> String) — deux lambdas consécutifs', () => {
    // BUG L — après le `>` du premier lambda, depth=-1
    // → la virgule séparatrice est ignorée → b absorbé dans a
    expect(parseParams('fun foo(a: () -> Int, b: () -> String)')).toEqual([
      { name: 'a', type: '() -> Int' },
      { name: 'b', type: '() -> String' },
    ]);
  });

  it('fun foo(transform: (T) -> R, fallback: R) — générique dans lambda', () => {
    // BUG L — type générique `R` après `->` ne change pas le problème
    expect(parseParams('fun foo(transform: (T) -> R, fallback: R)')).toEqual([
      { name: 'transform', type: '(T) -> R' },
      { name: 'fallback', type: 'R' },
    ]);
  });

  it('fun foo(block: suspend () -> Unit, count: Int) — suspend lambda', () => {
    // BUG L — `suspend` devant le lambda ne protège pas contre le bug
    expect(parseParams('fun foo(block: suspend () -> Unit, count: Int)')).toEqual([
      { name: 'block', type: 'suspend () -> Unit' },
      { name: 'count', type: 'Int' },
    ]);
  });

  it('fun foo(onClick: () -> Unit, onLongClick: () -> Unit, enabled: Boolean) — Compose typique', () => {
    // BUG L — pattern ultra-courant dans Compose UI
    // onClick et onLongClick sont tous deux des lambdas → enabled absorbé
    expect(parseParams(
      'fun foo(onClick: () -> Unit, onLongClick: () -> Unit, enabled: Boolean)',
    )).toEqual([
      { name: 'onClick', type: '() -> Unit' },
      { name: 'onLongClick', type: '() -> Unit' },
      { name: 'enabled', type: 'Boolean' },
    ]);
  });
});

// ── BUG L : lambda EN DERNIER — doit fonctionner (pas de split manquant) ─────

describe('BUG L — lambda EN DERNIER : comportement correct attendu', () => {
  it('fun foo(block: () -> Unit) — seul param : pas de BUG L de split', () => {
    // ✓ Pas de param suivant → split correct
    // Note : stripDefaultValue pourrait échouer si `= {}` présent, mais sans default c'est OK
    expect(parseParams('fun foo(block: () -> Unit)')).toEqual([
      { name: 'block', type: '() -> Unit' },
    ]);
  });

  it('fun foo(x: Int, block: () -> Unit) — lambda EN DERNIER : ✓', () => {
    // ✓ La virgule séparant `x: Int` de `block` vient AVANT le `>`
    // → split correct
    expect(parseParams('fun foo(x: Int, block: () -> Unit)')).toEqual([
      { name: 'x', type: 'Int' },
      { name: 'block', type: '() -> Unit' },
    ]);
  });

  it('fun foo(modifier: Modifier, content: @Composable () -> Unit) — Compose classique', () => {
    // ✓ Pattern le plus courant dans Compose — lambda en dernier fonctionne
    expect(parseParams('fun foo(modifier: Modifier, content: @Composable () -> Unit)')).toEqual([
      { name: 'modifier', type: 'Modifier' },
      { name: 'content', type: '@Composable () -> Unit' },
    ]);
  });
});

// ── BUG L : stripDefaultValue avec lambda ────────────────────────────────────

describe('BUG L — stripDefaultValue : default `= {}` non strippé', () => {
  it('fun foo(action: () -> Unit = {}) — default `{}` non strippé', () => {
    // BUG L — dans stripDefaultValue, `>` ramène depth à -1
    // → `=` à depth=-1 non détecté → `= {}` reste dans le type
    expect(parseParams('fun foo(action: () -> Unit = {})')).toEqual([
      { name: 'action', type: '() -> Unit' },
    ]);
  });

  it('fun foo(pred: (Int) -> Boolean = { false }) — default complexe', () => {
    // BUG L — même problème avec lambda paramétré
    expect(parseParams('fun foo(pred: (Int) -> Boolean = { false })')).toEqual([
      { name: 'pred', type: '(Int) -> Boolean' },
    ]);
  });

  it('fun foo(block: () -> Unit = {}, count: Int = 0) — deux params avec defaults lambda', () => {
    // BUG L — double peine : le split ET le strip sont cassés
    expect(parseParams('fun foo(block: () -> Unit = {}, count: Int = 0)')).toEqual([
      { name: 'block', type: '() -> Unit' },
      { name: 'count', type: 'Int' },
    ]);
  });

  it('fun foo(x: Int, action: () -> Unit = {}) — lambda avec default EN DERNIER', () => {
    // BUG L — le split fonctionne (virgule avant `>`) mais le default n'est pas strippé
    expect(parseParams('fun foo(x: Int, action: () -> Unit = {})')).toEqual([
      { name: 'x', type: 'Int' },
      { name: 'action', type: '() -> Unit' },
    ]);
  });
});

// ── BUG M : `)` dans les valeurs par défaut (string littéral) ────────────────

describe('BUG M — `)` dans les valeurs par défaut en string', () => {
  it('fun foo(x: String = ")", y: Int) — `)` dans string coupe trop tôt', () => {
    // BUG M — findMatchingParen trouve le `)` à l'intérieur de la string
    // comme paren fermante → paramStr tronqué → y: Int est perdu
    expect(parseParams('fun foo(x: String = ")", y: Int)')).toEqual([
      { name: 'x', type: 'String' },
      { name: 'y', type: 'Int' },
    ]);
  });

  it('fun foo(sep: String = ")", n: Int) — séparateur comme valeur par défaut', () => {
    // BUG M — pattern courant : séparateur par défaut `","`
    expect(parseParams('fun foo(sep: String = ")", n: Int)')).toEqual([
      { name: 'sep', type: 'String' },
      { name: 'n', type: 'Int' },
    ]);
  });

  it('fun foo(x: String = ")") — seul param avec `)` dans default : acceptable', () => {
    // BUG M atténué — le `)` prématuré tronque le paramStr mais le résultat
    // peut quand même être correct car c'est le seul param
    const result = parseParams('fun foo(x: String = ")")');
    expect(Array.isArray(result)).toBe(true);
    // Au minimum ne doit pas crasher
  });
});

// ── BUG K : context receivers et findParamListStart ──────────────────────────

describe('BUG K — context receivers : findParamListStart trouve le mauvais `(`', () => {
  it('context(Logger) fun foo(x: Int) — context receiver absorbe le premier `(`', () => {
    // BUG K — findParamListStart retourne la position de `(` dans `context(`
    // → paramStr = 'Logger' → parseOneParam('Logger') → null → [] retourné
    // Comportement correct : retourner [{ name: 'x', type: 'Int' }]
    const result = parseParams('context(Logger) fun foo(x: Int)');
    // Documentation : actuellement retourne [] (BUG K)
    // Après fix : devrait retourner [{ name: 'x', type: 'Int' }]
    expect(result).toEqual([{ name: 'x', type: 'Int' }]);
  });

  it('context(Logger, Scope) fun foo(x: Int, y: String)', () => {
    // BUG K — deux context receivers + params normaux
    const result = parseParams('context(Logger, Scope) fun foo(x: Int, y: String)');
    expect(result).toEqual([
      { name: 'x', type: 'Int' },
      { name: 'y', type: 'String' },
    ]);
  });
});
