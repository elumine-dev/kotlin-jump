import { describe, it, expect } from 'vitest';
import type { Dependency, Finding, RailFinding, UpgradeReport } from '../../src/upgrades/model';
import {
  badgeFor, buildReport, codeFor, fixesFor, formatReleased, hoverFor, isReported, messageFor, reanchor, severityFor, tierOf,
} from '../../src/providers/dependencyUpgrades';

/**
 * KJ-082, what the editor says about a dependency upgrade, in words a
 * reviewer can check: the diagnostic message, the badge, the hover, the quick
 * fix titles and the markdown report.
 *
 * The copy follows the house rules: English, no dash of any kind, counts that
 * agree in number, dates as a month and a year. A fix title says what moves:
 * a shared `[versions]` entry read by four libraries moves four libraries,
 * and the title says so before anyone clicks. A preview is offered only when
 * the policy allows it, and never as the preferred action next to a stable.
 */

const FILE = '/w/gradle/libs.versions.toml';
const TEXT = '[versions]\nretrofit = "2.9.0"\ncompose = "1.6.2"\nokhttp = "4.+"\n\n[libraries]\nretrofit-core = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }\ncompose-ui = { module = "androidx.compose.ui:ui", version.ref = "compose" }\nokhttp-core = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }\n';

const site = (name: string, literal: string, extra: Partial<Dependency> = {}): Dependency => {
  const start = TEXT.indexOf(`"${literal}"`) + 1;
  return {
    kind: 'library', key: `versions:${name}`, members: [{ group: 'com.squareup.retrofit2', artifact: 'retrofit' }], group: 'com.squareup.retrofit2', artifact: 'retrofit',
    currentVersion: literal, literal: 'exact', versionSite: { file: FILE, start, end: start + literal.length, text: literal },
    range: { file: FILE, start: start - 1, end: start + literal.length + 1 }, line: TEXT.slice(0, start).split('\n').length - 1, source: 'toml-versions', name, sharedBy: [], ...extra,
  };
};
const candidate = (versions: string[], pick: string | undefined, extra: Record<string, unknown> = {}) => ({
  latest: versions[versions.length - 1], latestStable: pick, pick, versions, newerCount: 3, currentKnown: true, fetchedAt: Date.UTC(2026, 9, 25, 10), stale: false, repository: 'mavenCentral' as const, ...extra,
});
const NOW = Date.UTC(2026, 9, 25, 12);

const retrofit: Finding = { dependency: site('retrofit', '2.9.0'), verdict: { kind: 'newer', to: '3.0.0', stability: 'stable', candidate: candidate(['2.9.0', '2.10.0', '2.11.0', '3.0.0'], '3.0.0', { releasedAt: '2025-05-27' }) } };
const shared: Finding = {
  dependency: site('compose', '1.6.2', { sharedBy: ['compose-ui', 'compose-ui-tooling', 'compose-ui-tooling-preview', 'compose-foundation'].map((alias, i) => ({ alias, line: 10 + i, character: 0 })) }),
  verdict: { kind: 'newer', to: '1.7.0', stability: 'stable', candidate: candidate(['1.6.2', '1.6.8', '1.7.0'], '1.7.0') },
};
const dynamic: Finding = { dependency: site('okhttp', '4.+', { literal: 'dynamic' }), verdict: { kind: 'rich', form: 'dynamic', pin: '4.12.0' } };
const preview: Finding = { dependency: site('retrofit', '2.9.0'), verdict: { kind: 'newer', to: '3.1.0-alpha01', stability: 'preRelease', candidate: candidate(['2.9.0', '3.0.0', '3.1.0-alpha01'], '3.0.0'), alsoStable: '3.0.0' } };
const quiet: Finding[] = [
  { dependency: site('retrofit', '2.9.0'), verdict: { kind: 'upToDate', candidate: candidate(['2.9.0'], undefined) } },
  { dependency: site('retrofit', '2.9.0'), verdict: { kind: 'unknown', reason: 'offline' } },
  { dependency: site('retrofit', '2.9.0', { pin: 'pin-comment' }), verdict: { kind: 'pinned', by: 'pin-comment' } },
  { dependency: site('retrofit', '2.9.0', { literal: 'rich' }), verdict: { kind: 'rich', form: 'rich' } },
  { dependency: site('retrofit', '2.9.0', { literal: 'none', currentVersion: undefined }), verdict: { kind: 'bomManaged' } },
];
const report = (findings: Finding[], rails: RailFinding[] = []): UpgradeReport => ({ findings, rails, pendingKeys: [], catalogUnparsed: false });

