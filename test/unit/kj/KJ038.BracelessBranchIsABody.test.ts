import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * Une branche SANS accolades a quand meme un corps : l'instruction qui la suit.
 *
 * La garde ne pouvait se declencher que sur un `{`. Un post ecrit ainsi
 *
 *   if (flag)
 *       BusProvider.getInstance().post(Event())
 *
 * passait donc tout droit, et le retirer laisse `if (flag)` suivi de
 * l'instruction SUIVANTE, qui devient le corps de l'if : cela compile, et le
 * comportement change en silence. Pour `else`, une branche de `when` ou un
 * `for`, c'est une erreur de syntaxe franche.
 */

const mod: any = await importOrNull('src/providers/unheardEvents');
const MAIN = '/w/app/src/main/kotlin/com/x';

const BUS = {
  path: `${MAIN}/Bus.kt`,
  text: 'package com.x\n\nobject BusProvider {\n    fun getInstance(): Bus = Bus\n}\n\nobject Bus {\n    fun post(e: Any) {}\n    fun register(o: Any) {}\n    fun unregister(o: Any) {}\n}\n',
};
const EVENTS = { path: `${MAIN}/Events.kt`, text: 'package com.x\n\nclass LuEvent\nclass OrphanEvent\n' };
// Sans un `register`, le detecteur n'apprend pas le bus et ne signale RIEN :
// un temoin qui ne produit aucune trouvaille ferait passer n'importe quelle
// garde. C'est exactement ce qui est arrive a la premiere version de ce test.
const LU = {
  path: `${MAIN}/Listener.kt`,
  text: 'package com.x\n\nclass Listener {\n    fun start() { BusProvider.getInstance().register(this) }\n\n    @Subscribe\n    fun onBusEvent(e: LuEvent) {}\n}\n',
};

const offert = (corps: string): boolean => {
  const appelant = {
    path: `${MAIN}/Caller.kt`,
    text: `package com.x\n\nclass Caller {\n    fun ok() {\n        BusProvider.getInstance().post(LuEvent())\n    }\n\n${corps}}\n`,
  };
  const scan = mod.findUnheardEvents({
    sources: [BUS, EVENTS, LU, appelant], testSourceSets: [], truncated: false,
  });
  const e = (scan.events as any[]).find((x) => x.name === 'OrphanEvent' && x.path === appelant.path);
  expect(e, 'le temoin doit produire une trouvaille, sinon il ne prouve rien').toBeDefined();
  return e.removeStart !== -1;
};

describe.skipIf(!mod)('un post seul dans une branche sans accolades', () => {
  it('if sans accolades : aucun correctif', () => {
    expect(offert('    fun f(flag: Boolean) {\n        if (flag)\n            BusProvider.getInstance().post(OrphanEvent())\n        println("apres")\n    }\n')).toBe(false);
  });

  it('else sans accolades : aucun correctif', () => {
    expect(offert('    fun f(flag: Boolean) {\n        if (flag)\n            println("oui")\n        else\n            BusProvider.getInstance().post(OrphanEvent())\n    }\n')).toBe(false);
  });

  it('branche de when sans accolades : aucun correctif', () => {
    expect(offert('    fun f(k: Int) {\n        when (k) {\n            1 ->\n                BusProvider.getInstance().post(OrphanEvent())\n            else -> println("no")\n        }\n    }\n')).toBe(false);
  });

  it('for sans accolades : aucun correctif', () => {
    expect(offert('    fun f(n: List<Int>) {\n        for (i in n)\n            BusProvider.getInstance().post(OrphanEvent())\n    }\n')).toBe(false);
  });

  it('temoin : un post au milieu d un corps ordinaire garde son correctif', () => {
    expect(offert('    fun f() {\n        println("avant")\n        BusProvider.getInstance().post(OrphanEvent())\n        println("apres")\n    }\n')).toBe(true);
  });

  it('temoin : un post precede d un appel qui finit par une parenthese', () => {
    expect(offert('    fun f() {\n        compute(1)\n        BusProvider.getInstance().post(OrphanEvent())\n        println("apres")\n    }\n')).toBe(true);
  });
});
