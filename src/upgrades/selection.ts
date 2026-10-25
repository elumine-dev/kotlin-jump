import type { Candidate, Dependency, Policy, RepoKind, UnknownReason, Verdict } from './model';
import { compareVersions, isStable, sortVersions } from './gradleVersion';

/**
 * Which version a bump offers, and the verdict that follows.
 *
 * The default policy prefers stable: a project on `2.4.21` is not told about
 * `2.5.0-Beta2`, while a project already on `1.0.0-alpha05` is told about the
 * next alpha and about the stable it skipped. A bump is never the current
 * version and never a downgrade; a project ahead of what the repository lists
 * is up to date, not behind.
 */

export interface CandidateMeta {
  fetchedAt?: number;
  stale?: boolean;
  releasedAt?: string;
  repository?: RepoKind;
}

const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

export function selectCandidate(policy: Policy, current: string, versions: readonly string[], meta: CandidateMeta = {}): Candidate {
  const sorted = sortVersions(versions);
  const stable = sorted.filter(isStable);
  const newer = sorted.filter(v => compareVersions(v, current) > 0);
  const newerStable = newer.filter(isStable);
  const pick = policy === 'stable' ? last(newerStable)
    : policy === 'latest' ? last(newer)
      : isStable(current) ? last(newerStable) : last(newer);
  return {
    latest: last(sorted) ?? '',
    latestStable: last(stable),
    pick,
    versions: sorted,
    newerCount: newer.length,
    currentKnown: sorted.includes(current),
    fetchedAt: meta.fetchedAt ?? 0,
    stale: meta.stale ?? false,
    releasedAt: meta.releasedAt,
    repository: meta.repository,
  };
}

/**
 * The versions every member publishes, ascending. A shared `[versions]`
 * entry can only move to a version that exists for each library reading it.
 */
export function intersectVersions(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return [];
  let common = new Set(lists[0]);
  for (const list of lists.slice(1)) {
    const here = new Set(list);
    common = new Set([...common].filter(v => here.has(v)));
  }
  return sortVersions([...common]);
}

/** The latest stable a dynamic version resolves to, inside its own prefix. */
function dynamicPin(current: string, versions: readonly string[]): string | undefined {
  const stable = versions.filter(isStable);
  if (current === '+' || current.startsWith('latest.')) return last(stable);
  const prefix = current.endsWith('+') ? current.slice(0, -1) : current;
  return last(stable.filter(v => v.startsWith(prefix)));
}

/**
 * The house order: a pin beats everything; a dynamic, range or rich version
 * is left alone (a dynamic one is offered the stable it could be pinned to);
 * a templated value is unknown for that reason; a version a BOM manages says
 * nothing; without a candidate the reason the caller gives stands; then the
 * candidate decides.
 */
export function verdictOf(dependency: Dependency, candidate: Candidate | undefined, unknownReason: UnknownReason | undefined): Verdict {
  if (dependency.pin) return { kind: 'pinned', by: dependency.pin };
  if (dependency.literal === 'range' || dependency.literal === 'rich') return { kind: 'rich', form: dependency.literal };
  if (dependency.literal === 'dynamic') {
    const pin = candidate ? dynamicPin(dependency.currentVersion ?? '', candidate.versions) : undefined;
    return pin ? { kind: 'rich', form: 'dynamic', pin } : { kind: 'rich', form: 'dynamic' };
  }
  if (dependency.literal === 'templated') return { kind: 'unknown', reason: 'templated' };
  if (dependency.literal === 'none' || dependency.currentVersion === undefined) return { kind: 'bomManaged' };
  if (!candidate) return { kind: 'unknown', reason: unknownReason ?? 'pending' };
  if (candidate.pick === undefined) return { kind: 'upToDate', candidate };
  const stability = isStable(candidate.pick) ? 'stable' : 'preRelease';
  const alsoStable = stability === 'preRelease' && candidate.latestStable !== undefined
    && compareVersions(candidate.latestStable, dependency.currentVersion) > 0
    ? candidate.latestStable : undefined;
  return alsoStable
    ? { kind: 'newer', to: candidate.pick, stability, candidate, alsoStable }
    : { kind: 'newer', to: candidate.pick, stability, candidate };
}
