/**
 * Tests for SuppressHoverProvider — plain-English descriptions on hover
 * of @Suppress / @SuppressLint / @SuppressWarnings IDs.
 *
 * Attack surface:
 *   - Must only fire inside the parenthesised argument list of the
 *     annotation; a bare `"UNCHECKED_CAST"` string elsewhere is not us.
 *   - Must handle multiple IDs in one annotation (`@SuppressLint("A", "B")`).
 *   - Must look up across Kotlin / Android Lint / javac ID conventions.
 *   - Must ignore unknown IDs gracefully (no hover, not a crash).
 *   - Must handle both `"..."` and `'...'` string literals.
 *   - Must not fire when cursor is outside any string on the annotation line.
 */

import { describe, it, expect } from 'vitest';
import './__mocks__/vscode';
import { SuppressHoverProvider } from '../../src/providers/SuppressHoverProvider';
import { SUPPRESS_DESCRIPTIONS } from '../../src/data/suppressDescriptions';

/** Invoke the provider with a synthetic single-line document. */
function hoverAt(line: string, col: number) {
  const provider = new SuppressHoverProvider();
  const doc = {
    lineAt: () => ({ text: line }),
  } as any;
  const position = { line: 0, character: col } as any;
  return provider.provideHover(doc, position);
}

/** Extract the concatenated markdown of all contents in a hover. */
function hoverText(hover: any): string {
  if (!hover) return '';
  const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
  return parts.map((p: any) => p?.value ?? String(p ?? '')).join('\n');
}

// ── Core lookups ──────────────────────────────────────────────────────────

describe('SP-hover-suppress — core ID lookups', () => {
  it('Kotlin: UNCHECKED_CAST inside @Suppress', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    const col  = line.indexOf('UNCHECKED_CAST') + 2;
    const h = hoverAt(line, col);
    expect(h).not.toBeNull();
    const text = hoverText(h);
    expect(text).toContain('UNCHECKED_CAST');
    expect(text).toContain('Kotlin warning');
  });

  it('Android Lint: MissingPermission inside @SuppressLint', () => {
    const line = '@SuppressLint("MissingPermission")';
    const col  = line.indexOf('MissingPermission') + 5;
    const h = hoverAt(line, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('Android Lint');
  });

  it('javac: unchecked inside @SuppressWarnings (Java)', () => {
    const line = '@SuppressWarnings("unchecked")';
    const col  = line.indexOf('unchecked') + 3;
    const h = hoverAt(line, col);
    expect(h).not.toBeNull();
    expect(hoverText(h)).toContain('javac warning');
  });
});

// ── Multiple IDs in one annotation ────────────────────────────────────────

describe('SP-hover-suppress — multiple IDs', () => {
  const line = '@SuppressLint("MissingPermission", "NewApi", "HardcodedText")';

  it('hovers on MissingPermission (first)', () => {
    const col = line.indexOf('MissingPermission') + 2;
    expect(hoverText(hoverAt(line, col))).toContain('MissingPermission');
  });

  it('hovers on NewApi (second)', () => {
    const col = line.indexOf('NewApi') + 2;
    expect(hoverText(hoverAt(line, col))).toContain('NewApi');
  });

  it('hovers on HardcodedText (third)', () => {
    const col = line.indexOf('HardcodedText') + 2;
    expect(hoverText(hoverAt(line, col))).toContain('HardcodedText');
  });
});

// ── Outside the annotation arguments ──────────────────────────────────────

describe('SP-hover-suppress — no hover outside annotation args', () => {
  it('cursor on the @ symbol → no hover', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    expect(hoverAt(line, 0)).toBeNull();
  });

  it('cursor on the annotation name → no hover', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    const col = line.indexOf('Suppress') + 3;
    expect(hoverAt(line, col)).toBeNull();
  });

  it('a bare "UNCHECKED_CAST" string on an unrelated line → no hover', () => {
    // No @Suppress on the line — the fast-reject regex kicks in.
    const line = 'val x = "UNCHECKED_CAST is the rule"';
    const col = line.indexOf('UNCHECKED_CAST') + 2;
    expect(hoverAt(line, col)).toBeNull();
  });

  it('cursor inside the @Suppress line but between strings → no hover', () => {
    const line = '@Suppress("A", "B")';
    // Between the two quoted IDs.
    const comma = line.indexOf(',');
    expect(hoverAt(line, comma)).toBeNull();
  });
});

// ── Unknown IDs ───────────────────────────────────────────────────────────

describe('SP-hover-suppress — unknown IDs degrade gracefully', () => {
  it('unknown lint id → null (no hover, no crash)', () => {
    const line = '@SuppressLint("TotallyMadeUpRule")';
    const col = line.indexOf('TotallyMadeUpRule') + 5;
    expect(hoverAt(line, col)).toBeNull();
  });

  it('empty string literal → null', () => {
    const line = '@Suppress("")';
    const col = line.indexOf('""') + 1;
    expect(hoverAt(line, col)).toBeNull();
  });

  it('non-identifier content in string → null', () => {
    // Spaces, punctuation, etc. don't match the ID regex.
    const line = '@Suppress("some random text")';
    const col = line.indexOf('random');
    expect(hoverAt(line, col)).toBeNull();
  });
});

