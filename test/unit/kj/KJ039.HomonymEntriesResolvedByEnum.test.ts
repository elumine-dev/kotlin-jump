import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries, explainEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * Des entrees d enum homonymes, chacune dans son enum.
 *
 * Le detecteur soustrayait le nombre de declarations du nombre de mentions du
 * nom : une seule mention de `FEED` n importe ou gardait vivantes toutes les
 * entrees `FEED` du projet. Sur le projet de reference, 318 entrees etaient
 * gardees ainsi, dont `MediaSource.FEED` que rien n utilise : seules ses soeurs
 * `CARD` et `IRRELEVANT` servent, les `FEED` ecrits ailleurs sont ceux
 * d `EventSource`, `SummarySource` ou `FeedItemContainer`.
 *
 * Une mention se rattache a un enum quand elle est qualifiee par son nom, ou
 * ecrite nue dans son propre fichier, ou nue dans un fichier Kotlin qui importe
 * l entree ou toutes les entrees de cet enum. Tout le reste est un doute : nue
 * en Java (un `case` de `switch` ne qualifie jamais), nue en Kotlin sans import
 * qui l explique, dans une chaine, derriere un qualificatif inconnu.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const K = '/w/app/src/main/kotlin';
const f = (path: string, text: string) => ({ path, text });
const names = (sources: any[]) =>
  findUnusedEnumEntries({ sources, testSourceSets: TEST_SETS }).map((e: any) => `${e.enumName}.${e.name}`).sort();

const media = f(`${K}/com/m/MediaCache.kt`, 'package com.m\n\nenum class MediaSource {\n    FEED,\n    CARD,\n}\n\nfun key(s: MediaSource) = s.name\n');
const event = f(`${K}/com/e/EventSource.kt`, 'package com.e\n\nenum class EventSource {\n    FEED,\n    CARD,\n}\n');
const base = () => [
  media,
  event,
  f(`${K}/com/u/Use.kt`, 'package com.u\n\nimport com.e.EventSource\nimport com.m.MediaSource\n\nfun a() = EventSource.FEED\nfun b() = MediaSource.CARD\nfun c() = EventSource.CARD\n'),
];

describe('une entree homonyme se rattache a son enum', () => {
  it('le cas du projet de reference : seule MediaSource.FEED sort', () => {
    expect(names(base())).toEqual(['MediaSource.FEED']);
    const why = explainEnumEntries({ sources: base(), testSourceSets: TEST_SETS })
      .filter(e => e.name === 'FEED').map(e => `${e.enumName} ${e.outcome}`).sort();
    expect(why).toEqual(['EventSource alive:main', 'MediaSource unreferenced']);
  });

  it('qualifiee par le paquet complet : vivante', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nfun z() = com.m.MediaSource.FEED\n');
    expect(names([...base(), z])).toEqual([]);
  });

  it('importee par son nom depuis Kotlin : vivante', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.m.MediaSource.FEED\n\nfun z() = FEED\n');
    expect(names([...base(), z])).toEqual([]);
  });

  it('toutes ses entrees importees depuis Kotlin : vivante', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.m.MediaSource.*\n\nfun z() = FEED\n');
    expect(names([...base(), z])).toEqual([]);
  });

  it('nue en Kotlin, expliquee par l import de l AUTRE enum : ne la garde pas', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.e.EventSource.FEED\n\nfun z() = FEED\n');
    expect(names([...base(), z])).toEqual(['MediaSource.FEED']);
  });

  it('nue dans son corps, meme si le fichier importe l entree de l AUTRE enum : vivante', () => {
    const nue = f(media.path, 'package com.m\n\nimport com.e.EventSource.FEED\n\nenum class MediaSource {\n    FEED,\n    CARD;\n\n    fun first() = this == FEED\n}\n');
    expect(names([nue, event, base()[2]])).toEqual([]);
  });

  it('nue dans son propre fichier : vivante', () => {
    const soi = f(media.path, media.text.replace('fun key', 'fun isFeed(s: MediaSource) = s == MediaSource.CARD || s.ordinal == 0 && FEED_OK\nval FEED_OK = true\nfun key'));
    const nue = f(media.path, 'package com.m\n\nenum class MediaSource {\n    FEED,\n    CARD;\n\n    fun first() = this == FEED\n}\n');
    expect(names([nue, event, base()[2]])).toEqual([]);
    expect(names([soi, event, base()[2]])).toEqual(['MediaSource.FEED']);
  });
});

