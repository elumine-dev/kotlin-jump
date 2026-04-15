/**
 * Tests adversariaux pour StringResourceDefinitionProvider.
 *
 * Bugs ciblés :
 *
 *   ADV-SR-1  Collision de type : même clé dans R.string et R.array →
 *             le provider doit naviguer vers le bon type selon le token pointé.
 *
 *   ADV-SR-2  Token incomplet : R.string. (sans clé) → undefined, pas de crash.
 *
 *   ADV-SR-3  Regex state leak : lastIndex non reset entre deux appels successifs
 *             sur des lignes différentes → résultats corrects.
 *
 *   ADV-SR-4  Priorité de locale pour plurals et arrays :
 *             /values/ bat /values-fr/ même si les deux définissent la clé.
 *
 *   ADV-SR-5  Clé inexistante après un autre token valide sur la même ligne →
 *             le second token retourne undefined sans affecter le premier.
 */

import { describe, it, expect } from 'vitest';
import { Position, Location } from './__mocks__/vscode';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { StringResourceDefinitionProvider } from '../../src/providers/StringResourceDefinitionProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUri(path: string) {
  return { toString: () => path };
}

function makeDoc(lines: string[]) {
  return { lineAt: (i: number) => ({ text: lines[i] }) } as any;
}

function buildProvider(entries: Array<{ uri: string; content: string }>) {
  const index = new StringResourceIndex();
  for (const { uri, content } of entries) {
    index.reindexFile(makeUri(uri), content);
  }
  return new StringResourceDefinitionProvider(index);
}

const DEFAULT_URI = 'file:///project/src/main/res/values/strings.xml';
const FR_URI      = 'file:///project/src/main/res/values-fr/strings.xml';

// ── ADV-SR-1 : Collision de type ─────────────────────────────────────────────

describe('ADV-SR-1 — collision de type : même clé string et array', () => {
  const provider = buildProvider([{
    uri: DEFAULT_URI,
    content: `<resources>
  <string name="types">comma,list</string>
  <string-array name="types">
    <item>Fire</item>
  </string-array>
</resources>`,
  }]);

  it('R.string.types → navigue vers la balise <string>', () => {
    const line = 'val s = R.string.types';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.string.types') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
    // <string name="types"> est sur la ligne 1
    expect(result.range.start.line).toBe(1);
  });

  it('R.array.types → navigue vers la balise <string-array>', () => {
    const line = 'val a = resources.getStringArray(R.array.types)';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.array.types') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
    // <string-array name="types"> est sur la ligne 2
    expect(result.range.start.line).toBe(2);
  });
});

// ── ADV-SR-2 : Token incomplet ────────────────────────────────────────────────

describe('ADV-SR-2 — token incomplet : R.string. sans clé', () => {
  const provider = buildProvider([{
    uri: DEFAULT_URI,
    content: '<resources><string name="foo">Foo</string></resources>',
  }]);

  it('R.string. (curseur après le point) → undefined', () => {
    const line = 'val x = R.string.';
    const doc  = makeDoc([line]);
    // Position sur le dernier caractère (le point)
    const pos  = new Position(0, line.length - 1);
    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });

  it('R. seul → undefined', () => {
    const line = 'val x = R.';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.length - 1);
    expect(provider.provideDefinition(doc, pos)).toBeUndefined();
  });
});

// ── ADV-SR-3 : Regex state leak ───────────────────────────────────────────────

