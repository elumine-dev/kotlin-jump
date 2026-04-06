import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { inferPackage, rewriteImports } from '../../src/providers/MoveFileProvider';

// ── inferPackage — happy paths ────────────────────────────────────────────────

describe('inferPackage — path-based inference', () => {
  const root = '/project/src/main/kotlin';

  it('same dir → same package', () => {
    const file = `${root}/com/example/ui/Button.kt`;
    expect(inferPackage(file, `${root}/com/example/ui`, 'com.example.ui')).toBe('com.example.ui');
  });

  it('sibling package', () => {
    const file = `${root}/com/example/ui/Button.kt`;
    expect(inferPackage(file, `${root}/com/example/widgets`, 'com.example.ui')).toBe('com.example.widgets');
  });

  it('sub-package (one level deeper)', () => {
    const file = `${root}/com/example/Button.kt`;
    expect(inferPackage(file, `${root}/com/example/ui`, 'com.example')).toBe('com.example.ui');
  });

  it('parent package (one level up)', () => {
    const file = `${root}/com/example/ui/Button.kt`;
    expect(inferPackage(file, `${root}/com/example`, 'com.example.ui')).toBe('com.example');
  });

  it('root package — dest equals source root', () => {
    const file = `${root}/com/example/Foo.kt`;
    expect(inferPackage(file, root, 'com.example')).toBe('');
  });

  it('deeply nested to top-level package', () => {
    const file = `${root}/a/b/c/d/Foo.kt`;
    expect(inferPackage(file, `${root}/a`, 'a.b.c.d')).toBe('a');
  });

  it('cross-module move (different source root in same project)', () => {
    // Both roots share the same package prefix — only the matching one should work
    const coreRoot = '/project/core/src/main/kotlin';
    const file     = `${coreRoot}/com/example/core/Repo.kt`;
    const dest     = `${coreRoot}/com/example/data`;
    expect(inferPackage(file, dest, 'com.example.core')).toBe('com.example.data');
  });
});

// ── inferPackage — returns null ───────────────────────────────────────────────

describe('inferPackage — null (cannot infer)', () => {
  it('package does not match directory structure', () => {
    // File is in /custom/Foo.kt but declares package com.example
    expect(inferPackage('/project/custom/Foo.kt', '/project/custom/sub', 'com.example')).toBeNull();
  });

  it('destination is outside the inferred source root', () => {
    const root = '/project/src/main/kotlin';
    const file = `${root}/com/example/Button.kt`;
    expect(inferPackage(file, '/totally/different', 'com.example')).toBeNull();
  });

  it('no package and no sourceRoots', () => {
    // Cannot determine source root without package or sourceRoots hint
    expect(inferPackage('/project/src/Foo.kt', '/project/src/sub', '')).toBeNull();
  });

  it('sourceRoots provided but dest is outside all of them', () => {
    const root = '/project/src/kotlin';
    expect(inferPackage(`${root}/Foo.kt`, '/other/location', '', [root])).toBeNull();
  });

  it('only one segment of package matches (partial suffix collision)', () => {
    // /a/b/ui/Button.kt has package com.example.ui
    // but /a/b/ui is NOT a valid source root (path would be /a/b/ui minus com/example/ui)
    expect(inferPackage('/a/b/ui/Button.kt', '/a/b/widgets', 'com.example.ui')).toBeNull();
  });
});

// ── inferPackage — sourceRoots fallback ──────────────────────────────────────

describe('inferPackage — sourceRoots fallback', () => {
  it('uses sourceRoot when file has no package (flat structure)', () => {
    const root = '/project/src/kotlin';
    const file = `${root}/Button.kt`;
    expect(inferPackage(file, `${root}/ui`, '', [root])).toBe('ui');
  });

  it('uses sourceRoot — moving to nested dir', () => {
    const root = '/project/src/kotlin';
    const file = `${root}/Foo.kt`;
    expect(inferPackage(file, `${root}/com/example`, '', [root])).toBe('com.example');
  });

  it('uses sourceRoot — moving to root (empty package)', () => {
    const root = '/project/src/kotlin';
    const file = `${root}/sub/Foo.kt`;
    expect(inferPackage(file, root, '', [root])).toBe('');
  });

  it('prefers path inference over sourceRoots when both could work', () => {
    // File is at /project/src/kotlin/com/example/Foo.kt with package com.example
    // Source root is also provided — path inference should succeed first
    const root = '/project/src/kotlin';
    const file = `${root}/com/example/Foo.kt`;
    const dest = `${root}/com/example/sub`;
    const result = inferPackage(file, dest, 'com.example', [root]);
    expect(result).toBe('com.example.sub'); // path inference wins
  });

  it('uses the first matching sourceRoot when multiple are provided', () => {
    const commonRoot  = '/project/src/commonMain/kotlin';
    const androidRoot = '/project/src/androidMain/kotlin';
    const file        = `${commonRoot}/Foo.kt`;
    const dest        = `${commonRoot}/com/app`;
    expect(inferPackage(file, dest, '', [androidRoot, commonRoot])).toBe('com.app');
  });
});

// ── rewriteImports — basic rewrites ──────────────────────────────────────────

