/**
 * Tests unitaires pour StringXmlDefinitionProvider.
 *
 * Ce provider fait le sens inverse : Cmd+Click sur name="foo" dans un fichier
 * strings.xml → retourne toutes les utilisations de R.string.foo / R.plurals.foo /
 * R.array.foo depuis le RResourceIndex pré-indexé.
 *
 * Plus besoin de mocker workspace.openTextDocument ni workspace.fs.readFile :
 * on alimente directement le RResourceIndex via reindexFile().
 *
 * Bugs ciblés :
 *
 *   BUG-SX-1  Curseur hors de l'attribut name="..." → aucun résultat.
 *   BUG-SX-2  Fichier sans /res/ dans le chemin → ignoré (aucun résultat).
 *   BUG-SX-3  Clé non utilisée → tableau vide, pas de crash.
 *   BUG-SX-4  Collision de type : <plurals name="foo"> ne matche que R.plurals.foo,
 *             pas R.string.foo ni R.array.foo.
 *   BUG-SX-5  Usages multiples dans plusieurs fichiers → tous retournés.
 *   BUG-SX-6  reindexFile idempotent → pas de duplication sur double appel.
 *   BUG-SX-7  removeFile → les usages disparaissent.
 */

import { describe, it, expect } from 'vitest';
import { RResourceIndex } from '../../src/indexer/RResourceIndex';
import { StringXmlDefinitionProvider } from '../../src/providers/StringXmlDefinitionProvider';
import * as vscode from 'vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlDoc(uri: string, lines: string[]) {
  return {
    uri: vscode.Uri.parse(uri),
    lineAt: (n: number) => ({ text: lines[n] }),
    lineCount: lines.length,
  } as any;
}

function makeProvider(entries: Array<{ uri: string; code: string }>) {
  const rIndex = new RResourceIndex();
  for (const { uri, code } of entries) rIndex.reindexFile(uri, code);
  return { provider: new StringXmlDefinitionProvider(rIndex), rIndex };
}

const RES_URI  = 'file:///project/src/main/res/values/strings.xml';
const KT_URI_1 = 'file:///project/src/main/kotlin/ScreenA.kt';
const KT_URI_2 = 'file:///project/src/main/kotlin/ScreenB.kt';

// ── Happy path ────────────────────────────────────────────────────────────────

describe('StringXmlDefinitionProvider — happy path', () => {
  it('<string name="title"> → trouve R.string.title dans un fichier Kotlin', () => {
    const { provider } = makeProvider([{
      uri: KT_URI_1,
      code: `package com.example\nfun show() { setTitle(R.string.title) }`,
    }]);

    const lines = ['<resources>', '  <string name="title">Title</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const pos   = new vscode.Position(1, lines[1].indexOf('title'));

    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri.toString()).toBe(KT_URI_1);
  });

  it('range pointe exactement sur le token R.string.title', () => {
    const { provider } = makeProvider([{
      uri: KT_URI_1,
      code: `package com.example\nval t = R.string.title`,
    }]);

    const lines = ['<resources>', '  <string name="title">Title</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const pos   = new vscode.Position(1, lines[1].indexOf('title'));

    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
    const r = locs[0].range;
    expect(r.start.line).toBe(1); // ligne 1 (0-indexed) dans le fichier Kotlin
    // `val t = R.string.title` — R.string.title commence à index 8
    expect(r.start.character).toBe(8);
    expect(r.end.character).toBe(8 + 'R.string.title'.length);
  });
});

// ── BUG-SX-1 : Curseur hors de l'attribut ────────────────────────────────────

describe('BUG-SX-1 — curseur hors de l\'attribut name="..."', () => {
  const { provider } = makeProvider([{ uri: KT_URI_1, code: `val x = R.string.foo` }]);
  const xmlLines = ['<resources>', '  <string name="foo">Foo</string>', '</resources>'];

  it('curseur sur < → tableau vide', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, 2));
    expect(locs).toEqual([]);
  });

  it('curseur sur le nom du tag avant l\'attribut → tableau vide', () => {
    const tagPos = xmlLines[1].indexOf('string');
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, tagPos));
    expect(locs).toEqual([]);
  });

  it('curseur après le " fermant → tableau vide', () => {
    const afterAttr = xmlLines[1].indexOf('"foo"') + '"foo"'.length;
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, afterAttr));
    expect(locs).toEqual([]);
  });
});

// ── BUG-SX-2 : Fichier non-res ────────────────────────────────────────────────

