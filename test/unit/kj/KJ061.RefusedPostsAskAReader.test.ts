import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-061 — les posts d un evenement inaudible que la suppression sure a
 * refuses, offerts a un lecteur avec la raison du refus.
 *
 * `findUnheardEvents` prouve qu un evenement n a aucun abonne, puis refuse
 * de couper un post dont le retrait n est pas evidemment sur : un argument
 * qui appelle quelque chose, par exemple. Sur le projet de reference un seul
 * post de cette forme gardait en vie une classe d evenement, une constante
 * et vingt-neuf lignes de tests. Un humain sait que `decode()` est pur ; un
 * balayage textuel ne le sait pas. La liste ici porte l instruction entiere
 * et la raison, rien n est retire.
 */

const mod: any = await importOrNull('src/providers/unprovenPosts');

const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

const EVENT = {
  path: 'app/src/main/java/com/x/Events.kt',
  text: 'package com.x\n\ndata class OpenedEvent(val url: String, val source: String? = null)\n',
};
// Sans un `register`, le detecteur n apprend pas le bus et ne signale RIEN :
// la meme forme que le temoin KJ056.
const BUS = {
  path: 'app/src/main/java/com/x/Bus.kt',
  text: 'package com.x\n\nobject BusProvider {\n    fun getInstance(): Bus = Bus\n}\n\nobject Bus {\n    fun post(e: Any) {}\n    fun register(o: Any) {}\n}\n',
};
const POSTER = {
  path: 'app/src/main/java/com/x/Router.kt',
  text: [
    'package com.x',
    '',
    'class Router {',
    '    fun route(url: String, source: String) {',
    '        val decoded = url',
    '        if (source.isNotEmpty()) {',
    '            BusProvider.getInstance().post(OpenedEvent(source.decode(), "newsletter"))',
    '            BusProvider.getInstance().post(OtherEvent(decoded))',
    '        }',
    '        BusProvider.getInstance().post(OpenedEvent(decoded, null))',
    '    }',
    '}',
    '',
  ].join('\n'),
};
const OTHER = {
  path: 'app/src/main/java/com/x/Other.kt',
  text: 'package com.x\n\nclass OtherEvent(val s: String)\n\nclass Hears {\n    fun start() { BusProvider.getInstance().register(this) }\n\n    @Subscribe\n    fun on(e: OtherEvent) {}\n}\n',
};

describe.skipIf(!mod)('findRefusedPosts', () => {
  it('le post refuse pour un appel dans son argument est liste avec l instruction entiere et la raison', () => {
    const found = mod.findRefusedPosts({ sources: [EVENT, BUS, POSTER, OTHER], testSourceSets: SEGS });
    expect(found).toHaveLength(1);
    const f = found[0];
    expect(f.name).toBe('OpenedEvent');
    expect(f.path).toBe(POSTER.path);
    expect(f.reason).toContain('decode()');
    expect(POSTER.text.slice(f.start, f.end)).toBe('            BusProvider.getInstance().post(OpenedEvent(source.decode(), "newsletter"))\n');
  });

  it('un post que la suppression sure accepte n est pas dans la liste', () => {
    // `Bus.post(OpenedEvent(decoded, null))` est une instruction entiere sans
    // appel dans son argument : la famille des evenements la coupe elle meme.
    const found = mod.findRefusedPosts({ sources: [EVENT, BUS, POSTER, OTHER], testSourceSets: SEGS });
    expect(found.some((f: any) => POSTER.text.slice(f.start, f.end).includes('decoded, null'))).toBe(false);
  });

  it('un abonnement illisible dans le corpus : rien n est offert', () => {
    // Deux parametres : le type d evenement ne se lit pas, le scan n a rien
    // prouve, et offrir un post reviendrait a offrir un message que quelqu un
    // entend peut-etre encore.
    const unreadable = {
      path: 'app/src/main/java/com/x/Weird.kt',
      text: 'package com.x\n\nclass Weird {\n    fun start() { BusProvider.getInstance().register(this) }\n\n    @Subscribe\n    fun on(e: OtherEvent, extra: Int) {}\n}\n',
    };
    const found = mod.findRefusedPosts({ sources: [EVENT, BUS, POSTER, OTHER, unreadable], testSourceSets: SEGS });
    expect(found).toEqual([]);
  });
});
