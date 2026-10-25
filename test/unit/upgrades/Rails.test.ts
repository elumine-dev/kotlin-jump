import { describe, it, expect } from 'vitest';
import type { Dependency } from '../../../src/upgrades/model';
import {
  agpGradleRail, agpMinimumGradle, kotlinFamilyRail, kspFor, kspKotlinPrefix, kspRail, readRailContext,
} from '../../../src/upgrades/rails';
import matrix from '../../../src/data/agp-gradle-matrix.json';

/**
 * KJ-082, the compatibility rails: what Android Studio's lint does not say.
 *
 * A newer version is not always a safe one. A KSP release carries the Kotlin
 * version it was built for in its own number (`2.2.21-2.0.5` is KSP 2.0.5
 * for Kotlin 2.2.21), so a KSP bump that silently requires a Kotlin bump
 * breaks the build; KSP 2.3 and later are versioned on their own. The Android
 * Gradle plugin requires a minimum Gradle, read from its release notes into a
 * bundled table; a rail stays silent on a line the table does not know. The
 * Kotlin companion plugins (serialization, compose, parcelize, kapt) ship with
 * Kotlin and must carry its version.
 */

const dep = (x: Partial<Dependency> & { group: string; artifact: string; currentVersion?: string }): Dependency => ({
  kind: 'library', key: `library:${x.group}:${x.artifact}`, members: [{ group: x.group, artifact: x.artifact }],
  literal: 'exact', range: { file: '/w/gradle/libs.versions.toml', start: 10, end: 17 }, line: 1, source: 'toml-versions',
  name: x.artifact, sharedBy: [],
  ...(x.currentVersion ? { versionSite: { file: '/w/gradle/libs.versions.toml', start: 11, end: 11 + x.currentVersion.length, text: x.currentVersion } } : {}),
  ...x,
});
const plugin = (id: string, version: string, extra: Partial<Dependency> = {}) =>
  dep({ kind: 'plugin', key: `plugin:${id}`, group: id, artifact: `${id}.gradle.plugin`, currentVersion: version, name: id, ...extra });

const KSP_VERSIONS = ['1.9.22-1.0.16', '1.9.22-1.0.17', '1.9.22-1.0.18', '2.0.21-1.0.28', '2.2.21-2.0.5', '2.3.0', '2.3.12'];

describe('KJ-082 rails: KSP follows Kotlin', () => {
  it('reads the Kotlin version a two part KSP release targets, and nothing from a standalone one', () => {
    expect(kspKotlinPrefix('2.2.21-2.0.5')).toBe('2.2.21');
    expect(kspKotlinPrefix('1.9.22-1.0.18')).toBe('1.9.22');
    expect(kspKotlinPrefix('2.3.12')).toBeUndefined();
    expect(kspKotlinPrefix('2.0.0-Beta4-1.0.17')).toBe('2.0.0-Beta4');
  });

  it('picks the newest KSP built for the project Kotlin', () => {
    expect(kspFor('1.9.22', KSP_VERSIONS)).toBe('1.9.22-1.0.18');
    expect(kspFor('2.1.0', KSP_VERSIONS)).toBeUndefined();
  });

  it('a KSP that targets another Kotlin than the build is a rail finding, with the matching KSP as the fix', () => {
    const ksp = plugin('com.google.devtools.ksp', '1.9.22-1.0.17');
    const rail = kspRail(ksp, KSP_VERSIONS, { kotlinVersion: '1.9.22' });
    expect(rail).toBeUndefined();
    const stale = plugin('com.google.devtools.ksp', '1.9.20-1.0.14');
    const r = kspRail(stale, KSP_VERSIONS, { kotlinVersion: '1.9.22' })!;
    expect(r.rail).toBe('ksp-kotlin');
    expect(r.expected).toBe('1.9.22');
    expect(r.actual).toBe('1.9.20');
    expect(r.compatiblePick).toBe('1.9.22-1.0.18');
    expect(r.message).toBe('ksp 1.9.20-1.0.14: built for Kotlin 1.9.20, this build uses Kotlin 1.9.22. Latest for Kotlin 1.9.22 is 1.9.22-1.0.18');
    expect(r.edits).toEqual([{ file: '/w/gradle/libs.versions.toml', start: 11, end: 11 + '1.9.20-1.0.14'.length, newText: '1.9.22-1.0.18' }]);
  });

  it('says so when no KSP exists for the build Kotlin, and stays quiet without a Kotlin version or on standalone KSP', () => {
    const stale = plugin('com.google.devtools.ksp', '1.9.20-1.0.14');
    const r = kspRail(stale, KSP_VERSIONS, { kotlinVersion: '2.1.0' })!;
    expect(r.compatiblePick).toBeUndefined();
    expect(r.edits).toBeUndefined();
    expect(r.message).toContain('No KSP release for Kotlin 2.1.0 is published');
    expect(kspRail(stale, KSP_VERSIONS, {})).toBeUndefined();
    expect(kspRail(plugin('com.google.devtools.ksp', '2.3.12'), KSP_VERSIONS, { kotlinVersion: '2.2.21' })).toBeUndefined();
    expect(kspRail(plugin('org.jetbrains.kotlin.jvm', '1.9.22'), KSP_VERSIONS, { kotlinVersion: '1.9.22' })).toBeUndefined();
  });
});