describe('BUG-SX-2 — fichier sans /res/ dans le chemin', () => {
  it('config.xml sans /res/ → aucun résultat', () => {
    const { provider } = makeProvider([{ uri: KT_URI_1, code: `val x = R.string.key` }]);
    const NON_RES_URI = 'file:///project/src/main/assets/config.xml';
    const lines = ['<config>', '  <string name="key">Value</string>', '</config>'];
    const doc   = xmlDoc(NON_RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('key')));
    expect(locs).toEqual([]);
  });
});

// ── BUG-SX-3 : Clé non utilisée ──────────────────────────────────────────────

describe('BUG-SX-3 — clé définie mais non utilisée', () => {
  it('aucune utilisation → tableau vide, pas de crash', () => {
    const { provider } = makeProvider([{ uri: KT_URI_1, code: `val x = R.string.other` }]);
    const lines = ['<resources>', '  <string name="unused_key">Unused</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('unused_key')));
    expect(locs).toEqual([]);
  });
});

// ── BUG-SX-4 : Collision de type ─────────────────────────────────────────────

describe('BUG-SX-4 — collision de type : chaque tag matche uniquement son type R.*', () => {
  const kotlinCode = `package com.example
val a = R.string.item
val b = resources.getQuantityString(R.plurals.item, n)
val c = resources.getStringArray(R.array.item)`;
  // Lines: 0=package, 1=R.string.item, 2=R.plurals.item, 3=R.array.item

  it('<plurals name="item"> → ligne 2 seulement (R.plurals.item)', () => {
    const { provider } = makeProvider([{ uri: KT_URI_1, code: kotlinCode }]);
    const lines = ['<resources>', '  <plurals name="item">', '    <item quantity="one">1</item>', '  </plurals>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('item')));

    expect(locs.some((l: any) => l.range.start.line === 2)).toBe(true);  // R.plurals.item
    expect(locs.some((l: any) => l.range.start.line === 1)).toBe(false); // pas R.string.item
    expect(locs.some((l: any) => l.range.start.line === 3)).toBe(false); // pas R.array.item
  });

  it('<string-array name="item"> → ligne 3 seulement (R.array.item)', () => {
    const { provider } = makeProvider([{ uri: KT_URI_1, code: kotlinCode }]);
    const lines = ['<resources>', '  <string-array name="item">', '    <item>X</item>', '  </string-array>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('item')));

    expect(locs.some((l: any) => l.range.start.line === 3)).toBe(true);  // R.array.item
    expect(locs.some((l: any) => l.range.start.line === 1)).toBe(false); // pas R.string.item
    expect(locs.some((l: any) => l.range.start.line === 2)).toBe(false); // pas R.plurals.item
  });
});

// ── BUG-SX-5 : Usages multiples ──────────────────────────────────────────────

describe('BUG-SX-5 — usages multiples dans plusieurs fichiers', () => {
  it('deux fichiers → deux locations', () => {
    const { provider } = makeProvider([
      { uri: KT_URI_1, code: `package com.example\nfun a() { setTitle(R.string.shared_key) }` },
      { uri: KT_URI_2, code: `package com.example\nfun b() { setHint(R.string.shared_key) }` },
    ]);

    const lines = ['<resources>', '  <string name="shared_key">Shared</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('shared_key')));

    expect(locs.length).toBe(2);
    const uris = locs.map((l: any) => l.uri.toString());
    expect(uris).toContain(KT_URI_1);
    expect(uris).toContain(KT_URI_2);
  });
});

// ── BUG-SX-6 : Idempotence de reindexFile ────────────────────────────────────

describe('BUG-SX-6 — reindexFile idempotent (pas de duplication sur double appel)', () => {
  it('reindexFile appelé deux fois → même nombre de résultats', () => {
    const rIndex = new RResourceIndex();
    const code   = `package com.example\nval x = R.string.dup_key`;
    rIndex.reindexFile(KT_URI_1, code);
    rIndex.reindexFile(KT_URI_1, code); // deuxième appel — ne doit pas doubler les entrées
    const provider = new StringXmlDefinitionProvider(rIndex);

    const lines = ['<resources>', '  <string name="dup_key">Dup</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('dup_key')));
    expect(locs.length).toBe(1); // exactement 1, pas 2
  });
});

// ── BUG-SX-7 : removeFile ────────────────────────────────────────────────────

describe('BUG-SX-7 — removeFile supprime les usages', () => {
  it('après removeFile → tableau vide', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(KT_URI_1, `val x = R.string.gone_key`);
    rIndex.removeFile(KT_URI_1);
    const provider = new StringXmlDefinitionProvider(rIndex);

    const lines = ['<resources>', '  <string name="gone_key">Gone</string>', '</resources>'];
    const doc   = xmlDoc(RES_URI, lines);
    const locs  = provider.provideDefinition(doc, new vscode.Position(1, lines[1].indexOf('gone_key')));
    expect(locs).toEqual([]);
  });
});
