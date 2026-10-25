import type { Dependency, EditSpan } from './model';

/**
 * The Gradle wrapper as a dependency (KJ-082).
 *
 * `gradle/wrapper/gradle-wrapper.properties` names the Gradle version inside
 * an escaped URL, `distributionUrl=https\://services.gradle.org/distributions/gradle-9.2.1-bin.zip`.
 * The version site is the bare `9.2.1`, so a bump rewrites nothing else and
 * keeps the `\:` escaping and the distribution type. A file that pins a
 * `distributionSha256Sum` cannot be bumped without the new checksum: the
 * next build would refuse the distribution, so the edit is refused until the
 * caller supplies it.
 */

const URL_LINE_RE = /^[ \t]*distributionUrl[ \t]*=[ \t]*(\S+)[ \t]*$/m;
const CHECKSUM_LINE_RE = /^[ \t]*distributionSha256Sum[ \t]*=[ \t]*(\S*)[ \t]*$/m;
const DISTRIBUTION_RE = /^https?:\/\/services\.gradle\.org\/distributions\/gradle-(.+)-(bin|all)\.zip$/;

function unescape(value: string): string {
  return value.replace(/\\:/g, ':').replace(/\\\\/g, '\\');
}

interface WrapperUrl {
  /** The raw value, escaping included, and its offsets in the file. */
  raw: string;
  start: number;
  end: number;
  version: string;
  type: 'bin' | 'all';
  /** Offsets of the bare version inside the file. */
  versionStart: number;
  versionEnd: number;
}

function readUrl(text: string): WrapperUrl | undefined {
  const m = URL_LINE_RE.exec(text);
  if (!m) return undefined;
  const raw = m[1];
  const d = DISTRIBUTION_RE.exec(unescape(raw));
  if (!d) return undefined;
  const start = m.index + m[0].indexOf(raw);
  // The version carries no escape, so its position is the same in the raw value.
  const inRaw = raw.indexOf(`gradle-${d[1]}-${d[2]}.zip`);
  if (inRaw < 0) return undefined;
  const versionStart = start + inRaw + 'gradle-'.length;
  return { raw, start, end: start + raw.length, version: d[1], type: d[2] as 'bin' | 'all', versionStart, versionEnd: versionStart + d[1].length };
}

function lineOf(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** The wrapper's Gradle version as a dependency, or undefined when the file does not point at a Gradle distribution. */
export function collectWrapperDependency(text: string, path: string): Dependency | undefined {
  const url = readUrl(text);
  if (!url) return undefined;
  return {
    kind: 'wrapper',
    key: 'wrapper',
    members: [{ group: 'org.gradle', artifact: 'gradle' }],
    group: 'org.gradle',
    artifact: 'gradle',
    currentVersion: url.version,
    literal: 'exact',
    versionSite: { file: path, start: url.versionStart, end: url.versionEnd, text: url.version },
    range: { file: path, start: url.start, end: url.end },
    line: lineOf(text, url.start),
    source: 'wrapper',
    name: 'Gradle',
    sharedBy: [],
  };
}

export function distributionType(text: string): 'bin' | 'all' {
  return readUrl(text)?.type ?? 'bin';
}

/** A `distributionSha256Sum` line pins the distribution: a bump needs the new checksum. */
export function hasChecksum(text: string): boolean {
  return CHECKSUM_LINE_RE.test(text);
}

/**
 * Rewrites the version inside the URL, and the checksum when the file pins
 * one and the caller supplies the new value. Without that value a pinned
 * file is left untouched and no edit is returned.
 */
export function bumpWrapperUrl(text: string, toVersion: string, sha256?: string): { text: string; edits: EditSpan[] } {
  const url = readUrl(text);
  if (!url) return { text, edits: [] };
  const checksum = CHECKSUM_LINE_RE.exec(text);
  if (checksum && !sha256) return { text, edits: [] };

  const edits: EditSpan[] = [{ file: '', start: url.versionStart, end: url.versionEnd, newText: toVersion }];
  if (checksum && sha256) {
    const valueStart = checksum.index + checksum[0].indexOf('=') + 1;
    const leading = /^[ \t]*/.exec(text.slice(valueStart))?.[0].length ?? 0;
    const start = valueStart + leading;
    edits.push({ file: '', start, end: start + checksum[1].length, newText: sha256 });
  }

  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return { text: out, edits };
}