describe('KJ-082 copy: tiers, messages, badges', () => {
  it('classifies a bump by the first part that changes', () => {
    expect(tierOf('2.9.0', '3.0.0')).toBe('major');
    expect(tierOf('1.6.2', '1.7.0')).toBe('minor');
    expect(tierOf('2.7.6', '2.7.7')).toBe('patch');
    expect(tierOf('2024.02.00', '2024.09.03')).toBe('minor');
    expect(tierOf('1.9.22', '2.0.21')).toBe('major');
    expect(tierOf('1.0.0', '1.0.0-rc1')).toBe('other');
  });

  it('reports only what has a fix: a newer version or a dynamic version with a pin', () => {
    expect(isReported(retrofit)).toBe(true);
    expect(isReported(dynamic)).toBe(true);
    for (const q of quiet) expect(isReported(q)).toBe(false);
    expect(isReported({ ...dynamic, verdict: { kind: 'rich', form: 'dynamic' } })).toBe(false);
  });

  it('says the name, the current version, the newer one, how far behind, and how many libraries share the entry', () => {
    expect(messageFor(retrofit)).toBe('retrofit 2.9.0: newer stable 3.0.0, 3 versions behind');
    expect(messageFor(shared)).toBe('compose 1.6.2: newer stable 1.7.0, 3 versions behind, shared by 4 libraries');
    expect(messageFor(preview)).toBe('retrofit 2.9.0: newer preview 3.1.0-alpha01, stable 3.0.0 available');
    expect(messageFor(dynamic)).toBe('okhttp 4.+: dynamic version, builds can change without a commit. Latest stable is 4.12.0');
    expect(messageFor({ ...retrofit, verdict: { ...retrofit.verdict, candidate: { ...(retrofit.verdict as any).candidate, newerCount: 1 } } as any })).toBe('retrofit 2.9.0: newer stable 3.0.0, 1 version behind');
  });

  it('a code and a severity per kind, a badge that names the target', () => {
    expect(codeFor(retrofit)).toBe('outdated-dependency');
    expect(codeFor(dynamic)).toBe('dynamic-version');
    expect(severityFor(retrofit)).toBe('warning');
    expect(severityFor(dynamic)).toBe('information');
    expect(badgeFor(retrofit)).toBe('↑ 3.0.0');
    expect(badgeFor(dynamic)).toBe('pin 4.12.0');
    expect(badgeFor(quiet[0])).toBeUndefined();
  });

  it('writes dates as a month and a year, never as digits with dashes', () => {
    expect(formatReleased('2025-05-27')).toBe('May 2025');
    expect(formatReleased('2026-10-01')).toBe('October 2026');
    expect(formatReleased('nonsense')).toBeUndefined();
  });

  it('no copy carries a dash: version strings and identifiers are the only hyphens allowed', () => {
    const texts = [messageFor(retrofit), messageFor(shared), messageFor(preview), messageFor(dynamic), hoverFor(retrofit, [], NOW), hoverFor(dynamic, [], NOW), hoverFor(quiet[1], [], NOW), hoverFor(quiet[2], [], NOW)];
    for (const t of texts) {
      const words = t.replace(/\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)*/g, '').replace(/`[^`]*`/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '');
      expect(words, t).not.toMatch(/[‐-―]|(?<=[A-Za-z])-(?=[A-Za-z])|\s-\s/);
    }
  });
});

describe('KJ-082 copy: the hover', () => {
  it('for a newer version: how far behind, when the latest shipped, who shares it, the links, when it was checked', () => {
    const h = hoverFor(shared, [], NOW);
    expect(h).toContain('**compose** 1.6.2');
    expect(h).toContain('newer stable **1.7.0**');
    expect(h).toContain('3 versions behind');
    expect(h).toContain('Shared by 4 libraries: compose-ui, compose-ui-tooling, compose-ui-tooling-preview, compose-foundation');
    expect(h).toContain('Checked 2 hours ago from Maven Central');
    expect(hoverFor(retrofit, [], NOW)).toContain('published May 2025');
    expect(hoverFor(retrofit, [], NOW)).toContain('[Maven Central](https://central.sonatype.com/artifact/com.squareup.retrofit2/retrofit)');
  });

  it('for the quiet verdicts: says what is known and why nothing is reported', () => {
    expect(hoverFor(quiet[0], [], NOW)).toContain('retrofit 2.9.0 is the latest stable');
    expect(hoverFor(quiet[1], [], NOW)).toContain('No version data for com.squareup.retrofit2:retrofit: offline');
    expect(hoverFor(quiet[2], [], NOW)).toContain('is pinned (# @pin)');
    expect(hoverFor(quiet[3], [], NOW)).toContain('rich version, not checked');
    expect(hoverFor(quiet[4], [], NOW)).toContain('managed by a BOM');
    expect(hoverFor({ dependency: site('retrofit', '2.9.0'), verdict: { kind: 'unknown', reason: 'noConsent' } }, [], NOW)).toContain('Version checks are off. Run Kotlin Jump: Check Dependency Upgrades');
  });

  it('a rail is spelled out under the dependency it concerns', () => {
    const ksp = site('ksp', '2.9.0', { members: [{ group: 'com.google.devtools.ksp', artifact: 'com.google.devtools.ksp.gradle.plugin' }], kind: 'plugin', name: 'ksp' });
    const rail: RailFinding = { rail: 'ksp-kotlin', dependency: ksp, expected: '1.9.22', actual: '1.9.20', message: 'ksp 1.9.20-1.0.14 targets Kotlin 1.9.20, this build uses Kotlin 1.9.22. Latest for Kotlin 1.9.22 is 1.9.22-1.0.18', compatiblePick: '1.9.22-1.0.18' };
    expect(hoverFor({ dependency: ksp, verdict: { kind: 'upToDate', candidate: candidate(['2.9.0'], undefined) } }, [rail], NOW)).toContain(rail.message);
  });
});

describe('KJ-082 copy: quick fixes', () => {
  const bump = (f: Finding, to: string) => (f.dependency.versionSite ? [{ file: FILE, start: f.dependency.versionSite.start, end: f.dependency.versionSite.end, newText: to }] : []);
  const textOf = () => TEXT;

  it('a stable bump is the preferred fix, and a shared entry says how many libraries move', () => {
    const fixes = fixesFor(retrofit, report([retrofit]), 'preferStable', textOf, bump);
    expect(fixes[0]).toMatchObject({ title: 'Bump retrofit to 3.0.0', preferred: true, kind: 'bump' });
    expect(fixes[0].edits).toEqual(bump(retrofit, '3.0.0'));
    expect(fixesFor(shared, report([shared]), 'preferStable', textOf, bump)[0].title).toBe('Bump compose to 1.7.0, 4 libraries move');
  });

  it('a preview is offered after the stable and never preferred; under the stable policy it is not offered at all', () => {
    const withPreview: Finding = { ...retrofit, verdict: { ...(retrofit.verdict as any), candidate: candidate(['2.9.0', '3.0.0', '3.1.0-alpha01'], '3.0.0') } };
    const titles = fixesFor(withPreview, report([withPreview]), 'preferStable', textOf, bump).map(f => `${f.title}${f.preferred ? ' *' : ''}`);
    expect(titles.slice(0, 2)).toEqual(['Bump retrofit to 3.0.0 *', 'Bump retrofit to 3.1.0-alpha01, preview']);
    expect(fixesFor(withPreview, report([withPreview]), 'stable', textOf, bump).map(f => f.title)).not.toContain('Bump retrofit to 3.1.0-alpha01, preview');
    // Already on a preview line: the newer preview is preferred, the skipped stable comes second.
    const t2 = fixesFor(preview, report([preview]), 'preferStable', textOf, bump).map(f => `${f.title}${f.preferred ? ' *' : ''}`);
    expect(t2.slice(0, 2)).toEqual(['Bump retrofit to 3.1.0-alpha01, preview *', 'Bump retrofit to 3.0.0, stable']);
  });

  it('a dynamic version gets a pin, every reported entry gets a comment to hold it back, in the file style', () => {
    const pin = fixesFor(dynamic, report([dynamic]), 'preferStable', textOf, bump);
    expect(pin[0]).toMatchObject({ title: 'Pin okhttp to 4.12.0', preferred: true, kind: 'pin' });
    expect(pin[0].edits[0].newText).toBe('4.12.0');
    const comment = fixesFor(retrofit, report([retrofit]), 'preferStable', textOf, bump).find(f => f.kind === 'comment')!;
    expect(comment.title).toBe('Pin retrofit at 2.9.0 with # @pin');
    const lineEnd = TEXT.indexOf('\n', TEXT.indexOf('retrofit = '));
    expect(comment.edits).toEqual([{ file: FILE, start: lineEnd, end: lineEnd, newText: ' # @pin' }]);
    const inBuild: Finding = { ...retrofit, dependency: { ...retrofit.dependency, source: 'build-literal', range: { ...retrofit.dependency.range, file: '/w/app/build.gradle.kts' } } };
    expect(fixesFor(inBuild, report([inBuild]), 'preferStable', () => 'implementation("com.squareup.retrofit2:retrofit:2.9.0")\n', bump).find(f => f.kind === 'comment')!.title).toBe('Ignore this version in upgrade checks');
  });

  it('two or more bumps of one tier in the file add a bulk fix, never for the majors', () => {
    const nav: Finding = { dependency: site('compose', '1.6.2', { name: 'navigation' }), verdict: { kind: 'newer', to: '1.6.3', stability: 'stable', candidate: candidate(['1.6.2', '1.6.3'], '1.6.3') } };
    const m3: Finding = { dependency: site('okhttp', '4.+', { name: 'material3', literal: 'exact', currentVersion: '1.2.0' }), verdict: { kind: 'newer', to: '1.2.1', stability: 'stable', candidate: candidate(['1.2.0', '1.2.1'], '1.2.1') } };
    const fixes = fixesFor(nav, report([nav, m3, retrofit]), 'preferStable', textOf, bump);
    expect(fixes.find(f => f.kind === 'bulk')!.title).toBe('Bump all 2 patch versions in this file');
    expect(fixesFor(retrofit, report([retrofit, { ...retrofit, dependency: { ...retrofit.dependency, key: 'versions:other', name: 'other' } }]), 'preferStable', textOf, bump).find(f => f.kind === 'bulk')).toBeUndefined();
  });

  it('a KSP rail offers the matching KSP first, and the pair with Kotlin when Kotlin can move too', () => {
    const ksp = site('ksp', '2.9.0', { kind: 'plugin', name: 'ksp', currentVersion: '1.9.20-1.0.14', members: [{ group: 'com.google.devtools.ksp', artifact: 'com.google.devtools.ksp.gradle.plugin' }] });
    ksp.versionSite = { file: FILE, start: 100, end: 113, text: '1.9.20-1.0.14' };
    const kotlin = site('kotlin', '2.9.0', { kind: 'plugin', name: 'kotlin', currentVersion: '1.9.22', members: [{ group: 'org.jetbrains.kotlin.jvm', artifact: 'org.jetbrains.kotlin.jvm.gradle.plugin' }] });
    kotlin.versionSite = { file: FILE, start: 50, end: 56, text: '1.9.22' };
    const kspFinding: Finding = { dependency: ksp, verdict: { kind: 'newer', to: '2.0.21-1.0.28', stability: 'stable', candidate: candidate(['1.9.20-1.0.14', '1.9.22-1.0.18', '2.0.21-1.0.28'], '2.0.21-1.0.28') } };
    const kotlinFinding: Finding = { dependency: kotlin, verdict: { kind: 'newer', to: '2.0.21', stability: 'stable', candidate: candidate(['1.9.22', '2.0.21'], '2.0.21') } };
    const rail: RailFinding = { rail: 'ksp-kotlin', dependency: ksp, expected: '1.9.22', actual: '1.9.20', message: 'x', compatiblePick: '1.9.22-1.0.18', edits: [{ file: FILE, start: 100, end: 113, newText: '1.9.22-1.0.18' }] };
    const fixes = fixesFor(kspFinding, report([kspFinding, kotlinFinding], [rail]), 'preferStable', textOf, bump);
    expect(fixes[0]).toMatchObject({ title: 'Bump ksp to 1.9.22-1.0.18, matches Kotlin 1.9.22', preferred: true });
    expect(fixes[1]).toMatchObject({ title: 'Bump kotlin to 2.0.21 and ksp to 2.0.21-1.0.28 together', preferred: false, kind: 'coupled' });
    expect(fixes[1].edits).toHaveLength(2);
    expect(fixes.some(f => f.title === 'Bump ksp to 2.0.21-1.0.28')).toBe(false);
  });
});

describe('KJ-082 copy: reanchor after an edit', () => {
  it('keeps the untouched findings at their new place and drops the one whose literal changed', () => {
    const findings = [retrofit, shared, dynamic];
    const edited = TEXT.replace('compose = "1.6.2"', 'compose = "1.7.0"').replace('[versions]\n', '[versions]\n# a new line above\n');
    const kept = reanchor(edited, FILE, 'toml', findings);
    expect(kept.map(f => f.dependency.name)).toEqual(['retrofit', 'okhttp']);
    const r = kept[0].dependency;
    expect(edited.slice(r.versionSite!.start, r.versionSite!.end)).toBe('2.9.0');
    expect(r.line).toBe(2);
  });

  it('an unreadable catalog keeps nothing', () => {
    expect(reanchor('[versions]\nbroken = { \n', FILE, 'toml', [retrofit])).toEqual([]);
  });
});

describe('KJ-082 copy: the report', () => {
  it('is a markdown table a pull request can carry, with the quiet entries listed apart', () => {
    const md = buildReport({ findings: [retrofit, shared, dynamic, ...quiet], rails: [], checkedAt: NOW, sources: ['mavenCentral', 'google'], policy: 'preferStable', racine: '/w' });
    expect(md).toContain('## Dependency upgrades');
    expect(md).toContain('2 upgrades available: 1 major, 1 minor. Checked 25 October 2026 against Maven Central, Google Maven. Policy: prefer stable.');
    expect(md).toContain('| Dependency | Current | Latest stable | Type | Release notes |');
    expect(md).toContain('| retrofit (com.squareup.retrofit2:retrofit) | 2.9.0 | 3.0.0 | major |');
    expect(md).toContain('| compose (4 libraries) | 1.6.2 | 1.7.0 | minor |');
    expect(md).toContain('Dynamic (1): okhttp 4.+, latest stable 4.12.0');
    expect(md).toContain('Not checked (1): retrofit 2.9.0 (offline)');
    expect(md).toContain('Pinned (1): retrofit 2.9.0 in gradle/libs.versions.toml');
    const copy = md.split('\n').filter(l => !/^\|[-| ]+\|$/.test(l)).join('\n').replace(/\d+(?:\.\d+)+(?:-[A-Za-z0-9.]+)*/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[a-z0-9.]+:[a-z0-9.-]+/g, '');
    expect(copy).not.toMatch(/[‐-―]|\s-\s/);
  });
});
