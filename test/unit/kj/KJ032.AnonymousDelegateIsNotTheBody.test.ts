import { describe, it, expect } from 'vitest';
import { declarationSpan } from '../../../src/util/declarationSpan';
import { sanitizeForUsageScan, buildLineStarts } from '../../../src/util/kotlinScan';

/**
 * L accolade d un objet anonyme delegue n est pas celle du corps.
 *
 * L etendue d une classe s arrete a la premiere accolade qui n est pas
 * imbriquee dans une parenthese. C est vrai de presque tous les en-tetes, et
 * faux d un seul : `class A : I by object : I { ... }`, ou l objet anonyme
 * ouvre une accolade a profondeur zero avant le corps.
 *
 * L etendue s arretait donc sur la fermante de l objet et laissait
 * `{ ... }` derriere elle, un bloc orphelin qui ne compile pas. Et comme ce
 * chemin rend `lineBasedEnd: false`, il affirme que la fin est CERTAINE, ce
 * qui coupe le rattrapage de `removalExtent`.
 *
 * Ce n est pas une regression : la liste blanche de caracteres d avant
 * acceptait cet en-tete tout autant. Elle refusait en revanche
 * `: Base(count = 3)` et `: @Suppress("x") Base()`, que la version actuelle
 * traite correctement. Zero occurrence sur les 5110 sources de reference,
 * mais la coupe y produit du code qui ne compile pas.
 */

const PRELUDE = `package p

open class Base(val c: Int = 0)
interface Iface { fun g(): Int }
fun fabrique(n: Int): Iface = object : Iface { override fun g() = n }

`;

const etendue = (corps: string) => {
  const texte = PRELUDE + corps + '\n';
  const nameOffset = texte.indexOf('class Morte') + 'class '.length;
  const span = declarationSpan(sanitizeForUsageScan(texte), buildLineStarts(texte), {
    kind: 'classLike',
    name: 'Morte',
    line: texte.slice(0, nameOffset).split('\n').length - 1,
    nameOffset,
    lastLine: texte.split('\n').length - 1,
  });
  return { texte, span, reste: span ? texte.slice(span.scanEnd).trim() : undefined };
};

describe('KJ-032 un objet anonyme delegue ne ferme pas la classe', () => {
  it('l etendue va jusqu a la fermante de la CLASSE', () => {
    const r = etendue(`class Morte : Iface by object : Iface {
    override fun g() = 0
} {
    fun f() = 1
}`);
    expect(r.span).toBeDefined();
    expect(r.reste).toBe('');
  });

  it('avec deux supertypes derriere le by, aussi', () => {
    const r = etendue(`class Morte : Iface by object : Iface {
    override fun g() = 0
}, Comparable<Int> {
    override fun compareTo(other: Int) = 0
}`);
    expect(r.reste).toBe('');
  });

  it('temoin : une delegation par appel de fonction marchait deja', () => {
    expect(etendue(`class Morte : Iface by fabrique(1) {
    fun f() = 1
}`).reste).toBe('');
  });

  it('temoin : un lambda dans un argument de supertype marchait deja', () => {
    expect(etendue(`class Morte : Base(c = 3) {
    fun f() = 1
}`).reste).toBe('');
  });

  it('temoin : un en-tete ordinaire ne bouge pas', () => {
    expect(etendue(`class Morte {
    fun f() = 1
}`).reste).toBe('');
  });

  it('temoin : une valeur par defaut lambda au constructeur ne bouge pas', () => {
    expect(etendue(`class Morte(val onClick: () -> Unit = { }) : Base() {
    fun f() = 1
}`).reste).toBe('');
  });
});