// ── Quoting variants ──────────────────────────────────────────────────────

describe('SP-hover-suppress — quote styles', () => {
  it("single-quoted ID (Java syntax permissive)", () => {
    const line = "@SuppressWarnings('unchecked')";
    const col = line.indexOf('unchecked') + 3;
    expect(hoverText(hoverAt(line, col))).toContain('javac warning');
  });
});

// ── Dictionary sanity ─────────────────────────────────────────────────────

describe('SP-hover-suppress — dictionary coverage', () => {
  it('includes core Kotlin IDs', () => {
    for (const id of ['UNCHECKED_CAST', 'UNUSED_PARAMETER', 'DEPRECATION', 'OPT_IN_USAGE']) {
      expect(SUPPRESS_DESCRIPTIONS[id], `missing: ${id}`).toBeDefined();
    }
  });

  it('includes core Android Lint IDs', () => {
    for (const id of ['MissingPermission', 'NewApi', 'UnusedResources', 'HardcodedText']) {
      expect(SUPPRESS_DESCRIPTIONS[id], `missing: ${id}`).toBeDefined();
    }
  });

  it('includes core javac IDs', () => {
    for (const id of ['unchecked', 'rawtypes', 'unused', 'deprecation']) {
      expect(SUPPRESS_DESCRIPTIONS[id], `missing: ${id}`).toBeDefined();
    }
  });

  it('every entry has a non-empty kind and text', () => {
    for (const [id, desc] of Object.entries(SUPPRESS_DESCRIPTIONS)) {
      expect(desc.kind.length, `kind empty for ${id}`).toBeGreaterThan(0);
      expect(desc.text.length, `text empty for ${id}`).toBeGreaterThan(10);
    }
  });

  it('total entries ≥ 30 (covers common real-world cases)', () => {
    expect(Object.keys(SUPPRESS_DESCRIPTIONS).length).toBeGreaterThanOrEqual(30);
  });
});

// ── Hover content shape ──────────────────────────────────────────────────

describe('SP-hover-suppress — hover content shape', () => {
  it('markdown contains the ID as bold, then the kind, then the description', () => {
    const line = '@Suppress("UNCHECKED_CAST")';
    const col = line.indexOf('UNCHECKED_CAST') + 2;
    const text = hoverText(hoverAt(line, col));
    expect(text).toMatch(/\*\*UNCHECKED_CAST\*\*/);
    expect(text).toContain('Kotlin warning');
    // Description starts with "Cast to a generic type..."
    expect(text).toMatch(/Cast to a generic type/);
  });

  it('includes doc link when present', () => {
    const line = '@SuppressLint("NewApi")';
    const col = line.indexOf('NewApi') + 2;
    const text = hoverText(hoverAt(line, col));
    expect(text).toContain('[Reference]');
  });
});

// ── Dictionary expansion 2026-04-28 — coverage for newly added IDs ────────
// 14 entries added to round out the most common gaps users would hit:
// 7 Kotlin warnings + 7 Android Lint checks. Tests guarantee:
//   - every new ID resolves to a hover (no silent gaps)
//   - the markdown carries kind + description + reference link
//   - the dictionary stays at or above 56 entries (regression guard)

const NEW_KOTLIN_IDS = [
  'USELESS_CAST',
  'USELESS_ELVIS',
  'UNREACHABLE_CODE',
  'UNNECESSARY_NOT_NULL_ASSERTION',
  'NON_EXHAUSTIVE_WHEN_STATEMENT',
  'INVISIBLE_REFERENCE',
  'INVISIBLE_MEMBER',
] as const;

const NEW_ANDROID_IDS = [
  'ContentDescription',
  'HandlerLeak',
  'StaticFieldLeak',
  'RestrictedApi',
  'AppCompatCustomView',
  'ObsoleteSdkInt',
  'MissingInflatedId',
] as const;

