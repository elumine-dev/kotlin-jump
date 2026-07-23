/**
 * TodoExpiryProvider — findOverdueTodos / parseTodoDate
 *
 * Vecteurs :
 *   TE-1  Date passée en commentaire ligne → hit, range exacte, dateIso
 *   TE-2  Date future / date du jour → pas de hit (aujourd'hui n'est pas overdue)
 *   TE-3  Dates invalides : 30 février, mois 13, jour 00/32 → rejetées
 *         (Date.UTC roll over silencieusement, le round trip doit bloquer)
 *   TE-4  29 février : valide année bissextile, invalide sinon
 *   TE-5  TODO dans une string literal → data, pas une note → pas de hit
 *   TE-6  `//` DANS une string ne fait pas commentaire → pas de hit
 *   TE-7  Bloc slash-star et continuation KDoc ` * ` → hit
 *   TE-8  TODO en code nu (hors commentaire) → pas de hit
 *   TE-9  Espaces dans les parens, plusieurs TODO par ligne
 *   TE-10 Formats non ISO (2020-1-1, 2020/01/01) → pas de match
 */

import { describe, it, expect } from 'vitest';
import { findOverdueTodos, parseTodoDate } from '../../src/providers/TodoExpiryProvider';

// Aujourd'hui fixé au 2026-07-22 UTC pour des tests déterministes
const TODAY = Date.UTC(2026, 6, 22);

describe('TE-1 — date passée en commentaire ligne', () => {
  it('hit avec range exacte et dateIso', () => {
    const line = 'val x = 1 // TODO(2025-01-01): migrate to Room';
    const hits = findOverdueTodos(line, TODAY);
    expect(hits).toHaveLength(1);
    expect(hits[0].dateIso).toBe('2025-01-01');
    expect(line.slice(hits[0].start, hits[0].end)).toBe('TODO(2025-01-01)');
  });

  it('hier → overdue', () => {
    expect(findOverdueTodos('// TODO(2026-07-21)', TODAY)).toHaveLength(1);
  });
});

describe('TE-2 — date future ou du jour', () => {
  it('future → pas de hit', () => {
    expect(findOverdueTodos('// TODO(2027-06-01): optimize later', TODAY)).toHaveLength(0);
  });
  it('date du jour → pas encore overdue', () => {
    expect(findOverdueTodos('// TODO(2026-07-22)', TODAY)).toHaveLength(0);
  });
});

describe('TE-3 — dates invalides rejetées malgré le roll over de Date.UTC', () => {
  it.each([
    ['2025-02-30', '30 février'],
    ['2025-13-01', 'mois 13'],
    ['2025-00-10', 'mois 00'],
    ['2025-01-32', 'jour 32'],
    ['2025-04-31', '31 avril'],
    ['2025-01-00', 'jour 00'],
  ])('%s (%s) → pas de hit', (date) => {
    expect(findOverdueTodos(`// TODO(${date})`, TODAY)).toHaveLength(0);
  });

  it('parseTodoDate rejette le roll over', () => {
    expect(parseTodoDate(2025, 2, 30)).toBeUndefined();
    expect(parseTodoDate(2025, 2, 28)).toBe(Date.UTC(2025, 1, 28));
  });
});

describe('TE-4 — 29 février', () => {
  it('2024-02-29 (bissextile, passé) → hit', () => {
    expect(findOverdueTodos('// TODO(2024-02-29)', TODAY)).toHaveLength(1);
  });
  it('2025-02-29 (non bissextile) → pas de hit', () => {
    expect(findOverdueTodos('// TODO(2025-02-29)', TODAY)).toHaveLength(0);
  });
});

describe('TE-5/6 — strings ne comptent pas', () => {
  it('TODO dans une string literal → pas de hit', () => {
    expect(findOverdueTodos('val s = "TODO(2020-01-01)"', TODAY)).toHaveLength(0);
  });
  it('`// TODO(...)` DANS une string → pas de hit', () => {
    expect(findOverdueTodos('val s = "// TODO(2020-01-01)"', TODAY)).toHaveLength(0);
  });
  it('string puis vrai commentaire → hit', () => {
    const line = 'val s = "x" // TODO(2020-01-01)';
    expect(findOverdueTodos(line, TODAY)).toHaveLength(1);
  });
});

describe('TE-7 — commentaires bloc et KDoc', () => {
  it('/* TODO(...) */ inline → hit', () => {
    expect(findOverdueTodos('val x = 1 /* TODO(2020-01-01) */', TODAY)).toHaveLength(1);
  });
  it('continuation KDoc " * TODO(...)" → hit', () => {
    expect(findOverdueTodos(' * TODO(2020-01-01): document this', TODAY)).toHaveLength(1);
  });
});

describe('TE-8 — TODO hors commentaire', () => {
  it('code nu → pas de hit', () => {
    expect(findOverdueTodos('TODO(2020-01-01)', TODAY)).toHaveLength(0);
  });
  it('stdlib TODO("message") → pas de match (pas une date)', () => {
    expect(findOverdueTodos('fun f() { TODO("later") } // TODO no date', TODAY)).toHaveLength(0);
  });
});

describe('TE-9 — variations de forme', () => {
  it('espaces dans les parens → hit', () => {
    expect(findOverdueTodos('// TODO( 2020-01-01 )', TODAY)).toHaveLength(1);
  });
  it('deux TODO datés sur une ligne → 2 hits', () => {
    const line = '// TODO(2020-01-01) then TODO(2021-06-15)';
    expect(findOverdueTodos(line, TODAY)).toHaveLength(2);
  });
  it('mixte passé + futur sur une ligne → 1 hit', () => {
    const line = '// TODO(2020-01-01) and TODO(2099-01-01)';
    const hits = findOverdueTodos(line, TODAY);
    expect(hits).toHaveLength(1);
    expect(hits[0].dateIso).toBe('2020-01-01');
  });
});

describe('TE-10 — formats non ISO ignorés', () => {
  it.each([
    '// TODO(2020-1-1)',
    '// TODO(2020/01/01)',
    '// TODO(01-01-2020)',
    '// TODO(20200101)',
    '// TODO 2020-01-01',
  ])('%s → pas de match', (line) => {
    expect(findOverdueTodos(line, TODAY)).toHaveLength(0);
  });
});
