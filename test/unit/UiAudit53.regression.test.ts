import { describe, it, expect } from 'vitest';
import { literalContradicts } from '../../src/providers/InlayHintsProvider';

// Audit 53 : sans compilateur, l'extension résout un appel par son nom, ce qui
// laisse passer quelques étiquettes venues d'une autre déclaration (mesuré :
// 14 sur 17170, voir reference_inlay_receiver_limit). Un sous ensemble est
// prouvable depuis le texte seul : un littéral dont la forme exclut le type du
// paramètre. Cas réel : `Timber.wtf("A Composite module …")` étiqueté
// `throwable:`, une chaîne passée pour un Throwable.

describe('Un littéral qui ne peut pas être du type déclaré', () => {
  it('reconnaît la contradiction', () => {
    expect(literalContradicts('"texte"', 'Throwable')).toBe(true);
    expect(literalContradicts('"texte"', 'Throwable?')).toBe(true);
    expect(literalContradicts('42', 'String')).toBe(true);
    expect(literalContradicts('true', 'Int')).toBe(true);
    expect(literalContradicts("'a'", 'String')).toBe(true);
    expect(literalContradicts('"""bloc"""', 'Int')).toBe(true);
  });

  it('reconnaît le littéral tel que le provider le lui donne', () => {
    // `getArgText` s'arrête au début de l'argument SUIVANT, donc il emporte la
    // virgule ; et le dernier argument d'un appel emporte la parenthèse
    // fermante. Sans nettoyer ces deux formes, la règle ne se déclenchait que
    // lorsqu'un littéral terminait proprement la tranche : 1 cas sur 8.
    expect(literalContradicts('"texte",', 'Throwable')).toBe(true);
    expect(literalContradicts('"texte")', 'Throwable')).toBe(true);
    expect(literalContradicts('"texte", ', 'Throwable')).toBe(true);
    expect(literalContradicts('42)', 'String')).toBe(true);
    expect(literalContradicts('true,', 'Int')).toBe(true);
    // Une virgule DANS la chaîne ne doit pas être confondue avec le séparateur.
    expect(literalContradicts('"a,b",', 'Throwable')).toBe(true);
    expect(literalContradicts('"a,b"', 'String')).toBe(false);
  });

  it('un appel imbriqué reste une expression après nettoyage', () => {
    expect(literalContradicts('bar(1),', 'String')).toBe(false);
    expect(literalContradicts('compute()', 'Int')).toBe(false);
    expect(literalContradicts('42.toString()', 'Int')).toBe(false);
  });

  it('laisse passer ce qui est cohérent', () => {
    expect(literalContradicts('"texte"', 'String')).toBe(false);
    expect(literalContradicts('"texte"', 'CharSequence')).toBe(false);
    expect(literalContradicts('42', 'Int')).toBe(false);
    expect(literalContradicts('42', 'Long')).toBe(false);
    expect(literalContradicts('1.5', 'Double')).toBe(false);
    expect(literalContradicts('true', 'Boolean')).toBe(false);
    expect(literalContradicts("'a'", 'Char')).toBe(false);
  });

  it('ne tranche pas quand elle ne peut pas savoir', () => {
    // `null` est le seul littéral qu'un type nullable accepte.
    expect(literalContradicts('null', 'Throwable?')).toBe(false);
    expect(literalContradicts('null', 'String')).toBe(false);
    // Une expression n'est pas un littéral.
    expect(literalContradicts('ex', 'Throwable')).toBe(false);
    expect(literalContradicts('buildMessage()', 'String')).toBe(false);
    // Un générique, un type inconnu, ou Any : rien à prouver.
    expect(literalContradicts('"x"', 'T')).toBe(false);
    expect(literalContradicts('"x"', 'Any')).toBe(false);
    expect(literalContradicts('42', 'Any')).toBe(false);
    expect(literalContradicts('"x"', 'MonTypeMaison')).toBe(false);
    expect(literalContradicts('"x"', '')).toBe(false);
  });
});
