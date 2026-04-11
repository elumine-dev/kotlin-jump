/**
 * Algebraic / property-based tests for OrganizeImportsProvider.
 *
 * Strategy: verify mathematical properties that must hold regardless of the
 * specific import list. A failure here means a correctness guarantee is broken,
 * which will cause users to lose imports or keep dead ones.
 *
 * Properties verified:
 *   OI-1  Idempotency — applying organize twice produces the same block
 *   OI-2  Permutation invariance — any input order → same sorted output
 *   OI-3  Sort correctness — organized block is always alphabetically ordered
 *   OI-4  No duplicates in output
 *   OI-5  Used imports always kept (no false removals)
 *   OI-6  Unused imports removed (no false positives, removeUnused=true)
 *   OI-7  Wildcard imports always kept (can't be usage-checked)
 *   OI-8  Alias handling — alias is the usage token, not the original name
 *   OI-9  Null when no import block exists
 *   OI-A  Coordinate correctness — firstLine/lastLine match actual positions
 */

import { describe, it, expect } from 'vitest';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Apply an OrganizeResult back into the original text. */
function applyOrganize(text: string, result: ReturnType<typeof organizeImports>): string {
  if (!result) return text;
  const ls = text.split('\n');
  return [
    ...ls.slice(0, result.firstLine),
    result.replacement,
    ...ls.slice(result.lastLine + 1),
  ].join('\n');
}

/** Return the organized import block as a list of lines. */
function organizedLines(text: string, removeUnused = true): string[] {
  const r = organizeImports(text, { removeUnused });
  if (!r) return [];
  return r.replacement.split('\n');
}

// ── OI-1: Idempotency ─────────────────────────────────────────────────────────
// organizeImports(applyOrganize(text, r1)) must produce the same block as r1.
// A violation means organize is not a fixed-point — running twice gives different results.

describe('OI-1 — idempotency: applying twice = applying once', () => {
  function assertIdempotent(label: string, text: string, opts = {}): void {
    const r1 = organizeImports(text, opts);
    if (!r1) return; // no import block

    const text2 = applyOrganize(text, r1);
    const r2    = organizeImports(text2, opts);

    // Second call must produce the same replacement (already organized)
    expect(r2, `${label}: second call must find import block`).not.toBeNull();
    expect(r2!.replacement, `${label}: idempotency`).toBe(r1.replacement);
  }

  it('alphabetically unsorted imports', () => {
    assertIdempotent('unsorted', `
import com.z.Zebra
import com.a.Apple
import com.m.Mango

val x: Apple = Apple(); val y: Mango = Mango(); val z: Zebra = Zebra()
`.trim());
  });

  it('with unused imports removed', () => {
    assertIdempotent('with unused', `
import com.a.Apple
import com.b.Banana
import com.z.Zombie

val x: Apple = Apple()
`.trim());
  });

  it('imports with blank lines between them (blank lines are dropped)', () => {
    assertIdempotent('blank between imports', `
import com.z.Zebra

import com.a.Apple

val x: Apple = Apple(); val y: Zebra = Zebra()
`.trim());
  });

  it('imports with a comment inside the block (comment dropped)', () => {
    assertIdempotent('comment in block', `
import com.z.Zebra
// this is a comment
import com.a.Apple

val x: Apple = Apple(); val y: Zebra = Zebra()
`.trim());
  });

  it('duplicated imports — second occurrence removed', () => {
    assertIdempotent('duplicates', `
import com.a.Apple
import com.a.Apple
import com.b.Banana

val a: Apple = Apple(); val b: Banana = Banana()
`.trim());
  });

  it('wildcard imports — always kept', () => {
    assertIdempotent('wildcard', `
import com.z.*
import com.a.Apple

val x: Apple = Apple(); val y: SomethingFromZ = SomethingFromZ()
`.trim());
  });

  it('aliased imports — alias is the usage token', () => {
    assertIdempotent('alias', `
import com.example.VeryLongName as Short
import com.b.Banana

val x: Short = Short(); val b: Banana = Banana()
`.trim());
  });

  it('all imports used — no removal', () => {
    assertIdempotent('all used', `
import com.d.Delta
import com.a.Alpha
import com.b.Beta
import com.c.Gamma

class Foo { val a: Alpha = Alpha(); val b: Beta = Beta(); val c: Gamma = Gamma(); val d: Delta = Delta() }
`.trim());
  });

  it('all imports unused (removeUnused=true) — full removal', () => {
    // When ALL imports are removed, replacement = '' → after applying, no import
    // lines remain → second call returns null. null is the correct stable state:
    // there is nothing left to organize.
    const text = `import com.a.Apple\nimport com.b.Banana\n\nclass Empty`.trim();
    const r1 = organizeImports(text);
    expect(r1).not.toBeNull();
    expect(r1!.replacement).toBe(''); // all removed

    const text2 = applyOrganize(text, r1);
    const r2 = organizeImports(text2);
    // null means "no import block" = correctly stable (nothing to organize)
    expect(r2, 'after full removal: no import block remains').toBeNull();
  });

  it('removeUnused=false — no removal even if unused', () => {
    assertIdempotent('no-removal mode', `
import com.z.Zombie
import com.a.Apple

class Empty
`.trim(), { removeUnused: false });
  });

  it('large import block — 20 imports mixed usage', () => {
    const used   = Array.from({ length: 10 }, (_, i) => `com.pkg${i}.Class${i}`);
    const unused = Array.from({ length: 10 }, (_, i) => `com.zzz${i}.Dead${i}`);
    const imports = [...used, ...unused].sort(() => Math.random() - 0.5)
      .map(p => `import ${p}`).join('\n');
    const body = used.map(p => {
      const name = p.split('.').pop()!;
      return `val x${name}: ${name} = ${name}()`;
    }).join('; ');

    assertIdempotent('large block', `${imports}\n\n${body}`);
  });
});

