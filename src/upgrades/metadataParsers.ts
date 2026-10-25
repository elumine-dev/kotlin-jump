/**
 * The four documents a version check reads, parsed with regular expressions.
 *
 * All four are machine written, flat, without namespaces or CDATA, and their
 * values are version strings that cannot contain `<` or `&`: a 78 KB Google
 * group index, the largest seen, is read in a fraction of a millisecond, and
 * an XML library would add weight to the bundle for no gain in correctness.
 *
 * Every parser returns `undefined` for anything that is not the expected
 * document, and never an empty list: an empty list would be cached and read
 * back as "this artifact has no versions", which is what a captive portal
 * page or a truncated download must never become.
 *
 * No vscode, no Node: the browser bundle and the tests read this as is.
 */

export interface MavenMetadata {
  groupId?: string;
  artifactId?: string;
  latest?: string;
  release?: string;
  /** In document order, oldest first on every repository seen. */
  versions: string[];
  /** `yyyyMMddHHmmss`, the moment the repository last touched the document. */
  lastUpdated?: string;
}

const BOM = /^﻿/;
const XML_DECLARATION_RE = /^\s*<\?xml[^>]*\?>/;

function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** The body of a metadata request before it is trusted: the start of a document, with the declaration and the comments out of the way. */
function bodyStart(body: string): string {
  return stripComments(body.replace(BOM, '').replace(XML_DECLARATION_RE, '')).trimStart();
}

/**
 * True for the start of one of the four documents, false for an HTML page.
 *
 * A captive portal answers 200 with HTML, sometimes behind an XML declaration
 * of its own. The downloader of sources learned that lesson the hard way: a
 * page cached as a jar was never retried.
 */
export function looksLikeMetadataBody(body: string): boolean {
  const start = bodyStart(body);
  if (start.startsWith('{')) return true;
  if (start.startsWith('<!')) return false;
  if (/^<html\b/i.test(start)) return false;
  return /^<[A-Za-z]/.test(start);
}

function text(xml: string, element: string): string | undefined {
  const m = new RegExp(`<${element}>\\s*([^<]*?)\\s*</${element}>`).exec(xml);
  return m?.[1] || undefined;
}

/** Maven Central, the Gradle plugin portal and any Maven repository: `maven-metadata.xml`. */
export function parseMavenMetadata(xml: string): MavenMetadata | undefined {
  const clean = stripComments(xml);
  if (!/<metadata[\s>]/.test(clean) || !/<\/metadata>/.test(clean)) return undefined;
  // Scoped to the <versions> block: the plugin portal document carries a top
  // level <version> before <versioning>, which is a marker's own version and
  // not one more published one.
  const block = /<versions>([\s\S]*?)<\/versions>/.exec(clean);
  if (!block) return undefined;
  const versions: string[] = [];
  for (const m of block[1].matchAll(/<version>\s*([^<\s][^<]*?)\s*<\/version>/g)) versions.push(m[1]);
  if (versions.length === 0) return undefined;
  const versioning = /<versioning>([\s\S]*?)<\/versioning>/.exec(clean)?.[1] ?? '';
  return {
    groupId: text(clean, 'groupId'),
    artifactId: text(clean, 'artifactId'),
    latest: text(versioning, 'latest'),
    release: text(versioning, 'release'),
    versions,
    lastUpdated: text(versioning, 'lastUpdated'),
  };
}

/** The first element of a document, after the declaration and the comments. */
function rootElement(xml: string): string | undefined {
  return /^<([A-Za-z_][\w.-]*)[\s>\/]/.exec(bodyStart(xml))?.[1];
}

/**
 * Google Maven, `<group path>/group-index.xml`: the root element is named by
 * the group, each child is an artifact with a `versions` attribute, newest
 * last. The caller names the group it asked for: a document whose root says
 * otherwise is a redirect gone wrong, not a list of versions.
 */
export function parseGoogleGroupIndex(xml: string, expectedGroup: string): Record<string, string[]> | undefined {
  const clean = stripComments(xml);
  if (rootElement(clean) !== expectedGroup) return undefined;
  const closing = clean.indexOf(`</${expectedGroup}>`);
  if (closing === -1) return undefined;
  const inside = clean.slice(clean.indexOf(`<${expectedGroup}`), closing);
  const out: Record<string, string[]> = {};
  for (const m of inside.matchAll(/<([A-Za-z_][\w.-]*)\s[^>]*?\bversions="([^"]*)"[^>]*>/g)) {
    const versions = m[2].split(',').map(v => v.trim()).filter(Boolean);
    if (versions.length > 0) out[m[1]] = versions;
  }
  return out;
}

/** Google Maven, `master-index.xml`: one empty element per group id under `<metadata>`. */
export function parseGoogleMasterIndex(xml: string): string[] | undefined {
  const clean = stripComments(xml);
  if (rootElement(clean) !== 'metadata') return undefined;
  const closing = clean.indexOf('</metadata>');
  if (closing === -1) return undefined;
  const inside = clean.slice(clean.indexOf('<metadata'), closing).replace(/^<metadata[^>]*>/, '');
  const groups: string[] = [];
  for (const m of inside.matchAll(/<([A-Za-z_][\w.-]*)\s*\/>/g)) groups.push(m[1]);
  return groups.length > 0 ? groups : undefined;
}

/**
 * `services.gradle.org/versions/current`, and `/versions/release-candidate`
 * which answers `{ }` when there is none.
 */
export function parseGradleCurrent(json: string, releaseCandidateJson?: string): { current: string; rc?: string } | undefined {
  const current = versionOf(json);
  if (current === undefined) return undefined;
  const rc = releaseCandidateJson === undefined ? undefined : versionOf(releaseCandidateJson);
  return rc === undefined ? { current } : { current, rc };
}

function versionOf(json: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' && version !== '' ? version : undefined;
  } catch {
    return undefined;
  }
}

/** `20261022124600` becomes `2026-10-22`. */
export function lastUpdatedToDate(stamp: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})\d{6}$/.exec(stamp);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
