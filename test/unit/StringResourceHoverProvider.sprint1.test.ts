import { describe, it, expect } from 'vitest';
import { Position } from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { StringResourceHoverProvider } from '../../src/providers/StringResourceHoverProvider';

function xmlUri(path: string) { return { toString: () => path }; }

const DEFAULT_URI = xmlUri('file:///project/src/main/res/values/strings.xml');
const EN_URI      = xmlUri('file:///project/src/main/res/values-en/strings.xml');
const FR_URI      = xmlUri('file:///project/src/main/res/values-fr/strings.xml');

function makeDocument(lines: string[], languageId = 'kotlin') {
  return {
    languageId,
    lineAt: (i: number) => ({ text: lines[i] }),
  } as any;
}

function buildProvider(
  defaultXml: string,
  localeXml?: { uri: ReturnType<typeof xmlUri>; xml: string }[],
) {
  const index = new StringResourceIndex();
  index.reindexFile(DEFAULT_URI, defaultXml);
  for (const { uri, xml } of localeXml ?? []) {
    index.reindexFile(uri, xml);
  }
  return new StringResourceHoverProvider(index);
}

// ── R.plurals hover ───────────────────────────────────────────────────────────

describe('StringResourceHoverProvider — R.plurals hover', () => {
  it('shows hover with "plural" header and "other" value for R.plurals.foo', () => {
    const provider = buildProvider(`<resources>
  <plurals name="pokemon_count">
    <item quantity="one">%d Pokemon</item>
    <item quantity="other">%d Pokemon</item>
  </plurals>
</resources>`);
    const line = 'getQuantityString(R.plurals.pokemon_count, n)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.pokemon_count') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover).toBeDefined();
    const md = hover!.contents[0].value;
    expect(md).toContain('plural');
    expect(md).toContain('%d Pokemon');
  });

  it('returns undefined for R.plurals.missing (key not in index)', () => {
    const provider = buildProvider(`<resources></resources>`);
    const line = 'getQuantityString(R.plurals.missing, n)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.missing') + 5);

    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });

  it('header reports `quantity=other` when `other` is declared', () => {
    const provider = buildProvider(`<resources>
  <plurals name="pokemon_count">
    <item quantity="one">%d Pokemon</item>
    <item quantity="other">%d Pokemons</item>
  </plurals>
</resources>`);
    const line = 'getQuantityString(R.plurals.pokemon_count, n)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.pokemon_count') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('(quantity=other)');
    expect(md).not.toContain('no `other` quantity defined');
  });

  it('falls back to declared quantity when `other` is missing, and flags the gap', () => {
    const provider = buildProvider(`<resources>
  <plurals name="tickets_only_one">
    <item quantity="one">%d ticket left</item>
    <item quantity="few">%d tickets left</item>
  </plurals>
</resources>`);
    const line = 'getQuantityString(R.plurals.tickets_only_one, n)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.tickets_only_one') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('(quantity=one)');
    expect(md).not.toContain('(quantity=other)');
    expect(md).toContain('%d ticket left');
    expect(md).toContain('no `other` quantity defined');
  });

  it('R.plurals.foo does NOT trigger R.string hover (separate lookup)', () => {
    const provider = buildProvider(`<resources>
  <string name="pokemon_count">this is a string, not a plural</string>
  <plurals name="pokemon_count">
    <item quantity="other">%d Pokemon</item>
  </plurals>
</resources>`);
    const line = 'getQuantityString(R.plurals.pokemon_count, n)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.pokemon_count') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover!.contents[0].value).toContain('plural');
    expect(hover!.contents[0].value).not.toContain('this is a string, not a plural');
  });
});

// ── R.array hover ─────────────────────────────────────────────────────────────

