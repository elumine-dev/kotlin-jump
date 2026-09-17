import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-062 — un test qui nomme l evenement peut VERIFIER le post.
 *
 * `verify { bus.post(OpenedEvent(url, null)) }` sur un bus mocke : retirer le
 * post compile, et ce test echoue a l execution, ce qu aucun balayage du code
 * principal ne voit. Sur le projet de reference, la regle de branche a retire
 * le seul post d un evenement que `DeepLinkIntentControllerTest` verifiait :
 * deux tests rouges, build vert. L humain a retire ces tests avec l evenement.
 *
 * Ici le post est retenu avec sa raison, pour la relecture qui montre au
 * lecteur quoi cocher ; une fois tous les posts partis, l evenement est
 * testOnly et ses tests reviennent au planificateur de fermeture.
 */

const mod: any = await importOrNull('src/providers/unheardEvents');

const MAIN = '/w/app/src/main/kotlin/com/x';
const TEST = '/w/app/src/test/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin'];
const BUS = {
  path: `${MAIN}/Bus.kt`,
  text: 'package com.x\n\nobject BusProvider {\n    fun getInstance(): Bus = Bus\n}\n\nobject Bus {\n    fun post(e: Any) {}\n    fun register(o: Any) {}\n}\n',
};
const EVENTS = { path: `${MAIN}/Events.kt`, text: 'package com.x\n\nclass LuEvent\nclass OpenedEvent(val url: String, val source: String?)\n' };
const LU = {
  path: `${MAIN}/Listener.kt`,
  text: 'package com.x\n\nclass Listener {\n    fun start() { BusProvider.getInstance().register(this) }\n\n    @Subscribe\n    fun onBusEvent(e: LuEvent) {}\n}\n',
};
const POSTER = {
  path: `${MAIN}/Router.kt`,
  text: 'package com.x\n\nclass Router {\n    fun route(url: String) {\n        before()\n        BusProvider.getInstance().post(OpenedEvent(url, null))\n        after()\n    }\n}\n',
};
const scan = (extra: { path: string; text: string }[]) =>
  mod.findUnheardEvents({ sources: [BUS, EVENTS, LU, POSTER, ...extra], testSourceSets: SEGS, truncated: false });
const site = (extra: { path: string; text: string }[]) => {
  const found = (scan(extra).events as any[]).filter(e => e.name === 'OpenedEvent');
  expect(found, 'le temoin doit produire une trouvaille, sinon il ne prouve rien').toHaveLength(1);
  return found[0];
};

describe.skipIf(!mod)('un test qui nomme l evenement retient le post', () => {
  it('sans test : le post part, comme avant', () => {
    const e = site([]);
    expect(e.verdict).toBe('unheard');
    expect(POSTER.text.slice(e.removeStart, e.removeEnd)).toBe('        BusProvider.getInstance().post(OpenedEvent(url, null))\n');
    expect(e.withheld).toBeUndefined();
  });

  it('un test qui verifie le post : retenu, avec le test sur la raison', () => {
    const test = {
      path: `${TEST}/RouterTest.kt`,
      text: 'package com.x\n\nimport io.mockk.verify\nimport org.junit.Test\n\nclass RouterTest {\n    @Test\n    fun posts() {\n        Router().route("u")\n        verify { bus.post(OpenedEvent("u", null)) }\n    }\n}\n',
    };
    const e = site([test]);
    expect(e.verdict).toBe('unheard');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('tests name OpenedEvent (RouterTest.kt) and may verify this post');
  });

  it('un test qui ne fait qu importer le nom ne retient rien', () => {
    const test = {
      path: `${TEST}/OtherTest.kt`,
      text: 'package com.x\n\nimport com.x.OpenedEvent\nimport org.junit.Test\n\nclass OtherTest {\n    @Test\n    fun t() { check(1 == 1) }\n}\n',
    };
    const e = site([test]);
    expect(e.removeStart).toBeGreaterThan(0);
    expect(e.withheld).toBeUndefined();
  });

  it('une source PRINCIPALE qui nomme l evenement ne compte pas comme un test', () => {
    // Un deuxieme fichier principal qui construit l evenement est un autre
    // site de post, pas un test qui verifie.
    const other = { path: `${MAIN}/Other.kt`, text: 'package com.x\n\nclass Other {\n    fun go() {\n        first()\n        BusProvider.getInstance().post(OpenedEvent("o", null))\n        last()\n    }\n}\n' };
    const found = (scan([other]).events as any[]).filter(e => e.name === 'OpenedEvent');
    expect(found).toHaveLength(2);
    for (const e of found) expect(e.withheld).toBeUndefined();
  });
});
