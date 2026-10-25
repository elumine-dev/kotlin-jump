import { capMap } from '../util/boundedCache';

/**
 * Gradle's own order of versions, and what counts as stable.
 *
 * A dependency is behind when a repository lists a version Gradle would rank
 * above the one in the catalog, so the comparison here is a port of Gradle's
 * `StaticVersionComparator`, not a semver lookalike:
 *
 *   - a version is split on `.`, `-`, `_` and `+`, then at every digit to
 *     letter boundary, so `1a1`, `1.a.1` and `1-a+1` are the same version;
 *   - a numeric part ranks above any word (`1.a < 1.1`), two numeric parts
 *     compare by value (`1.01 == 1.1`);
 *   - `dev` ranks below every other word; `rc`, `snapshot`, `final`, `ga`,
 *     `release` and `sp` rank above every other word, in that order, whatever
 *     their case; the remaining words compare by code unit, so uppercase
 *     comes first and `1.0.0-Beta2 < 1.0.0-alpha05`;
 *   - an extra numeric part makes a version higher (`1.1 < 1.1.0`), an extra
 *     word makes it lower (`1.1.a < 1.1`, `1.0-rc < 1.0`).
 *
 * Two consequences surprise people and are therefore spelled out in the
 * hover: `2.5.0-Beta2` ranks above `2.4.21`, and a Beta ranks below an alpha
 * of the same version. Both are what Gradle does.
 */

export interface ParsedVersion {
  parts: string[];
  /** The value of each numeric part, undefined for a word. */
  numeric: (number | undefined)[];
}

/** Repositories list a few hundred versions per artifact; the memo stays small. */
export const PARSE_CACHE_LIMIT = 4096;

const parsed = new Map<string, ParsedVersion>();

/** For the test that guards the cap. */
export function parseCacheSize(): number {
  return parsed.size;
}

/** The qualifiers Gradle ranks apart from plain words, with their rank. */
const SPECIAL: Readonly<Record<string, number>> = { dev: -1, rc: 1, snapshot: 2, final: 3, ga: 4, release: 5, sp: 6 };

export function parseVersion(version: string): ParsedVersion {
  const hit = parsed.get(version);
  if (hit) return hit;
  const parts: string[] = [];
  for (const chunk of version.split(/[.\-_+]/)) {
    if (chunk === '') continue;
    for (const part of chunk.match(/\d+|\D+/g) ?? []) parts.push(part);
  }
  const numeric = parts.map(p => (/^\d+$/.test(p) ? Number(p) : undefined));
  const result: ParsedVersion = { parts, numeric };
  parsed.set(version, result);
  capMap(parsed, PARSE_CACHE_LIMIT);
  return result;
}

/** Negative when `a` ranks below `b`, zero when Gradle treats them as the same version. */
export function compareVersions(a: string, b: string): number {
  if (a === b) return 0;
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const common = Math.min(pa.parts.length, pb.parts.length);
  for (let i = 0; i < common; i++) {
    const sa = pa.parts[i];
    const sb = pb.parts[i];
    if (sa === sb) continue;
    const na = pa.numeric[i];
    const nb = pb.numeric[i];
    if (na !== undefined && nb !== undefined) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (na !== undefined) return 1;
    if (nb !== undefined) return -1;
    const qa = SPECIAL[sa.toLowerCase()];
    const qb = SPECIAL[sb.toLowerCase()];
    if (qa !== undefined && qb !== undefined) {
      if (qa !== qb) return qa < qb ? -1 : 1;
      continue;
    }
    // A special qualifier against a plain word: its rank against zero, so
    // `dev` loses to any word and `rc` and above win over any word.
    if (qa !== undefined) return qa < 0 ? -1 : 1;
    if (qb !== undefined) return qb < 0 ? 1 : -1;
    return sa < sb ? -1 : 1;
  }
  if (pa.parts.length > common) return pa.numeric[common] !== undefined ? 1 : -1;
  if (pb.parts.length > common) return pb.numeric[common] !== undefined ? -1 : 1;
  return 0;
}

/** An ascending copy without duplicate texts. The input is left alone. */
export function sortVersions(versions: readonly string[]): string[] {
  return [...new Set(versions)].sort(compareVersions);
}

/**
 * The rule the gradle versions plugin documents, tightened on one point.
 *
 * Stable: digits, dots, commas, dashes and a leading `v`, with an optional
 * `-r`, `-jre` or `-android` (Guava's flavours), or a version with a WHOLE
 * part spelled release, final, ga or sp. The plugin accepts those keywords as
 * substrings, which makes `1.0-omega` stable through its `ga`; here the
 * keyword must be a part of its own. A repository's `release` field is no
 * signal at all: the plugin portal lists `2.5.0-Beta2` as a release.
 */
export function isStable(version: string): boolean {
  if (version === '') return false;
  if (/^[0-9,.v-]+(-r|-jre|-android)?$/i.test(version)) return true;
  return parseVersion(version).parts.some(p => /^(release|final|ga|sp)$/i.test(p));
}
