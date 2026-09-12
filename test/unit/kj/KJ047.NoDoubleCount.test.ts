import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { findEverythingUnusedCommand } from '../../../src/commands/FindEverythingUnused';
import { UnusedEnumEntryProvider } from '../../../src/providers/UnusedEnumEntryProvider';
import { DeadIslandProvider } from '../../../src/providers/DeadIslandProvider';

/**
 * Le nombre en tete du resume est la somme des sections, donc chaque trouvaille
 * doit appartenir a UNE section.
 *
 * Les sections symboles et membres ont toujours exclu leurs verdicts testOnly
 * de leur compte. Les sections entrees d'enum et ilots, non. La ligne « tenu en
 * vie par ses tests » ajoutee en 1.42.222 les recomptait donc : sur
 * /Users/kevin/Desktop/work/lapresse, onze trouvailles comptees deux fois dans
 * le total, 3 entrees d'enum et 8 ilots.
 */

const SOURCES = [
  {
    path: '/w/app/src/main/kotlin/com/x/K.kt',
    text: ['package com.x', '', 'enum class K { USED, TESTED }', '', 'class Api { fun go() = K.USED }', ''].join('\n'),
  },
  {
    path: '/w/app/src/test/kotlin/com/x/KTest.kt',
    text: ['package com.x', '', 'class KTest {', '    @Test', '    fun t() { assertEquals(K.TESTED, x) }', '}', ''].join('\n'),
  },
];

/** Un ilot de deux declarations qui ne se tiennent qu entre elles, teste. */
const SOURCES_ILOT = [
  {
    path: '/w/app/src/main/kotlin/com/x/Widget.kt',
    text: ['package com.x', '', 'class Widget {', '    fun draw() { if (SHOW_DEBUG) println("x") }', '}', '',
      'internal const val SHOW_DEBUG = false', ''].join('\n'),
  },
  {
    path: '/w/app/src/test/kotlin/com/x/WidgetTest.kt',
    text: ['package com.x', '', 'class WidgetTest {', '    @Test', '    fun `off`() { assertFalse(SHOW_DEBUG) }', '}', ''].join('\n'),
  },
];

const corpusDe = (sources: any[]): any => ({
  get: async () => ({
    sources, moduleDirs: [], modulesWithCode: [], libraryModules: [],
    index: { entries: () => [] },
    truncated: false, sourcesTruncated: false,
  }),
});
const corpus = corpusDe(SOURCES);
const stubProvider: any = { setFindings: () => {}, setUnreadable: () => {}, setScan: () => {} };

afterEach(() => { vi.restoreAllMocks(); delete (vscodeMock.workspace as any).workspaceFolders; });

async function resume(
  actives: Set<string>,
  quelCorpus: any = corpus,
  allumer: () => void = () => vi.spyOn(UnusedEnumEntryProvider, 'isEnabled').mockReturnValue(true),
): Promise<string> {
  const ACTIVES = actives;
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w') }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (typeof def === 'boolean' && !ACTIVES.has(cle) ? false : def),
  } as any);
  (vscodeMock.window as any).withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  let message = '';
  (vscodeMock.window as any).showInformationMessage = async (m: string) => { message = m; return undefined; };
  (vscodeMock.window as any).showWarningMessage = async () => undefined;
  allumer();
  await findEverythingUnusedCommand(
    quelCorpus, stubProvider, stubProvider, stubProvider, stubProvider, stubProvider,
    stubProvider, stubProvider, stubProvider, stubProvider, stubProvider,
  );
  return message;
}

describe('Find Everything Unused — le total ne compte rien deux fois', () => {
  const ENUM = new Set(['unusedEnumEntries', 'unusedEnumEntriesIncludeTestOnly']);
  const ILOT = new Set(['deadIslands', 'unusedSymbolsIncludeTestOnly']);

  it('une entree d enum testOnly compte pour UNE trouvaille, pas deux', async () => {
    const m = await resume(ENUM);
    expect(m, m).toMatch(/^1 finding /);
  });

  it('elle est portee par la ligne des tests, pas par celle des enums', async () => {
    const m = await resume(ENUM);
    expect(m).toContain('kept alive only by its tests');
    expect(m).not.toContain('enum entry ·');
    expect(m).not.toContain('enum entries');
  });

  it('un ilot testOnly compte pour UNE trouvaille, pas deux', async () => {
    const m = await resume(ILOT, corpusDe(SOURCES_ILOT),
      () => vi.spyOn(DeadIslandProvider, 'isEnabled').mockReturnValue(true));
    expect(m, m).toMatch(/^1 finding /);
  });

  it('il est porte par la ligne des tests, pas par celle des ilots', async () => {
    const m = await resume(ILOT, corpusDe(SOURCES_ILOT),
      () => vi.spyOn(DeadIslandProvider, 'isEnabled').mockReturnValue(true));
    expect(m).toContain('kept alive only by its tests');
    expect(m).not.toContain('dead island');
  });
});