describe('les doutes gardent toutes les homonymes', () => {
  it('nue en Java meme avec l import statique de l AUTRE enum : le switch se resout par son sujet', () => {
    const j = f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nimport static com.e.EventSource.FEED;\n\nclass J { int f(com.m.MediaSource s) { switch (s) { case FEED: return 1; default: return 0; } } }\n');
    expect(names([...base(), j])).toEqual([]);
  });

  it('nue en Java : un case de switch ne qualifie jamais', () => {
    const j = f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nclass J { int f(com.m.MediaSource s) { switch (s) { case FEED: return 1; default: return 0; } } }\n');
    expect(names([...base(), j])).toEqual([]);
  });

  it('nue en Kotlin sans import qui l explique : la resolution contextuelle peut la lier', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.m.MediaSource\n\nval m: MediaSource = FEED\n');
    expect(names([...base(), z])).toEqual([]);
  });

  it('dans une chaine : valueOf ou un serialiseur la lit par son nom', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nval raw = "FEED"\n');
    expect(names([...base(), z])).toEqual([]);
  });

  it('derriere un qualificatif qui n est pas un enum qui la declare : doute', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nfun z(x: Any) = source().FEED\n');
    expect(names([...base(), z])).toEqual([]);
    const alias = f(`${K}/com/z/Z.kt`, 'package com.z\n\ntypealias Src = com.m.MediaSource\n\nfun z() = Src.FEED\n');
    expect(names([...base(), alias])).toEqual([]);
  });

  it('import avec alias : doute', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.m.MediaSource.FEED as F\n\nfun z() = F\n');
    expect(names([...base(), z])).toEqual([]);
  });
});

