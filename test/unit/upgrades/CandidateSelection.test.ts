import { describe, it, expect } from 'vitest';
import { selectCandidate, intersectVersions, verdictOf } from '../../../src/upgrades/selection';
import type { Candidate, Dependency, Policy } from '../../../src/upgrades/model';

/**
 * KJ-082, which version a bump offers.
 *
 * The default policy prefers stable: a project on `2.4.21` is not told about
 * `2.5.0-Beta2`, while a project already on `1.0.0-alpha05` is told about the
 * next alpha, and about the stable it skipped. A bump is never the current
 * version and never a downgrade, and a project ahead of what the repository
 * lists is up to date, not behind. A shared `[versions]` entry is only offered
 * a version that exists for every library reading it. The verdict then
 * applies the house order: a pin beats everything, a dynamic version is only
 * offered the stable inside its own prefix, a version managed by a BOM says
 * nothing, and an unknown stays unknown with its reason.
 */

const dependency = (over: Partial<Dependency> = {}): Dependency => ({
  kind: 'library', key: 'library:com.example.kiosk:door', members: [{ group: 'com.example.kiosk', artifact: 'door' }],
  group: 'com.example.kiosk', artifact: 'door', currentVersion: '1.0.0', literal: 'exact',
  versionSite: { file: '/w/gradle/libs.versions.toml', start: 10, end: 15, text: '1.0.0' },
  range: { file: '/w/gradle/libs.versions.toml', start: 10, end: 15 }, line: 0,
  source: 'toml-versions', name: 'door', sharedBy: [],
  ...over,
});
const candidate = (versions: string[], current = '1.0.0', policy: Policy = 'preferStable'): Candidate =>
  selectCandidate(policy, current, versions);

describe('selectCandidate', () => {
  const published = ['2.4.19', '2.4.20-RC', '2.4.20', '2.4.21-RC', '2.4.21', '2.5.0-Beta1', '2.5.0-Beta2'];

  it('prefers stable: a stable current is not told about a Beta', () => {
    const c = selectCandidate('preferStable', '2.4.20', published);
    expect(c.pick).toBe('2.4.21');
    expect(c.latest).toBe('2.5.0-Beta2');
    expect(c.latestStable).toBe('2.4.21');
    expect(c.newerCount).toBe(4);
    expect(c.currentKnown).toBe(true);
    expect(c.versions).toEqual(published);
  });

  it('prefers stable: a current already on a preview line is offered the newest preview, with the stable it skipped', () => {
    const c = selectCandidate('preferStable', '1.0.0-alpha05', ['1.0.0-alpha05', '1.0.0', '1.1.0-alpha01']);
    expect(c.pick).toBe('1.1.0-alpha01');
    expect(c.latestStable).toBe('1.0.0');
  });

  it('stable only never offers a preview, even to a preview current', () => {
    expect(selectCandidate('stable', '2.4.20', published).pick).toBe('2.4.21');
    expect(selectCandidate('stable', '2.4.21', published).pick).toBeUndefined();
    expect(selectCandidate('stable', '1.0.0-alpha05', ['1.0.0-alpha05', '1.1.0-alpha01']).pick).toBeUndefined();
  });

  it('latest offers the newest of everything', () => {
    expect(selectCandidate('latest', '2.4.20', published).pick).toBe('2.5.0-Beta2');
  });

  it('is up to date when nothing is newer, and never offers the current version', () => {
    const c = selectCandidate('preferStable', '2.4.21', published);
    expect(c.pick).toBeUndefined();
    expect(c.newerCount).toBe(2);
  });

  it('treats a current ahead of the repository as up to date and unknown to it', () => {
    const c = selectCandidate('preferStable', '3.0.0', published);
    expect(c.pick).toBeUndefined();
    expect(c.newerCount).toBe(0);
    expect(c.currentKnown).toBe(false);
  });

  it('never offers a downgrade when the list is unsorted or repeats itself', () => {
    const c = selectCandidate('latest', '2.0.0', ['1.0.0', '2.0.0', '1.5.0', '2.0.0', '1.0.0-rc']);
    expect(c.pick).toBeUndefined();
    expect(c.versions).toEqual(['1.0.0-rc', '1.0.0', '1.5.0', '2.0.0']);
  });

  it('carries the metadata it was given, with quiet defaults', () => {
    const bare = selectCandidate('stable', '1.0.0', ['1.0.0']);
    expect(bare.fetchedAt).toBe(0);
    expect(bare.stale).toBe(false);
    expect(bare.releasedAt).toBeUndefined();
    const rich = selectCandidate('stable', '1.0.0', ['1.0.0'], { fetchedAt: 42, stale: true, releasedAt: '2026-10-22', repository: 'mavenCentral' });
    expect(rich).toMatchObject({ fetchedAt: 42, stale: true, releasedAt: '2026-10-22', repository: 'mavenCentral' });
  });

  it('has an empty list and no pick when the repository listed nothing', () => {
    const c = selectCandidate('preferStable', '1.0.0', []);
    expect(c.versions).toEqual([]);
    expect(c.latest).toBe('');
    expect(c.pick).toBeUndefined();
    expect(c.currentKnown).toBe(false);
  });
});

