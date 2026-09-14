import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { scanTestOnly } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Une entree d enum homonyme, gardee en vie par ses seuls tests, ne part pas
 * avec les tests de l AUTRE entree du meme nom.
 *
 * Depuis la resolution par enum (v1.42.328), `MediaSource.FEED` peut etre
 * `testOnly` pendant que `EventSource.FEED` vit en main. Avant, toute mention
 * de `FEED` en main gardait les deux, et la question ne se posait pas. Or le
 * plan des tests a retirer cherche le NOM : un test qui importe
 * `com.e.EventSource.FEED` et n ecrit que `FEED` n exerce aucun autre nom du
 * code principal, il passait donc pour un test de `MediaSource.FEED`, et le
 * code vivant perdait son test.
 */

const K = 'app/src/main/java';
const T = 'app/src/test/java';
const f = (path: string, text: string) => ({ path, text });

const sources = (autreTest: string) => [
  f(`${K}/com/m/MediaSource.kt`, 'package com.m\n\nenum class MediaSource {\n    FEED,\n    CARD,\n}\n'),
  f(`${K}/com/e/EventSource.kt`, 'package com.e\n\nenum class EventSource {\n    FEED,\n}\n'),
  f(`${K}/com/u/Use.kt`, 'package com.u\n\nimport com.e.EventSource\nimport com.m.MediaSource\n\nfun main() { println(EventSource.FEED); println(MediaSource.CARD) }\n'),
  f(`${T}/com/m/MediaSourceTest.kt`, 'package com.m\n\nclass MediaSourceTest {\n    @Test\n    fun feed() { check(MediaSource.FEED.ordinal == 0) }\n}\n'),
  f(`${T}/com/e/EventSourceTest.kt`, autreTest),
];

const corpus = (s: ReturnType<typeof sources>): any => ({
  get: async () => ({ sources: s, moduleDirs: [], modulesWithCode: [], libraryModules: [], truncated: false, sourcesTruncated: false }),
});

describe('co-suppression des tests d une entree homonyme', () => {
  afterEach(() => vi.restoreAllMocks());
  const config = () => vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);

  it('le test de EventSource.FEED ecrit nu par import reste intact', async () => {
    config();
    const scan = await scanTestOnly(corpus(sources(
      'package com.e\n\nimport com.e.EventSource.FEED\n\nclass EventSourceTest {\n    @Test\n    fun feed() { check(FEED.ordinal == 0) }\n}\n')));
    const touches = scan!.groups.flatMap(g => [...g.plan.files, ...g.plan.cuts.map(c => c.path)]);
    expect(touches.some(p => p.endsWith('EventSourceTest.kt'))).toBe(false);
  });

  it('mentions indiscernables (une chaine) : rien n est propose, meme pour un enum parcouru ailleurs', async () => {
    // `EventSource.entries` le met hors des trouvailles, et la chaine rend la
    // resolution incertaine : le compte retombe sur le nom, MediaSource.FEED
    // sort testOnly, et son plan par nom emportait le test de l enum parcouru.
    config();
    const s = sources('package com.e\n\nimport com.e.EventSource.FEED\n\nclass EventSourceTest {\n    @Test\n    fun feed() { check(FEED.name == "FEED") }\n}\n')
      .map(x => x.path.endsWith('Use.kt')
        ? f(x.path, 'package com.u\n\nimport com.e.EventSource\nimport com.m.MediaSource\n\nfun main() { println(EventSource.entries.size); println(MediaSource.CARD) }\n')
        : x);
    const scan = await scanTestOnly(corpus(s));
    const touches = scan!.groups.flatMap(g => [...g.plan.files, ...g.plan.cuts.map(c => c.path)]);
    expect(touches.some(p => p.endsWith('EventSourceTest.kt'))).toBe(false);
  });

  it('temoin : le test de MediaSource.FEED, lui, est bien propose', async () => {
    config();
    const scan = await scanTestOnly(corpus(sources(
      'package com.e\n\nclass EventSourceTest {\n    @Test\n    fun other() { check(true) }\n}\n')));
    expect(scan!.groups.map(g => g.group.label)).toEqual(['MediaSource.FEED']);
    expect(scan!.groups[0].plan.files).toEqual([`${T}/com/m/MediaSourceTest.kt`]);
  });
});
