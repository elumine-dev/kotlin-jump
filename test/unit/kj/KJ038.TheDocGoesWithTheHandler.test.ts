import { describe, it, expect } from 'vitest';
import { findUnheardEvents } from '../../../src/providers/unheardEvents';

/**
 * Le commentaire de documentation part avec le handler qu il decrit.
 *
 * L etendue commencait a la ligne de l annotation, donc un KDoc pose au dessus
 * restait. Il se recolle alors a la declaration SUIVANTE et la documente : le
 * lecteur retrouve « ce que ce handler faisait » au dessus d une fonction qui
 * n a rien a voir.
 *
 * Les autres familles emportent la KDoc depuis longtemps, celle des
 * declarations en tete. Celle-ci ne le faisait pas.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const BASE = [
  f(`${MAIN}/BusOwner.kt`, 'package com.x\n\nclass BusOwner {\n    fun start() {\n        EventBus.getDefault().register(this)\n        EventBus.getDefault().post(HeardEvent())\n    }\n}\n'),
  f(`${MAIN}/AnyListener.kt`, 'package com.x\n\nclass AnyListener {\n    @Subscribe\n    fun onBusEvent(event: HeardEvent) {\n    }\n}\n'),
  f(`${MAIN}/HeardEvent.kt`, 'package com.x\n\nclass HeardEvent\n'),
  f(`${MAIN}/GhostEvent.kt`, 'package com.x\n\nclass GhostEvent\n'),
];

const coupeDe = (texte: string) => {
  const scan = findUnheardEvents({
    sources: [...BASE, f(`${MAIN}/Starved.kt`, texte)], testSourceSets: ['/src/test/'],
  } as any);
  const d = scan.deadSubscriptions[0];
  if (!d || d.removeStart < 0) return undefined;
  return {
    coupe: texte.slice(d.removeStart, d.removeEnd),
    reste: texte.slice(0, d.removeStart) + texte.slice(d.removeEnd),
  };
};

describe('KJ-038 la doc part avec le handler', () => {
  it('un KDoc d une ligne au dessus de l annotation', () => {
    const r = coupeDe('package com.x\n\nclass Starved {\n    /** Ce que ce handler faisait. */\n    @Subscribe\n    fun onBusEvent(event: GhostEvent) {\n    }\n\n    fun garde() = 1\n}\n')!;
    expect(r.coupe).toContain('Ce que ce handler faisait');
    expect(r.reste).not.toContain('Ce que ce handler faisait');
    expect(r.reste).toContain('fun garde()');
  });

  it('un KDoc sur plusieurs lignes', () => {
    const r = coupeDe('package com.x\n\nclass Starved {\n    /**\n     * Ce que ce handler faisait.\n     * Sur deux lignes.\n     */\n    @Subscribe\n    fun onBusEvent(event: GhostEvent) {\n    }\n\n    fun garde() = 1\n}\n')!;
    expect(r.coupe).toContain('Sur deux lignes');
    expect(r.reste).not.toContain('Ce que ce handler faisait');
  });

  it('temoin : sans KDoc, l annotation part toujours et rien de plus', () => {
    const r = coupeDe('package com.x\n\nclass Starved {\n    @Subscribe\n    fun onBusEvent(event: GhostEvent) {\n    }\n\n    fun garde() = 1\n}\n')!;
    expect(r.coupe.trimStart().startsWith('@Subscribe')).toBe(true);
    expect(r.reste).toContain('fun garde()');
  });

  it('temoin : un commentaire en bout de ligne de code n est pas une doc', () => {
    // `fun precedent() = 1 /* px */` finit sur `*/` sans etre un bloc de
    // commentaire. La remontee ne doit pas l avaler avec la ligne de code.
    const r = coupeDe('package com.x\n\nclass Starved {\n    fun precedent() = 1 /* px */\n    @Subscribe\n    fun onBusEvent(event: GhostEvent) {\n    }\n}\n')!;
    expect(r.coupe).not.toContain('precedent');
    expect(r.reste).toContain('fun precedent()');
  });

  it('temoin : une ligne vide entre la doc et l annotation coupe la remontee', () => {
    const r = coupeDe('package com.x\n\nclass Starved {\n    /** Detachee. */\n\n    @Subscribe\n    fun onBusEvent(event: GhostEvent) {\n    }\n}\n')!;
    expect(r.coupe).not.toContain('Detachee');
  });
});
