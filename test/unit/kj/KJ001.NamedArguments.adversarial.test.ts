import { describe, it, expect } from 'vitest';
import {
  NamedArgumentsActionProvider,
  splitTopLevelArguments,
} from '../../../src/providers/NamedArgumentsActionProvider';

/** KJ-001 — tentatives de casse au-delà du contrat. */

const resolver = (callee: string) => {
  const table: Record<string, { name: string; isVararg?: boolean }[]> = {
    heal: [{ name: 'amount' }],
    levelUp: [{ name: 'base' }, { name: 'gain' }, { name: 'bonuses', isVararg: true }],
    render: [{ name: 'title' }, { name: 'body' }],
  };
  return table[callee] ? { params: table[callee] } : null;
};

const provider = new NamedArgumentsActionProvider(resolver);

describe('KJ-001 adversarial — splitTopLevelArguments', () => {
  it('raw string """…""" avec virgule', () => {
    expect(splitTopLevelArguments('"""a, b""", 1')).toEqual(['"""a, b"""', '1']);
  });

  it('template ${call(1, 2)} dans une string', () => {
    expect(splitTopLevelArguments('"x${g(1, 2)}", 3')).toEqual(['"x${g(1, 2)}"', '3']);
  });

  it('char literal virgule', () => {
    expect(splitTopLevelArguments("',', 2")).toEqual(["','", '2']);
  });

  it('lambda inline contenant appel à 2 args', () => {
    expect(splitTopLevelArguments('{ x -> g(x, 1) }, 2')).toEqual(['{ x -> g(x, 1) }', '2']);
  });

  it('crochets de tableau', () => {
    expect(splitTopLevelArguments('arr[i, j], 4')).toEqual(['arr[i, j]', '4']);
  });

  it('liste vide → []', () => {
    expect(splitTopLevelArguments('')).toEqual([]);
    expect(splitTopLevelArguments('   ')).toEqual([]);
  });
});

describe('KJ-001 — fuzz de garde du splitter (déterministe)', () => {
  it('1000 listes d’arguments générées : jamais de crash, contenu préservé', () => {
    // LCG déterministe — pas de Math.random : le test doit être rejouable.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const ATOMS = ['x', '"a,b"', "'\\','", '{ p -> q(p, 1) }', 'f(g(1, 2), h[i, j])', '"t ${u(1, 2)}"', '"""raw, )"""'];
    for (let round = 0; round < 1000; round++) {
      const parts = Array.from({ length: 1 + rand(5) }, () => ATOMS[rand(ATOMS.length)]);
      const joined = parts.join(', ');
      const split = splitTopLevelArguments(joined);
      expect(split, joined).toEqual(parts);
    }
  });
});

describe('KJ-001 adversarial — buildNamedCall', () => {
  it('vararg : rien après le vararg n’est nommé', () => {
    expect(provider.buildNamedCall('levelUp(5, 1, 3, 4, 5)')).toBe(
      'levelUp(base = 5, gain = 1, 3, 4, 5)'
    );
  });

  it('receveur safe-call préservé', () => {
    expect(provider.buildNamedCall('vm?.heal(20)')).toBe('vm?.heal(amount = 20)');
  });

  it('argument comparaison == pas confondu avec un nommage', () => {
    expect(provider.buildNamedCall('heal(a == b)')).toBe('heal(amount = a == b)');
  });

  it('nommage existant avec espaces multiples respecté', () => {
    expect(provider.buildNamedCall('heal(amount   =   20)')).toBeNull();
  });

  it('parenthèse jamais fermée → null, pas de crash', () => {
    expect(provider.buildNamedCall('heal(20')).toBeNull();
  });

  it('appel vide → null', () => {
    expect(provider.buildNamedCall('heal()')).toBeNull();
  });

  it('texte qui n’est pas un appel → null', () => {
    expect(provider.buildNamedCall('val x = 3')).toBeNull();
    expect(provider.buildNamedCall('')).toBeNull();
  });

  it('string arg contenant `name =` non prise pour un argument nommé', () => {
    expect(provider.buildNamedCall('render("title = fake", body)')).toBe(
      'render(title = "title = fake", body = body)'
    );
  });

  it('plus d’arguments que de paramètres : le surplus reste intact', () => {
    expect(provider.buildNamedCall('render(a, b, c)')).toBe('render(title = a, body = b, c)');
  });
});
