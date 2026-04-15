import { describe, it, expect } from 'vitest';
import { Position, Location } from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { StringResourceDefinitionProvider } from '../../src/providers/StringResourceDefinitionProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlUri(path: string) {
  return { toString: () => path };
}

function makeDoc(lines: string[]) {
  return { lineAt: (i: number) => ({ text: lines[i] }) } as any;
}

const DEFAULT_XML_URI = 'file:///project/src/main/res/values/strings.xml';

function buildProvider(xmlContent: string) {
  const index = new StringResourceIndex();
  index.reindexFile(xmlUri(DEFAULT_XML_URI), xmlContent);
  return new StringResourceDefinitionProvider(index);
}

// ── R.string ─────────────────────────────────────────────────────────────────

describe('StringResourceDefinitionProvider — R.string', () => {
  it('returns a Location pointing to the correct line', () => {
    const provider = buildProvider(`<resources>
  <string name="title_pokedex">Pokédex</string>
</resources>`);
    const line = 'val t = R.string.title_pokedex';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.string.title_pokedex') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
    expect(result.uri.toString()).toBe(DEFAULT_XML_URI);
    expect(result.range.start.line).toBe(1);
    expect(result.range.start.character).toBe(0);
  });

  it('cursor at start of token returns Location', () => {
    const provider = buildProvider(`<resources><string name="foo">Foo</string></resources>`);
    const line = 'val x = R.string.foo';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.string.foo')); // exactly at 'R'

    expect(provider.provideDefinition(doc, pos)).toBeDefined();
  });

  it('cursor at last char of token returns Location', () => {
    const provider = buildProvider(`<resources><string name="foo">Foo</string></resources>`);
    const line = 'val x = R.string.foo';
    const doc  = makeDoc([line]);
    const tokenStart = line.indexOf('R.string.foo');
    const pos  = new Position(0, tokenStart + 'R.string.foo'.length - 1);

    expect(provider.provideDefinition(doc, pos)).toBeDefined();
  });

  it('cursor one past end of token returns undefined', () => {
    const provider = buildProvider(`<resources><string name="foo">Foo</string></resources>`);
    const line = 'val x = R.string.foo + y';
    const doc  = makeDoc([line]);
    const tokenEnd = line.indexOf('R.string.foo') + 'R.string.foo'.length;
    const pos  = new Position(0, tokenEnd);

    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });

  it('unknown key returns undefined (graceful no-op)', () => {
    const provider = buildProvider(`<resources><string name="known">ok</string></resources>`);
    const line = 'val x = R.string.does_not_exist';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.string.does_not_exist') + 5);

    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });

  it('cursor before the token returns undefined', () => {
    const provider = buildProvider(`<resources><string name="foo">Foo</string></resources>`);
    const line = 'val x = R.string.foo';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, 0);

    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });

  it('correct line when key is not on the first line', () => {
    const provider = buildProvider(`<resources>
  <string name="first">First</string>
  <string name="second">Second</string>
  <string name="third">Third</string>
</resources>`);
    const line = 'val t = R.string.third';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.string.third') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result.range.start.line).toBe(3);
  });
});

// ── R.plurals ─────────────────────────────────────────────────────────────────

describe('StringResourceDefinitionProvider — R.plurals', () => {
  it('returns a Location pointing to the plurals opening tag line', () => {
    const provider = buildProvider(`<resources>
  <plurals name="pokemon_count">
    <item quantity="one">%d Pokémon</item>
    <item quantity="other">%d Pokémon</item>
  </plurals>
</resources>`);
    const line = 'val label = resources.getQuantityString(R.plurals.pokemon_count, count)';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.pokemon_count') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
    expect(result.uri.toString()).toBe(DEFAULT_XML_URI);
    expect(result.range.start.line).toBe(1);
  });

  it('unknown plurals key returns undefined', () => {
    const provider = buildProvider(`<resources><plurals name="count"><item quantity="one">1</item></plurals></resources>`);
    const line = 'R.plurals.missing_key';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.missing_key') + 5);

    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });
});

// ── R.array ───────────────────────────────────────────────────────────────────

describe('StringResourceDefinitionProvider — R.array', () => {
  it('returns a Location pointing to the string-array opening tag line', () => {
    const provider = buildProvider(`<resources>
  <string-array name="pokemon_types">
    <item>Fire</item>
    <item>Water</item>
  </string-array>
</resources>`);
    const line = 'val types = resources.getStringArray(R.array.pokemon_types)';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.array.pokemon_types') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
    expect(result.uri.toString()).toBe(DEFAULT_XML_URI);
    expect(result.range.start.line).toBe(1);
  });

  it('unknown array key returns undefined', () => {
    const provider = buildProvider(`<resources><string-array name="known"><item>A</item></string-array></resources>`);
    const line = 'R.array.missing_array';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.array.missing_array') + 5);

    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });
});

// ── Multiple tokens on the same line ─────────────────────────────────────────

describe('StringResourceDefinitionProvider — multiple tokens', () => {
  it('resolves the correct token when two are on the same line', () => {
    const provider = buildProvider(`<resources>
  <string name="ok">OK</string>
  <string name="cancel">Cancel</string>
</resources>`);
    const line = 'setButtons(R.string.ok, R.string.cancel)';
    const doc  = makeDoc([line]);

    const posOk     = new Position(0, line.indexOf('R.string.ok') + 5);
    const posCancel = new Position(0, line.indexOf('R.string.cancel') + 5);

    const locOk     = provider.provideDefinition(doc, posOk)     as Location;
    const locCancel = provider.provideDefinition(doc, posCancel) as Location;

    expect(locOk.range.start.line).toBe(1);
    expect(locCancel.range.start.line).toBe(2);
  });

  it('no regex state leak between successive calls', () => {
    const provider = buildProvider(`<resources>
  <string name="a">A</string>
  <string name="b">B</string>
</resources>`);
    const lineA = 'val a = R.string.a';
    const lineB = 'val b = R.string.b';
    const docA  = makeDoc([lineA]);
    const docB  = makeDoc([lineB]);

    const locA = provider.provideDefinition(docA, new Position(0, lineA.indexOf('R.string.a') + 5)) as Location;
    const locB = provider.provideDefinition(docB, new Position(0, lineB.indexOf('R.string.b') + 5)) as Location;

    expect(locA.range.start.line).toBe(1);
    expect(locB.range.start.line).toBe(2);
  });
});
