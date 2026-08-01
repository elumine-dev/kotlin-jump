import { describe, it, expect } from 'vitest';
import { findDeadIslands, messageFor } from '../../../src/providers/deadIslands';

/**
 * KJ-046 — les îlots morts : des groupes de déclarations qui ne se
 * référencent qu'entre elles et que rien d'autre ne référence.
 *
 * Le contrat de base : la paire mutuelle que le comptage par symbole ne peut
 * pas voir (chacun mentionne l'autre, donc chacun paraît vivant), la chaîne
 * vers un puits, et la vie au moindre appelant externe.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const islands = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findDeadIslands({ sources, testSourceSets: TEST_SETS, ...extra })
    .map(i => i.members.map(m => (m.container ? `${m.container}.` : '') + m.name).sort());

describe('le cas de base', () => {
  it('une paire mutuelle que personne n’appelle est une île', () => {
    const a = f(`${MAIN}/LegacySync.kt`, 'package com.x\n\nfun legacySync() {\n    uploaderSend()\n}\n');
    const b = f(`${MAIN}/Uploader.kt`, 'package com.x\n\nfun uploaderSend() {\n    legacySync()\n}\n');
    expect(islands([a, b])).toEqual([['legacySync', 'uploaderSend']]);
  });

  it('un triangle est une seule île', () => {
    const a = f(`${MAIN}/A.kt`, 'package com.x\n\nfun stepA() {\n    stepB()\n}\n');
    const b = f(`${MAIN}/B.kt`, 'package com.x\n\nfun stepB() {\n    stepC()\n}\n');
    const c = f(`${MAIN}/C.kt`, 'package com.x\n\nfun stepC() {\n    stepA()\n}\n');
    expect(islands([a, b, c])).toEqual([['stepA', 'stepB', 'stepC']]);
  });

  it('une chaîne vers un puits regroupe le mort déjà connu et son otage', () => {
    // `deadEntry` est déjà une trouvaille KJ-032 ; `hostage` n'est mentionné
    // que par elle. L'île les rapporte ensemble, une trouvaille par cause.
    const src = f(`${MAIN}/Chain.kt`, 'package com.x\n\nfun deadEntry() {\n    hostage()\n}\n\nfun hostage() {\n    println("work")\n}\n');
    const found = findDeadIslands({ sources: [src], testSourceSets: TEST_SETS });
    expect(found).toHaveLength(1);
    expect(found[0].members.map(m => `${m.name}:${m.individuallyDead}`).sort())
      .toEqual(['deadEntry:true', 'hostage:false']);
  });

  it('un appelant externe dissout tout', () => {
    const a = f(`${MAIN}/LegacySync.kt`, 'package com.x\n\nfun legacySync() {\n    uploaderSend()\n}\n');
    const b = f(`${MAIN}/Uploader.kt`, 'package com.x\n\nfun uploaderSend() {\n    legacySync()\n}\n');
    // `main` est gardée (F9), donc hors du pool : son corps ancre des racines.
    const use = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    legacySync()\n}\n');
    expect(islands([a, b, use])).toEqual([]);
  });

  it('deux îles disjointes sont partitionnées', () => {
    const a = f(`${MAIN}/A.kt`, 'package com.x\n\nfun ringA() {\n    ringB()\n}\n\nfun ringB() {\n    ringA()\n}\n');
    const b = f(`${MAIN}/B.kt`, 'package com.x\n\nfun loopX() {\n    loopY()\n}\n\nfun loopY() {\n    loopX()\n}\n');
    expect(islands([a, b]).sort()).toEqual([['loopX', 'loopY'], ['ringA', 'ringB']]);
  });

  it('le message nomme la taille et le nombre de fichiers', () => {
    const a = f(`${MAIN}/LegacySync.kt`, 'package com.x\n\nfun legacySync() {\n    uploaderSend()\n}\n');
    const b = f(`${MAIN}/Uploader.kt`, 'package com.x\n\nfun uploaderSend() {\n    legacySync()\n}\n');
    const found = findDeadIslands({ sources: [a, b], testSourceSets: TEST_SETS });
    expect(messageFor(found[0])).toContain('2 declarations across 2 file(s)');
  });
});
