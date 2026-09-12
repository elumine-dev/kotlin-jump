/**
 * Le correctif « ajouter un abonne » se posait sur la derniere accolade DU
 * TEXTE, pas du code.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 6 fichiers sur 5 093 se
 * terminent par une chaine brute qui porte un gabarit JSON, donc leur derniere
 * accolade est une accolade de donnees. L abonne y etait insere : le fichier
 * compile toujours, la methode n existe pas, et le gabarit est corrompu. Une
 * modification silencieuse et fausse du fichier de l utilisateur, appliquee a
 * travers l apercu de refactorisation.
 *
 * Le nom du gestionnaire etait appris de la meme façon, donc un abonne mis en
 * commentaire nommait le nouveau.
 */
import { describe, it, expect } from 'vitest';
import { subscriberAnchor } from '../../src/commands/FindUnheardEvents';

const NL = String.fromCharCode(10);
const TRIPLE = '"' + '"' + '"';
const OUVRE = '/' + '*';
const FERME = '*' + '/';

/** Ce que le correctif verrait a l offset choisi. */
const autour = (texte: string) => {
  const a = subscriberAnchor(texte)!;
  return { avant: texte.slice(0, a.at).trimEnd().slice(-24), handler: a.handler };
};

describe('subscriberAnchor', () => {
  it('ignore une accolade de chaine brute a la fin du fichier', () => {
    const texte = [
      'package a',
      '',
      'class Ecran {',
      '    fun f() = Unit',
      '}',
      '',
      `val GABARIT = ${TRIPLE}`,
      '{',
      '  "cle": { "sous": 1 }',
      '}',
      `${TRIPLE}.trimIndent()`,
    ].join(NL);
    // L accolade retenue doit etre celle de la classe, pas celle du JSON.
    expect(subscriberAnchor(texte)!.at).toBe(texte.indexOf('}'));
    expect(autour(texte).avant.endsWith('fun f() = Unit')).toBe(true);
  });

  it('ignore une accolade de commentaire de fin de fichier', () => {
    const texte = [
      'package a',
      'class Ecran {',
      '    fun f() = Unit',
      '}',
      `// a supprimer : le } au dessus`,
    ].join(NL);
    expect(subscriberAnchor(texte)!.at).toBe(texte.indexOf('}'));
  });

  it('ignore une accolade de bloc de commentaire', () => {
    const texte = ['class E {', '}', OUVRE, ' vieux code : if (x) { }', FERME].join(NL);
    expect(subscriberAnchor(texte)!.at).toBe(texte.indexOf('}'));
  });

  it('n apprend pas le nom d un abonne mis en commentaire', () => {
    const texte = [
      'package a',
      'class Ecran {',
      `    // @Subscribe fun onVieuxNom(e: E) {}`,
      '}',
    ].join(NL);
    expect(autour(texte).handler).toBe('onBusEvent');
  });

  it('temoin : un vrai abonne donne bien son nom', () => {
    const texte = [
      'package a',
      'class Ecran {',
      '    @Subscribe',
      '    fun onQuelqueChose(e: E) {}',
      '}',
    ].join(NL);
    expect(autour(texte).handler).toBe('onQuelqueChose');
  });

  it('temoin : une classe ordinaire garde son ancienne ancre', () => {
    const texte = ['package a', 'class Ecran {', '    fun f() = Unit', '}', ''].join(NL);
    expect(subscriberAnchor(texte)!.at).toBe(texte.lastIndexOf('}'));
  });

  it('temoin : un fichier sans accolade ne donne pas d ancre', () => {
    expect(subscriberAnchor('package a' + NL + 'val x = 1')).toBeUndefined();
  });
});
