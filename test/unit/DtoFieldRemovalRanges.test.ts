/**
 * KJ-044 - ce que la suppression coupe VRAIMENT dans la liste de parametres.
 *
 * C est la seule suppression de la famille code mort qui coupe A L INTERIEUR
 * d une ligne, entre deux virgules. Une borne fausse d une unite ne produit
 * pas un diagnostic discutable, elle produit du code qui ne compile plus :
 * deux parametres colles sans virgule, ou une virgule en double.
 *
 * Trois branches decident de ces bornes, selon que le champ est le premier,
 * un du milieu, ou le dernier. Casser celle du milieu fabrique `,,` sur 11
 * suppressions du projet reel ; casser celle du premier parametre laisse
 * `(,`. La suite complete les laissait passer toutes les deux : seule la
 * borne de depart etait tenue par un test.
 *
 * Ces tests appliquent la coupe et lisent le texte obtenu, plutot que de
 * comparer des offsets a des nombres ecrits a la main. Un nombre attendu qui
 * derive avec le code ne prouve rien ; du Kotlin valide, si.
 */
import { describe, it, expect } from 'vitest';
import { findUnusedDtoFields } from '../../src/providers/unusedDtoFields';

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';

/** Le fichier tel qu il reste une fois le champ retire. */
function apresSuppression(champ: string, lignesDto: string[], lecture: string): string {
  const texte = lignesDto.join('\n');
  const sources = [
    { path: `${MAIN}/ConfigDO.kt`, text: texte },
    { path: `${MAIN}/Use.kt`, text: `package com.x\n\nfun go(c: ConfigDO) = ${lecture}\n` },
  ];
  const found = findUnusedDtoFields({ sources, testSourceSets: TEST_SETS });
  const cible = found.find(x => x.name === champ);
  expect(cible, `le champ ${champ} doit etre signale (${found.map(x => x.name).join(', ')})`).toBeDefined();
  expect(cible!.removeStart, 'et proposer une suppression').toBeGreaterThanOrEqual(0);
  return texte.slice(0, cible!.removeStart) + texte.slice(cible!.removeEnd);
}

/** Les parametres restants, lus dans le texte obtenu. */
function parametres(texte: string): string[] {
  const dedans = texte.slice(texte.indexOf('(') + 1, texte.lastIndexOf(')'));
  return dedans.split(',')
    .map(s => s.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('@')).join(' '))
    .filter(s => s !== '');
}

const TROIS = [
  'package com.x',
  '',
  '@Serializable',
  'data class ConfigDO(',
  '    @SerialName("a")',
  '    val premier: Long,',
  '    @SerialName("b")',
  '    val milieu: String,',
  '    @SerialName("c")',
  '    val dernier: Int,',
  ')',
];

describe('KJ-044 - les bornes de suppression d un champ', () => {
  it('un champ du milieu part sans laisser de virgule en trop', () => {
    const apres = apresSuppression('milieu', TROIS, 'c.premier + c.dernier');
    expect(apres).not.toMatch(/,\s*,/);
    expect(apres).toContain('val premier: Long,');
    expect(apres).toContain('val dernier: Int,');
    expect(apres).not.toContain('milieu');
    expect(parametres(apres)).toEqual(['val premier: Long', 'val dernier: Int']);
  });

  it('le premier champ part sans laisser de virgule en tete', () => {
    const apres = apresSuppression('premier', TROIS, 'c.milieu + c.dernier');
    expect(apres).not.toMatch(/\(\s*,/);
    expect(apres).not.toMatch(/,\s*,/);
    expect(apres).not.toContain('premier');
    expect(parametres(apres)).toEqual(['val milieu: String', 'val dernier: Int']);
  });

  it('le dernier champ part avec sa virgule finale', () => {
    const apres = apresSuppression('dernier', TROIS, 'c.premier + c.milieu');
    expect(apres).not.toMatch(/,\s*,/);
    expect(apres).not.toContain('dernier');
    expect(parametres(apres)).toEqual(['val premier: Long', 'val milieu: String']);
  });

  it('sans virgule finale a la ktlint, le dernier champ part quand meme proprement', () => {
    const sansVirguleFinale = [...TROIS];
    sansVirguleFinale[9] = '    val dernier: Int';
    // La virgule qui precede le champ retire reste, et Kotlin accepte une
    // virgule finale depuis 1.4. Ce qui compte est qu il n y en ait pas deux.
    const apres = apresSuppression('dernier', sansVirguleFinale, 'c.premier + c.milieu');
    expect(apres).not.toMatch(/,\s*,/);
    expect(parametres(apres)).toEqual(['val premier: Long', 'val milieu: String']);
  });

  it('temoin : ce qui reste porte toujours les deux autres annotations', () => {
    const apres = apresSuppression('milieu', TROIS, 'c.premier + c.dernier');
    expect(apres).toContain('@SerialName("a")');
    expect(apres).toContain('@SerialName("c")');
    expect(apres).not.toContain('@SerialName("b")');
  });
});
