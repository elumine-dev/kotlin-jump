import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * G59, la directive `unused` ne protege plus aucune declaration.
 *
 * Oracle : `9b514d8dc2` sur LaPresse (AND-2340). Kevin y retire a la main neuf
 * membres que KJ gardait pour une seule raison, `F12:suppress-unused`, dont
 * `getFillColor`, `getPageColor` et `isCentered` de
 * `CirclePageWithMarginIndicator.java`, classe marquee
 * `@SuppressWarnings("unused")`.
 *
 * Decision du 2026-10-14, posee deux fois parce que la regle inverse avait ete
 * confirmee le 2026-09-20 : « partout, fichier compris ». Une directive qui fait
 * taire un avertissement ne dit rien de l'atteignabilite du code.
 *
 * Les parametres gardent leur protection : `UNUSED_PARAMETER` ecrit une
 * signature imposee de l'exterieur, pas du code mort.
 */

const SEGS = ['test/java', 'test/kotlin', 'androidTest'];

const ROOT = '/w/app/src/main/java/p';
const CALLER = {
  path: `${ROOT}/Caller.java`,
  text: [
    'package p;',
    '',
    'public class Caller {',
    '\tpublic static void main(String[] args) {',
    '\t\tnew Indicator().setFillColor(1);',
    '\t\tSystem.out.println(Mode.ON);',
    '\t\tSystem.out.println(Mode.MID);',
    '\t}',
    '}',
    '',
  ].join('\n'),
};

const INDICATOR = {
  path: `${ROOT}/Indicator.java`,
  text: [
    'package p;',
    '',
    '@SuppressWarnings("unused")',
    'public class Indicator {',
    '\tprivate int fill;',
    '',
    '\tpublic void setFillColor(final int fillColor) {',
    '\t\tfill = fillColor;',
    '\t}',
    '',
    '\tpublic int getFillColor() {',
    '\t\treturn fill;',
    '\t}',
    '}',
    '',
  ].join('\n'),
};

const MODE = {
  path: `${ROOT}/Mode.java`,
  text: [
    'package p;',
    '',
    'public enum Mode {',
    '\tON,',
    '\t@SuppressWarnings("unused") OFF,',
    '\tMID',
    '}',
    '',
  ].join('\n'),
};

const MODULE = {
  path: `${ROOT}/LegacyModule.kt`,
  text: [
    '@file:Suppress("unused")',
    '',
    'package p',
    '',
    'class LegacyModule {',
    '    fun provide(): String = "x"',
    '}',
    '',
  ].join('\n'),
};

const cut = (sources: { path: string; text: string }[]) => {
  const { parFichier } = collecterUnePasse(sources, SEGS);
  return [...parFichier.values()].flat().map(c => c.quoi);
};

describe('G59, la directive unused ne protege plus', () => {
  it('un getter mort sous @SuppressWarnings("unused") de classe est coupe', () => {
    expect(cut([CALLER, INDICATOR, MODE, MODULE])).toContain('getFillColor');
  });

  // Au milieu, pas en dernier : la derniere entree annotee n'a pas d'etendue
  // de coupe, directive ou pas (G60, meme avec @Deprecated).
  it('une entree d enum marquee @SuppressWarnings("unused") est coupee', () => {
    expect(cut([CALLER, INDICATOR, MODE, MODULE])).toContain('OFF');
  });

  it('un fichier entier sous @file:Suppress("unused") est juge', () => {
    expect(cut([CALLER, INDICATOR, MODE, MODULE])).toContain('LegacyModule');
  });

  it('garde : le vivant reste, directive ou non', () => {
    const cuts = cut([CALLER, INDICATOR, MODE, MODULE]);
    expect(cuts).not.toContain('setFillColor');
    expect(cuts).not.toContain('ON');
    expect(cuts).not.toContain('Indicator');
  });
});
