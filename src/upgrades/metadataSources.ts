/**
 * Where each dependency's versions live, and the one request that answers for
 * several of them.
 *
 * Google Maven publishes one `group-index.xml` per group with every artifact
 * and every version, so four Compose libraries cost one request. Maven
 * Central publishes one `maven-metadata.xml` per artifact. The Kotlin plugins
 * all share the version of `kotlin-gradle-plugin`, one request for the whole
 * family. KSP is asked from Central, because Google's copy of it stopped in
 * 2021 at `1.5.30-1.0.0` and would read as "up to date" forever.
 *
 * Pure: no vscode, no Node, no network. The queue sends what this plans.
 */
import type { Dependency, MetadataRequest, RepoRef, RepositorySet } from './model';
import { defaultRepoFor } from '../http/MavenCoordinatesParser';
import { fingerprint } from '../util/boundedCache';

export const GOOGLE_MAVEN = 'https://dl.google.com/dl/android/maven2';
export const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2';
export const GRADLE_PLUGIN_PORTAL = 'https://plugins.gradle.org/m2';
export const GRADLE_SERVICES = 'https://services.gradle.org/versions';

export const GOOGLE_MASTER_KEY = 'google/_master';
export const GRADLE_KEY = 'gradle/_versions';
export const GRADLE_RC_KEY = 'gradle/_rc';

const AGP_GROUP = 'com.android.tools.build';
const KOTLIN_PLUGIN_PREFIX = 'org.jetbrains.kotlin.';
const KSP_PLUGIN_ID = 'com.google.devtools.ksp';

const GOOGLE_REPO: RepoRef = { kind: 'google', url: GOOGLE_MAVEN };
const CENTRAL_REPO: RepoRef = { kind: 'mavenCentral', url: MAVEN_CENTRAL };
const PORTAL_REPO: RepoRef = { kind: 'gradlePluginPortal', url: GRADLE_PLUGIN_PORTAL };
const GRADLE_REPO: RepoRef = { kind: 'gradle', url: GRADLE_SERVICES };

const pathOf = (dotted: string) => dotted.replace(/\./g, '/');
const trimSlash = (url: string) => url.replace(/\/+$/, '');

export function mavenMetadataUrl(repoUrl: string, group: string, artifact: string): string {
  return `${trimSlash(repoUrl)}/${pathOf(group)}/${artifact}/maven-metadata.xml`;
}
export function googleGroupIndexUrl(group: string): string {
  return `${GOOGLE_MAVEN}/${pathOf(group)}/group-index.xml`;
}
export function googleMasterIndexUrl(): string {
  return `${GOOGLE_MAVEN}/master-index.xml`;
}
/** The marker artifact of a plugin id: `<id path>/<id>.gradle.plugin/maven-metadata.xml`. */
export function pluginMarkerUrl(repoUrl: string, pluginId: string): string {
  return mavenMetadataUrl(repoUrl, pluginId, `${pluginId}.gradle.plugin`);
}
export function gradleCurrentUrl(): string {
  return `${GRADLE_SERVICES}/current`;
}
export function gradleReleaseCandidateUrl(): string {
  return `${GRADLE_SERVICES}/release-candidate`;
}

export function centralKey(group: string, artifact: string): string {
  return `central/${pathOf(group)}/${artifact}`;
}
export function portalKey(pluginId: string): string {
  return `portal/${pathOf(pluginId)}/${pluginId}.gradle.plugin`;
}
export function googleGroupKey(group: string): string {
  return `google/${pathOf(group)}/_group`;
}
/** A custom repository is named by a fingerprint of its URL, trailing slash ignored. */
export function customKey(repoUrl: string, group: string, artifact: string): string {
  return `custom-${fingerprint(trimSlash(repoUrl)).toString(16)}/${pathOf(group)}/${artifact}`;
}

/** Gradle itself is stable when its version carries no letter: `9.8.2`, against `9.9.0-rc-1` or `9.0-milestone-1`. */
function isPreviewGradle(version: string | undefined): boolean {
  return version !== undefined && /[A-Za-z]/.test(version);
}

const has = (repos: readonly RepoRef[], kind: RepoRef['kind']) => repos.some(r => r.kind === kind);

/** The first custom repository the engine may ask: https, and without credentials. */
function firstCustom(repos: readonly RepoRef[]): RepoRef | undefined {
  return repos.find(r => r.kind === 'custom' && !r.private && r.url.startsWith('https://'));
}