describe('KJ-082 rails: the Android Gradle plugin needs its Gradle', () => {
  it('the bundled table maps an AGP line to its Gradle minimum, qualifiers ignored, unknown lines to nothing', () => {
    expect(agpMinimumGradle('9.4.0', matrix)).toBe('9.6.0');
    expect(agpMinimumGradle('9.4.0-rc01', matrix)).toBe('9.6.0');
    expect(agpMinimumGradle('8.13.0', matrix)).toBe('8.13');
    expect(agpMinimumGradle('42.0.0', matrix)).toBeUndefined();
    expect(agpMinimumGradle('9.4.0', undefined)).toBeUndefined();
  });

  it('a wrapper older than the minimum is a rail finding on the AGP site', () => {
    const agp = dep({ kind: 'agp', key: 'agp', group: 'com.android.application', artifact: 'com.android.application.gradle.plugin', currentVersion: '9.4.0', name: 'agp' });
    expect(agpGradleRail(agp, { wrapperVersion: '9.6.0', matrix })).toBeUndefined();
    const r = agpGradleRail(agp, { wrapperVersion: '9.2.1', matrix })!;
    expect(r.rail).toBe('agp-gradle');
    expect(r.expected).toBe('9.6.0');
    expect(r.actual).toBe('9.2.1');
    expect(r.message).toBe('agp 9.4.0 needs Gradle 9.6.0, the wrapper is 9.2.1');
    expect(agpGradleRail(agp, { matrix })).toBeUndefined();
    expect(agpGradleRail(agp, { wrapperVersion: '9.2.1' })).toBeUndefined();
  });
});

describe('KJ-082 rails: the Kotlin companion plugins carry the Kotlin version', () => {
  it('a companion plugin with its own version different from Kotlin is a rail finding with Kotlin as the fix', () => {
    const r = kotlinFamilyRail(plugin('org.jetbrains.kotlin.plugin.serialization', '1.9.20'), { kotlinVersion: '1.9.22' })!;
    expect(r.rail).toBe('kotlin-family');
    expect(r.compatiblePick).toBe('1.9.22');
    expect(r.message).toBe('org.jetbrains.kotlin.plugin.serialization 1.9.20 does not match Kotlin 1.9.22');
    expect(r.edits?.[0].newText).toBe('1.9.22');
    expect(kotlinFamilyRail(plugin('org.jetbrains.kotlin.plugin.serialization', '1.9.22'), { kotlinVersion: '1.9.22' })).toBeUndefined();
    expect(kotlinFamilyRail(plugin('com.google.dagger.hilt.android', '2.50'), { kotlinVersion: '1.9.22' })).toBeUndefined();
    expect(kotlinFamilyRail(plugin('org.jetbrains.kotlin.jvm', '1.9.20'), { kotlinVersion: '1.9.22' })).toBeUndefined();
  });
});

describe('KJ-082 rails: reading the build context', () => {
  it('finds the Kotlin, AGP and wrapper versions among the dependencies, and gives up on disagreeing Kotlin sources', () => {
    const kotlin = plugin('org.jetbrains.kotlin.jvm', '1.9.22');
    const agp = dep({ kind: 'agp', key: 'agp', group: 'com.android.application', artifact: 'com.android.application.gradle.plugin', currentVersion: '8.2.0', name: 'agp' });
    const wrapper = dep({ kind: 'wrapper', key: 'wrapper', group: 'org.gradle', artifact: 'gradle', currentVersion: '9.2.1', name: 'Gradle', source: 'wrapper' });
    expect(readRailContext([kotlin, agp, wrapper], matrix)).toEqual({ kotlinVersion: '1.9.22', agpVersion: '8.2.0', wrapperVersion: '9.2.1', matrix });
    const other = plugin('org.jetbrains.kotlin.android', '2.0.0');
    expect(readRailContext([kotlin, other], matrix).kotlinVersion).toBeUndefined();
    expect(readRailContext([kotlin, plugin('org.jetbrains.kotlin.android', '1.9.22')], matrix).kotlinVersion).toBe('1.9.22');
  });
});
