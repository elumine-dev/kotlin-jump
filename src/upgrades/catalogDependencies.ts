import { parseCatalog } from '../indexer/VersionCatalogIndex';
import type { Coordinate, Dependency, DependencyKind, LiteralKind, PinKind, SharedBy } from './model';
import { classifyVersionLiteral } from './versionLiteral';
import { fileLevelMarker, pinOnLine } from './pins';

/**
 * The version sites of a Gradle version catalog.
 *
 * `parseCatalog` knows every alias, its coordinate and its `version.ref`, but
 * not where the version text sits. This module adds the exact offsets of the
 * bare literal, quotes excluded, groups the aliases that read one `[versions]`
 * entry into a single dependency with several members, and gives inline
 * versions and `"group:artifact:version"` shorthands a site of their own.
 *
 * No vscode import: the engine, the harness and the tests call it directly.
 */

export interface CatalogCollection {
  dependencies: Dependency[];
  /** The catalog could not be read in full: nothing is returned, by design. */
  unparsed: boolean;
}

const AGP_PLUGIN_RE = /^com\.android\.(application|library|test|dynamic-feature|kotlin-multiplatform-library|asset-pack|asset-pack-bundle|fused-library|privacy-sandbox-sdk|ai-pack)$/;
const AGP_LIBRARY = 'com.android.tools.build:gradle';

/** A plugin id is published as a marker artifact `<id>:<id>.gradle.plugin`. */
export function pluginMarker(id: string): Coordinate {
  return { group: id, artifact: `${id}.gradle.plugin` };
}

function isAgp(c: Coordinate): boolean {
  return AGP_PLUGIN_RE.test(c.group) || `${c.group}:${c.artifact}` === AGP_LIBRARY;
}

function isPluginMarker(c: Coordinate): boolean {
  return c.artifact === `${c.group}.gradle.plugin`;
}

function kindOf(members: readonly Coordinate[]): DependencyKind {
  if (members.some(isAgp)) return 'agp';
  if (members.length > 0 && members.every(isPluginMarker)) return 'plugin';
  return 'library';
}

interface Literal {
  /** Bare text between the quotes, or the inline table for a rich version. */
  text: string;
  kind: LiteralKind;
  /** Offsets of the bare text in the whole file; absent for a rich version. */
  start?: number;
  end?: number;
  /** Offsets of the quoted literal (or the inline table), what a diagnostic underlines. */
  rangeStart: number;
  rangeEnd: number;
}

/** The literal after `=` for a `[versions]` entry: `"1.2.3"` or `{ strictly = "..." }`. */
function versionsEntryLiteral(entryText: string, entryStart: number): Literal | undefined {
  const quoted = /^\s*[A-Za-z0-9_.-]+\s*=\s*(["'])/.exec(entryText);
  if (quoted) {
    const open = quoted[0].length - 1;
    const close = entryText.indexOf(quoted[1], open + 1);
    if (close < 0) return undefined;
    const text = entryText.slice(open + 1, close);
    return { text, kind: classifyVersionLiteral(text), start: entryStart + open + 1, end: entryStart + close, rangeStart: entryStart + open, rangeEnd: entryStart + close + 1 };
  }
  const table = /^\s*[A-Za-z0-9_.-]+\s*=\s*(\{)/.exec(entryText);
  if (table) {
    const open = table[0].length - 1;
    const close = entryText.lastIndexOf('}');
    const text = entryText.slice(open, close + 1);
    return { text, kind: classifyVersionLiteral(text) === 'rich' ? 'rich' : 'templated', rangeStart: entryStart + open, rangeEnd: entryStart + close + 1 };
  }
  return undefined;
}

/** `version = "x"` inside an inline table (not `version.ref`), or `version = { strictly = ... }`. */
function inlineLiteral(entryText: string, entryStart: number): Literal | undefined {
  const quoted = /(?<![.\w])version\s*=\s*"([^"]*)"/.exec(entryText);
  if (quoted) {
    const start = entryStart + quoted.index + quoted[0].indexOf('"') + 1;
    return { text: quoted[1], kind: classifyVersionLiteral(quoted[1]), start, end: start + quoted[1].length, rangeStart: start - 1, rangeEnd: start + quoted[1].length + 1 };
  }
  const table = /(?<![.\w])version\s*=\s*(\{[^}]*\})/.exec(entryText);
  if (table) {
    const start = entryStart + table.index + table[0].indexOf('{');
    return { text: table[1], kind: 'rich', rangeStart: start, rangeEnd: start + table[1].length };
  }
  if (/(?<![.\w])version\.(strictly|require|prefer|reject)\s*=/.test(entryText)) {
    const m = /(?<![.\w])version\.(?:strictly|require|prefer|reject)\s*=\s*"([^"]*)"/.exec(entryText)!;
    const start = entryStart + m.index;
    return { text: m[0], kind: 'rich', rangeStart: start, rangeEnd: start + m[0].length };
  }
  return undefined;
}

