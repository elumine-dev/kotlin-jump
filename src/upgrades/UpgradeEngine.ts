import type {
  CacheEntry, Candidate, Dependency, EditSpan, Finding, MetadataRequest, Policy, RailFinding, RepoKind, RepoRef, RepositorySet,
  UnknownReason, UpgradeReport, Verdict,
} from './model';
import { MetadataCache, type CacheStore } from './cache';
import { FetchQueue, type FetchQueueOptions, type MetadataFetcher } from './fetchQueue';
import {
  GOOGLE_MASTER_KEY, GOOGLE_MAVEN, GRADLE_KEY, GRADLE_RC_KEY, MAVEN_CENTRAL, centralKey, googleGroupIndexUrl, googleGroupKey, googleMasterIndexUrl,
  mavenMetadataUrl, pluginMarkerUrl, requestsFor,
} from './metadataSources';
import { lastUpdatedToDate, parseGoogleGroupIndex, parseGoogleMasterIndex, parseGradleCurrent, parseMavenMetadata } from './metadataParsers';
import { intersectVersions, selectCandidate, verdictOf } from './selection';
import { sortVersions } from './gradleVersion';
import { readRepositories, type GradleFileText } from './repositories';
import { collectCatalogDependencies } from './catalogDependencies';
import { collectBuildFileDependencies } from './buildFileDependencies';
import { bumpWrapperUrl, collectWrapperDependency, distributionType, hasChecksum } from './wrapperDependency';
import { agpGradleRail, agpMinimumGradle, isKsp, kotlinFamilyRail, kspRail, readRailContext, type AgpGradleMatrix } from './rails';
import { bumpEdit } from './edits';
import { hostAllowed, networkAllowed, type ConsentInput } from './consent';
import { compareVersions } from './gradleVersion';

/**
 * The engine behind dependency upgrades: files in, verdicts out.
 *
 * `evaluate` is synchronous and reads memory only, so an opened catalog
 * paints what the cache knows at once; `refresh` fetches what is missing or
 * stale, under the consent gate and the queue's limits, and fires
 * `onDidChange` once the answers land. Nothing here imports vscode or Node:
 * the store and the fetcher are handed in, which is also how the tests and the
 * demo seed answers without a network.
 */

export type GradleFileKind = 'toml' | 'build' | 'settings' | 'wrapper';

export interface GradleFile { path: string; text: string; kind: GradleFileKind }

export interface ProjectContext {
  repositories: RepositorySet;
  trusted: boolean;
}

export interface UpgradeEngineDeps {
  store: CacheStore;
  /** Undefined in the web build and under `--offline`: nothing is ever fetched. */
  fetcher?: MetadataFetcher;
  now?: () => number;
  policy: () => Policy;
  consent: () => ConsentInput;
  /** `group:artifact`, `group:*`, an alias or a `[versions]` key. */
  ignore?: () => readonly string[];
  matrix?: AgpGradleMatrix;
  log?: (line: string) => void;
  queue?: FetchQueueOptions;
}

export interface RefreshResult {
  requested: number;
  fetched: number;
  fromCache: number;
  notModified: number;
  skipped?: 'noConsent' | 'noFetcher';
  quietHosts: string[];
}

export interface Collected { dependencies: Dependency[]; unparsed: boolean }

export function fileKindOf(path: string): GradleFileKind | undefined {
  const base = path.split(/[\\/]/).pop() ?? '';
  if (/\.versions\.toml$/.test(base)) return 'toml';
  if (base === 'gradle-wrapper.properties') return 'wrapper';
  if (/^settings\.gradle(\.kts)?$/.test(base)) return 'settings';
  if (/\.gradle(\.kts)?$/.test(base)) return 'build';
  return undefined;
}