describe('StringResourceHoverProvider — R.array hover', () => {
  it('shows hover with "string-array" header and bracketed items for R.array.foo', () => {
    const provider = buildProvider(`<resources>
  <string-array name="pokemon_types">
    <item>Fire</item>
    <item>Water</item>
    <item>Grass</item>
  </string-array>
</resources>`);
    const line = 'getStringArray(R.array.pokemon_types)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.array.pokemon_types') + 5);

    const hover = provider.provideHover(doc, pos);
    expect(hover).toBeDefined();
    const md = hover!.contents[0].value;
    expect(md).toContain('string-array');
    expect(md).toContain('[Fire, Water, Grass]');
  });

  it('returns undefined for R.array.missing (key not in index)', () => {
    const provider = buildProvider(`<resources></resources>`);
    const line = 'getStringArray(R.array.missing)';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.array.missing') + 5);

    expect(provider.provideHover(doc, pos)).toBeUndefined();
  });
});

// ── Format string hints ───────────────────────────────────────────────────────

describe('StringResourceHoverProvider — format string hints (Feature 4)', () => {
  it('annotates %s as String in hover markdown', () => {
    const provider = buildProvider(
      `<resources><string name="welcome">Hello, %s!</string></resources>`,
    );
    const line = 'val s = R.string.welcome';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.welcome') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('%s');
    expect(md).toContain('String');
  });

  it('annotates %d as Int', () => {
    const provider = buildProvider(
      `<resources><string name="reward">You earned %d coins!</string></resources>`,
    );
    const line = 'val s = R.string.reward';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.reward') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('%d');
    expect(md).toContain('Int');
  });

  it('annotates positional %1$s and %2$d with arg numbers', () => {
    const provider = buildProvider(
      `<resources><string name="damage">%1$s dealt %2$d damage!</string></resources>`,
    );
    const line = 'val s = R.string.damage';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.damage') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('arg1');
    expect(md).toContain('arg2');
  });

  it('annotates %.1f as Float', () => {
    const provider = buildProvider(
      `<resources><string name="rate">Catch rate: %.1f%%</string></resources>`,
    );
    const line = 'val s = R.string.rate';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.rate') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('Float');
  });

  it('does NOT show format hint for %% (escaped percent)', () => {
    const provider = buildProvider(
      `<resources><string name="pct">100%%</string></resources>`,
    );
    const line = 'val s = R.string.pct';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.pct') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).not.toContain('Format:');
  });

  it('does NOT show format hint for a plain string with no specifiers', () => {
    const provider = buildProvider(
      `<resources><string name="plain">Hello World</string></resources>`,
    );
    const line = 'val s = R.string.plain';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.plain') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).not.toContain('Format:');
  });
});

// ── Locale grid (Feature 6) ───────────────────────────────────────────────────

describe('StringResourceHoverProvider — locale grid (Feature 6)', () => {
  it('shows locale grid when multiple locales are indexed', () => {
    const provider = buildProvider(
      `<resources><string name="title">Title</string></resources>`,
      [{ uri: EN_URI, xml: `<resources><string name="title">Title EN</string></resources>` }],
    );
    const line = 'val t = R.string.title';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.title') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('Locales:');
    expect(md).toContain('default ✓');
    expect(md).toContain('en ✓');
  });

  it('shows ✗ for a locale where the key is absent', () => {
    const provider = buildProvider(
      `<resources><string name="only_default">X</string></resources>`,
      [{ uri: EN_URI, xml: `<resources><string name="other">Y</string></resources>` }],
    );
    const line = 'val t = R.string.only_default';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.only_default') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('en ✗');
    expect(md).toContain('default ✓');
  });

  it('does NOT show locale grid when only one locale is indexed', () => {
    const provider = buildProvider(
      `<resources><string name="title">Title</string></resources>`,
    );
    const line = 'val t = R.string.title';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.title') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).not.toContain('Locales:');
  });

  it('shows correct labels — "values" maps to "default", "values-fr" maps to "fr"', () => {
    const provider = buildProvider(
      `<resources><string name="k">A</string></resources>`,
      [{ uri: FR_URI, xml: `<resources><string name="k">B</string></resources>` }],
    );
    const line = 'val k = R.string.k';
    const doc  = makeDocument([line]);
    const pos  = new Position(0, line.indexOf('R.string.k') + 5);

    const md = provider.provideHover(doc, pos)!.contents[0].value;
    expect(md).toContain('default');
    expect(md).toContain('fr');
    expect(md).not.toContain('values-fr');
  });
});
