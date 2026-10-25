import { describe, it, expect } from 'vitest';
import {
  GOOGLE_MAVEN, MAVEN_CENTRAL, GRADLE_PLUGIN_PORTAL, GRADLE_SERVICES,
  mavenMetadataUrl, googleGroupIndexUrl, googleMasterIndexUrl, pluginMarkerUrl, gradleCurrentUrl, gradleReleaseCandidateUrl,
  centralKey, portalKey, googleGroupKey, customKey, GOOGLE_MASTER_KEY, GRADLE_KEY, GRADLE_RC_KEY,
  planRequests,
} from '../../../src/upgrades/metadataSources';
import type { Dependency, RepositorySet } from '../../../src/upgrades/model';

/**
 * KJ-082, which document to ask for each dependency.
 *
 * One request serves many dependencies: the four Compose libraries of one
 * Google group share one group index, the four Kotlin plugins share one Maven
 * Central document for `kotlin-gradle-plugin`, and KSP is asked from Central
 * because Google's copy of it stopped in 2021. Before the Google master index
 * is known, the route is the old group prefix guess, and the master index is
 * planned first so the next pass routes for real.
 */

let n = 0;
function dep(x: Partial<Dependency> & { group: string; artifact: string }): Dependency {
  const kind = x.kind ?? 'library';
  return {
    kind, key: x.key ?? `${kind}:${x.group}:${x.artifact}`, members: [{ group: x.group, artifact: x.artifact }],
    group: x.group, artifact: x.artifact, currentVersion: x.currentVersion ?? '1.0.0', literal: 'exact',
    range: { file: '/w/gradle/libs.versions.toml', start: n++, end: n }, line: 0, source: 'toml-versions',
    name: x.name ?? x.artifact, sharedBy: [], ...x,
  };
}
const plugin = (id: string, v = '1.0.0') => dep({ kind: 'plugin', key: `plugin:${id}`, group: id, artifact: `${id}.gradle.plugin`, currentVersion: v, name: id });

const REPOS: RepositorySet = {
  plugins: [{ kind: 'gradlePluginPortal', url: GRADLE_PLUGIN_PORTAL }, { kind: 'mavenCentral', url: MAVEN_CENTRAL }, { kind: 'google', url: GOOGLE_MAVEN }],
  project: [{ kind: 'mavenCentral', url: MAVEN_CENTRAL }, { kind: 'google', url: GOOGLE_MAVEN }],
};
const GOOGLE_GROUPS = new Set(['androidx.compose.ui', 'androidx.compose.foundation', 'com.android.tools.build', 'com.google.devtools.ksp']);

describe('URL builders and cache keys', () => {
  it('build the documented URLs', () => {
    expect(mavenMetadataUrl(MAVEN_CENTRAL, 'com.squareup.okhttp3', 'okhttp')).toBe('https://repo1.maven.org/maven2/com/squareup/okhttp3/okhttp/maven-metadata.xml');
    expect(googleGroupIndexUrl('androidx.compose.ui')).toBe('https://dl.google.com/dl/android/maven2/androidx/compose/ui/group-index.xml');
    expect(googleMasterIndexUrl()).toBe('https://dl.google.com/dl/android/maven2/master-index.xml');
    expect(pluginMarkerUrl(GRADLE_PLUGIN_PORTAL, 'org.jetbrains.kotlin.android')).toBe('https://plugins.gradle.org/m2/org/jetbrains/kotlin/android/org.jetbrains.kotlin.android.gradle.plugin/maven-metadata.xml');
    expect(gradleCurrentUrl()).toBe('https://services.gradle.org/versions/current');
    expect(gradleReleaseCandidateUrl()).toBe('https://services.gradle.org/versions/release-candidate');
    expect(GRADLE_SERVICES).toBe('https://services.gradle.org/versions');
  });

  it('name cache entries by repository and path, a custom repository by a fingerprint of its URL', () => {
    expect(centralKey('com.squareup.okhttp3', 'okhttp')).toBe('central/com/squareup/okhttp3/okhttp');
    expect(portalKey('org.jetbrains.kotlin.android')).toBe('portal/org/jetbrains/kotlin/android/org.jetbrains.kotlin.android.gradle.plugin');
    expect(googleGroupKey('androidx.compose.ui')).toBe('google/androidx/compose/ui/_group');
    expect(GOOGLE_MASTER_KEY).toBe('google/_master');
    expect(GRADLE_KEY).toBe('gradle/_versions');
    expect(GRADLE_RC_KEY).toBe('gradle/_rc');
    const k = customKey('https://jitpack.io', 'com.github.example', 'lib');
    expect(k).toMatch(/^custom-[0-9a-f]+\/com\/github\/example\/lib$/);
    expect(customKey('https://jitpack.io/', 'com.github.example', 'lib')).toBe(k);
    expect(customKey('https://maven.example.org/releases', 'com.github.example', 'lib')).not.toBe(k);
  });
});