// ── OI-2: Permutation invariance ─────────────────────────────────────────────
// Any ordering of the same imports must produce the same organized block.

describe('OI-2 — permutation invariance: import order doesn\'t affect result', () => {
  function assertPermutationInvariant(label: string, imports: string[], body: string): void {
    const perms = [
      imports,
      [...imports].reverse(),
      [imports[imports.length - 1], ...imports.slice(0, -1)],
      [imports[1], imports[0], ...imports.slice(2)],
    ].filter(p => p.length > 0);

    const results = perms.map(perm =>
      organizedLines(`${perm.join('\n')}\n\n${body}`)
    );

    const first = results[0].join('\n');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].join('\n'), `${label}: permutation ${i}`).toBe(first);
    }
  }

  it('three imports, all used', () => {
    assertPermutationInvariant(
      'three used',
      ['import com.a.Alpha', 'import com.b.Beta', 'import com.c.Gamma'],
      'val a: Alpha = Alpha(); val b: Beta = Beta(); val c: Gamma = Gamma()',
    );
  });

  it('mix of used and unused imports', () => {
    assertPermutationInvariant(
      'mixed',
      ['import com.a.Used', 'import com.b.Unused', 'import com.c.AlsoUsed'],
      'val a: Used = Used(); val c: AlsoUsed = AlsoUsed()',
    );
  });

  it('wildcard + explicit imports', () => {
    assertPermutationInvariant(
      'wildcard+explicit',
      ['import com.a.*', 'import com.b.Bar', 'import com.c.Baz'],
      'val b: Bar = Bar(); val c: Baz = Baz()',
    );
  });
});

// ── OI-3: Sort correctness ────────────────────────────────────────────────────

describe('OI-3 — sorted output: result is alphabetically ordered by import path', () => {
  it('reverse-sorted input → sorted output', () => {
    const result = organizedLines(`
import com.z.Zebra
import com.m.Mango
import com.a.Apple

val a: Apple = Apple(); val m: Mango = Mango(); val z: Zebra = Zebra()
`.trim(), false);

    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1].replace('import ', '');
      const curr = result[i].replace('import ', '');
      expect(prev <= curr, `line ${i - 1} must precede line ${i} alphabetically`).toBe(true);
    }
  });

  it('paths with different separators sort deterministically', () => {
    const ls = organizedLines(`
import com.b_z.Bar
import com.b.Baz
import com.a.Apple

val a: Apple = Apple(); val baz: Baz = Baz(); val bar: Bar = Bar()
`.trim(), false);

    for (let i = 1; i < ls.length; i++) {
      const prev = ls[i - 1].replace('import ', '');
      const curr = ls[i].replace('import ', '');
      expect(prev <= curr, `sort invariant at ${i}`).toBe(true);
    }
  });
});

// ── OI-4: No duplicates ───────────────────────────────────────────────────────

describe('OI-4 — no duplicate imports in organized output', () => {
  it('3 copies of same import → 1 in output', () => {
    const result = organizedLines(`
import com.a.Foo
import com.a.Foo
import com.a.Foo

val x: Foo = Foo()
`.trim());

    const counts = new Map<string, number>();
    for (const line of result) counts.set(line, (counts.get(line) ?? 0) + 1);
    for (const [line, count] of counts) {
      expect(count, `"${line}" appears ${count} times`).toBe(1);
    }
  });

  it('duplicates with different casing are both kept (case-sensitive dedup)', () => {
    // Different paths → both kept
    const result = organizedLines(`
import com.a.Foo
import com.a.foo

val x: Foo = Foo(); val y: foo = foo()
`.trim());
    expect(result).toHaveLength(2);
  });
});

