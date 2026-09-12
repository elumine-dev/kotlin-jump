/**
 * Une fonction SANS CORPS ne doit pas emprunter le corps de la suivante.
 *
 * `declarationSpan` cherche le `{` ou le `=` qui ouvre le corps dans les 800
 * caracteres qui suivent la parenthese fermante. Une methode abstraite d une
 * interface n en a pas : la recherche trouvait donc l accolade de la
 * DECLARATION SUIVANTE et refermait sur elle. L etendue partait de la methode
 * et allait jusqu a la fin de la classe d implementation.
 *
 * L en tete de ce fichier decrit exactement ce risque : « over-blanking
 * swallows the NEXT declaration's body and hides a real usage, which is a
 * false positive that deletes live code ». La branche `fun` ne s en gardait
 * pas.
 *
 * Deux consequences, mesurees sur /Users/kevin/Desktop/work/lapresse :
 *   - le correctif rapide « supprimer ce membre » effaçait une cinquantaine de
 *     lignes vivantes, dont la classe d implementation entiere ;
 *   - les appels situes dans cette classe tombaient DANS l etendue du membre,
 *     donc comptes comme des mentions de lui meme, donc ignores : 14 membres
 *     signales non references alors qu ils sont implementes et appeles.
 */
import { describe, it, expect } from 'vitest';
import { declarationSpan } from '../../src/util/declarationSpan';

const NL = String.fromCharCode(10);

function span(texte: string, nom: string) {
  const lignes = texte.split(NL);
  const lineStarts: number[] = [0];
  for (let i = 0; i < texte.length; i++) if (texte[i] === NL) lineStarts.push(i + 1);
  const nameOffset = texte.indexOf(nom);
  const line = texte.slice(0, nameOffset).split(NL).length - 1;
  return declarationSpan(texte, lineStarts, {
    kind: 'fun', name: nom, line, nameOffset, lastLine: lignes.length - 1,
  });
}

const INTERFACE = [
  'interface Horloge {',
  '    fun formate(secondes: Int): String',
  '    fun autre(): Int',
  '}',
  '',
  'class HorlogeImpl : Horloge {',
  '    override fun formate(secondes: Int): String {',
  '        return secondes.toString()',
  '    }',
  '',
  '    override fun autre(): Int = formate(1).length',
  '}',
].join(NL);

