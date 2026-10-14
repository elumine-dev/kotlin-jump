import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries } from '../../../src/providers/unusedEnumEntries';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Une entree d enum marquee `@Suppress("unused")`, ou dont l enum l est, est
 * signalee et supprimee comme les autres.
 *
 * G59 (2026-10-14) : la directive unused ne protege plus aucune declaration,
 * fichier compris ; ces cas en sont les temoins.
 *
 * Historique, avant G59 :
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

describe('l entree d enum morte sort malgre la demande de silence', () => {
  it('temoin : sans annotation, les deux entrees mortes sortent', () => {
    expect(signalees(enumAvec('', ''))).toEqual(['AUTRE', 'MORT']);
  });

  it('sur l enum : les deux entrees mortes sortent et partent', () => {
    const src = enumAvec('@Suppress("unused")\n', '');
    expect(signalees(src)).toEqual(['AUTRE', 'MORT']);
    expect(supprimees(src)).toBe(2);
  });

  it('sur l entree : elle sort, et sa voisine morte aussi', () => {
    const src = enumAvec('', '@Suppress("unused")\n    ');
    expect(signalees(src)).toEqual(['AUTRE', 'MORT']);
  });

  it('SuppressWarnings, et parmi d autres diagnostics : rien ne protege', () => {
    expect(signalees(enumAvec('@SuppressWarnings("unused")\n', ''))).toEqual(['AUTRE', 'MORT']);
    expect(signalees(enumAvec('@Suppress("MagicNumber", "unused")\n', ''))).toEqual(['AUTRE', 'MORT']);
  });

  it('un autre diagnostic ne vaut pas silence', () => {
    expect(signalees(enumAvec('@Suppress("MagicNumber")\n', ''))).toEqual(['AUTRE', 'MORT']);
    expect(signalees(enumAvec('', '@Suppress("MagicNumber")\n    '))).toContain('AUTRE');
  });
});

describe('l entree sous silence et sa voisine de ligne sortent toutes deux', () => {
  // Avant G59, la fenetre allait du debut de la LIGNE jusqu au nom de l entree.
  // Sur un enum ecrit d une ligne, l annotation de la premiere entree tombait
  // dans la fenetre de toutes les suivantes, qui n etaient plus jamais signalees.
  it('enum sur une ligne : l entree marquee sort avec sa voisine', () => {
    const src = 'package com.x\n\nenum class E { VIVANT, @Suppress("unused") GARDE, MORT }\n';
    expect(signalees(src)).toEqual(['GARDE', 'MORT']);
  });

  it('premiere ou derniere entree marquee : elle sort, sa voisine aussi', () => {
    expect(signalees('package com.x\n\nenum class E { @Suppress("unused") GARDE, MORT, VIVANT }\n')).toEqual(['GARDE', 'MORT']);
    expect(signalees('package com.x\n\nenum class E { VIVANT, MORT, @Suppress("unused") GARDE }\n')).toEqual(['GARDE', 'MORT']);
  });

  it('un membre marque dans le corps de l entree precedente ne fait pas taire la suivante', () => {
    const src = 'package com.x\n\nenum class E {\n    VIVANT {\n        @Suppress("unused")\n        override fun f() = 1\n    },\n    MORT;\n\n    open fun f() = 0\n}\n';
    expect(signalees(src)).toEqual(['MORT']);
  });

  it('l annotation d un parametre du constructeur de l enum ne fait pas taire la premiere entree', () => {
    const src = 'package com.x\n\nenum class E(@Suppress("unused") val code: Int) { MORT(1), VIVANT(2) }\n';
    expect(signalees(src)).toEqual(['MORT']);
  });

  it('temoin : meme enum sans annotation', () => {
    const src = 'package com.x\n\nenum class E(val code: Int) { MORT(1), VIVANT(2) }\n';
    expect(signalees(src)).toEqual(['MORT']);
  });

  it('Java, sur une ligne : meme regle, les deux sortent', () => {
    const java = (src: string) =>
      (findUnusedEnumEntries({ sources: [f('/w/app/src/main/java/com/x/E.java', src), APPEL, GRADLE], testSourceSets: ['/src/test/'] } as any) as any[])
        .map(e => e.name).sort();
    expect(java('package com.x;\n\npublic enum E { VIVANT, @SuppressWarnings("unused") GARDE, MORT }\n')).toEqual(['GARDE', 'MORT']);
  });

  it('temoin : sans annotation, les deux sortent', () => {
    const src = 'package com.x\n\nenum class E { VIVANT, GARDE, MORT }\n';
    expect(signalees(src)).toEqual(['GARDE', 'MORT']);
  });
});
