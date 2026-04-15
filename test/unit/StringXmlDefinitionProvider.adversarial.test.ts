/**
 * Tests adversariaux pour StringXmlDefinitionProvider.
 *
 * Bugs ciblés / comportements à vérifier :
 *
 *   ADV-SX-1  Commentaire XML contenant un faux tag resource :
 *             `<!-- <string name="ghost"> -->` ne doit PAS déclencher de navigation.
 *             (Bug connu — fix appliqué via masquage des spans de commentaires)
 *
 *   ADV-SX-2  Commentaire avant un vrai tag sur la même ligne :
 *             `<!-- note --> <string name="real">` → navigation correcte vers "real".
 *
 *   ADV-SX-3  Le type du tag est masqué par un commentaire :
 *             `<!-- <plurals --> <string name="key">` → type résolu = 'string', pas 'plurals'.
 *
 *   ADV-SX-4  Positions frontières de l'attribut name="..." :
 *             - cursor === attrStart (sur le 'n' de name) → match
 *             - cursor === attrEnd - 1 (sur le '"' fermant) → match
 *             - cursor === attrEnd (juste après le '"' fermant) → pas de match
 *
 *   ADV-SX-5  Chemin contenant "resources" (pas "/res/") → exclu.
 *             Chemin contenant "/res/" → inclus.
 *
 *   ADV-SX-6  Attribut avant le commentaire + attribut à l'intérieur du commentaire :
 *             seul l'attribut hors-commentaire doit être résolu.
 *
 *   ADV-SX-7  Plusieurs spans de commentaires sur la même ligne :
 *             `<!-- a --> <string name="x"> <!-- b -->` → "x" résolu correctement.
 *
 *   ADV-SX-8  Clé avec chiffres et underscores : `name="my_key_2"` → résolution correcte.
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

const RES_URI   = 'file:///project/src/main/res/values/strings.xml';
const KT_URI    = 'file:///project/src/main/kotlin/Screen.kt';

function makeProvider(code: string) {
  const rIndex = new RResourceIndex();
  rIndex.reindexFile(KT_URI, code);
  return new StringXmlDefinitionProvider(rIndex);
}

// ── ADV-SX-1 : Faux tag dans un commentaire XML ───────────────────────────────

describe('ADV-SX-1 — commentaire XML contenant un faux tag resource', () => {
  it('<!-- <string name="ghost"> --> → aucune navigation', () => {
    const provider = makeProvider('val x = R.string.ghost');
    // Cursor on "ghost" inside the comment
    const line = '<!-- <string name="ghost"> -->';
    const doc  = xmlDoc(RES_URI, [line]);
    const pos  = new vscode.Position(0, line.indexOf('ghost'));
    const locs = provider.provideDefinition(doc, pos);
    expect(locs).toEqual([]);
  });

  it('<!-- <plurals name="p"> --> → aucune navigation', () => {
    const provider = makeProvider('val x = R.plurals.p');
    const line = '  <!-- <plurals name="p"> -->';
    const doc  = xmlDoc(RES_URI, [line]);
    const pos  = new vscode.Position(0, line.indexOf('"p"') + 1);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs).toEqual([]);
  });
});

// ── ADV-SX-2 : Commentaire avant un vrai tag sur la même ligne ───────────────

describe('ADV-SX-2 — commentaire avant un vrai tag sur la même ligne', () => {
  it('<!-- note --> <string name="real"> → navigation correcte', () => {
    const provider = makeProvider('val x = R.string.real');
    const line = '<!-- note --> <string name="real">Real</string>';
    const doc  = xmlDoc(RES_URI, [line]);
    const pos  = new vscode.Position(0, line.indexOf('"real"') + 1);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
    expect(locs[0].uri.toString()).toBe(KT_URI);
  });
});

// ── ADV-SX-3 : Type de tag masqué par un commentaire ─────────────────────────

describe('ADV-SX-3 — tag type masqué par un commentaire', () => {
  it('<!-- <plurals --> <string name="key"> → type résolu = string, pas plurals', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(KT_URI, 'R.string.key\nR.plurals.key');
    const provider = new StringXmlDefinitionProvider(rIndex);

    const line = '<!-- <plurals name="key"> --> <string name="key">Key</string>';
    const doc  = xmlDoc(RES_URI, [line]);
    // Cursor on the SECOND name="key" (the real <string> one)
    const secondAttr = line.lastIndexOf('name="key"');
    const pos = new vscode.Position(0, secondAttr + 'name="'.length);
    const locs = provider.provideDefinition(doc, pos);

    // Should only return the R.string.key usage (line 0), not R.plurals.key (line 1)
    expect(locs.length).toBe(1);
    expect(locs[0].range.start.line).toBe(0); // R.string.key is on line 0
  });
});

// ── ADV-SX-4 : Positions frontières de l'attribut ────────────────────────────

describe('ADV-SX-4 — positions frontières de l\'attribut name="..."', () => {
  const provider = makeProvider('val x = R.string.key');
  const xmlLines = ['<resources>', '  <string name="key">Key</string>', '</resources>'];
  const line = xmlLines[1]; // '  <string name="key">Key</string>'
  const attrStart  = line.indexOf('name="key"');          // position of 'n'
  const attrEnd    = attrStart + 'name="key"'.length;     // position just after '"'

  it('cursor === attrStart (sur le "n" de name) → match', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, attrStart));
    expect(locs.length).toBe(1);
  });

  it('cursor === attrEnd - 1 (sur le "\\" fermant) → match', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, attrEnd - 1));
    expect(locs.length).toBe(1);
  });

  it('cursor === attrEnd (juste après le "\\" fermant) → pas de match', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, attrEnd));
    expect(locs).toEqual([]);
  });

  it('cursor === attrStart - 1 (juste avant "name") → pas de match', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, new vscode.Position(1, attrStart - 1));
    expect(locs).toEqual([]);
  });
});

// ── ADV-SX-5 : Filtre de chemin /res/ ────────────────────────────────────────

describe('ADV-SX-5 — filtre de chemin /res/', () => {
  const provider = makeProvider('val x = R.string.key');
  const xmlLines = ['<resources>', '  <string name="key">Key</string>', '</resources>'];
  const pos = new vscode.Position(1, xmlLines[1].indexOf('"key"') + 1);

  it('chemin contenant "/resources/" (pas "/res/") → exclu', () => {
    const RESOURCES_URI = 'file:///project/src/main/resources/values/strings.xml';
    const doc  = xmlDoc(RESOURCES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs).toEqual([]);
  });

  it('chemin contenant "/res/" → inclus', () => {
    const doc  = xmlDoc(RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
  });

  it('chemin type "file:///res/foo.xml" (res en racine) → inclus', () => {
    const ROOT_RES_URI = 'file:///res/values/strings.xml';
    const doc  = xmlDoc(ROOT_RES_URI, xmlLines);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
  });
});

// ── ADV-SX-6 : Attribut avant + attribut dans le commentaire ─────────────────

describe('ADV-SX-6 — attribut avant commentaire vs attribut dans commentaire', () => {
  it('name="before" hors commentaire → résolu ; name="inside" dans commentaire → ignoré', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(KT_URI, 'R.string.before\nR.string.inside');
    const provider = new StringXmlDefinitionProvider(rIndex);

    // "before" is outside the comment, "inside" is inside
    const line = '  <string name="before"> <!-- name="inside" --> </string>';
    const doc  = xmlDoc(RES_URI, ['<resources>', line, '</resources>']);

    // Cursor on "before" → match
    const posBeforeKey = line.indexOf('"before"') + 1;
    const locsReal = provider.provideDefinition(doc, new vscode.Position(1, posBeforeKey));
    expect(locsReal.length).toBe(1);
    expect(locsReal[0].range.start.line).toBe(0); // R.string.before is line 0

    // Cursor on "inside" → no match (it's inside a comment)
    const posInsideKey = line.indexOf('"inside"') + 1;
    const locsFake = provider.provideDefinition(doc, new vscode.Position(1, posInsideKey));
    expect(locsFake).toEqual([]);
  });
});

// ── ADV-SX-7 : Plusieurs spans de commentaires sur la même ligne ──────────────

describe('ADV-SX-7 — plusieurs spans de commentaires sur la même ligne', () => {
  it('<!-- a --> <string name="x"> <!-- b --> → "x" résolu', () => {
    const provider = makeProvider('val x = R.string.x');
    const line = '<!-- a --> <string name="x">X</string> <!-- b -->';
    const doc  = xmlDoc(RES_URI, [line]);
    const pos  = new vscode.Position(0, line.indexOf('"x"') + 1);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
  });

  it('deux faux tags dans deux commentaires séparés → aucune navigation', () => {
    const provider = makeProvider('val x = R.string.fakeA\nval y = R.string.fakeB');
    const line = '<!-- <string name="fakeA"> --> <!-- <string name="fakeB"> -->';
    const doc  = xmlDoc(RES_URI, [line]);

    const posA = new vscode.Position(0, line.indexOf('"fakeA"') + 1);
    const posB = new vscode.Position(0, line.indexOf('"fakeB"') + 1);
    expect(provider.provideDefinition(doc, posA)).toEqual([]);
    expect(provider.provideDefinition(doc, posB)).toEqual([]);
  });
});

// ── ADV-SX-8 : Clé avec chiffres et underscores ──────────────────────────────

describe('ADV-SX-8 — clé avec chiffres et underscores', () => {
  it('name="my_key_2" → résolution correcte', () => {
    const provider = makeProvider('val x = R.string.my_key_2');
    const line = '  <string name="my_key_2">Value</string>';
    const doc  = xmlDoc(RES_URI, ['<resources>', line, '</resources>']);
    const pos  = new vscode.Position(1, line.indexOf('"my_key_2"') + 1);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
    expect(locs[0].uri.toString()).toBe(KT_URI);
  });

  it('name="_private" (commence par underscore) → résolution correcte', () => {
    const provider = makeProvider('val x = R.string._private');
    const line = '  <string name="_private">Value</string>';
    const doc  = xmlDoc(RES_URI, ['<resources>', line, '</resources>']);
    const pos  = new vscode.Position(1, line.indexOf('"_private"') + 1);
    const locs = provider.provideDefinition(doc, pos);
    expect(locs.length).toBe(1);
  });
});
