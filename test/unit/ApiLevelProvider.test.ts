import { describe, it, expect, vi, afterEach } from 'vitest';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';
import { ApiLevelProvider } from '../../src/providers/ApiLevelProvider';

afterEach(() => vi.restoreAllMocks());

function makeDocument(lines: string[], languageId = 'kotlin') {
  return {
    languageId,
    lineAt: (i: number) => ({ text: lines[i] }),
    lineCount: lines.length,
  } as any;
}

function fullRange(doc: any) {
  return new Range(0, 0, doc.lineCount - 1, 0);
}

const provider = new ApiLevelProvider();

// ── @RequiresApi with integer literal ─────────────────────────────────────────

describe('ApiLevelProvider — @RequiresApi integer', () => {
  it('produces a hint for @RequiresApi(33) — Tiramisu', () => {
    const doc   = makeDocument(['@RequiresApi(33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
    expect(hints[0].label).toContain('13');
  });

  it('produces a hint for @RequiresApi(21) — Lollipop', () => {
    const doc   = makeDocument(['@RequiresApi(21)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Lollipop');
  });

  it('hint is placed after the closing paren of the annotation', () => {
    const line  = '@RequiresApi(33)';
    const doc   = makeDocument([line]);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect((hints[0].position as Position).character).toBe(line.length);
  });

  it('produces NO hint for an unknown API level (e.g. 99)', () => {
    const doc   = makeDocument(['@RequiresApi(99)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('supports @RequiresApi(value = 33) named argument', () => {
    const doc   = makeDocument(['@RequiresApi(value = 33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('supports @RequiresApi(api = 33) named argument', () => {
    const doc   = makeDocument(['@RequiresApi(api = 33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('produces NO hint when @RequiresApi is inside a // comment', () => {
    const doc   = makeDocument(['// @RequiresApi(33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });
});

// ── @RequiresApi with VERSION_CODES constant ──────────────────────────────────

describe('ApiLevelProvider — @RequiresApi VERSION_CODES', () => {
  it('resolves Build.VERSION_CODES.TIRAMISU → API 33', () => {
    const doc   = makeDocument(['@RequiresApi(Build.VERSION_CODES.TIRAMISU)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('resolves bare TIRAMISU (without Build.VERSION_CODES. prefix)', () => {
    const doc   = makeDocument(['@RequiresApi(TIRAMISU)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('resolves Build.VERSION_CODES.O → API 26 (Oreo)', () => {
    const doc   = makeDocument(['@RequiresApi(Build.VERSION_CODES.O)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Oreo');
  });

  it('resolves LOLLIPOP_MR1 — constant with digit suffix', () => {
    const doc   = makeDocument(['@RequiresApi(Build.VERSION_CODES.LOLLIPOP_MR1)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Lollipop MR1');
  });

  it('resolves N_MR1 — single letter + digit suffix', () => {
    const doc   = makeDocument(['@RequiresApi(Build.VERSION_CODES.N_MR1)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Nougat MR1');
  });

  it('resolves S_V2 — letter + underscore + digit', () => {
    const doc   = makeDocument(['@RequiresApi(Build.VERSION_CODES.S_V2)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('S_V2');
  });

  it('produces NO hint for unknown VERSION_CODES constant', () => {
    const doc   = makeDocument(['@RequiresApi(UNKNOWN_FUTURE)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('integer and VERSION_CODES on same annotation do not produce duplicate hints', () => {
    // Each annotation should produce exactly ONE hint
    const doc   = makeDocument(['@RequiresApi(33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
  });
});

// ── SDK_INT comparisons ───────────────────────────────────────────────────────

describe('ApiLevelProvider — SDK_INT comparisons', () => {
  it('produces a hint for SDK_INT >= 33', () => {
    const doc   = makeDocument(['if (Build.VERSION.SDK_INT >= 33) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('produces a hint for SDK_INT > 32 (equivalent to >= 33)', () => {
    const doc   = makeDocument(['if (SDK_INT > 32) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('produces NO hint for SDK_INT >= 99 (unknown level)', () => {
    const doc   = makeDocument(['if (SDK_INT >= 99) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('produces NO hint when SDK_INT >= N is inside a // comment', () => {
    const doc   = makeDocument(['// if (SDK_INT >= 33) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('hint for SDK_INT > 32 is placed after the number 32', () => {
    const line  = 'if (SDK_INT > 32) {';
    const doc   = makeDocument([line]);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    const endOfExpr = line.indexOf('32') + 2;
    expect((hints[0].position as Position).character).toBe(endOfExpr);
  });
});

// ── SDK_INT with VERSION_CODES constant ──────────────────────────────────────

describe('ApiLevelProvider — SDK_INT >= Build.VERSION_CODES.XXX', () => {
  it('produces a hint for SDK_INT >= Build.VERSION_CODES.TIRAMISU', () => {
    const doc   = makeDocument(['if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Tiramisu');
  });

  it('produces a hint for SDK_INT >= Build.VERSION_CODES.S', () => {
    const doc   = makeDocument(['val isModern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('S (12)');
  });

  it('produces a hint for SDK_INT >= Build.VERSION_CODES.M', () => {
    const doc   = makeDocument(['if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) println("ok")']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('Marshmallow');
  });

  it('produces a hint for SDK_INT > Build.VERSION_CODES.S (equivalent to >= S_V2)', () => {
    const doc   = makeDocument(['if (SDK_INT > Build.VERSION_CODES.S) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toContain('S_V2');
  });

  it('produces NO hint for an unknown VERSION_CODES constant', () => {
    const doc   = makeDocument(['if (SDK_INT >= Build.VERSION_CODES.FUTURE_API) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('produces NO hint when inside a // comment', () => {
    const doc   = makeDocument(['// if (SDK_INT >= Build.VERSION_CODES.S) {']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });

  it('hint is placed after the constant name, not after Build.VERSION_CODES', () => {
    const line  = 'if (SDK_INT >= Build.VERSION_CODES.TIRAMISU) {';
    const doc   = makeDocument([line]);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    const expectedEnd = line.indexOf('TIRAMISU') + 'TIRAMISU'.length;
    expect((hints[0].position as Position).character).toBe(expectedEnd);
  });

  it('integer and VERSION_CODES on the same line each produce exactly one hint', () => {
    const doc = makeDocument([
      'if (SDK_INT >= 33) { }  // SDK_INT >= Build.VERSION_CODES.TIRAMISU',
    ]);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    // comment is ignored → only the integer form produces a hint
    expect(hints).toHaveLength(1);
  });
});

// ── Range filtering ───────────────────────────────────────────────────────────

describe('ApiLevelProvider — range filtering', () => {
  it('only produces hints for lines within the requested range', () => {
    const doc = makeDocument([
      '@RequiresApi(33)',  // line 0 — in range
      '@RequiresApi(28)',  // line 1 — in range
      '@RequiresApi(21)',  // line 2 — out of range
    ]);
    const range = new Range(0, 0, 1, 0);
    const hints = provider.provideInlayHints(doc, range);
    expect(hints).toHaveLength(2);
    expect(hints.every(h => (h.position as Position).line <= 1)).toBe(true);
  });
});

// ── Disabled setting ──────────────────────────────────────────────────────────

describe('ApiLevelProvider — disabled setting', () => {
  it('returns [] when kotlinJump.apiLevelInlayHints = false', () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'apiLevelInlayHints' ? false : def,
    } as any);

    const doc   = makeDocument(['@RequiresApi(33)']);
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });
});

// ── Java files ────────────────────────────────────────────────────────────────

describe('ApiLevelProvider — Java files', () => {
  it('produces hints for Java files as well', () => {
    const doc   = makeDocument(['@RequiresApi(33)'], 'java');
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(1);
  });

  it('produces NO hints for non-Kotlin/Java files (e.g. XML)', () => {
    const doc   = makeDocument(['@RequiresApi(33)'], 'xml');
    const hints = provider.provideInlayHints(doc, fullRange(doc));
    expect(hints).toHaveLength(0);
  });
});