/** The third field of `alias = "group:artifact:version"`. */
function shorthandLiteral(entryText: string, entryStart: number): Literal | undefined {
  const m = /^\s*[A-Za-z0-9_.-]+\s*=\s*"([^:"]+):([^:"]+):([^"]*)"/.exec(entryText);
  if (!m) return undefined;
  const start = entryStart + m[0].length - 1 - m[3].length;
  return { text: m[3], kind: classifyVersionLiteral(m[3]), start, end: start + m[3].length, rangeStart: start, rangeEnd: start + m[3].length };
}

function lineOfOffset(lineStarts: readonly number[], offset: number): number {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function collectCatalogDependencies(text: string, file: string, root = 'libs'): CatalogCollection {
  const catalog = parseCatalog(text, root);
  if (catalog.unparsed) return { dependencies: [], unparsed: true };

  const lines = text.split('\n');
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const fileMarker = fileLevelMarker(lines, 'toml');
  const pinAt = (line: number): PinKind | undefined => (fileMarker ? 'ignore-marker' : pinOnLine(lines, line, 'toml'));

  const dependencies: Dependency[] = [];

  // 1. The [versions] entries, each a site waiting for its members.
  interface Site { dep: Dependency; literal: Literal | undefined }
  const sites = new Map<string, Site>();
  for (const a of catalog.aliases) {
    if (a.namespace !== 'versions') continue;
    const entryText = text.slice(a.removeStart, a.removeEnd);
    const literal = versionsEntryLiteral(entryText, a.removeStart);
    const dep: Dependency = {
      kind: 'library', key: `versions:${a.raw}`, members: [], group: '', artifact: '',
      currentVersion: literal && literal.kind !== 'rich' && literal.kind !== 'templated' ? literal.text : undefined,
      literal: literal?.kind ?? 'none',
      ...(literal?.start !== undefined && literal.end !== undefined ? { versionSite: { file, start: literal.start, end: literal.end, text: literal.text } } : {}),
      range: literal ? { file, start: literal.rangeStart, end: literal.rangeEnd } : { file, start: a.removeStart, end: a.removeStart + a.raw.length },
      line: a.line, source: 'toml-versions', name: a.raw, sharedBy: [],
      ...(pinAt(a.line) ? { pin: pinAt(a.line) } : {}),
    };
    sites.set(a.raw, { dep, literal });
  }

  // 2. Libraries and plugins: members of a shared site, or sites of their own.
  for (const a of catalog.aliases) {
    if ((a.namespace !== 'libraries' && a.namespace !== 'plugins') || !a.coordinate) continue;
    const member: Coordinate = a.namespace === 'plugins'
      ? pluginMarker(a.coordinate)
      : { group: a.coordinate.split(':')[0], artifact: a.coordinate.split(':')[1] };
    const pin = pinAt(a.line);

    if (a.versionRef) {
      const site = sites.get(a.versionRef);
      if (!site) continue;
      site.dep.members.push(member);
      site.dep.sharedBy.push({ alias: a.raw, line: a.line, character: a.character } satisfies SharedBy);
      if (pin && !site.dep.pin) site.dep.pin = pin;
      continue;
    }

    const entryText = text.slice(a.removeStart, a.removeEnd);
    const entryStart = a.removeStart;
    const inline = inlineLiteral(entryText, entryStart);
    const shorthand = inline ? undefined : shorthandLiteral(entryText, entryStart);
    const literal = inline ?? shorthand;
    const source = inline ? 'toml-inline' : shorthand ? 'toml-shorthand' : 'toml-inline';
    const kind = kindOf([member]);
    const name = a.raw;
    const key = kind === 'agp' ? 'agp' : a.namespace === 'plugins' ? `plugin:${a.coordinate}` : `library:${a.coordinate}`;
    dependencies.push({
      kind, key, members: [member], group: member.group, artifact: member.artifact,
      currentVersion: literal && literal.kind !== 'rich' && literal.kind !== 'templated' ? literal.text : undefined,
      literal: literal?.kind ?? 'none',
      ...(literal?.start !== undefined && literal.end !== undefined ? { versionSite: { file, start: literal.start, end: literal.end, text: literal.text } } : {}),
      range: literal ? { file, start: literal.rangeStart, end: literal.rangeEnd } : { file, start: entryStart + entryText.indexOf(a.raw), end: entryStart + entryText.indexOf(a.raw) + a.raw.length },
      line: a.line, source, name, sharedBy: [],
      ...(pin ? { pin } : {}),
    });
  }

  // 3. A site nothing reads is not a dependency: there is nothing to look up.
  for (const { dep } of sites.values()) {
    if (dep.members.length === 0) continue;
    dep.kind = kindOf(dep.members);
    dep.group = dep.members[0].group;
    dep.artifact = dep.members[0].artifact;
    if (dep.kind === 'agp') dep.key = 'agp';
    dependencies.push(dep);
  }

  dependencies.sort((a, b) => a.range.start - b.range.start);
  for (const d of dependencies) d.line = lineOfOffset(lineStarts, d.range.start);
  return { dependencies, unparsed: false };
}
