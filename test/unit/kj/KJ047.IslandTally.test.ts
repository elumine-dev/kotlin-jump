import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { scanTestOnly } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Un ilot pousse UN GROUPE PAR MEMBRE, et tous partagent le meme plan : c'est
 * le seul moyen de couper chaque membre a sa place tout en ne planifiant les
 * tests qu'une fois. Le comptage, lui, etait fait par groupe, donc un ilot de
 * deux membres annonçait deux fois les tests qu'il supprime reellement.
 *
 * Le message que voit l'utilisateur est la seule sortie de cette commande qui
 * dise combien de tests partent. Un compte gonfle y est un mensonge.
 */

const SOURCES = [
  {
    path: 'app/src/main/java/com/x/Widget.kt',
    text: [
      'package com.x', '',
      'class Widget {', '    fun draw() { if (SHOW_DEBUG) println("x") }', '}', '',
      'internal const val SHOW_DEBUG = false', '',
    ].join('\n'),
  },
  {
    path: 'app/src/test/java/com/x/WidgetTest.kt',
    text: [
      'package com.x', '',
      'class WidgetTest {', '    @Test', '    fun `flag is off`() { assertFalse(SHOW_DEBUG) }', '}', '',
    ].join('\n'),
  },
];

const corpus: any = {
  get: async () => ({
    sources: SOURCES,
    moduleDirs: [],
    modulesWithCode: [],
    libraryModules: [],
    truncated: false,
    sourcesTruncated: false,
  }),
};

describe('scanTestOnly — le compte des tests d un ilot', () => {
  it('un ilot de deux membres ne compte ses tests qu une fois', async () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (_k: string, d: any) => d,
    } as any);
    const scan = await scanTestOnly(corpus);
    expect(scan).toBeDefined();
    // Deux membres, donc deux groupes, mais un seul plan et un seul test.
    expect(scan!.groups.length).toBe(2);
    expect(scan!.offered).toBe(1);
    expect(scan!.testFunctions).toBe(1);
    expect(scan!.testFiles.size).toBe(1);
    vi.restoreAllMocks();
  });
});
