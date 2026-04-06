/**
 * Tests adversaires pour SignatureReader.parseParams
 *
 * Convention :
 *   ✓ commentaire absent → le test DOIT passer (comportement correct)
 *   // BUG X → le test DOIT échouer et documente un bug réel
 *
 * Lancer séparément :
 *   npm test -- test/unit/SignatureReader.adversarial.test.ts
 */

import { describe, it, expect } from 'vitest';
import { parseParams } from '../../src/util/SignatureReader';

// ── BUG A : annotations avec arguments parenthésés ───────────────────────────
// Le regex ^(@\w+[\w.]*\s*)+ s'arrête à `(`.
// @Assisted("id") laisse ("id") name: Type → colonIdx trouve : au mauvais endroit.

describe('BUG A — annotation avec arguments parenthésés', () => {
  it('@Assisted("id") name: Type doit retourner le paramètre', () => {
    // BUG A — attend fix : retourne [] car ("id") name échoue le test /^[A-Za-z_]\w*$/
    expect(parseParams('fun foo(@Assisted("id") name: String)')).toEqual([
      { name: 'name', type: 'String' },
    ]);
  });

  it('@Suppress("CAST") content: () -> Unit doit retourner le paramètre', () => {
    // BUG A — attend fix
    expect(parseParams('fun foo(@Suppress("CAST") content: () -> Unit)')).toEqual([
      { name: 'content', type: '() -> Unit' },
    ]);
  });

  it('combinaison @Composable @Suppress("foo") block: () -> Unit', () => {
    // BUG A — attend fix : @Composable est strippé, @Suppress("foo") laisse ("foo") block
    expect(parseParams('fun foo(@Composable @Suppress("foo") block: () -> Unit)')).toEqual([
      { name: 'block', type: '() -> Unit' },
    ]);
  });

  it('@Assisted("viewModelKey") + paramètre normal après', () => {
    // BUG A — attend fix : le premier param est perdu, le second reste
    expect(parseParams('fun foo(@Assisted("key") id: String, count: Int)')).toEqual([
      { name: 'id', type: 'String' },
      { name: 'count', type: 'Int' },
    ]);
  });

  it('@JvmField(false) flag: Boolean doit retourner le paramètre', () => {
    // BUG A — attend fix
    expect(parseParams('fun foo(@JvmField(false) flag: Boolean)')).toEqual([
      { name: 'flag', type: 'Boolean' },
    ]);
  });

  it('annotation simple sans parens reste intact', () => {
    // ✓ @Composable sans parens fonctionne déjà
    expect(parseParams('fun foo(@Composable content: () -> Unit)')).toEqual([
      { name: 'content', type: '() -> Unit' },
    ]);
  });

  it('@JvmStatic sans parens reste intact', () => {
    // ✓
    expect(parseParams('fun foo(@JvmStatic count: Int)')).toEqual([
      { name: 'count', type: 'Int' },
    ]);
  });
});

// ── BUG B : signature tronquée (≥ 9 paramètres) ──────────────────────────────
// readSignature tronque à MAX_DISPLAY_LINES=8 et ajoute `    // ...`
// sans fermer `)`. findMatchingParen retourne -1 → parseParams retourne [].

describe('BUG B — signature tronquée sans `)` fermante', () => {
  it('signature avec `// ...` et sans `)` retourne [] — documente le bug', () => {
    // BUG B — attend fix : devrait au moins retourner les paramètres visibles
    const truncated = [
      'fun foo(',
      '    p1: Int,',
      '    p2: Int,',
      '    p3: Int,',
      '    p4: Int,',
      '    p5: Int,',
      '    p6: Int,',
      '    p7: Int,',
      '    // ...',
    ].join('\n');
    // Actuellement retourne [] — on documente ce comportement attendu après fix
    const result = parseParams(truncated);
    expect(result.length).toBeGreaterThanOrEqual(7); // au moins les 7 params visibles
  });
});

// ── Types Kotlin non couverts dans les tests existants ────────────────────────