describe('ADV-SR-3 — regex state leak entre appels successifs', () => {
  it('deux appels consécutifs retournent les bons résultats', () => {
    const provider = buildProvider([{
      uri: DEFAULT_URI,
      content: `<resources>
  <string name="alpha">Alpha</string>
  <string name="beta">Beta</string>
  <string name="gamma">Gamma</string>
</resources>`,
    }]);

    const lines = [
      'val a = R.string.alpha',
      'val b = R.string.beta',
      'val g = R.string.gamma',
    ];

    const results = lines.map((line, i) => {
      const doc = makeDoc([line]);
      const pos = new Position(0, line.indexOf('R.string.') + 5);
      return provider.provideDefinition(doc, pos) as Location;
    });

    expect(results[0].range.start.line).toBe(1); // alpha → ligne 1
    expect(results[1].range.start.line).toBe(2); // beta  → ligne 2
    expect(results[2].range.start.line).toBe(3); // gamma → ligne 3
  });

  it('appels alternés plurals / string ne se mélangent pas', () => {
    const provider = buildProvider([{
      uri: DEFAULT_URI,
      content: `<resources>
  <string name="item">Item</string>
  <plurals name="item_count">
    <item quantity="one">1 item</item>
  </plurals>
</resources>`,
    }]);

    const lineStr     = 'val s = R.string.item';
    const linePlurals = 'val p = resources.getQuantityString(R.plurals.item_count, n)';

    const docStr     = makeDoc([lineStr]);
    const docPlurals = makeDoc([linePlurals]);

    const locStr     = provider.provideDefinition(docStr,     new Position(0, lineStr.indexOf('R.string.item') + 5))     as Location;
    const locPlurals = provider.provideDefinition(docPlurals, new Position(0, linePlurals.indexOf('R.plurals.item_count') + 5)) as Location;

    expect(locStr.range.start.line).toBe(1);     // <string>  → ligne 1
    expect(locPlurals.range.start.line).toBe(2); // <plurals> → ligne 2
  });
});

// ── ADV-SR-4 : Priorité de locale pour plurals et arrays ─────────────────────

describe('ADV-SR-4 — priorité de locale /values/ > /values-fr/', () => {
  it('plurals défini dans les deux locales → /values/ gagne', () => {
    const provider = buildProvider([
      {
        uri: FR_URI,
        content: `<resources>
  <plurals name="count">
    <item quantity="one">1 Pokémon</item>
  </plurals>
</resources>`,
      },
      {
        uri: DEFAULT_URI,
        content: `<resources>
  <plurals name="count">
    <item quantity="one">1 Pokemon</item>
  </plurals>
</resources>`,
      },
    ]);

    const line = 'val l = resources.getQuantityString(R.plurals.count, n)';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.plurals.count') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result.uri.toString()).toBe(DEFAULT_URI); // doit pointer vers /values/
  });

  it('array défini dans les deux locales → /values/ gagne', () => {
    const provider = buildProvider([
      {
        uri: FR_URI,
        content: '<resources><string-array name="types"><item>Feu</item></string-array></resources>',
      },
      {
        uri: DEFAULT_URI,
        content: '<resources><string-array name="types"><item>Fire</item></string-array></resources>',
      },
    ]);

    const line = 'val a = resources.getStringArray(R.array.types)';
    const doc  = makeDoc([line]);
    const pos  = new Position(0, line.indexOf('R.array.types') + 5);

    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result.uri.toString()).toBe(DEFAULT_URI);
  });
});

// ── ADV-SR-5 : Token inexistant après token valide sur la même ligne ──────────

describe('ADV-SR-5 — token inexistant après token valide', () => {
  it('second token inconnu → undefined sans affecter la résolution du premier', () => {
    const provider = buildProvider([{
      uri: DEFAULT_URI,
      content: `<resources>
  <string name="known">Known</string>
</resources>`,
    }]);

    // Line with two tokens: one known, one unknown
    const line = 'setTexts(R.string.known, R.string.ghost)';
    const doc  = makeDoc([line]);

    const posKnown = new Position(0, line.indexOf('R.string.known') + 5);
    const posGhost = new Position(0, line.indexOf('R.string.ghost') + 5);

    const locKnown = provider.provideDefinition(doc, posKnown) as Location;
    const locGhost = provider.provideDefinition(doc, posGhost);

    expect(locKnown.range.start.line).toBe(1);
    expect(locGhost).toBeUndefined();
  });
});
