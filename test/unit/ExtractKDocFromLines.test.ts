import { describe, it, expect } from 'vitest';
import { extractKDocFromLines } from '../../src/util/SignatureReader';

// ── helpers ───────────────────────────────────────────────────────────────────

function lines(...strs: string[]): string[] { return strs; }

// ── basic extraction ──────────────────────────────────────────────────────────

describe('extractKDocFromLines — block comments', () => {
  it('extracts a single-line /** */ comment', () => {
    const src = lines('/** Does the thing. */', 'fun doThing() {}');
    expect(extractKDocFromLines(src, 1)).toContain('Does the thing.');
  });

  it('extracts a multi-line /** */ block', () => {
    const src = lines(
      '/**',
      ' * Loads data from the network.',
      ' * @param url The endpoint.',
      ' * @return The response body.',
      ' */',
      'fun loadData(url: String): String',
    );
    const result = extractKDocFromLines(src, 5);
    expect(result).toContain('Loads data from the network.');
    expect(result).toContain('url');
    expect(result).toContain('The endpoint.');
  });

  it('extracts a // line comment', () => {
    const src = lines('// Computes the hash.', 'fun hash(): Int');
    expect(extractKDocFromLines(src, 1)).toBe('Computes the hash.');
  });

  it('extracts multiple // lines', () => {
    const src = lines('// First line.', '// Second line.', 'fun foo()');
    const result = extractKDocFromLines(src, 2);
    expect(result).toContain('First line.');
    expect(result).toContain('Second line.');
  });
});

// ── annotation skipping ───────────────────────────────────────────────────────

describe('extractKDocFromLines — skips annotations between KDoc and declaration', () => {
  it('skips a single @annotation', () => {
    const src = lines('/** Injected. */', '@Inject', 'class Repo');
    expect(extractKDocFromLines(src, 2)).toContain('Injected.');
  });

  it('skips multiple annotations', () => {
    const src = lines('/** Composable UI. */', '@Composable', '@Preview', 'fun Screen()');
    expect(extractKDocFromLines(src, 3)).toContain('Composable UI.');
  });

  it('skips blank lines before annotation', () => {
    const src = lines('/** Brief. */', '', '@SuppressWarnings', 'fun go()');
    expect(extractKDocFromLines(src, 3)).toContain('Brief.');
  });
});

// ── boundary / edge cases ─────────────────────────────────────────────────────

describe('extractKDocFromLines — edge cases', () => {
  it('returns null when declarationLine is 0 (nothing above)', () => {
    expect(extractKDocFromLines(lines('fun first()'), 0)).toBeNull();
  });

  it('returns null when there is no comment above', () => {
    const src = lines('val x = 1', 'fun foo()');
    expect(extractKDocFromLines(src, 1)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(extractKDocFromLines([], 0)).toBeNull();
  });

  it('returns null when /** has no matching closing */', () => {
    // Block never started with /** properly at the beginning of the found range
    const src = lines('* Some line without opening', '*/', 'fun bad()');
    expect(extractKDocFromLines(src, 2)).toBeNull();
  });

  it('handles the 60-line cap for block comments (does not crash)', () => {
    const bigBlock = ['/**', ...Array.from({ length: 70 }, (_, i) => ` * Line ${i}`), ' */', 'fun big()'];
    const result = extractKDocFromLines(bigBlock, bigBlock.length - 1);
    // Result may be null (cap exceeded so /** not found in window) or a string — either is valid; must not throw
    expect(() => extractKDocFromLines(bigBlock, bigBlock.length - 1)).not.toThrow();
  });

  it('// chain stops at non-comment line', () => {
    const src = lines('val unrelated = 1', '// Relevant comment.', 'fun fn()');
    const result = extractKDocFromLines(src, 2);
    expect(result).toBe('Relevant comment.');
    expect(result).not.toContain('unrelated');
  });
});

// ── BUG H-OOB — declarationLine hors limites du tableau ──────────────────────
// Si entry.line est corrompu (index stale + fichier raccourci entre indexation et lecture),
// lines[declarationLine - 1] vaut undefined → undefined.trim() → TypeError crash.
// Ces tests documentent le bug et serviront de régression après correction.

describe('extractKDocFromLines — declarationLine hors limites (BUG H-OOB)', () => {
  it('H-OOB1 — declarationLine très loin au-delà de lines.length : ne crashe pas et retourne null', () => {
    // BUG : lines[999998] → undefined → undefined.trim() → TypeError
    // Scénario réel : index stale (entry.line=1000) + fichier raccourci à 2 lignes
    const src = lines('package com.example', 'class Foo');
    expect(() => extractKDocFromLines(src, 999_999)).not.toThrow();
    expect(extractKDocFromLines(src, 999_999)).toBeNull();
  });

  it('H-OOB2 — declarationLine = lines.length (juste après la fin) : ne crashe pas et retourne null', () => {
    const src = lines('package com.example', 'class Foo');
    expect(() => extractKDocFromLines(src, src.length)).not.toThrow();
    expect(extractKDocFromLines(src, src.length)).toBeNull();
  });

  it('H-OOB3 — declarationLine = lines.length + 1 : ne crashe pas et retourne null', () => {
    const src = lines('package com.example', 'class Foo');
    expect(() => extractKDocFromLines(src, src.length + 1)).not.toThrow();
    expect(extractKDocFromLines(src, src.length + 1)).toBeNull();
  });

  it('H-OOB4 — declarationLine négative : ne crashe pas et retourne null', () => {
    const src = lines('/** Doc. */', 'class Foo');
    expect(() => extractKDocFromLines(src, -1)).not.toThrow();
    expect(extractKDocFromLines(src, -1)).toBeNull();
  });

  it('H-OOB5 — tableau vide avec declarationLine = 0 : ne crashe pas et retourne null (contrôle existant)', () => {
    expect(extractKDocFromLines([], 0)).toBeNull();
  });
});
