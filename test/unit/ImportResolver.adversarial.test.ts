/**
 * Tests adversariaux pour ImportResolver.
 *
 * Bug couvert :
 *   IR-1 — import alias (import X as Y) : navigation impossible sur le nom aliasé
 *           RE_IMPORT capturait uniquement le FQN (`com.example.Foo`) sans l'alias.
 *           `exactCandidates('Bar', cache)` → `"com.example.Foo".endsWith('.Bar')` → false
 *           Résultat : Cmd+Click sur `Bar` ne naviguait nulle part.
 *
 *           Fix : capturer le groupe `as Y` dans RE_IMPORT, stocker dans
 *           `aliases: Map<string, string>` (alias → FQN original), exclure de `exact`
 *           (l'alias masque le nom original), résoudre via `aliases.get(simpleName)`.
 */

import { describe, it, expect } from 'vitest';
import { resolve, resolveBest } from '../../src/util/ImportResolver';
import { mockDocument } from './helpers';

// ── IR-1 — import alias (import FQN as Alias) ─────────────────────────────────

describe('IR-1 — import alias : import X as Y', () => {
  it('import com.example.Foo as Bar → resolve("Bar") contient "com.example.Foo"', () => {
    // BUG IR-1 — RE_IMPORT s'arrête avant " as Bar" → exact = ["com.example.Foo"]
    // exactCandidates("Bar") → endsWith(".Bar") → false → []
    const doc = mockDocument(
      'file:///ir1/t1/Test.kt',
      'package com.test\nimport com.example.Foo as Bar\nval x: Bar = Bar()',
    );
    expect(resolve('Bar', doc)).toContain('com.example.Foo');
  });

  it('import com.example.Foo as Bar → resolve("Foo") retourne aussi "com.example.Foo" (FQN accessible par les deux noms)', () => {
    // Le FQN est conservé dans exact pour les lookups internes (isEnclosingClassVisible,
    // type hierarchy, etc.) qui utilisent le nom original de la classe, pas l'alias.
    // L'extension est un outil de navigation : les deux noms pointent vers la même cible.
    const doc = mockDocument(
      'file:///ir1/t2/Test.kt',
      'package com.other\nimport com.example.Foo as Bar\n',
    );
    expect(resolve('Foo', doc)).toContain('com.example.Foo');
  });

  it('resolveBest("Bar", doc, lookup) → priority "exact" avec com.example.Foo', () => {
    // BUG IR-1 (avant fix) : priority "none" → lookup jamais appelé avec "com.example.Foo"
    const doc = mockDocument(
      'file:///ir1/t3/Test.kt',
      'package com.test\nimport com.example.Foo as Bar\n',
    );
    const sentinel = { name: 'Foo_sentinel' };
    const result = resolveBest('Bar', doc, fqn => fqn === 'com.example.Foo' ? sentinel : undefined);
    expect(result.priority).toBe('exact');
    expect(result.matches).toContain(sentinel);
  });

  it('alias coexistant avec import normal — les deux sont résolus indépendamment', () => {
    const doc = mockDocument(
      'file:///ir1/t4/Test.kt',
      [
        'package com.test',
        'import com.a.Foo as MyFoo',
        'import com.b.Bar',
      ].join('\n'),
    );
    // Alias résout correctement
    expect(resolve('MyFoo', doc)).toContain('com.a.Foo');
    // Import normal non aliasé fonctionne toujours
    expect(resolve('Bar', doc)).toContain('com.b.Bar');
    // Le FQN original est toujours accessible (pour isEnclosingClassVisible)
    expect(resolve('Foo', doc)).toContain('com.a.Foo');
  });

  it('plusieurs alias dans le même fichier', () => {
    const doc = mockDocument(
      'file:///ir1/t5/Test.kt',
      [
        'package com.test',
        'import com.a.TypeA as AliasA',
        'import com.b.TypeB as AliasB',
        'import com.c.TypeC',
      ].join('\n'),
    );
    expect(resolve('AliasA', doc)).toContain('com.a.TypeA');
    expect(resolve('AliasB', doc)).toContain('com.b.TypeB');
    // Import normal non aliasé non affecté
    expect(resolve('TypeC', doc)).toContain('com.c.TypeC');
  });

  it('alias vers un type générique : import java.util.HashMap as JMap', () => {
    const doc = mockDocument(
      'file:///ir1/t6/Test.kt',
      'package com.test\nimport java.util.HashMap as JMap\n',
    );
    // Alias résout vers le FQN original
    expect(resolve('JMap', doc)).toContain('java.util.HashMap');
    // Le FQN original est aussi accessible par son nom simple (pour isEnclosingClassVisible)
    expect(resolve('HashMap', doc)).toContain('java.util.HashMap');
  });
});

