import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Uri, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { advanceLineState, scanForUsagesWithTarget } from '../../src/providers/FindUsagesEngine';
import { displayNameOf, resultFor } from '../../src/testing/GradleTestRunner';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// Audit 29 : régressions introduites par nos propres correctifs des versions
// 1.42.26 et 1.42.30, trouvées par la chasse adversariale.

const token = { isCancellationRequested: false } as any;

describe('État de fin de ligne du moteur d\'usages', () => {
  it('un """ écrit dans un commentaire n\'ouvre pas de chaîne brute', () => {
    expect(advanceLineState('val header = 1 // TODO: passer en """ raw string')).toEqual({ raw: false, block: false });
    expect(advanceLineState('val a = 1 /* on garde """ pour plus tard')).toEqual({ raw: false, block: true });
    expect(advanceLineState('/* note """ */ val b = 2')).toEqual({ raw: false, block: false });
  });

  it('une vraie chaîne brute ouvre et referme', () => {
    expect(advanceLineState('val sql = """')).toEqual({ raw: true, block: false });
    expect(advanceLineState('val sql = """SELECT 1"""')).toEqual({ raw: false, block: false });
    expect(advanceLineState('  FROM t """', 0, { raw: true, block: false })).toEqual({ raw: false, block: false });
  });

  it('une URL dans une chaîne simple n\'est pas un commentaire', () => {
    expect(advanceLineState('val url = "http://x.io" + """')).toEqual({ raw: true, block: false });
  });
});

describe('Un commentaire ne doit pas faire disparaître les usages', () => {
  let origRead: any;
  let origOpen: any;
  beforeEach(() => { origRead = workspace.fs.readFile; origOpen = workspace.openTextDocument; });
  afterEach(() => { workspace.fs.readFile = origRead; workspace.openTextDocument = origOpen; });

  function fileSet(files: Record<string, string>): SymbolIndex {
    const index = new SymbolIndex();
    for (const [uri, code] of Object.entries(files)) index.add(parse(uri, code));
    workspace.fs.readFile = (async (u: any) => Buffer.from(files[u.toString()] ?? '')) as any;
    workspace.openTextDocument = (async (u: any) => mockDocument(u.toString(), files[u.toString()] ?? '')) as any;
    return index;
  }

  it('un // contenant """ ne masque pas les appels des lignes suivantes', async () => {
    const decl = 'file:///a29/Repo.kt';
    const use = 'file:///a29/Screen.kt';
    const index = fileSet({
      [decl]: 'package app\nfun loadUser(): Int = 1',
      [use]: 'package app\nval header = 1 // TODO: passer en """ raw string\nfun render() = loadUser()\nfun again() = loadUser()',
    });
    const target = index.lookup('loadUser')[0];
    const hits = await scanForUsagesWithTarget('loadUser', target, index, [use], token);
    // Sans le correctif : aucun résultat, et le renommage laissait l'ancien nom.
    expect(hits.map(h => h.line)).toEqual([2, 3]);
  });

  it('un commentaire de bloc contenant """ se referme normalement', async () => {
    const decl = 'file:///a29/Decl.kt';
    const use = 'file:///a29/Use.kt';
    const index = fileSet({
      [decl]: 'package app\nval userId = 1',
      [use]: 'package app\nval a = 1 /* on garde """ pour plus tard\n   texte\n*/\nfun f() = userId',
    });
    const target = index.lookup('userId')[0];
    const hits = await scanForUsagesWithTarget('userId', target, index, [use], token);
    expect(hits.map(h => h.line)).toEqual([4]);
  });
});

describe('Nom d\'affichage JUnit et méthode voisine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a29-'));
  const file = path.join(dir, 'CalcTest.kt');
  fs.writeFileSync(file, [
    'package com.app',
    'class CalcTest {',
    '    @DisplayName("adds two numbers")',
    '    @Test fun add() = check(1)',
    '    @Test fun sub() = check(2)',
    '',
    '    @DisplayName("first")',
    '    @Test fun a() = go()',
    '    // helper',
    '',
    '    @Test',
    '    fun b() = go()',
    '}',
  ].join('\n'));
  const entryAt = (name: string, line: number) =>
    ({ fqn: `com.app.CalcTest.${name}`, name, packageName: 'com.app', line, uri: { fsPath: file } } as any);

  it('un test ne prend pas le @DisplayName de son voisin', () => {
    const cache = new Map();
    expect(displayNameOf(entryAt('add', 3), cache)).toBe('adds two numbers');
    // `@Test fun add()` est une déclaration, pas une ligne d'annotation : la
    // remontée doit s'arrêter là.
    expect(displayNameOf(entryAt('sub', 4), cache)).toBeUndefined();
    // Une ligne vide coupe aussi la remontée.
    expect(displayNameOf(entryAt('b', 11), cache)).toBeUndefined();
    expect(displayNameOf(entryAt('a', 7), cache)).toBe('first');
  });

  it('le résultat d\'un test ne contamine pas le suivant', () => {
    const results = new Map<string, any>([
      ['com.app.CalcTest.adds two numbers', { classFqn: 'com.app.CalcTest', methodName: 'adds two numbers', state: 'failed', message: 'boom' }],
    ]);
    const cache = new Map();
    expect(resultFor(entryAt('add', 3), results, cache)?.state).toBe('failed');
    expect(resultFor(entryAt('sub', 4), results, cache)).toBeUndefined();
  });
});
