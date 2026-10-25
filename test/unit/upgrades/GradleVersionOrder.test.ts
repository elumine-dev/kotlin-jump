import { describe, it, expect } from 'vitest';
import { compareVersions, sortVersions, parseVersion, parseCacheSize, PARSE_CACHE_LIMIT } from '../../../src/upgrades/gradleVersion';

/**
 * KJ-082, the order of versions.
 *
 * A dependency is behind when a repository lists a version Gradle would rank
 * above the one in the catalog, so the comparison must be Gradle's own, not a
 * semver lookalike. Gradle splits on dots, dashes, underscores and pluses and
 * at every digit to letter boundary, ranks a number above any word, ranks
 * `dev` below everything, puts `rc`, `snapshot`, `final`, `ga`, `release` and
 * `sp` above every other word in that order, and compares the remaining words
 * by code unit, so `Beta2` sorts below `alpha05`. The cases below are the
 * examples of the Gradle manual plus the ones met on real repositories today:
 * `9.5.0-rc01 < 9.6.0-alpha01`, `2.4.21 < 2.5.0-Beta2`, `2.2.21-2.0.5 < 2.3.0`.
 */

const lt = (a: string, b: string) => {
  expect(compareVersions(a, b), `${a} < ${b}`).toBeLessThan(0);
  expect(compareVersions(b, a), `${b} > ${a}`).toBeGreaterThan(0);
};
const eq = (a: string, b: string) => {
  expect(compareVersions(a, b), `${a} == ${b}`).toBe(0);
  expect(compareVersions(b, a), `${b} == ${a}`).toBe(0);
};
const chain = (...versions: string[]) => {
  for (let i = 0; i + 1 < versions.length; i++) lt(versions[i], versions[i + 1]);
};

describe('compareVersions, the examples of the Gradle manual', () => {
  it('compares numeric parts by value', () => {
    lt('1.1', '1.2');
    lt('1.9', '1.10');
    lt('2024.02.00', '2024.09.01');
  });

  it('ranks a numeric part above a word', () => {
    lt('1.a', '1.1');
  });

  it('compares words by code unit, uppercase first', () => {
    chain('1.A', '1.B', '1.a', '1.b');
  });

  it('makes an extra numeric part higher and an extra word lower', () => {
    lt('1.1', '1.1.0');
    lt('1.1.a', '1.1');
    lt('1.0-rc', '1.0');
  });

  it('puts dev below every other word and the special qualifiers above', () => {
    chain('1.0-dev', '1.0-ALPHA', '1.0-alpha', '1.0-rc');
    chain('1.0-zeta', '1.0-rc', '1.0-snapshot', '1.0-final', '1.0-ga', '1.0-release', '1.0-sp', '1.0');
  });

  it('ignores the separator and the case of a special qualifier', () => {
    eq('1.0-RC-1', '1.0.rc.1');
    lt('1.0-RC-1', '1.0-rc-2');
    eq('1.0-SNAPSHOT', '1.0-snapshot');
  });

  it('splits at digit and letter boundaries, so 1a1 is 1.a.1', () => {
    eq('1a1', '1.a.1');
    eq('1.a.1', '1-a+1');
    eq('1_a_1', '1a1');
  });

  it('treats leading zeros as the same number', () => {
    eq('1.01', '1.1');
    lt('1.01', '1.2');
  });

  it('is zero for the same text', () => {
    eq('2.9.0', '2.9.0');
    eq('', '');
  });
});

describe('compareVersions, cases met on real repositories', () => {
  it('ranks an alpha of the next minor above the rc of the previous one', () => {
    lt('9.5.0-rc01', '9.6.0-alpha01');
  });

  it('ranks a Beta of the next minor above the previous stable', () => {
    lt('2.4.21', '2.5.0-Beta2');
  });

  it('ranks Beta2 below alpha05, because B sorts before a by code unit', () => {
    lt('1.0.0-Beta2', '1.0.0-alpha05');
  });

  it('ranks a two part KSP version below the standalone line that followed it', () => {
    lt('2.2.21-2.0.5', '2.3.0');
  });

  it('ranks the jre flavour of a library above its android flavour', () => {
    lt('33.5.0-android', '33.5.0-jre');
  });

  it('ranks a date like version by value', () => {
    lt('20240303', '20241001');
  });
});

describe('sortVersions', () => {
  it('returns an ascending copy without duplicates and leaves the input alone', () => {
    const input = ['2.0.0', '1.0.0', '2.0.0', '1.0.0-rc', '1.0.0-dev', '10.0.0'];
    const copy = [...input];
    expect(sortVersions(input)).toEqual(['1.0.0-dev', '1.0.0-rc', '1.0.0', '2.0.0', '10.0.0']);
    expect(input).toEqual(copy);
  });

  it('gives the same order whatever the input order', () => {
    const a = ['1.1', '1.1.0', '1.1.a', '1.A', '1.a', '1.0-sp', '1.0-ga', '1.0'];
    const sorted = sortVersions(a);
    expect(sortVersions([...a].reverse())).toEqual(sorted);
    expect(sortVersions([...a].sort())).toEqual(sorted);
    expect(sorted).toEqual(['1.A', '1.a', '1.0-ga', '1.0-sp', '1.0', '1.1.a', '1.1', '1.1.0']);
  });

  it('is empty for an empty list', () => {
    expect(sortVersions([])).toEqual([]);
  });
});

describe('parseVersion and its memo', () => {
  it('splits into parts with the numeric value of each numeric part', () => {
    expect(parseVersion('1.0-rc01')).toEqual({ parts: ['1', '0', 'rc', '01'], numeric: [1, 0, undefined, 1] });
    expect(parseVersion('33.5.0-android')).toEqual({ parts: ['33', '5', '0', 'android'], numeric: [33, 5, 0, undefined] });
  });

  it('never grows past its cap', () => {
    for (let i = 0; i < PARSE_CACHE_LIMIT + 500; i++) parseVersion(`0.0.${i}-memo`);
    expect(parseCacheSize()).toBeLessThanOrEqual(PARSE_CACHE_LIMIT);
    expect(PARSE_CACHE_LIMIT).toBe(4096);
  });
});
