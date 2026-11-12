import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/cleanup/passe';

/**
 * A pass cuts what nothing names. What only tests name, and a drawable nothing
 * names, are seen and left alone: a report has to be able to say so, and no
 * cut may be made of them.
 */

const f = (path: string, text: string) => ({ path, text });
const MAIN = '/w/app/src/main/kotlin/com/x';
const SOURCES = [
  f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n"),
  f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    println(1)\n}\n'),
  f(`${MAIN}/Dead.kt`, 'package com.x\n\nclass DeadForGood\n'),
  f(`${MAIN}/Probe.kt`, 'package com.x\n\nclass OnlyTestsKnowMe {\n    fun answer() = 42\n}\n'),
  f('/w/app/src/test/kotlin/com/x/ProbeTest.kt', 'package com.x\n\nclass ProbeTest {\n    fun t() { OnlyTestsKnowMe().answer() }\n}\n'),
];
const DRAWABLE = '/w/app/src/main/res/drawable/ic_forgotten.png';
const CTX = {
  modulesWithCode: ['/w/app'], libraryModules: [], moduleDirs: ['/w/app'],
  resourceEntries: [{ kind: 'drawable', name: 'ic_forgotten', variants: [{ path: DRAWABLE, qualifier: 'drawable', moduleDir: '/w/app' }] }] as any,
};

describe('what a pass sees and leaves alone', () => {
  const passe = collecterUnePasse(SOURCES, ['/src/test/'], CTX);
  const coupes = [...passe.parFichier.values()].flat().map(c => c.quoi);

  it('cuts the declaration nothing names, so the fixture is not silent', () => {
    expect(coupes).toContain('DeadForGood');
  });

  it('hands back the class only tests name, at its line, and cuts nothing of it', () => {
    const vu = passe.aRevoir.find(a => a.quoi === 'OnlyTestsKnowMe');
    expect(vu).toMatchObject({ path: `${MAIN}/Probe.kt`, line: 2, famille: 'symboles', raison: 'testOnly' });
    expect(coupes).not.toContain('OnlyTestsKnowMe');
    expect(passe.parFichier.has(`${MAIN}/Probe.kt`)).toBe(false);
  });

  it('hands back the drawable nothing names, and deletes no file for it', () => {
    expect(passe.aRevoir.filter(a => a.raison === 'reviewOnly'))
      .toEqual([{ path: DRAWABLE, line: 0, famille: 'ressources', quoi: 'drawable/ic_forgotten', raison: 'reviewOnly' }]);
    expect([...passe.fichiersMorts]).not.toContain(DRAWABLE);
  });

  it('does not doubt what it cuts: a dead function of an island tests keep is cut, and only cut', () => {
    // `helper` lives through the test, `entry` through nobody: the island is
    // testOnly as a whole, yet `entry` alone is a plain dead declaration.
    const island = [
      ...SOURCES,
      f(`${MAIN}/Island.kt`, 'package com.x\n\nfun entryNobodyCalls(): Int = helperTestsCall()\n\nfun helperTestsCall(): Int = 7\n'),
      f('/w/app/src/test/kotlin/com/x/IslandTest.kt', 'package com.x\n\nclass IslandTest {\n    fun t() { helperTestsCall() }\n}\n'),
    ];
    const p = collecterUnePasse(island, ['/src/test/'], CTX);
    const cut = [...p.parFichier.values()].flat().map(c => c.quoi);
    expect(cut).toContain('entryNobodyCalls');
    expect(p.aRevoir.map(a => a.quoi)).not.toContain('entryNobodyCalls');
    expect(p.aRevoir.map(a => a.quoi)).toContain('helperTestsCall');
  });

  it('names a spot once, even when two families saw it', () => {
    // `doorTestsOpen` is a test-only symbol AND the head of a test-only island.
    const twice = [
      ...SOURCES,
      f(`${MAIN}/Twice.kt`, 'package com.x\n\nfun doorTestsOpen(): Int = roomBehindTheDoor()\n\nfun roomBehindTheDoor(): Int = 7\n'),
      f('/w/app/src/test/kotlin/com/x/TwiceTest.kt', 'package com.x\n\nclass TwiceTest {\n    fun t() { doorTestsOpen() }\n}\n'),
    ];
    const vus = collecterUnePasse(twice, ['/src/test/'], CTX).aRevoir;
    expect(vus.map(a => a.quoi)).toContain('doorTestsOpen');
    const spots = vus.map(a => `${a.path}:${a.line}:${a.quoi}`);
    expect(spots.filter((s, i) => spots.indexOf(s) !== i)).toEqual([]);
  });

  it('says nothing of a dead declaration: that one is a cut, not a doubt', () => {
    expect(passe.aRevoir.map(a => a.quoi)).not.toContain('DeadForGood');
  });
});
