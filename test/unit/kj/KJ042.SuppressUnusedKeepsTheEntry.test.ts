import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Une entree d enum marquee `@Suppress("unused")`, ou dont l enum l est, n est
 * ni signalee ni supprimee.
 *
 * Meme defaut que pour les membres : `Suppress` figure parmi les annotations
 * benignes des enums, ce qui dit seulement qu il ne rend rien atteignable, et
 * personne ne regardait QUEL diagnostic il nomme. L entree restait signalee et
 * « Remove Everything Unused » l effacait, alors que l auteur avait ecrit de la
 * garder.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
const APPEL = f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() { println(E.VIVANT) }\n');
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const enumAvec = (annoEnum: string, annoMort: string, annoAutre = '') =>
  `package com.x\n\n${annoEnum}enum class E {\n    VIVANT,\n    ${annoMort}MORT,\n    ${annoAutre}AUTRE,\n}\n`;
const signalees = (src: string) =>
  (findUnusedEnumEntries({ sources: [f(`${MAIN}/E.kt`, src), APPEL, GRADLE], testSourceSets: ['/src/test/'] } as any) as any[])
    .map(e => e.name).sort();
const supprimees = (src: string) =>
  (collecterUnePasse([f(`${MAIN}/E.kt`, src), APPEL, GRADLE], ['/src/test/']).parFichier.get(`${MAIN}/E.kt`) ?? [])
    .filter((c: any) => c.famille === 'entrees').length;

describe('l entree d enum respecte la demande de silence', () => {
  it('temoin : sans annotation, les deux entrees mortes sortent', () => {
    expect(signalees(enumAvec('', ''))).toEqual(['AUTRE', 'MORT']);
  });

  it('sur l enum : aucune entree, et rien ne part', () => {
    const src = enumAvec('@Suppress("unused")\n', '');
    expect(signalees(src)).toEqual([]);
    expect(supprimees(src)).toBe(0);
  });

  it('sur l entree : elle reste, sa voisine morte sort toujours', () => {
    const src = enumAvec('', '@Suppress("unused")\n    ');
    expect(signalees(src)).toEqual(['AUTRE']);
  });

  it('SuppressWarnings, et parmi d autres diagnostics', () => {
    expect(signalees(enumAvec('@SuppressWarnings("unused")\n', ''))).toEqual([]);
    expect(signalees(enumAvec('@Suppress("MagicNumber", "unused")\n', ''))).toEqual([]);
  });

  it('un autre diagnostic ne vaut pas silence', () => {
    expect(signalees(enumAvec('@Suppress("MagicNumber")\n', ''))).toEqual(['AUTRE', 'MORT']);
    expect(signalees(enumAvec('', '@Suppress("MagicNumber")\n    '))).toContain('AUTRE');
  });
});