export function readProjectContext(files: readonly GradleFile[], trusted: boolean): ProjectContext {
  const texts: GradleFileText[] = files
    .filter(f => f.kind === 'settings' || f.kind === 'build')
    .map(f => ({ path: f.path, text: f.text, kind: f.kind as 'settings' | 'build' }));
  return { repositories: readRepositories(texts), trusted };
}

export function collectDependencies(file: GradleFile): Collected {
  switch (file.kind) {
    case 'toml': {
      const r = collectCatalogDependencies(file.text, file.path);
      return { dependencies: r.dependencies, unparsed: r.unparsed };
    }
    case 'wrapper': {
      const d = collectWrapperDependency(file.text, file.path);
      return { dependencies: d ? [d] : [], unparsed: false };
    }
    default:
      return { dependencies: collectBuildFileDependencies(file.text, file.path, file.kind), unparsed: false };
  }
}

interface MemberAnswer {
  versions?: string[];
  reason?: UnknownReason;
  fetchedAt: number;
  stale: boolean;
  releasedAt?: string;
  repository?: RepoKind;
  /** The repository's own newest version, to date the pick when they coincide. */
  latest?: string;
}

const isPluginMarker = (m: Dependency['members'][number]) => m.artifact === `${m.group}.gradle.plugin`;

function matchesIgnore(dep: Dependency, patterns: readonly string[]): boolean {
  if (patterns.length === 0) return false;
  const names = new Set<string>([dep.name, ...dep.sharedBy.map(s => s.alias)]);
  return patterns.some(p => {
    if (names.has(p)) return true;
    if (p.endsWith(':*')) { const g = p.slice(0, -2); return dep.members.some(m => m.group === g); }
    return dep.members.some(m => `${m.group}:${m.artifact}` === p || m.group === p);
  });
}

export class UpgradeEngine {
  private readonly cache: MetadataCache;
  private readonly queue: FetchQueue | undefined;
  private readonly now: () => number;
  private readonly failures = new Map<string, UnknownReason>();
  private readonly overlay = new Map<string, CacheEntry>();
  private readonly listeners = new Set<(keys: ReadonlySet<string>) => void>();
  private sessionGrant = false;
  private frozen = false;

  constructor(private readonly deps: UpgradeEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.cache = new MetadataCache(deps.store, this.now);
    this.queue = deps.fetcher ? new FetchQueue(deps.fetcher, { ...deps.queue, now: deps.queue?.now ?? this.now, log: deps.log }) : undefined;
  }

  /** The explicit command counts as consent for its run, like downloading sources does. */
  grantConsentForSession(): void { this.sessionGrant = true; }

  get sessionGranted(): boolean { return this.sessionGrant; }

  /**
   * Answers handed in directly, for the demo and the tests: they win over the
   * cache, and the network stays closed from then on.
   */
  seed(entries: ReadonlyMap<string, CacheEntry> | Record<string, CacheEntry>): void {
    const pairs = entries instanceof Map ? [...entries] : Object.entries(entries);
    for (const [k, e] of pairs) this.overlay.set(k, e);
    this.frozen = true;
  }

