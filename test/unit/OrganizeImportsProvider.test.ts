import { describe, it, expect } from 'vitest';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lines(result: ReturnType<typeof organizeImports>): string[] {
  return result!.replacement.split('\n');
}

// ── No imports ────────────────────────────────────────────────────────────────

describe('no imports', () => {
  it('returns null for empty file', () => {
    expect(organizeImports('')).toBeNull();
  });

  it('returns null for file with no import statements', () => {
    expect(organizeImports('package com.example\n\nclass Foo {}')).toBeNull();
  });
});

// ── Sorting ───────────────────────────────────────────────────────────────────

describe('sorting', () => {
  it('sorts two imports alphabetically', () => {
    const code = 'import com.z.Zebra\nimport com.a.Apple\n\nval a: Apple = Apple(); val z: Zebra = Zebra()';
    expect(lines(organizeImports(code, { removeUnused: false }))).toEqual([
      'import com.a.Apple',
      'import com.z.Zebra',
    ]);
  });

  it('sorts many imports', () => {
    const code = [
      'import z.Zoo',
      'import a.Apple',
      'import m.Mango',
      'import b.Banana',
      '',
      'val x: Zoo = Zoo(); val y: Apple = Apple(); val z: Mango = Mango(); val w: Banana = Banana()',
    ].join('\n');
    const sorted = lines(organizeImports(code, { removeUnused: false }));
    expect(sorted).toEqual(['import a.Apple', 'import b.Banana', 'import m.Mango', 'import z.Zoo']);
  });

  it('already sorted — same result', () => {
    const code = 'import a.Apple\nimport z.Zebra\n\nval a: Apple = Apple(); val z: Zebra = Zebra()';
    expect(lines(organizeImports(code, { removeUnused: false }))).toEqual([
      'import a.Apple',
      'import z.Zebra',
    ]);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('deduplication', () => {
  it('removes exact duplicate imports', () => {
    const code = 'import com.example.Foo\nimport com.example.Foo\n\nval x = Foo()';
    expect(lines(organizeImports(code, { removeUnused: false }))).toEqual(['import com.example.Foo']);
  });

  it('removes three duplicates, keeps one', () => {
    const code = 'import x.A\nimport x.A\nimport x.A\n\nval v = A()';
    expect(lines(organizeImports(code, { removeUnused: false }))).toEqual(['import x.A']);
  });

  it('deduplicates and sorts simultaneously', () => {
    const code = 'import z.Z\nimport a.A\nimport z.Z\n\nval v: A = A(); val w: Z = Z()';
    expect(lines(organizeImports(code, { removeUnused: false }))).toEqual(['import a.A', 'import z.Z']);
  });
});

// ── Unused import removal (heuristic) ────────────────────────────────────────

describe('unused import removal', () => {
  it('removes import whose simple name never appears in the file body', () => {
    const code = 'import com.example.Foo\n\nclass Bar {}';
    const result = organizeImports(code)!;
    expect(result.replacement).toBe('');
    expect(result.removed).toEqual(['import com.example.Foo']);
  });

  it('keeps import when simple name appears in code', () => {
    const code = 'import com.example.Foo\n\nval x: Foo = Foo()';
    const result = organizeImports(code)!;
    expect(result.replacement).toContain('import com.example.Foo');
    expect(result.removed).toHaveLength(0);
  });

  it('keeps import used as annotation', () => {
    const code = 'import com.example.MyAnnotation\n\n@MyAnnotation\nclass Foo {}';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('keeps import used as type parameter', () => {
    const code = 'import com.example.Item\n\nval list: List<Item> = emptyList()';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('keeps import used in KDoc', () => {
    const code = 'import com.example.Foo\n\n/** @see Foo */\nclass Bar {}';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('does NOT count the import line itself as a usage', () => {
    // "Foo" appears only in the import — should still be removed
    const code = 'import com.example.Foo\n\nclass Bar {}';
    expect(organizeImports(code)!.removed).toContain('import com.example.Foo');
  });

  it('respects removeUnused=false — keeps unused imports', () => {
    const code = 'import com.example.Unused\n\nclass Foo {}';
    const result = organizeImports(code, { removeUnused: false })!;
    expect(result.replacement).toContain('import com.example.Unused');
    expect(result.removed).toHaveLength(0);
  });

  it('mixed: one used, one unused', () => {
    const code = 'import com.example.Used\nimport com.example.Ghost\n\nval x = Used()';
    const result = organizeImports(code)!;
    expect(result.replacement).toContain('import com.example.Used');
    expect(result.removed).toContain('import com.example.Ghost');
  });
});

// ── Wildcard imports ──────────────────────────────────────────────────────────

describe('wildcard imports', () => {
  it('always keeps wildcard imports — cannot determine usage', () => {
    const code = 'import com.example.*\n\nclass Foo {}';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('sorts wildcards with other imports', () => {
    const code = 'import z.Z\nimport com.example.*\n\nval x: Z = Z()';
    const sorted = lines(organizeImports(code, { removeUnused: false }));
    expect(sorted).toEqual(['import com.example.*', 'import z.Z']);
  });
});

// ── Aliased imports ───────────────────────────────────────────────────────────

describe('aliased imports', () => {
  it('keeps aliased import when alias is used', () => {
    const code = 'import com.a.Foo as MyFoo\n\nval x: MyFoo = MyFoo()';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('removes aliased import when alias is not used', () => {
    const code = 'import com.a.Foo as MyFoo\n\nclass Bar {}';
    expect(organizeImports(code)!.removed).toContain('import com.a.Foo as MyFoo');
  });

  it('checks alias name, not original name', () => {
    // "Foo" appears but the alias "MyFoo" does not → should be removed
    const code = 'import com.a.Foo as MyFoo\n\nclass Foo {}';  // Foo used but not as alias
    // This is a known heuristic edge case — the import is for MyFoo, not Foo
    // Expected: removed (correct — MyFoo is not used, even if "Foo" appears as something else)
    expect(organizeImports(code)!.removed).toContain('import com.a.Foo as MyFoo');
  });

  it('preserves alias syntax in output', () => {
    const code = 'import com.a.Foo as MyFoo\n\nval x: MyFoo = MyFoo()';
    expect(organizeImports(code)!.replacement).toBe('import com.a.Foo as MyFoo');
  });
});

// ── Block structure ───────────────────────────────────────────────────────────

describe('block structure', () => {
  it('detects firstLine and lastLine correctly', () => {
    const code = 'package com.example\n\nimport com.z.Zebra\nimport com.a.Apple\n\nclass Foo {}';
    const result = organizeImports(code, { removeUnused: false })!;
    expect(result.firstLine).toBe(2);
    expect(result.lastLine).toBe(3);
  });

  it('condenses blank lines within import block', () => {
    const code = 'import com.z.Z\n\nimport com.a.A\n\nval a: A = A(); val z: Z = Z()';
    const result = organizeImports(code, { removeUnused: false })!;
    expect(result.replacement).not.toContain('\n\n');
    expect(result.firstLine).toBe(0);
    expect(result.lastLine).toBe(2); // blank line on line 1 and import on line 2
  });

  it('single import — firstLine equals lastLine', () => {
    const code = 'import com.example.Foo\n\nval x: Foo = Foo()';
    const result = organizeImports(code)!;
    expect(result.firstLine).toBe(result.lastLine);
  });
});

// ── Java static imports ───────────────────────────────────────────────────────

describe('Java static imports', () => {
  it('keeps Java static import when member name appears in code', () => {
    const code = 'import static com.example.Constants.MAX\n\nval x = MAX + 1';
    expect(organizeImports(code)!.removed).toHaveLength(0);
  });

  it('removes unused Java static import', () => {
    const code = 'import static com.example.Constants.MAX\n\nval x = 1';
    expect(organizeImports(code)!.removed).toHaveLength(1);
  });

  it('preserves static keyword in output', () => {
    const code = 'import static com.example.Constants.MAX\n\nval x = MAX + 1';
    expect(organizeImports(code)!.replacement).toContain('import static com.example.Constants.MAX');
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('all imports unused — replacement is empty string', () => {
    const code = 'import com.example.Foo\nimport com.example.Bar\n\nclass Baz {}';
    const result = organizeImports(code)!;
    expect(result.replacement).toBe('');
    expect(result.removed).toHaveLength(2);
  });

  it('single import, used — no change in content', () => {
    const code = 'import com.example.Foo\n\nval x: Foo = Foo()';
    expect(organizeImports(code)!.replacement).toBe('import com.example.Foo');
  });

  it('import with trailing comment is parsed correctly', () => {
    const code = 'import com.example.Foo // for navigation\n\nval x: Foo = Foo()';
    const result = organizeImports(code)!;
    // The trailing comment should be stripped (normalized output)
    expect(result.removed).toHaveLength(0);
  });
});
