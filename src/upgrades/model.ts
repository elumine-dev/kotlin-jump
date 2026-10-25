/**
 * Dependency upgrades (KJ-082): the shared vocabulary.
 *
 * Pure types. Nothing here imports vscode or a Node module, so every engine
 * module and every test can read them, and so can the browser bundle.
 *
 * The unit of checking is a VERSION SITE, not a library: one `[versions]`
 * entry shared by four libraries is one dependency with four members, and a
 * candidate must exist for every member before it is offered.
 */

export type Policy = 'preferStable' | 'stable' | 'latest';

export type DependencyKind = 'library' | 'plugin' | 'wrapper' | 'agp';

/** What the version text is: only `exact` can be compared and bumped. */
export type LiteralKind = 'exact' | 'dynamic' | 'range' | 'rich' | 'templated' | 'none';

export type DependencySource =
  | 'toml-versions' | 'toml-inline' | 'toml-shorthand'
  | 'build-literal' | 'build-plugin' | 'settings-plugin'
  | 'wrapper';

export type PinKind = 'pin-comment' | 'ignore-marker';

export interface Coordinate { group: string; artifact: string }

/** Offsets of the bare version text in `file`, quotes excluded. */
export interface VersionSite { file: string; start: number; end: number; text: string }

/** An alias that reads a shared `[versions]` entry. */
export interface SharedBy { alias: string; line: number; character: number }

export interface Dependency {
  kind: DependencyKind;
  /** `library:group:artifact`, `plugin:id`, `wrapper`, `agp`. Unique within a file. */
  key: string;
  /** At least one. Several when one `[versions]` entry is shared. */
  members: Coordinate[];
  group: string;
  artifact: string;
  /** Undefined when a BOM manages the version, or when nothing readable was written. */
  currentVersion?: string;
  literal: LiteralKind;
  /** When `literal` is `exact` or `dynamic`: what a bump or a pin replaces. */
  versionSite?: VersionSite;
  /** What a diagnostic underlines: the version literal when there is one, else the entry. */
  range: { file: string; start: number; end: number };
  /** 0 based line of `range.start`, for providers that index by line. */
  line: number;
  source: DependencySource;
  versionRef?: string;
  /** Display name: the `[versions]` key, the alias, the plugin id or `Gradle`. */
  name: string;
  sharedBy: SharedBy[];
  pin?: PinKind;
}

export type RepoKind = 'mavenCentral' | 'google' | 'gradlePluginPortal' | 'gradle' | 'custom';

export interface RepoRef {
  kind: RepoKind;
  /** Base URL without a trailing slash. */
  url: string;
  /** Declared with `credentials { }`: never contacted. */
  private?: boolean;
}

/** Repositories a build declares, in declaration order. */
export interface RepositorySet { plugins: RepoRef[]; project: RepoRef[] }

export interface Candidate {
  latest: string;
  latestStable?: string;
  /** What the policy picks; undefined when nothing newer qualifies. */
  pick?: string;
  /** Deduplicated, ascending in Gradle order. */
  versions: readonly string[];
  /** Versions newer than the current one, whatever their stability. */
  newerCount: number;
  /** The current version appears in the repository's list. */
  currentKnown: boolean;
  fetchedAt: number;
  stale: boolean;
  /** `yyyy-mm-dd` when the repository says when its latest version was published. */
  releasedAt?: string;
  repository?: RepoKind;
}

export type UnknownReason =
  | 'pending' | 'noConsent' | 'noFetcher' | 'offline' | 'rateLimited'
  | 'notFound' | 'noRepository' | 'templated' | 'membersDisagree' | 'error';

export type Verdict =
  | { kind: 'upToDate'; candidate: Candidate }
  | { kind: 'newer'; to: string; stability: 'stable' | 'preRelease'; candidate: Candidate; alsoStable?: string }
  | { kind: 'unknown'; reason: UnknownReason; detail?: string }
  | { kind: 'pinned'; by: PinKind }
  /** A dynamic version carries the stable it could be pinned to, when known. */
  | { kind: 'rich'; form: 'dynamic' | 'range' | 'rich'; pin?: string }
  | { kind: 'bomManaged'; bom?: string };

export interface Finding { dependency: Dependency; verdict: Verdict }

export type Rail = 'ksp-kotlin' | 'agp-gradle' | 'kotlin-family';

/** A relation between two sites: a dependency can be up to date and incompatible at once. */
export interface RailFinding {
  rail: Rail;
  dependency: Dependency;
  expected: string;
  actual: string;
  message: string;
  /** The compatible pick for the dependency itself, when one exists. */
  compatiblePick?: string;
  edits?: EditSpan[];
}

export interface EditSpan { file: string; start: number; end: number; newText: string }

export interface UpgradeReport {
  findings: Finding[];
  rails: RailFinding[];
  /** Keys whose metadata has not landed yet. */
  pendingKeys: string[];
  /** The catalog could not be read in full: nothing is reported for it. */
  catalogUnparsed: boolean;
}

export type MetadataFormat = 'maven-metadata' | 'google-group-index' | 'google-master-index' | 'gradle-current';

/** One HTTP request the engine plans; several dependencies may share it. */
export interface MetadataRequest {
  /** Cache key, also the dedupe key: `central/com/squareup/okhttp3/okhttp`. */
  key: string;
  url: string;
  repo: RepoRef;
  format: MetadataFormat;
}

/** What the cache stores for one request, raw: sorting happens in the engine. */
export interface CacheEntry {
  v: 1;
  url: string;
  fetchedAt: number;
  etag?: string;
  lastModified?: string;
  status: 'ok' | 'notFound';
  /** maven-metadata and custom repositories: versions in document order. */
  versions?: string[];
  /** google group-index: artifact name to versions in document order. */
  artifacts?: Record<string, string[]>;
  /** google master index: group ids. */
  groups?: string[];
  /** maven-metadata `lastUpdated`, `yyyyMMddHHmmss`. */
  lastUpdated?: string;
  /** services.gradle.org: the current release and the active release candidate. */
  gradle?: { current: string; rc?: string };
}
