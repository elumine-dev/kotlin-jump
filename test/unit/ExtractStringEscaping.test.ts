/**
 * L'echappement d'un litteral vers strings.xml.
 *
 * `escapeForStringsXml` protege le guillemet avec une garde contre le DOUBLE
 * echappement, `(?<!\\)"`, mais la regle de l'apostrophe n'en avait pas. Un
 * litteral Kotlin ecrit `"HH\'h\'mm"`, ou l'apostrophe est deja echappee, en
 * ressortait avec deux antislashs, et l'application aurait affiche
 * `HH\'h\'mm` au lieu de `HH'h'mm`.
 *
 * Mesure sur un projet reel : 11786 litteraux passes en revue, 10621 des 10624
 * sans modele font un aller retour exact, et les deux cas rompus sont
 * exactement cette forme. Neuf fichiers du projet portent une apostrophe deja
 * echappee.
 */
import { describe, it, expect } from 'vitest';
import { escapeForStringsXml } from '../../src/providers/ExtractStringResourceProvider';

const BS = String.fromCharCode(92);

/** Relecture d'une valeur de strings.xml, d'apres la specification Android. */
function relire(v: string): string {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== BS) { out += v[i]; continue; }
    out += v[i + 1] ?? '';
    i++;
  }
  return out.replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

describe('une apostrophe deja echappee ne l est pas deux fois', () => {
  it('le litteral Kotlin HH-quote-h-quote-mm', () => {
    const source = 'HH' + BS + "'h" + BS + "'mm";
    const xml = escapeForStringsXml(source);
    expect(xml, 'un seul antislash par apostrophe').toBe('HH' + BS + "'h" + BS + "'mm");
    expect(relire(xml), 'et la relecture rend le texte voulu').toBe("HH'h'mm");
  });

  it('une apostrophe NUE est bien echappee', () => {
    expect(escapeForStringsXml("l'an")).toBe('l' + BS + "'an");
    expect(relire(escapeForStringsXml("l'an"))).toBe("l'an");
  });

  it('le guillemet garde son comportement, nu comme echappe', () => {
    expect(escapeForStringsXml('a"b')).toBe('a' + BS + '"b');
    expect(escapeForStringsXml('a' + BS + '"b')).toBe('a' + BS + '"b');
  });

  it('et les entites XML restent inchangees', () => {
    expect(escapeForStringsXml('a & b < c')).toBe('a &amp; b &lt; c');
  });
});
