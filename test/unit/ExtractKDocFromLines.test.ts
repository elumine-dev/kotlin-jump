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