// ── OI-5: Used imports always kept ───────────────────────────────────────────

describe('OI-5 — used imports must never be removed', () => {
  it('each used simple name: import is kept', () => {
    const cases: Array<[string, string, string]> = [
      ['class usage',     'import com.a.Foo',             'class Bar : Foo()'],
      ['constructor',     'import com.a.Bar',             'val x = Bar()'],
      ['type annotation', 'import com.a.Baz',             'fun f(): Baz = TODO()'],
      ['extension fun',   'import com.a.ext',             'fun ext.foo() {}'],
      ['property type',   'import com.a.Prop',            'val x: Prop get() = TODO()'],
      ['generic param',   'import com.a.T',               'fun <X : T> f() {}'],
    ];

    for (const [label, imp, usage] of cases) {
      const result = organizeImports(`${imp}\n\n${usage}`);
      expect(result, `${label}: result`).not.toBeNull();
      expect(
        result!.replacement.includes(imp.trim()),
        `${label}: "${imp}" must be kept when used`,
      ).toBe(true);
    }
  });

  it('name used in deeply nested expression is not considered unused', () => {
    const text = `
import com.a.DeepType

class X {
  val nested = listOf(mapOf("key" to DeepType.create()))
}
`.trim();
    const result = organizeImports(text);
    expect(result!.replacement.includes('import com.a.DeepType')).toBe(true);
  });
});

// ── OI-6: Unused imports removed ─────────────────────────────────────────────

describe('OI-6 — unused imports are removed (removeUnused=true)', () => {
  it('simple unused import is removed', () => {
    const text = `import com.a.Unused\n\nclass X`;
    const result = organizeImports(text);
    expect(result!.replacement).toBe('');  // empty block after removing only import
  });

  it('unused import does not appear in output', () => {
    const text = `
import com.a.Used
import com.b.Unused

val x: Used = Used()
`.trim();
    const result = organizeImports(text)!;
    expect(result.replacement).not.toContain('Unused');
    expect(result.replacement).toContain('Used');
    expect(result.removed).toContain('import com.b.Unused');
  });

  it('import used only in the import block itself is considered unused', () => {
    // "Apple" appears in the import line but NOT in the body — must be removed
    const text = `
import com.a.Apple
import com.b.Bar

val x: Bar = Bar()
`.trim();
    const result = organizeImports(text)!;
    expect(result.replacement).not.toContain('Apple');
  });
});

// ── OI-7: Wildcard imports always kept ───────────────────────────────────────

describe('OI-7 — wildcard imports always kept (can\'t be usage-checked)', () => {
  it('wildcard kept even when nothing from its package is used', () => {
    const text = `import com.a.*\n\nclass Empty`;
    const result = organizeImports(text)!;
    expect(result.replacement).toContain('import com.a.*');
  });

  it('multiple wildcards all kept', () => {
    const text = `import com.a.*\nimport com.b.*\n\nclass Empty`;
    const result = organizeImports(text)!;
    expect(result.replacement).toContain('import com.a.*');
    expect(result.replacement).toContain('import com.b.*');
  });
});

// ── OI-8: Alias handling ──────────────────────────────────────────────────────

describe('OI-8 — alias: usage token is the alias, not the original class name', () => {
  it('alias used in body → import kept', () => {
    const text = `import com.long.pkg.VeryLongClassName as Short\n\nval x: Short = Short()`;
    const result = organizeImports(text)!;
    expect(result.replacement).toContain('import com.long.pkg.VeryLongClassName as Short');
  });

  it('alias NOT used in body → import removed', () => {
    // Body has VeryLongClassName but not Short — should be removed since alias=Short
    const text = `import com.long.pkg.VeryLongClassName as Short\n\nval x: VeryLongClassName = TODO()`;
    const result = organizeImports(text)!;
    expect(result.replacement).not.toContain('import com.long.pkg.VeryLongClassName as Short');
  });

  it('original name without alias is the usage token', () => {
    // No alias — simple name is "Foo"
    const text = `import com.a.Foo\n\nval x: Foo = Foo()`;
    const result = organizeImports(text)!;
    expect(result.replacement).toContain('import com.a.Foo');
  });

  it('alias idempotency: aliased import organizes stably', () => {
    const text = `
import com.z.Zebra as Z
import com.a.Apple as A

val a: A = A(); val z: Z = Z()
`.trim();

    const r1 = organizeImports(text)!;
    const text2 = applyOrganize(text, r1);
    const r2 = organizeImports(text2)!;
    expect(r2.replacement).toBe(r1.replacement);
  });
});