describe('intersectVersions', () => {
  it('keeps only the versions every member publishes, in ascending order', () => {
    expect(intersectVersions([
      ['1.6.2', '1.7.0', '1.8.0', '1.9.0'],
      ['1.9.0', '1.7.0', '1.6.2'],
      ['1.7.0', '1.6.2', '1.9.0', '2.0.0-alpha01'],
    ])).toEqual(['1.6.2', '1.7.0', '1.9.0']);
  });

  it('is the single list, sorted and deduplicated, for one member', () => {
    expect(intersectVersions([['2.0.0', '1.0.0', '1.0.0']])).toEqual(['1.0.0', '2.0.0']);
  });

  it('is empty for no member or for members with nothing in common', () => {
    expect(intersectVersions([])).toEqual([]);
    expect(intersectVersions([['1.0.0'], ['2.0.0']])).toEqual([]);
  });
});

describe('verdictOf', () => {
  it('reports newer with the stability of the pick', () => {
    const v = verdictOf(dependency(), candidate(['1.0.0', '1.1.0']), undefined);
    expect(v).toMatchObject({ kind: 'newer', to: '1.1.0', stability: 'stable' });
    expect((v as { alsoStable?: string }).alsoStable).toBeUndefined();
  });

  it('names the stable skipped when the pick is a preview', () => {
    const dep = dependency({ currentVersion: '1.0.0-alpha05' });
    const v = verdictOf(dep, candidate(['1.0.0-alpha05', '1.0.0', '1.1.0-alpha01'], '1.0.0-alpha05'), undefined);
    expect(v).toMatchObject({ kind: 'newer', to: '1.1.0-alpha01', stability: 'preRelease', alsoStable: '1.0.0' });
  });

  it('does not name a stable that is not newer than the current preview', () => {
    const dep = dependency({ currentVersion: '1.1.0-alpha01' });
    const v = verdictOf(dep, candidate(['1.0.0', '1.1.0-alpha01', '1.1.0-alpha02'], '1.1.0-alpha01'), undefined);
    expect(v).toMatchObject({ kind: 'newer', to: '1.1.0-alpha02', stability: 'preRelease' });
    expect((v as { alsoStable?: string }).alsoStable).toBeUndefined();
  });

  it('is up to date when the candidate has no pick', () => {
    expect(verdictOf(dependency(), candidate(['0.9.0', '1.0.0']), undefined)).toMatchObject({ kind: 'upToDate' });
  });

  it('a pin beats everything, even a newer version', () => {
    expect(verdictOf(dependency({ pin: 'pin-comment' }), candidate(['1.0.0', '2.0.0']), undefined)).toEqual({ kind: 'pinned', by: 'pin-comment' });
    expect(verdictOf(dependency({ pin: 'ignore-marker', literal: 'dynamic' }), undefined, 'offline')).toEqual({ kind: 'pinned', by: 'ignore-marker' });
  });

  it('a dynamic version is offered the latest stable inside its own prefix', () => {
    const dep = dependency({ literal: 'dynamic', currentVersion: '4.+' });
    const c = selectCandidate('preferStable', '4.+', ['4.9.0', '4.12.0', '5.0.0-alpha.1', '5.1.0']);
    expect(verdictOf(dep, c, undefined)).toEqual({ kind: 'rich', form: 'dynamic', pin: '4.12.0' });
    const bare = dependency({ literal: 'dynamic', currentVersion: '+' });
    expect(verdictOf(bare, c, undefined)).toEqual({ kind: 'rich', form: 'dynamic', pin: '5.1.0' });
    const latestRelease = dependency({ literal: 'dynamic', currentVersion: 'latest.release' });
    expect(verdictOf(latestRelease, c, undefined)).toEqual({ kind: 'rich', form: 'dynamic', pin: '5.1.0' });
    expect(verdictOf(dep, undefined, 'pending')).toEqual({ kind: 'rich', form: 'dynamic' });
  });

  it('a range or a rich version is left alone', () => {
    expect(verdictOf(dependency({ literal: 'range', currentVersion: '[1.0, 2.0[' }), candidate(['3.0.0']), undefined)).toEqual({ kind: 'rich', form: 'range' });
    expect(verdictOf(dependency({ literal: 'rich', currentVersion: undefined }), candidate(['3.0.0']), undefined)).toEqual({ kind: 'rich', form: 'rich' });
  });

  it('a templated version is unknown for that reason', () => {
    expect(verdictOf(dependency({ literal: 'templated', currentVersion: '$kotlin' }), candidate(['3.0.0']), undefined)).toEqual({ kind: 'unknown', reason: 'templated' });
  });

  it('a version a BOM manages says nothing', () => {
    expect(verdictOf(dependency({ literal: 'none', currentVersion: undefined }), undefined, 'pending')).toEqual({ kind: 'bomManaged' });
    expect(verdictOf(dependency({ currentVersion: undefined }), candidate(['3.0.0']), undefined)).toEqual({ kind: 'bomManaged' });
  });

  it('passes an unknown reason through, pending by default', () => {
    expect(verdictOf(dependency(), undefined, 'rateLimited')).toEqual({ kind: 'unknown', reason: 'rateLimited' });
    expect(verdictOf(dependency(), undefined, undefined)).toEqual({ kind: 'unknown', reason: 'pending' });
  });
});
