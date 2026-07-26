import { describe, it, expect } from 'vitest';
import {
  suggestResourceName,
  escapeForStringsXml,
  isComposableContext,
  extractTemplateArgs,
  buildReplacement,
  literalAtPosition,
} from '../../../src/providers/ExtractStringResourceProvider';

/** KJ-005 — tentatives de casse au-delà du contrat. */

describe('KJ-005 adversarial — suggestResourceName', () => {
  it('littéral qui commence par un chiffre : préfixé (nom res invalide sinon)', () => {
    expect(suggestResourceName('3 starters available', new Set())).toBe('s_3_starters_available');
  });

  it('littéral 100 % ponctuation : fallback stable', () => {
    expect(suggestResourceName('!!! ???', new Set())).toBe('extracted_string');
  });

  it('cascade de collisions', () => {
    const existing = new Set(['battle', 'battle_2', 'battle_3']);
    expect(suggestResourceName('Battle', existing)).toBe('battle_4');
  });

  it('placeholders retirés du nom mais pas du contenu', () => {
    const name = suggestResourceName('Turn %1$d of %2$d', new Set());
    expect(name).toBe('turn_of');
  });

  it('coupe au mot, jamais en plein milieu', () => {
    const name = suggestResourceName(
      'This is a very long disclaimer text that should be truncated',
      new Set()
    );
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith('_')).toBe(false);
    // le dernier segment est un mot entier du littéral
    const last = name.split('_').pop()!;
    expect('this is a very long disclaimer text that should be truncated').toContain(last);
  });
});

describe('KJ-005 adversarial — templates Kotlin (bug trouvé par Kevin)', () => {
  it('$var converti en placeholder positionnel + argument', () => {
    expect(extractTemplateArgs('Turn $turns of 10')).toEqual({
      xmlValue: 'Turn %1$s of 10',
      args: ['turns'],
    });
  });

  it('${expr} et $var mélangés, numérotation séquentielle', () => {
    expect(extractTemplateArgs('${user.name} has $count wins')).toEqual({
      xmlValue: '%1$s has %2$s wins',
      args: ['user.name', 'count'],
    });
  });

  it('sans template : valeur intacte, aucun argument', () => {
    expect(extractTemplateArgs('plain text')).toEqual({ xmlValue: 'plain text', args: [] });
  });

  it('remplacement composable avec arguments', () => {
    expect(buildReplacement('"Turn $turns"', 'turn_of', 'composable', ['turns'])).toBe(
      'stringResource(R.string.turn_of, turns)'
    );
  });

  it('remplacement code avec arguments passe par getString', () => {
    expect(buildReplacement('"Hi $name"', 'hi', 'code', ['name'])).toBe(
      'context.getString(R.string.hi, name)'
    );
  });

  it('le nom généré exclut les identifiants de template', () => {
    expect(suggestResourceName('Turn $turns of 10', new Set())).toBe('turn_of_10');
  });
});

describe('KJ-005 adversarial — BUG-HUNT-5 : littéral sous le curseur', () => {
  it('deuxième littéral de la ligne atteignable (le provider ne prenait que le premier)', () => {
    const line = 'setError("Oops", fallback = "Try again")';
    const second = literalAtPosition(line, line.indexOf('Try'));
    expect(second?.literal).toBe('Try again');
    const first = literalAtPosition(line, line.indexOf('Oops'));
    expect(first?.literal).toBe('Oops');
  });

  it('curseur hors de tout littéral → null', () => {
    const line = 'setError("Oops", retry)';
    expect(literalAtPosition(line, line.indexOf('retry'))).toBeNull();
  });

  it('littéral avec guillemet échappé : bornes exactes', () => {
    const line = 'log("dit \\"go\\"") ; Text("ok")';
    const hit = literalAtPosition(line, line.indexOf('ok'));
    expect(hit?.literal).toBe('ok');
  });
});

describe('KJ-005 adversarial — escapeForStringsXml', () => {
  it('guillemets doubles échappés', () => {
    expect(escapeForStringsXml('say "hi" loud')).toBe('say \\"hi\\" loud');
  });

  it('&amp; existant pas double-échappé… (limitation assumée : & brut attendu en entrée)', () => {
    expect(escapeForStringsXml('A & B')).toBe('A &amp; B');
  });

  it('chaîne vide reste vide', () => {
    expect(escapeForStringsXml('')).toBe('');
  });
});

describe('KJ-005 adversarial — isComposableContext', () => {
  it('détecte @Composable au-dessus de la fun englobante', () => {
    const lines = ['@Composable', 'fun Header() {', '    Text("x")', '}'];
    expect(isComposableContext(lines, 2)).toBe(true);
  });

  it('annotation empilée avec @Preview', () => {
    const lines = ['@Preview', '@Composable', 'fun P() {', '    Text("x")', '}'];
    expect(isComposableContext(lines, 3)).toBe(true);
  });

  it('fun ordinaire → code', () => {
    const lines = ['fun bind() {', '    setText("x")', '}'];
    expect(isComposableContext(lines, 1)).toBe(false);
  });

  it('@Composable sur la MÊME ligne que fun', () => {
    const lines = ['@Composable fun Inline() { Text("x") }'];
    expect(isComposableContext(lines, 0)).toBe(true);
  });

  it('la fun PRÉCÉDENTE composable ne contamine pas la suivante', () => {
    const lines = [
      '@Composable',
      'fun A() { }',
      '',
      'fun b() {',
      '    setText("x")',
      '}',
    ];
    expect(isComposableContext(lines, 4)).toBe(false);
  });
});