describe('types Kotlin avancés', () => {
  it('type nullable String?', () => {
    expect(parseParams('fun foo(x: String?)')).toEqual([{ name: 'x', type: 'String?' }]);
  });

  it('nullable avec default null : String? = null', () => {
    expect(parseParams('fun foo(x: String? = null)')).toEqual([{ name: 'x', type: 'String?' }]);
  });

  it('type lambda multi-paramètres (Int, String) -> Boolean', () => {
    expect(parseParams('fun foo(pred: (Int, String) -> Boolean)')).toEqual([
      { name: 'pred', type: '(Int, String) -> Boolean' },
    ]);
  });

  it('suspend () -> Unit comme type de paramètre', () => {
    expect(parseParams('fun foo(block: suspend () -> Unit)')).toEqual([
      { name: 'block', type: 'suspend () -> Unit' },
    ]);
  });

  it('variance in/out dans les génériques : Array<out String>', () => {
    expect(parseParams('fun foo(x: Array<out String>)')).toEqual([
      { name: 'x', type: 'Array<out String>' },
    ]);
  });

  it('Array<in Int>', () => {
    expect(parseParams('fun foo(x: Array<in Int>)')).toEqual([
      { name: 'x', type: 'Array<in Int>' },
    ]);
  });

  it('3 niveaux de génériques imbriqués', () => {
    expect(parseParams('fun foo(x: Map<String, List<Pair<Int, Int>>>)')).toEqual([
      { name: 'x', type: 'Map<String, List<Pair<Int, Int>>>' },
    ]);
  });

  it('default qui référence un autre paramètre : y: Int = x + 1', () => {
    expect(parseParams('fun foo(x: Int, y: Int = x + 1)')).toEqual([
      { name: 'x', type: 'Int' },
      { name: 'y', type: 'Int' },
    ]);
  });

  it('vararg non en premier position : fun foo(x: String, vararg ys: Int)', () => {
    expect(parseParams('fun foo(x: String, vararg ys: Int)')).toEqual([
      { name: 'x', type: 'String' },
      { name: 'ys', type: 'Int' },
    ]);
  });

  it('borne de type générique avec `:` : fun <T : Comparable<T>> foo(x: T)', () => {
    // La borne `T : Comparable<T>` contient un `:` dans le header de type — ne pas confondre
    expect(parseParams('fun <T : Comparable<T>> foo(x: T)')).toEqual([
      { name: 'x', type: 'T' },
    ]);
  });

  it('type intersection : T & Any', () => {
    expect(parseParams('fun <T : Any> foo(x: T & Any)')).toEqual([
      { name: 'x', type: 'T & Any' },
    ]);
  });

  it('lambda avec default complexe : action: () -> Unit = {}', () => {
    expect(parseParams('fun foo(action: () -> Unit = {})')).toEqual([
      { name: 'action', type: '() -> Unit' },
    ]);
  });

  it('type avec annotation qualifiée : content: @receiver:Foo () -> Unit', () => {
    // @receiver: contient `:` — risque de mauvais parsing
    // Attend fix ou comportement documenté
    const result = parseParams('fun foo(content: @receiver:Foo () -> Unit)');
    // Au minimum on ne doit pas crasher
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── vararg avec annotation parenthésée ───────────────────────────────────────

describe('vararg + annotation avec args', () => {
  it('vararg @Suppress("X") items: String', () => {
    // BUG A — attend fix : @Suppress("X") laisse ("X") items → parsing échoue
    expect(parseParams('fun foo(vararg @Suppress("X") items: String)')).toEqual([
      { name: 'items', type: 'String' },
    ]);
  });
});

// ── Cas de robustesse : l'implémentation ne doit pas crasher ─────────────────

describe('robustesse — pas de crash', () => {
  it('signature vide', () => {
    expect(() => parseParams('')).not.toThrow();
    expect(parseParams('')).toEqual([]);
  });

  it('seulement des espaces', () => {
    expect(() => parseParams('   ')).not.toThrow();
    expect(parseParams('   ')).toEqual([]);
  });

  it('paramètre sans type : fun foo(x)', () => {
    expect(() => parseParams('fun foo(x)')).not.toThrow();
    // x sans `:` → token ignoré silencieusement
    expect(parseParams('fun foo(x)')).toEqual([]);
  });

  it('crochets non balancés : fun foo(x: Map<String)', () => {
    expect(() => parseParams('fun foo(x: Map<String)')).not.toThrow();
  });

  it('signature très longue (stress)', () => {
    const params = Array.from({ length: 20 }, (_, i) => `p${i}: Int`).join(', ');
    expect(() => parseParams(`fun foo(${params})`)).not.toThrow();
  });
});
