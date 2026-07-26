import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-002 — Postfix completion. CONTRAT :
 *   export function extractReceiver(lineText: string, dotIndex: number): string | null
 *     // renvoie l'expression receveuse complète qui précède le point
 *   export function expandPostfix(template: string, receiver: string): string | null
 *     // templates : let, val, if, null, notnull, for, when, try, not
 *     // renvoie null si le template ne s'applique pas (ex. `if` sur un littéral numérique)
 */
const mod: any = await importOrNull('src/providers/PostfixCompletionProvider');

describe.skipIf(!mod)('KJ-002 — extraction du receveur', () => {
  it('identifiant simple', () => {
    const line = '        pikachu.';
    expect(mod.extractReceiver(line, line.length - 1)).toBe('pikachu');
  });

  it('chaîne d’accès complète', () => {
    const line = 'val c = find(25)?.name?.length.';
    expect(mod.extractReceiver(line, line.length - 1)).toBe('find(25)?.name?.length');
  });

  it('appel avec arguments imbriqués', () => {
    const line = 'list.filter { it.level > 50 }.';
    expect(mod.extractReceiver(line, line.length - 1)).toBe('list.filter { it.level > 50 }');
  });

  it('ne déborde pas sur le mot-clé précédent', () => {
    const line = 'return ready.';
    expect(mod.extractReceiver(line, line.length - 1)).toBe('ready');
  });
});

describe.skipIf(!mod)('KJ-002 — expansion des templates', () => {
  it('.null / .notnull', () => {
    expect(mod.expandPostfix('null', 'pokemon')).toBe('if (pokemon == null) {\n    $0\n}');
    expect(mod.expandPostfix('notnull', 'pokemon')).toBe('if (pokemon != null) {\n    $0\n}');
  });

  it('.let', () => {
    expect(mod.expandPostfix('let', 'pokemon.name')).toBe('pokemon.name.let { $0 }');
  });

  it('.for', () => {
    expect(mod.expandPostfix('for', 'team')).toBe('for (item in team) {\n    $0\n}');
  });

  it('.not', () => {
    expect(mod.expandPostfix('not', 'ready')).toBe('!ready');
  });

  it('.if sur littéral numérique → null (refusé)', () => {
    expect(mod.expandPostfix('if', '42')).toBeNull();
  });
});