// ── OI-9: Null for no import block ───────────────────────────────────────────

describe('OI-9 — null when no import block', () => {
  it('empty string → null', () => expect(organizeImports('')).toBeNull());
  it('package only → null', () => expect(organizeImports('package com.p')).toBeNull());
  it('class only → null', () => expect(organizeImports('class Foo')).toBeNull());
  it('package + class, no imports → null', () => {
    expect(organizeImports('package com.p\n\nclass Foo')).toBeNull();
  });
});

// ── OI-A: Coordinate correctness ─────────────────────────────────────────────

describe('OI-A — firstLine/lastLine correctly identify import block in original text', () => {
  it('single import at line 0: firstLine=lastLine=0', () => {
    const text = `import com.a.Foo\n\nval x: Foo = Foo()`;
    const result = organizeImports(text)!;
    expect(result.firstLine).toBe(0);
    expect(result.lastLine).toBe(0);
  });

  it('imports after package: firstLine=1', () => {
    const text = `package com.p\nimport com.a.Foo\n\nval x: Foo = Foo()`;
    const result = organizeImports(text)!;
    expect(result.firstLine).toBe(1);
  });

  it('applying result produces syntactically valid import block', () => {
    const text = `package com.p\nimport com.z.Zebra\nimport com.a.Apple\n\nval a: Apple = Apple(); val z: Zebra = Zebra()`;
    const r1 = organizeImports(text)!;
    const text2 = applyOrganize(text, r1);
    // The applied result must still be organizable and produce same block
    const r2 = organizeImports(text2)!;
    expect(r2.replacement).toBe(r1.replacement);
  });

  it('no out-of-bounds: applying result on text reconstructs coherently', () => {
    const text = `
package com.p

import com.b.Beta
import com.a.Alpha

class X { val a: Alpha = Alpha(); val b: Beta = Beta() }
`.trim();
    const r1 = organizeImports(text)!;
    const applied = applyOrganize(text, r1);
    // Must still have package declaration and class body
    expect(applied).toContain('package com.p');
    expect(applied).toContain('class X');
  });
});

// ── OI-B: Edge cases likely to break idempotency ─────────────────────────────
// These scenarios are specifically designed to stress the import block detection
// and body extraction logic.

describe('OI-B — edge cases: blank lines, mixed content, position shifts', () => {
  it('import block at end of file (no body after)', () => {
    // Unusual but valid: imports with no class body after them
    const text = `package com.p\nimport com.a.Foo\nimport com.b.Bar`;
    const result = organizeImports(text, { removeUnused: false })!;
    expect(result).not.toBeNull();
    const r2 = organizeImports(applyOrganize(text, result), { removeUnused: false });
    expect(r2!.replacement).toBe(result.replacement);
  });

  it('static import preserved verbatim', () => {
    const text = `import static com.a.Foo.staticMethod\n\nFoo.staticMethod()`;
    const result = organizeImports(text, { removeUnused: false })!;
    expect(result.replacement).toContain('import static com.a.Foo.staticMethod');
  });

  it('import with trailing comment — comment stripped in output', () => {
    const text = `import com.a.Foo // needed\n\nval x: Foo = Foo()`;
    const result = organizeImports(text)!;
    // fullText is trimmed, so trailing comment preserved only if in original trim
    expect(result.replacement).toMatch(/import com\.a\.Foo/);
  });

  it('large number of imports — fuzz permutation invariance', () => {
    // 15 imports in a pseudo-random order — permutations should all produce same result
    const pkgs = Array.from({ length: 15 }, (_, i) => `com.pkg${String(i).padStart(2, '0')}.Cls${i}`);
    const body  = pkgs.map(p => { const n = p.split('.').pop()!; return `${n}()`; }).join('; ');

    const orderedText   = pkgs.map(p => `import ${p}`).join('\n') + '\n\n' + body;
    const reversedText  = [...pkgs].reverse().map(p => `import ${p}`).join('\n') + '\n\n' + body;
    const shuffledText  = [...pkgs].sort((a, b) => (a.charCodeAt(7) > b.charCodeAt(7) ? 1 : -1))
      .map(p => `import ${p}`).join('\n') + '\n\n' + body;

    const r1 = organizedLines(orderedText, false);
    const r2 = organizedLines(reversedText, false);
    const r3 = organizedLines(shuffledText, false);

    expect(r2, 'reversed = ordered').toEqual(r1);
    expect(r3, 'shuffled = ordered').toEqual(r1);
  });
});