describe('SP-hover-suppress — dict sanity (post-expansion)', () => {
  it('total entries >= 56 (regression guard against accidental delete)', () => {
    expect(Object.keys(SUPPRESS_DESCRIPTIONS).length).toBeGreaterThanOrEqual(56);
  });

  it('every new Kotlin ID has a non-empty kind + text', () => {
    for (const id of NEW_KOTLIN_IDS) {
      const desc = SUPPRESS_DESCRIPTIONS[id];
      expect(desc, `missing dict entry for ${id}`).toBeDefined();
      expect(desc.kind.length, `${id}: empty kind`).toBeGreaterThan(0);
      expect(desc.text.length, `${id}: empty text`).toBeGreaterThan(20);
    }
  });

  it('every new Android Lint ID has a non-empty kind + text + docUrl', () => {
    for (const id of NEW_ANDROID_IDS) {
      const desc = SUPPRESS_DESCRIPTIONS[id];
      expect(desc, `missing dict entry for ${id}`).toBeDefined();
      expect(desc.kind).toBe('Android Lint');
      expect(desc.text.length).toBeGreaterThan(20);
      expect(desc.docUrl, `${id}: docUrl missing`).toMatch(/^https:\/\//);
    }
  });
});

// ── Integration tests — full hover pipeline for every new ID ──────────────
// Each test reproduces the realistic case: a Kotlin/Java file annotated with
// @Suppress(...) / @SuppressLint(...), cursor placed inside the literal,
// hover invoked. Asserts on the rendered markdown that the user actually
// sees — not just on the dictionary lookup.

describe('SP-hover-suppress — integration: every new Kotlin warning resolves on hover', () => {
  for (const id of NEW_KOTLIN_IDS) {
    it(`@Suppress("${id}") resolves and shows "Kotlin warning" + description`, () => {
      const line = `@Suppress("${id}")`;
      const col  = line.indexOf(id) + 2;
      const h = hoverAt(line, col);
      expect(h, `no hover produced for ${id}`).not.toBeNull();
      const text = hoverText(h);
      expect(text).toContain(`**${id}**`);
      expect(text).toContain('Kotlin warning');
      // Description must be substantial — not just the header
      expect(text.length).toBeGreaterThan(40);
      // All Kotlin entries link to the Kotlin docs
      expect(text).toMatch(/\[Reference\]\(https:\/\/kotlinlang\.org/);
    });
  }
});

describe('SP-hover-suppress — integration: every new Android Lint check resolves on hover', () => {
  for (const id of NEW_ANDROID_IDS) {
    it(`@SuppressLint("${id}") resolves and shows "Android Lint" + description`, () => {
      const line = `@SuppressLint("${id}")`;
      const col  = line.indexOf(id) + 2;
      const h = hoverAt(line, col);
      expect(h, `no hover produced for ${id}`).not.toBeNull();
      const text = hoverText(h);
      expect(text).toContain(`**${id}**`);
      expect(text).toContain('Android Lint');
      expect(text.length).toBeGreaterThan(40);
      // All new Android entries link to the per-check Lint docs
      expect(text).toMatch(/\[Reference\]\(https:\/\/googlesamples\.github\.io/);
      // The doc URL must end with the ID — the Lint docs use per-check filenames
      expect(text).toContain(`${id}.md.html`);
    });
  }
});

describe('SP-hover-suppress — integration: mixing new IDs alongside existing ones', () => {
  it('multi-ID @Suppress with both old and new Kotlin entries — each cursor position resolves independently', () => {
    const line = '@Suppress("UNCHECKED_CAST", "USELESS_ELVIS", "UNREACHABLE_CODE")';

    const a = hoverAt(line, line.indexOf('UNCHECKED_CAST') + 2);
    expect(hoverText(a)).toContain('UNCHECKED_CAST');

    const b = hoverAt(line, line.indexOf('USELESS_ELVIS') + 2);
    expect(hoverText(b)).toContain('USELESS_ELVIS');
    expect(hoverText(b)).toContain('Elvis operator');

    const c = hoverAt(line, line.indexOf('UNREACHABLE_CODE') + 2);
    expect(hoverText(c)).toContain('UNREACHABLE_CODE');
  });

  it('@SuppressLint mixing old and new Android Lint IDs', () => {
    const line = '@SuppressLint("MissingPermission", "ContentDescription", "StaticFieldLeak")';

    const a = hoverAt(line, line.indexOf('MissingPermission') + 2);
    expect(hoverText(a)).toContain('MissingPermission');

    const b = hoverAt(line, line.indexOf('ContentDescription') + 2);
    expect(hoverText(b)).toContain('ContentDescription');
    expect(hoverText(b)).toContain('Accessibility');

    const c = hoverAt(line, line.indexOf('StaticFieldLeak') + 2);
    expect(hoverText(c)).toContain('StaticFieldLeak');
    expect(hoverText(c)).toContain('static');
  });

  it('Kotlin code with realistic @Suppress on a class declaration', () => {
    // Real-world shape — leading whitespace, multi-arg, trailing decl
    const line = '    @Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER")';
    const a = hoverAt(line, line.indexOf('INVISIBLE_REFERENCE') + 2);
    expect(hoverText(a)).toContain('INVISIBLE_REFERENCE');
    expect(hoverText(a)).toContain('internal');

    const b = hoverAt(line, line.indexOf('INVISIBLE_MEMBER') + 2);
    expect(hoverText(b)).toContain('INVISIBLE_MEMBER');
  });
});