describe('le verdict de test suit la meme resolution', () => {
  it('seul un test de l AUTRE enum la nomme : non referencee, pas testOnly', () => {
    const t = f('/w/app/src/test/kotlin/com/e/ETest.kt', 'package com.e\n\nfun t() = EventSource.FEED\n');
    const found = findUnusedEnumEntries({ sources: [...base(), t], testSourceSets: TEST_SETS });
    expect(found.map((e: any) => `${e.enumName}.${e.name} ${e.verdict} ${e.testMentions}`)).toEqual(['MediaSource.FEED unreferenced 0']);
  });

  const seulementEnTest = (t: { path: string; text: string }, autres: Array<{ path: string; text: string }> = []) =>
    findUnusedEnumEntries({ sources: [...base(), ...autres, t], testSourceSets: TEST_SETS })
      .map((e: any) => `${e.enumName}.${e.name} ${e.verdict} ${e.testMentions}`);

  it('un test Kotlin qui importe l entree de SON enum : testOnly', () => {
    const t = f('/w/app/src/test/kotlin/com/z/ZTest.kt', 'package com.z\n\nimport com.m.MediaSource.FEED\n\nfun t() = FEED\n');
    expect(seulementEnTest(t)).toEqual(['MediaSource.FEED testOnly 1']);
  });

  it('un test Kotlin qui importe toutes les entrees de SON enum : testOnly', () => {
    const t = f('/w/app/src/test/kotlin/com/z/ZTest.kt', 'package com.z\n\nimport com.m.MediaSource.*\n\nfun t() = FEED\n');
    expect(seulementEnTest(t)).toEqual(['MediaSource.FEED testOnly 1']);
  });

  it('nue dans le corps d un AUTRE enum homonyme : sans position, doute, rien ne sort', () => {
    // Le `FEED` nu de `Local` est le sien, mais rien ne dit ou finit son corps.
    const t = f('/w/app/src/test/kotlin/com/m/Local.kt', 'package com.m\n\nenum class Local {\n    FEED;\n\n    fun first() = this == FEED\n}\n');
    expect(seulementEnTest(t)).toEqual([]);
  });

  it('le drapeau des tests : faux des qu un test nomme l entree d un autre enum, qualifiee ou importee', () => {
    const drapeau = (autres: Array<{ path: string; text: string }>) =>
      findUnusedEnumEntries({ sources: [...base(), f('/w/app/src/test/kotlin/com/m/MTest.kt', 'package com.m\n\nfun t() = MediaSource.FEED\n'), ...autres], testSourceSets: TEST_SETS })
        .map((e: any) => `${e.enumName}.${e.name} ${e.testsNameOnlyThisEntry}`);
    expect(drapeau([])).toEqual(['MediaSource.FEED true']);
    expect(drapeau([f('/w/app/src/test/kotlin/com/e/ETest.kt', 'package com.e\n\nfun t() = EventSource.FEED\n')]))
      .toEqual(['MediaSource.FEED false']);
    expect(drapeau([f('/w/app/src/test/kotlin/com/z/ZTest.kt', 'package com.z\n\nimport com.e.EventSource.FEED\n\nfun t() = FEED\n')]))
      .toEqual(['MediaSource.FEED false']);
  });

  it('un test de SON enum la nomme : testOnly', () => {
    const t = f('/w/app/src/test/kotlin/com/m/MTest.kt', 'package com.m\n\nfun t() = MediaSource.FEED\n');
    const found = findUnusedEnumEntries({ sources: [...base(), t], testSourceSets: TEST_SETS });
    expect(found.map((e: any) => `${e.enumName}.${e.name} ${e.verdict} ${e.testMentions}`)).toEqual(['MediaSource.FEED testOnly 1']);
  });
});

describe('une declaration de test ne se soustrait pas des mentions du code principal', () => {
  // Present avant la resolution par enum : le compte des declarations incluait
  // les enums des tests, dont la declaration est recoltee cote test. Une entree
  // utilisee une fois en main, homonyme d une entree d un enum de test, tombait
  // a zero mention et sortait comme morte.
  const mode = f(`${K}/com/x/Mode.kt`, 'package com.x\n\nenum class Mode {\n    ALLOW,\n}\n');
  const use = f(`${K}/com/x/Gate.kt`, 'package com.x\n\nfun go() = Mode.ALLOW\n');
  const testEnum = f('/w/app/src/test/kotlin/com/x/TestMode.kt', 'package com.x\n\nenum class TestMode {\n    ALLOW,\n}\n');
  // Une chaine rend la resolution incertaine : on retombe sur le compte brut.
  const chaine = f('/w/app/src/test/kotlin/com/x/GateTest.kt', 'package com.x\n\nval raw = "ALLOW"\n');

  it('utilisee en main : vivante', () => {
    expect(names([mode, use, testEnum, chaine])).toEqual([]);
    expect(explainEnumEntries({ sources: [mode, use, testEnum, chaine], testSourceSets: TEST_SETS })
      .filter(e => e.enumName === 'Mode').map(e => e.outcome)).toEqual(['alive:main']);
  });

  it('inutilisee en main, nommee par un test : testOnly, sans compter la declaration de test', () => {
    const t = f('/w/app/src/test/kotlin/com/x/ModeTest.kt', 'package com.x\n\nfun t() = Mode.ALLOW\n');
    const found = findUnusedEnumEntries({ sources: [mode, testEnum, chaine, t], testSourceSets: TEST_SETS });
    expect(found.map((e: any) => `${e.enumName}.${e.name} ${e.verdict} ${e.testMentions}`)).toEqual(['Mode.ALLOW testOnly 2']);
  });
});