  onDidChange(listener: (keys: ReadonlySet<string>) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  collect(files: readonly GradleFile[]): Collected {
    const dependencies: Dependency[] = [];
    let unparsed = false;
    for (const f of files) {
      const c = collectDependencies(f);
      dependencies.push(...c.dependencies);
      unparsed = unparsed || c.unparsed;
    }
    return { dependencies, unparsed };
  }

  private consentNow(): ConsentInput {
    const c = this.deps.consent();
    return this.sessionGrant ? { ...c, sessionGrant: true } : c;
  }

  private googleGroups(): ReadonlySet<string> | undefined {
    const groups = this.lookup(GOOGLE_MASTER_KEY)?.groups;
    return groups ? new Set(groups) : undefined;
  }

  private lookup(key: string): CacheEntry | undefined {
    return this.overlay.get(key) ?? this.cache.get(key)?.entry;
  }

  private isFresh(key: string): boolean {
    if (this.overlay.has(key)) return true;
    return this.cache.get(key)?.fresh ?? false;
  }

  private reasonWhenMissing(key: string): UnknownReason {
    const failed = this.failures.get(key);
    if (failed) return failed;
    if (!this.queue || this.frozen) return this.frozen ? 'notFound' : 'noFetcher';
    return networkAllowed(this.consentNow()) ? 'pending' : 'noConsent';
  }

  /** The versions one cached document holds for one member. */
  private versionsIn(entry: CacheEntry, request: MetadataRequest, artifact: string): string[] | undefined {
    switch (request.format) {
      case 'maven-metadata': return entry.versions;
      case 'google-group-index': return entry.artifacts?.[artifact];
      case 'gradle-current': {
        const out: string[] = [];
        for (const k of [GRADLE_KEY, GRADLE_RC_KEY]) {
          const e = this.lookup(k);
          if (e?.gradle?.current) out.push(e.gradle.current);
          if (e?.gradle?.rc) out.push(e.gradle.rc);
        }
        return out;
      }
      default: return undefined;
    }
  }

  /**
   * Where else a member may be published when its first repository says 404
   * or does not list the version in use. A plugin marker lives on the portal,
   * on Central or on Google Maven (Google's own plugins are on Google Maven
   * only); a library on Central or on Google Maven.
   */
  private fallbackRequests(request: MetadataRequest, member: Dependency['members'][number]): MetadataRequest[] {
    const central: RepoRef = { kind: 'mavenCentral', url: MAVEN_CENTRAL };
    const google: RepoRef = { kind: 'google', url: GOOGLE_MAVEN };
    const out: MetadataRequest[] = [];
    if (isPluginMarker(member)) {
      const id = member.group;
      if (request.repo.kind !== 'mavenCentral') out.push({ key: centralKey(id, member.artifact), url: pluginMarkerUrl(MAVEN_CENTRAL, id), repo: central, format: 'maven-metadata' });
      if (request.repo.kind !== 'google') out.push({ key: googleGroupKey(id), url: googleGroupIndexUrl(id), repo: google, format: 'google-group-index' });
      return out;
    }
    if (request.repo.kind === 'google') out.push({ key: centralKey(member.group, member.artifact), url: mavenMetadataUrl(MAVEN_CENTRAL, member.group, member.artifact), repo: central, format: 'maven-metadata' });
    if (request.repo.kind === 'mavenCentral') out.push({ key: googleGroupKey(member.group), url: googleGroupIndexUrl(member.group), repo: google, format: 'google-group-index' });
    return out;
  }

  private memberRequest(dep: Dependency, member: Dependency['members'][number], repos: RepositorySet): MetadataRequest | undefined {
    // A plugin marker read by a shared site is still a plugin: the Kotlin
    // family, KSP and the portal know it; Central as a library does not.
    const clone: Dependency = dep.kind === 'wrapper' || dep.kind === 'agp' ? dep
      : isPluginMarker(member) ? { ...dep, kind: 'plugin', members: [member], group: member.group, artifact: member.artifact }
        : { ...dep, kind: 'library', members: [member], group: member.group, artifact: member.artifact };
    return requestsFor(clone, repos, this.googleGroups()).find(r => r.key !== GOOGLE_MASTER_KEY);
  }

  /**
   * Every request these dependencies need, one per member, markers routed as
   * plugins, the master index first while the Google groups are unknown.
   */
  private plan(dependencies: readonly Dependency[], repos: RepositorySet): MetadataRequest[] {
    const out = new Map<string, MetadataRequest>();
    const groups = this.googleGroups();
    if (groups === undefined && dependencies.some(d => d.kind === 'library' && d.currentVersion !== undefined)) {
      out.set(GOOGLE_MASTER_KEY, { key: GOOGLE_MASTER_KEY, url: googleMasterIndexUrl(), repo: { kind: 'google', url: GOOGLE_MAVEN }, format: 'google-master-index' });
    }
    for (const dep of dependencies) {
      if (dep.currentVersion === undefined) continue;
      if (dep.kind === 'wrapper' || dep.kind === 'agp') {
        for (const r of requestsFor(dep, repos, groups)) if (!out.has(r.key)) out.set(r.key, r);
        continue;
      }
      for (const m of dep.members) {
        const r = this.memberRequest(dep, m, repos);
        if (r && !out.has(r.key)) out.set(r.key, r);
      }
    }
    return [...out.values()];
  }

  /** The cache keys these files may read: the first requests and their second opinions. */
  keysFor(files: readonly GradleFile[], ctx: ProjectContext): string[] {
    const { dependencies } = this.collect(files);
    const keys = new Set<string>([GOOGLE_MASTER_KEY]);
    for (const r of this.plan(dependencies, ctx.repositories)) keys.add(r.key);
    for (const dep of dependencies) {
      if (!dep.currentVersion || dep.kind === 'wrapper' || dep.kind === 'agp') continue;
      for (const m of dep.members) {
        const r = this.memberRequest(dep, m, ctx.repositories);
        if (r) for (const fb of this.fallbackRequests(r, m)) keys.add(fb.key);
      }
    }
    return [...keys];
  }

  private answerFor(dep: Dependency, member: Dependency['members'][number], repos: RepositorySet): MemberAnswer {
    const request = this.memberRequest(dep, member, repos);
    if (!request) return { reason: 'noRepository', fetchedAt: 0, stale: false };
    const artifact = dep.kind === 'agp' ? 'gradle' : member.artifact;
    const primary = this.lookup(request.key);
    let chosen = request;
    let entry: CacheEntry | undefined = primary?.status === 'ok' ? primary : undefined;
    let versions = entry ? this.versionsIn(entry, request, artifact) : undefined;
    const fallbacks = dep.kind === 'wrapper' || dep.kind === 'agp' ? [] : this.fallbackRequests(request, member);
    if (versions === undefined) {
      // Not fetched yet, a 404, or a group index without this artifact: the
      // other repositories answer when the cache has them; otherwise the
      // first missing answer says why there is none yet.
      let missing: UnknownReason | undefined = primary ? undefined : this.reasonWhenMissing(request.key);
      for (const fb of fallbacks) {
        const e = this.lookup(fb.key);
        if (!e) { missing ??= this.reasonWhenMissing(fb.key); continue; }
        if (e.status !== 'ok') continue;
        const v = this.versionsIn(e, fb, artifact);
        if (v) { chosen = fb; entry = e; versions = v; break; }
      }
      if (versions === undefined || !entry) return { reason: missing ?? 'notFound', fetchedAt: primary?.fetchedAt ?? 0, stale: false };
    } else if (dep.currentVersion && !versions.includes(dep.currentVersion)) {
      // A mirror that never heard of the version in use is a stale mirror: the
      // other repository is read too, when the cache has it.
      for (const fb of fallbacks) {
        const other = this.lookup(fb.key);
        const more = other?.status === 'ok' ? this.versionsIn(other, fb, artifact) : undefined;
        if (more) versions = [...versions, ...more];
      }
    }
    const sorted = sortVersions(versions);
    const latest = sorted[sorted.length - 1];
    return {
      versions: sorted, fetchedAt: entry!.fetchedAt, stale: !this.isFresh(chosen.key), repository: chosen.repo.kind, latest,
      ...(entry!.lastUpdated && chosen.format === 'maven-metadata' ? { releasedAt: lastUpdatedToDate(entry!.lastUpdated) } : {}),
    };
  }

  /** The requests a second opinion needs: 404s and stale mirrors, after the first pass. */
  private secondOpinions(dependencies: readonly Dependency[], repos: RepositorySet): MetadataRequest[] {
    const out: MetadataRequest[] = [];
    for (const dep of dependencies) {
      if (!dep.currentVersion || dep.kind === 'wrapper' || dep.kind === 'agp') continue;
      for (const m of dep.members) {
        const request = this.memberRequest(dep, m, repos);
        if (!request) continue;
        const entry = this.lookup(request.key);
        if (!entry) continue;
        const versions = entry.status === 'ok' ? this.versionsIn(entry, request, m.artifact) : undefined;
        if (versions && versions.includes(dep.currentVersion)) continue;
        out.push(...this.fallbackRequests(request, m));
      }
    }
    return out;
  }

  private verdictFor(dep: Dependency, repos: RepositorySet, policy: Policy): { verdict: Verdict; versions?: string[] } {
    if (dep.pin || dep.literal === 'none' || dep.literal === 'range' || dep.literal === 'rich' || dep.literal === 'templated' || dep.currentVersion === undefined) {
      return { verdict: verdictOf(dep, undefined, undefined) };
    }
    const answers = dep.members.map(m => this.answerFor(dep, m, repos));
    const missing = answers.find(a => a.reason);
    if (missing) return { verdict: verdictOf(dep, undefined, missing.reason) };
    const lists = answers.map(a => a.versions!);
    const versions = lists.length === 1 ? lists[0] : intersectVersions(lists);
    const fetchedAt = Math.min(...answers.map(a => a.fetchedAt));
    const stale = answers.some(a => a.stale);
    const candidate = selectCandidate(policy, dep.currentVersion, versions, { fetchedAt, stale, repository: answers[0].repository });
    const dated = answers.find(a => a.releasedAt && a.latest === candidate.pick);
    const withDate: Candidate = dated ? { ...candidate, releasedAt: dated.releasedAt } : candidate;
    if (lists.length > 1 && candidate.pick === undefined && dep.literal === 'exact') {
      // One member alone would move: the shared entry cannot, and the reader must know why.
      const alone = dep.members.map((m, i) => ({ m, pick: selectCandidate(policy, dep.currentVersion!, lists[i]).pick })).filter(x => x.pick);
      if (alone.length > 0) {
        const detail = alone.map(x => `${x.m.group}:${x.m.artifact} ${x.pick}`).join(', ');
        return { verdict: { kind: 'unknown', reason: 'membersDisagree', detail }, versions };
      }
    }
    return { verdict: verdictOf(dep, withDate, undefined), versions };
  }

  /** Synchronous, memory only. */
  evaluate(files: readonly GradleFile[], ctx: ProjectContext): UpgradeReport {
    const { dependencies, unparsed } = this.collect(files);
    const policy = this.deps.policy();
    const ignore = this.deps.ignore?.() ?? [];
    const findings: Finding[] = [];
    const pendingKeys: string[] = [];
    const versionsByKey = new Map<string, string[]>();
    for (const dep of dependencies) {
      if (matchesIgnore(dep, ignore)) { findings.push({ dependency: dep, verdict: { kind: 'pinned', by: 'ignore-marker' } }); continue; }
      const { verdict, versions } = this.verdictFor(dep, ctx.repositories, policy);
      if (versions) versionsByKey.set(dep.key, versions);
      if (verdict.kind === 'unknown' && verdict.reason === 'pending') pendingKeys.push(dep.key);
      findings.push({ dependency: dep, verdict });
    }

    const railCtx = readRailContext(dependencies, this.deps.matrix);
    const rails: RailFinding[] = [];
    for (const dep of dependencies) {
      if (isKsp(dep)) {
        const r = kspRail(dep, versionsByKey.get(dep.key), railCtx);
        if (r) rails.push(r);
      }
      const agp = agpGradleRail(dep, railCtx);
      if (agp) rails.push(agp);
      const family = kotlinFamilyRail(dep, railCtx);
      if (family) rails.push(family);
    }
    return { findings, rails, pendingKeys, catalogUnparsed: unparsed };
  }

  /** Loads from the store what these files need, before the first paint. No network. */
  async warm(files: readonly GradleFile[], ctx: ProjectContext): Promise<void> {
    await this.cache.warm([GOOGLE_MASTER_KEY]);
    await this.cache.warm(this.keysFor(files, ctx));
  }

  /** Fetches what is missing or stale, under the consent gate. Resolves when every lookup settled. */
  async refresh(files: readonly GradleFile[], ctx: ProjectContext, opts: { force?: boolean; signal?: AbortSignal } = {}): Promise<RefreshResult> {
    const result: RefreshResult = { requested: 0, fetched: 0, fromCache: 0, notModified: 0, quietHosts: [] };
    if (!this.queue || this.frozen) return { ...result, skipped: 'noFetcher' };
    const consent = this.consentNow();
    if (!networkAllowed(consent)) return { ...result, skipped: 'noConsent' };

    const { dependencies } = this.collect(files);
    const changed = new Set<string>();
    const done = new Set<string>();
    const run = async (requests: readonly MetadataRequest[]) => {
      const todo = requests.filter(r => !done.has(r.key) && hostAllowed(consent, r.repo));
      for (const r of todo) done.add(r.key);
      result.requested += todo.length;
      await Promise.all(todo.map(r => this.fetchOne(r, opts, result, changed)));
    };

    await run(this.plan(dependencies, ctx.repositories));
    // The master index may have landed only now: route the libraries for real.
    await run(this.plan(dependencies, ctx.repositories));
    // Second opinions: a 404, or a mirror that does not list the version in use.
    await run(this.secondOpinions(dependencies, ctx.repositories));

    result.quietHosts = this.queue.quietHosts();
    if (changed.size > 0) for (const l of this.listeners) l(changed);
    return result;
  }

  private async fetchOne(request: MetadataRequest, opts: { force?: boolean; signal?: AbortSignal }, result: RefreshResult, changed: Set<string>): Promise<void> {
    const cached = this.cache.get(request.key);
    if (cached?.fresh && !opts.force) { result.fromCache++; return; }
    const headers = cached && !opts.force ? this.cache.conditionalHeaders(cached.entry) : {};
    const outcome = await this.queue!.fetch(request.url, headers, opts.signal);
    const now = this.now();
    switch (outcome.kind) {
      case 'ok': {
        const entry = this.entryFrom(request, outcome.body, outcome.headers, now);
        if (!entry) { this.failures.set(request.key, 'error'); this.deps.log?.(`[upgrades] unreadable answer from ${request.url}`); return; }
        this.failures.delete(request.key);
        await this.cache.put(request.key, entry);
        result.fetched++;
        changed.add(request.key);
        return;
      }
      case 'notModified':
        this.failures.delete(request.key);
        await this.cache.touch(request.key, now);
        result.notModified++;
        return;
      case 'notFound': {
        this.failures.delete(request.key);
        const was = this.lookup(request.key);
        await this.cache.put(request.key, { v: 1, url: request.url, fetchedAt: now, status: 'notFound' });
        if (!was || was.status !== 'notFound') changed.add(request.key);
        return;
      }
      case 'rateLimited': this.failures.set(request.key, 'rateLimited'); return;
      case 'offline': this.failures.set(request.key, 'offline'); return;
      default: this.failures.set(request.key, 'error'); return;
    }
  }

  private entryFrom(request: MetadataRequest, body: string, headers: Record<string, string>, now: number): CacheEntry | undefined {
    const base: CacheEntry = {
      v: 1, url: request.url, fetchedAt: now, status: 'ok',
      ...(headers.etag ? { etag: headers.etag } : {}),
      ...(headers['last-modified'] ? { lastModified: headers['last-modified'] } : {}),
    };
    switch (request.format) {
      case 'maven-metadata': {
        const m = parseMavenMetadata(body);
        return m ? { ...base, versions: m.versions, ...(m.lastUpdated ? { lastUpdated: m.lastUpdated } : {}) } : undefined;
      }
      case 'google-group-index': {
        const group = request.key.replace(/^google\//, '').replace(/\/_group$/, '').replace(/\//g, '.');
        const artifacts = parseGoogleGroupIndex(body, group);
        return artifacts ? { ...base, artifacts } : undefined;
      }
      case 'google-master-index': {
        const groups = parseGoogleMasterIndex(body);
        return groups ? { ...base, groups } : undefined;
      }
      case 'gradle-current': {
        if (request.key === GRADLE_RC_KEY) {
          const rc = parseGradleCurrent('{"version":""}', body)?.rc;
          return { ...base, gradle: { current: '', ...(rc ? { rc } : {}) } };
        }
        const g = parseGradleCurrent(body);
        return g ? { ...base, gradle: { current: g.current } } : undefined;
      }
      default: return undefined;
    }
  }

  /**
   * The Gradle an AGP bump would need beyond the wrapper in place, with what
   * the wrapper edit requires: nothing, or a checksum the caller must fetch.
   */
  wrapperRequirement(report: UpgradeReport, agp: Finding, to: string, textOf: (file: string) => string | undefined): { gradle: string; wrapper: Dependency; checksumRequired: boolean } | undefined {
    if (agp.dependency.kind !== 'agp') return undefined;
    const needed = agpMinimumGradle(to, this.deps.matrix);
    const wrapper = report.findings.find(f => f.dependency.kind === 'wrapper')?.dependency;
    if (!needed || !wrapper?.currentVersion || compareVersions(wrapper.currentVersion, needed) >= 0) return undefined;
    const text = textOf(wrapper.range.file);
    return { gradle: needed, wrapper, checksumRequired: text ? hasChecksum(text) : false };
  }

  /**
   * The spans a bump writes: the site itself, or the wrapper URL (and its
   * checksum line when there is one, which then needs the checksum). An AGP
   * bump that drags the wrapper along passes `wrapper`, read from
   * `wrapperRequirement`, and gets both files' spans in one list.
   */
  bumpEdits(
    finding: Finding | RailFinding,
    to: string,
    textOf: (file: string) => string | undefined,
    opts: { wrapperSha256?: string; wrapper?: { dependency: Dependency; to: string } } = {},
  ): EditSpan[] {
    if ('rail' in finding) return finding.edits ?? [];
    const dep = finding.dependency;
    const wrapperEdits = (wrapper: Dependency, version: string): EditSpan[] | undefined => {
      const text = textOf(wrapper.range.file);
      if (!text) return undefined;
      const r = bumpWrapperUrl(text, version, opts.wrapperSha256);
      return r.edits.length === 0 ? undefined : r.edits.map(e => ({ ...e, file: wrapper.range.file }));
    };
    if (dep.kind === 'wrapper') return wrapperEdits(dep, to) ?? [];
    const own = bumpEdit(dep, to);
    if (!own) return [];
    if (!opts.wrapper) return [own];
    const dragged = wrapperEdits(opts.wrapper.dependency, opts.wrapper.to);
    // Withheld as a whole: an AGP bump without its Gradle is a broken build.
    return dragged ? [own, ...dragged] : [];
  }

  /** `distributionSha256Sum` for a wrapper version, fetched on an explicit action only. */
  async wrapperChecksum(version: string, type: 'bin' | 'all'): Promise<string | undefined> {
    if (!this.deps.fetcher) return undefined;
    try {
      const res = await this.deps.fetcher({ url: `https://services.gradle.org/distributions/gradle-${version}-${type}.zip.sha256`, headers: {}, timeoutMs: 15_000 });
      const body = res.body.trim();
      return res.status === 200 && /^[0-9a-f]{64}$/.test(body) ? body : undefined;
    } catch {
      return undefined;
    }
  }

  wrapperType(text: string): 'bin' | 'all' { return distributionType(text); }
}