describe('declarationSpan - une fonction sans corps', () => {
  it('une methode abstraite ne rend aucune etendue', () => {
    // Sans corps, il n y a rien a delimiter. Rendre `undefined` sort le membre
    // du perimetre : pas de signalement, pas de suppression proposee. C est la
    // direction sure, celle que l en tete du fichier reclame, et c est ce que
    // la branche faisait deja quand aucune accolade ne trainait a portee.
    expect(span(INTERFACE, 'formate')).toBeUndefined();
    expect(span(INTERFACE, 'autre')).toBeUndefined();
  });

  it('et surtout elle ne rend pas une etendue qui couvre la classe suivante', () => {
    const s = span(INTERFACE, 'formate');
    const couvert = s === undefined ? '' : INTERFACE.slice(s.scanStart, s.scanEnd);
    expect(couvert).not.toContain('class HorlogeImpl');
    expect(couvert).not.toContain('override fun');
  });

  it('la methode abstraite n emprunte pas le corps de sa voisine de dessous', () => {
    // Kotlin autorise une methode concrete dans une interface. La ligne juste
    // en dessous de l abstraite porte donc une accolade, et sans la garde sur
    // les debuts de declaration la fenetre de recherche l attrape.
    const texte = [
      'interface Horloge {',
      '    fun formate(secondes: Int): String',
      '    fun defaut(): Int { return 1 }',
      '}',
    ].join(NL);
    const s = span(texte, 'formate');
    const couvert = s === undefined ? '' : texte.slice(s.scanStart, s.scanEnd);
    expect(couvert).not.toContain('defaut');
    expect(couvert).not.toContain('return 1');
  });

  it('temoin : une fonction AVEC corps garde son accolade', () => {
    const texte = [
      'class A {',
      '    fun calcule(x: Int): Int {',
      '        return x + 1',
      '    }',
      '}',
      '',
      'class B {',
      '    fun autre() = 1',
      '}',
    ].join(NL);
    const s = span(texte, 'calcule');
    expect(s).toBeDefined();
    const couvert = texte.slice(s!.scanStart, s!.scanEnd);
    expect(couvert).toContain('return x + 1');
    expect(couvert).not.toContain('class B');
    expect(s!.lineBasedEnd).toBe(false);
  });

  it('temoin : un corps expression coupe a la fin de sa ligne, pas plus loin', () => {
    // L etendue s arrete en fin de ligne du `=`. Sous couvrir perd un
    // signalement, sur couvrir efface du code vivant : la direction sure est
    // deja celle la, et ce test la fige.
    const texte = [
      'class A {',
      '    fun calcule(x: Int): Int =',
      '        x + 1',
      '}',
    ].join(NL);
    const s = span(texte, 'calcule');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).not.toContain('class');
    expect(s!.lineBasedEnd).toBe(true);
  });

  it('temoin : une accolade sur la ligne qui suit la signature reste un corps', () => {
    const texte = [
      'class A {',
      '    fun calcule(x: Int): Int',
      '    {',
      '        return x + 1',
      '    }',
      '}',
    ].join(NL);
    const s = span(texte, 'calcule');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('return x + 1');
  });

  it('une clause throws sur la ligne suivante laisse trouver le corps', () => {
    // Forme reelle, deux fois sur /Users/kevin/Desktop/work/lapresse. La ligne
    // qui suit la signature n ouvre pas une declaration, elle la termine, donc
    // la fenetre doit continuer jusqu a son accolade. Ajouter `throws` a la
    // liste des debuts de declaration casserait ces deux methodes.
    const texte = [
      'class A {',
      '    public static int getNbChars(final TextPaint p, final String s)',
      '            throws InterruptedException {',
      '        return 1;',
      '    }',
      '}',
    ].join(NL);
    const s = span(texte, 'getNbChars');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('return 1;');
  });

  it('une clause where sur la ligne suivante aussi', () => {
    const texte = [
      'class A {',
      '    fun <T> plusGrand(a: T, b: T): T',
      '        where T : Comparable<T> {',
      '        return if (a > b) a else b',
      '    }',
      '}',
    ].join(NL);
    const s = span(texte, 'plusGrand');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('a else b');
  });

  it('temoin : une signature sur plusieurs lignes trouve encore son corps', () => {
    const texte = [
      'class A {',
      '    fun calcule(',
      '        x: Int,',
      '    ): Int {',
      '        return x + 1',
      '    }',
      '}',
    ].join(NL);
    const s = span(texte, 'calcule');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('return x + 1');
  });
  it('un nom entre accents graves trouve quand meme sa parenthese', () => {
    // Le parseur rend `it draws` sans ses quotes, donc `nameOffset + longueur`
    // tombe sur l accent grave fermant et non sur la parenthese. Toute
    // fonction de test Kotlin ecrite ainsi perdait son etendue, et aucun
    // correctif ne pouvait la delimiter.
    const texte = [
      'class WidgetTest {',
      '    @Test',
      '    fun `it draws`() {',
      '        Widget().draw()',
      '    }',
      '}',
    ].join(NL);
    const s = span(texte, 'it draws');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('Widget().draw()');
  });

  it('temoin : un nom ordinaire n a pas change', () => {
    const texte = ['class A {', '    fun simple() {', '        rien()', '    }', '}'].join(NL);
    const s = span(texte, 'simple');
    expect(s).toBeDefined();
    expect(texte.slice(s!.scanStart, s!.scanEnd)).toContain('rien()');
  });
});