function pluginRequests(pluginId: string, repos: RepositorySet): MetadataRequest[] {
  if (pluginId.startsWith(KOTLIN_PLUGIN_PREFIX)) {
    return [{ key: centralKey('org.jetbrains.kotlin', 'kotlin-gradle-plugin'), url: mavenMetadataUrl(MAVEN_CENTRAL, 'org.jetbrains.kotlin', 'kotlin-gradle-plugin'), repo: CENTRAL_REPO, format: 'maven-metadata' }];
  }
  if (pluginId === KSP_PLUGIN_ID) {
    return [{ key: centralKey(KSP_PLUGIN_ID, 'symbol-processing-gradle-plugin'), url: mavenMetadataUrl(MAVEN_CENTRAL, KSP_PLUGIN_ID, 'symbol-processing-gradle-plugin'), repo: CENTRAL_REPO, format: 'maven-metadata' }];
  }
  if (has(repos.plugins, 'gradlePluginPortal')) {
    return [{ key: portalKey(pluginId), url: pluginMarkerUrl(GRADLE_PLUGIN_PORTAL, pluginId), repo: PORTAL_REPO, format: 'maven-metadata' }];
  }
  if (has(repos.plugins, 'mavenCentral')) {
    return [{ key: centralKey(pluginId, `${pluginId}.gradle.plugin`), url: pluginMarkerUrl(MAVEN_CENTRAL, pluginId), repo: CENTRAL_REPO, format: 'maven-metadata' }];
  }
  if (has(repos.plugins, 'google')) {
    return [{ key: googleGroupKey(pluginId), url: googleGroupIndexUrl(pluginId), repo: GOOGLE_REPO, format: 'google-group-index' }];
  }
  return [];
}

function libraryRequest(group: string, artifact: string, repos: RepositorySet, googleGroups: ReadonlySet<string> | undefined): MetadataRequest | undefined {
  const onGoogle = googleGroups ? googleGroups.has(group) : defaultRepoFor({ group, artifact, version: '' }) === GOOGLE_MAVEN;
  if (onGoogle) return { key: googleGroupKey(group), url: googleGroupIndexUrl(group), repo: GOOGLE_REPO, format: 'google-group-index' };
  if (has(repos.project, 'mavenCentral')) {
    return { key: centralKey(group, artifact), url: mavenMetadataUrl(MAVEN_CENTRAL, group, artifact), repo: CENTRAL_REPO, format: 'maven-metadata' };
  }
  const custom = firstCustom(repos.project);
  if (custom) return { key: customKey(custom.url, group, artifact), url: mavenMetadataUrl(custom.url, group, artifact), repo: custom, format: 'maven-metadata' };
  return undefined;
}

/** The requests one dependency needs, one per member for a shared version site. */
export function requestsFor(dep: Dependency, repos: RepositorySet, googleGroups: ReadonlySet<string> | undefined): MetadataRequest[] {
  if (dep.currentVersion === undefined) return [];
  switch (dep.kind) {
    case 'wrapper': {
      const out: MetadataRequest[] = [{ key: GRADLE_KEY, url: gradleCurrentUrl(), repo: GRADLE_REPO, format: 'gradle-current' }];
      if (isPreviewGradle(dep.currentVersion)) out.push({ key: GRADLE_RC_KEY, url: gradleReleaseCandidateUrl(), repo: GRADLE_REPO, format: 'gradle-current' });
      return out;
    }
    case 'agp':
      return [{ key: googleGroupKey(AGP_GROUP), url: googleGroupIndexUrl(AGP_GROUP), repo: GOOGLE_REPO, format: 'google-group-index' }];
    case 'plugin':
      return pluginRequests(dep.group, repos);
    case 'library': {
      const out: MetadataRequest[] = [];
      for (const m of dep.members) {
        const r = libraryRequest(m.group, m.artifact, repos, googleGroups);
        if (r) out.push(r);
      }
      return out;
    }
  }
}

/**
 * Every request a set of dependencies needs, deduplicated by key, in
 * dependency order. Before the Google master index is known the routing is
 * the group prefix guess, and the master index is planned first so the next
 * pass routes for real.
 */
export function planRequests(deps: readonly Dependency[], repos: RepositorySet, googleGroups: ReadonlySet<string> | undefined): MetadataRequest[] {
  const seen = new Set<string>();
  const out: MetadataRequest[] = [];
  const add = (r: MetadataRequest) => { if (!seen.has(r.key)) { seen.add(r.key); out.push(r); } };
  if (googleGroups === undefined && deps.some(d => d.kind === 'library' && d.currentVersion !== undefined)) {
    add({ key: GOOGLE_MASTER_KEY, url: googleMasterIndexUrl(), repo: GOOGLE_REPO, format: 'google-master-index' });
  }
  for (const dep of deps) for (const r of requestsFor(dep, repos, googleGroups)) add(r);
  return out;
}