describe('planRequests', () => {
  it('asks one Google group index for four Compose libraries of the same group', () => {
    const deps = ['ui', 'ui-tooling', 'ui-tooling-preview', 'ui-text'].map(a => dep({ group: 'androidx.compose.ui', artifact: a }));
    const reqs = planRequests(deps, REPOS, GOOGLE_GROUPS);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ key: 'google/androidx/compose/ui/_group', url: googleGroupIndexUrl('androidx.compose.ui'), format: 'google-group-index', repo: { kind: 'google' } });
  });

  it('asks one Maven Central document for the whole Kotlin plugin family, and Central for KSP', () => {
    const deps = ['org.jetbrains.kotlin.jvm', 'org.jetbrains.kotlin.android', 'org.jetbrains.kotlin.plugin.serialization', 'org.jetbrains.kotlin.plugin.compose', 'com.google.devtools.ksp'].map(id => plugin(id));
    const reqs = planRequests(deps, REPOS, GOOGLE_GROUPS);
    expect(reqs.map(r => r.key)).toEqual([
      'central/org/jetbrains/kotlin/kotlin-gradle-plugin',
      'central/com/google/devtools/ksp/symbol-processing-gradle-plugin',
    ]);
    expect(reqs[0].url).toBe(mavenMetadataUrl(MAVEN_CENTRAL, 'org.jetbrains.kotlin', 'kotlin-gradle-plugin'));
    expect(reqs[1].format).toBe('maven-metadata');
  });

  it('asks Google for the Android Gradle plugin and the portal marker for any other plugin', () => {
    const agp = dep({ kind: 'agp', key: 'agp', group: 'com.android.tools.build', artifact: 'gradle', currentVersion: '8.2.0', name: 'agp' });
    const hilt = plugin('com.google.dagger.hilt.android');
    const reqs = planRequests([agp, hilt], REPOS, GOOGLE_GROUPS);
    expect(reqs.map(r => r.key)).toEqual([
      'google/com/android/tools/build/_group',
      'portal/com/google/dagger/hilt/android/com.google.dagger.hilt.android.gradle.plugin',
    ]);
    expect(reqs[1]).toMatchObject({ url: pluginMarkerUrl(GRADLE_PLUGIN_PORTAL, 'com.google.dagger.hilt.android'), format: 'maven-metadata', repo: { kind: 'gradlePluginPortal' } });
  });

  it('falls back to a Central marker, then to a Google marker group, when the plugin portal is not declared', () => {
    const hilt = plugin('com.google.dagger.hilt.android');
    const central = planRequests([hilt], { plugins: [{ kind: 'mavenCentral', url: MAVEN_CENTRAL }], project: [] }, GOOGLE_GROUPS);
    expect(central[0].key).toBe('central/com/google/dagger/hilt/android/com.google.dagger.hilt.android.gradle.plugin');
    expect(central[0].url).toBe(pluginMarkerUrl(MAVEN_CENTRAL, 'com.google.dagger.hilt.android'));
    const google = planRequests([hilt], { plugins: [{ kind: 'google', url: GOOGLE_MAVEN }], project: [] }, GOOGLE_GROUPS);
    expect(google[0]).toMatchObject({ key: 'google/com/google/dagger/hilt/android/_group', format: 'google-group-index' });
  });

  it('asks the wrapper from services.gradle.org, and the release candidate only when the wrapper is on a preview', () => {
    const stable = dep({ kind: 'wrapper', key: 'wrapper', group: 'org.gradle', artifact: 'gradle', currentVersion: '9.2.1', name: 'Gradle' });
    expect(planRequests([stable], REPOS, GOOGLE_GROUPS).map(r => r.key)).toEqual(['gradle/_versions']);
    const rc = dep({ kind: 'wrapper', key: 'wrapper', group: 'org.gradle', artifact: 'gradle', currentVersion: '9.9.0-rc-1', name: 'Gradle' });
    const reqs = planRequests([rc], REPOS, GOOGLE_GROUPS);
    expect(reqs.map(r => r.key)).toEqual(['gradle/_versions', 'gradle/_rc']);
    expect(reqs[0]).toMatchObject({ url: gradleCurrentUrl(), format: 'gradle-current', repo: { kind: 'gradle' } });
    expect(reqs[1].url).toBe(gradleReleaseCandidateUrl());
  });

  it('routes a library to Central, or to the first custom https repository when Central is not declared', () => {
    const okhttp = dep({ group: 'com.squareup.okhttp3', artifact: 'okhttp' });
    expect(planRequests([okhttp], REPOS, GOOGLE_GROUPS)[0]).toMatchObject({ key: 'central/com/squareup/okhttp3/okhttp', format: 'maven-metadata', repo: { kind: 'mavenCentral' } });
    const custom: RepositorySet = { plugins: [], project: [
      { kind: 'google', url: GOOGLE_MAVEN },
      { kind: 'custom', url: 'https://nexus.example.org/repository/releases', private: true },
      { kind: 'custom', url: 'http://insecure.example.org/maven' },
      { kind: 'custom', url: 'https://jitpack.io' },
    ] };
    const reqs = planRequests([okhttp], custom, GOOGLE_GROUPS);
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ key: customKey('https://jitpack.io', 'com.squareup.okhttp3', 'okhttp'), url: mavenMetadataUrl('https://jitpack.io', 'com.squareup.okhttp3', 'okhttp'), repo: { kind: 'custom', url: 'https://jitpack.io' } });
    expect(planRequests([okhttp], { plugins: [], project: [{ kind: 'google', url: GOOGLE_MAVEN }] }, GOOGLE_GROUPS)).toEqual([]);
  });

  it('before the master index is known, plans it first and routes by the group prefix guess', () => {
    const deps = [dep({ group: 'com.squareup.okhttp3', artifact: 'okhttp' }), dep({ group: 'androidx.room', artifact: 'room-runtime' })];
    const reqs = planRequests(deps, REPOS, undefined);
    expect(reqs.map(r => r.key)).toEqual(['google/_master', 'central/com/squareup/okhttp3/okhttp', 'google/androidx/room/_group']);
    expect(reqs[0]).toMatchObject({ url: googleMasterIndexUrl(), format: 'google-master-index' });
  });

  it('deduplicates by key and keeps dependency order', () => {
    const deps = [
      dep({ group: 'androidx.compose.ui', artifact: 'ui' }),
      dep({ group: 'com.squareup.okhttp3', artifact: 'okhttp' }),
      dep({ group: 'androidx.compose.ui', artifact: 'ui-text' }),
      dep({ group: 'com.squareup.okhttp3', artifact: 'logging-interceptor' }),
    ];
    expect(planRequests(deps, REPOS, GOOGLE_GROUPS).map(r => r.key)).toEqual([
      'google/androidx/compose/ui/_group',
      'central/com/squareup/okhttp3/okhttp',
      'central/com/squareup/okhttp3/logging-interceptor',
    ]);
  });

  it('plans nothing for a dependency without a comparable version, and nothing twice for a shared version site', () => {
    const bom = dep({ group: 'androidx.compose.ui', artifact: 'ui', currentVersion: undefined, literal: 'none' });
    const shared = dep({ group: 'com.squareup.retrofit2', artifact: 'retrofit', members: [{ group: 'com.squareup.retrofit2', artifact: 'retrofit' }, { group: 'com.squareup.retrofit2', artifact: 'converter-gson' }] });
    const reqs = planRequests([bom, shared], REPOS, GOOGLE_GROUPS);
    expect(reqs.map(r => r.key)).toEqual(['central/com/squareup/retrofit2/retrofit', 'central/com/squareup/retrofit2/converter-gson']);
  });
});
