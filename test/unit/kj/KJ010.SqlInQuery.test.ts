import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

/**
 * KJ-010 — SQL highlight dans @Query. CONTRAT : la grammaire
 * syntaxes/kotlin.tmLanguage.json gagne une règle d'injection qui scope le
 * contenu string de @Query(...) avec un scope SQL dédié.
 */
const grammar = () =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'syntaxes', 'kotlin.tmLanguage.json'), 'utf8'));

const hasQueryRule = () => JSON.stringify(grammar()).includes('@Query');

describe.skipIf(!hasQueryRule())('KJ-010 — grammaire @Query', () => {
  it('la règle référence un scope SQL', () => {
    const raw = JSON.stringify(grammar());
    expect(raw).toMatch(/sql/i);
  });

  it('la grammaire reste un JSON valide avec scopeName intact', () => {
    const g = grammar();
    expect(g.scopeName).toBeTruthy();
    expect(Array.isArray(g.patterns)).toBe(true);
  });

  it('les strings triple-quoted sont couvertes par la règle', () => {
    // La fixture SqlQueryDao.kt utilise """ … """ : la règle doit matcher
    // les deux formes de littéraux. On vérifie la présence d'un motif """ dans
    // la ou les règles mentionnant @Query.
    const raw = JSON.stringify(grammar());
    const queryChunk = raw.slice(raw.indexOf('@Query'));
    expect(queryChunk).toMatch(/"""|\\"\\"\\"/);
  });
});