describe('rewriteImports — rewrites', () => {
  it('rewrites a single exact import', () => {
    const text   = 'import com.example.ui.Button';
    const [r] = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r).toEqual({ line: 0, newText: 'import com.example.widgets.Button' });
  });

  it('rewrites import with alias — preserves alias', () => {
    const text = 'import com.example.ui.Button as Btn';
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.newText).toBe('import com.example.widgets.Button as Btn');
  });

  it('preserves trailing inline comment', () => {
    const text = 'import com.example.ui.Button // primary CTA';
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.newText).toBe('import com.example.widgets.Button // primary CTA');
  });

  it('preserves leading indentation (rare but valid)', () => {
    const text = '  import com.example.ui.Button';
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.newText).toBe('  import com.example.widgets.Button');
  });

  it('rewrites multiple imports', () => {
    const text = [
      'import com.example.ui.Button',
      'import com.example.ui.TextField',
    ].join('\n');
    const rewrites = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button', 'TextField']));
    expect(rewrites).toHaveLength(2);
    expect(rewrites[0].newText).toBe('import com.example.widgets.Button');
    expect(rewrites[1].newText).toBe('import com.example.widgets.TextField');
  });

  it('handles nested FQN — Button.Companion', () => {
    const text = 'import com.example.ui.Button.Companion';
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.newText).toBe('import com.example.widgets.Button.Companion');
  });

  it('handles move to root package (empty newPackage)', () => {
    const text = 'import com.example.ui.Button';
    const [r]  = rewriteImports(text, 'com.example.ui', '', new Set(['Button']));
    expect(r.newText).toBe('import Button');
  });
});

// ── rewriteImports — no-op cases ─────────────────────────────────────────────

describe('rewriteImports — no rewrites', () => {
  it('different package — not rewritten', () => {
    expect(rewriteImports('import com.example.other.Widget', 'com.example.ui', 'com.example.widgets', new Set(['Widget']))).toHaveLength(0);
  });

  it('symbol not in moved file — not rewritten', () => {
    expect(rewriteImports('import com.example.ui.OtherThing', 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });

  it('wildcard import — not rewritten (too risky to auto-update)', () => {
    expect(rewriteImports('import com.example.ui.*', 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });

  it('empty oldPackage — nothing to do', () => {
    expect(rewriteImports('import foo.Bar', '', 'new.pkg', new Set(['Bar']))).toHaveLength(0);
  });

  it('empty symbolNames — nothing to do', () => {
    expect(rewriteImports('import com.example.ui.Button', 'com.example.ui', 'com.example.widgets', new Set())).toHaveLength(0);
  });

  it('non-import lines are never matched', () => {
    const text = [
      'package com.other',
      '',
      'val x = com.example.ui.Button()',   // FQN usage in code — not an import line
      '// import com.example.ui.Button',   // commented-out import
    ].join('\n');
    expect(rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });

  it('package name that is a prefix of oldPackage is not matched', () => {
    // oldPackage = "com.example.ui", but import is "com.example.uikit.Button"
    // "com.example.uikit.Button" does NOT start with "com.example.ui."
    const text = 'import com.example.uikit.Button';
    expect(rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });
});

// ── rewriteImports — line number accuracy ────────────────────────────────────

describe('rewriteImports — line numbers', () => {
  it('reports correct 0-based line numbers', () => {
    const text = [
      'package com.example',          // line 0
      '',                             // line 1
      'import com.example.ui.Button', // line 2
      'import com.example.ui.Field',  // line 3
    ].join('\n');
    const rewrites = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button', 'Field']));
    expect(rewrites[0].line).toBe(2);
    expect(rewrites[1].line).toBe(3);
  });

  it('handles a file with imports at the very first line', () => {
    const text = 'import com.example.ui.Button\nclass Foo';
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.line).toBe(0);
  });

  it('handles a file where imports are far down (after large header)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `// line ${i}`);
    lines.push('import com.example.ui.Button');
    const text = lines.join('\n');
    const [r]  = rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']));
    expect(r.line).toBe(50);
  });
});

// ── rewriteImports — tricky package prefix collisions ────────────────────────

describe('rewriteImports — prefix collision guard', () => {
  it('does not match a symbol whose simple name happens to start the same', () => {
    // symbolNames = {'Button'}, import is com.example.ui.ButtonGroup
    // "ButtonGroup".split('.')[0] = "ButtonGroup" ≠ "Button" → no match
    const text = 'import com.example.ui.ButtonGroup';
    expect(rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });

  it('does not match when oldPackage appears as a substring in a longer package', () => {
    // import com.example.uiextra.Button — "com.example.uiextra" starts with "com.example.ui"
    // but does NOT start with "com.example.ui." so should not be matched
    const text = 'import com.example.uiextra.Button';
    expect(rewriteImports(text, 'com.example.ui', 'com.example.widgets', new Set(['Button']))).toHaveLength(0);
  });
});

// ── Cross-platform path separator ────────────────────────────────────────────

describe('inferPackage — OS path separator', () => {
  it('correctly handles OS path separator in file paths', () => {
    const sep  = path.sep;
    const root = `${sep}project${sep}src${sep}kotlin`;
    const file = `${root}${sep}com${sep}example${sep}Foo.kt`;
    const dest = `${root}${sep}com${sep}example${sep}sub`;
    expect(inferPackage(file, dest, 'com.example')).toBe('com.example.sub');
  });
});
