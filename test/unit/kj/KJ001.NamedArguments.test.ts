import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-001 — Add names to call arguments. CONTRAT :
 *   export function splitTopLevelArguments(argListText: string): string[]
 *   export class NamedArgumentsActionProvider {
 *     constructor(resolve: (callee: string, arity: number) =>
 *       { params: { name: string; isVararg?: boolean }[] } | null)
 *     buildNamedCall(callText: string): string | null   // le WorkspaceEdit utilise ce texte
 *   }
 */
const mod: any = await importOrNull('src/providers/NamedArgumentsActionProvider');

const resolver = (callee: string, arity: number) => {
  const table: Record<string, string[]> = {
    'createTrainer/3': ['name', 'age', 'isChampion'],
    'heal/1': ['amount'],
    'heal/2': ['amount', 'critical'],
    'withCallback/3': ['label', 'retries', 'onDone'],
  };
  const params = table[`${callee}/${arity}`];
  return params ? { params: params.map((name) => ({ name })) } : null;
};

describe.skipIf(!mod)('KJ-001 — découpage des arguments', () => {
  it('découpe simple', () => {
    expect(mod.splitTopLevelArguments('"Ada", 36, true')).toEqual(['"Ada"', '36', 'true']);
  });

  it('ignore les virgules dans les strings', () => {
    expect(mod.splitTopLevelArguments('"Oak, Prof. (Kanto)", 60, false')).toEqual([
      '"Oak, Prof. (Kanto)"',
      '60',
      'false',
    ]);
  });

  it('ignore les virgules dans les appels imbriqués', () => {
    expect(mod.splitTopLevelArguments('levelUp(10, 2), false')).toEqual([
      'levelUp(10, 2)',
      'false',
    ]);
  });

  it('string avec échappement de guillemet', () => {
    expect(mod.splitTopLevelArguments('"a\\", b", 1')).toEqual(['"a\\", b"', '1']);
  });

  it('lambda inline avec virgule', () => {
    expect(mod.splitTopLevelArguments('{ a, b -> a }, 2')).toEqual(['{ a, b -> a }', '2']);
  });
});

describe.skipIf(!mod)('KJ-001 — construction de l’appel nommé', () => {
  const provider = () => new mod.NamedArgumentsActionProvider(resolver);

  it('cas nominal', () => {
    expect(provider().buildNamedCall('createTrainer("Ada", 36, true)')).toBe(
      'createTrainer(name = "Ada", age = 36, isChampion = true)'
    );
  });

  it('argument déjà nommé conservé tel quel', () => {
    expect(provider().buildNamedCall('createTrainer("Red", 11, isChampion = false)')).toBe(
      'createTrainer(name = "Red", age = 11, isChampion = false)'
    );
  });

  it('surcharge résolue par arité', () => {
    expect(provider().buildNamedCall('heal(20)')).toBe('heal(amount = 20)');
    expect(provider().buildNamedCall('heal(20, true)')).toBe('heal(amount = 20, critical = true)');
  });

  it('trailing lambda jamais nommée', () => {
    expect(provider().buildNamedCall('withCallback("sync", 3) { println(it) }')).toBe(
      'withCallback(label = "sync", retries = 3) { println(it) }'
    );
  });

  it('callee inconnu → null (pas d’action proposée)', () => {
    expect(provider().buildNamedCall('mystery(1, 2)')).toBeNull();
  });

  it('appel déjà entièrement nommé → null (action inutile)', () => {
    expect(provider().buildNamedCall('heal(amount = 20)')).toBeNull();
  });
});