// ── IR-2 — Kotlin implicit default imports ────────────────────────────────────
// Bug : le resolver ne connaissait que les imports explicites. Cmd+Click sur
// `listOf`, `println`, `String`, `Sequence` dans un fichier .kt sans import
// explicite retournait "no definition found" — alors que ces symboles sont
// implicitement importés dans TOUS les .kt par le compilateur Kotlin.

describe('IR-2 — Kotlin default imports (implicit wildcards)', () => {
  it('listOf in a .kt file resolves via kotlin.collections without explicit import', () => {
    const doc = mockDocument(
      'file:///ir2/t1/Test.kt',
      'package com.test\nval xs = listOf(1, 2, 3)',
    );
    expect(resolve('listOf', doc)).toContain('kotlin.collections.listOf');
  });

  it('println resolves via kotlin.io without explicit import', () => {
    const doc = mockDocument(
      'file:///ir2/t2/Test.kt',
      'package com.test\nfun main() { println("hello") }',
    );
    expect(resolve('println', doc)).toContain('kotlin.io.println');
  });

  it('String resolves via kotlin without explicit import', () => {
    const doc = mockDocument(
      'file:///ir2/t3/Test.kt',
      'package com.test\nval s: String = "hi"',
    );
    expect(resolve('String', doc)).toContain('kotlin.String');
  });

  it('resolveBest finds listOf via wildcard priority when stdlib is indexed', () => {
    const doc = mockDocument(
      'file:///ir2/t4/Test.kt',
      'package com.test\nval xs = listOf(1)',
    );
    const sentinel = { id: 'listOfFromStdlib' };
    const result = resolveBest('listOf', doc, fqn =>
      fqn === 'kotlin.collections.listOf' ? sentinel : undefined,
    );
    expect(result.priority).toBe('wildcard');
    expect(result.matches).toContain(sentinel);
  });

  it('Java file gets java.lang default only — kotlin.collections NOT implicit', () => {
    const doc = mockDocument(
      'file:///ir2/t5/Test.java',
      'package com.test;\nclass T { Object o; }',
    );
    // Object is in java.lang — implicitly available in Java
    expect(resolve('Object', doc)).toContain('java.lang.Object');
    // listOf is Kotlin-specific — must NOT be auto-resolved for a .java file
    expect(resolve('listOf', doc)).not.toContain('kotlin.collections.listOf');
  });

  it('explicit import coexists with defaults — explicit wins on priority', () => {
    const doc = mockDocument(
      'file:///ir2/t6/Test.kt',
      'package com.test\nimport com.mylib.listOf\nval xs = listOf(1)',
    );
    // Both would resolve in candidates; the explicit com.mylib.listOf is exact priority
    const result = resolveBest('listOf', doc, fqn =>
      fqn === 'com.mylib.listOf' ? { src: 'explicit' }
      : fqn === 'kotlin.collections.listOf' ? { src: 'default' }
      : undefined,
    );
    expect(result.priority).toBe('exact');
    expect(result.matches).toEqual([{ src: 'explicit' }]);
  });
});
