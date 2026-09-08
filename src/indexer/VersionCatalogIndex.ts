/**
 * The version catalog, parsed once for everything that needs it.
 *
 * Two incompatible parsers used to coexist: this one, which never understood
 * `module = "group:artifact"`, and one inside DependencyUsageBadgeProvider,
 * which understood it but ignored `[versions]`, `[plugins]` and `[bundles]`.
 * On a real catalog written entirely in the `module =` form, the first read
 * ZERO of its 164 libraries, so the hover was silently blank everywhere.
 *
 * Everything here is textual and dependency free. TOML is only parsed as far
 * as a Gradle catalog uses it, and anything beyond that sets `unparsed`, which
 * makes the whole catalog produce nothing rather than something wrong.
 */

export type CatalogNamespace = 'libraries' | 'plugins' | 'bundles' | 'versions';

export interface CatalogEntry {
  group: string;
  name: string;
  version: string;
  alias: string;
}

export interface CatalogAlias {
  /** The alias exactly as written, e.g. `androidx-appcompat`. */
  raw: string;
  /**
   * Alias split on the separators Gradle treats as equivalent.
   *
   * `-`, `_` and `.` all produce the same type-safe accessor, so
   * `androidx-appcompat`, `androidx_appcompat` and `androidx.appcompat` are
   * three spellings of `libs.androidx.appcompat`.
   */
  segments: string[];
  namespace: CatalogNamespace;
  /** `group:artifact` for a library, the plugin id for a plugin. */
  coordinate?: string;
  versionRef?: string;
  /** Aliases a `[bundles]` entry lists. */
  bundleMembers?: string[];
  line: number;
  character: number;
  /** Whole-entry extent, so a fix removes a multi-line inline table as a unit. */
  removeStart: number;
  removeEnd: number;
}

export interface Catalog {
  /** Accessor root, `libs` for `gradle/libs.versions.toml`. */
  root: string;
  aliases: CatalogAlias[];
  /**
   * True when a line inside a known section could not be read. The catalog
   * then proves nothing: a misparse could report a live alias as dead.
   */
  unparsed: boolean;
}

const SECTION_RE = /^\[([A-Za-z0-9_-]+)\]\s*$/;
const KNOWN_SECTIONS = new Set<CatalogNamespace>(['libraries', 'plugins', 'bundles', 'versions']);

/** Splits an alias the way Gradle does when building an accessor. */
export function aliasSegments(alias: string): string[] {
  return alias.split(/[-_.]/).filter(Boolean);
}

/**
 * Cuts a line at its first `#` that sits outside a string.
 *
 * Needed for real catalogs: a comment can hold anything, including the name of
 * another alias, and a comment is never a reference.
 */
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inString = !inString;
    else if (ch === '#' && !inString) return line.slice(0, i);
  }
  return line;
}

/** Reads `module`, `group`+`name`, or the `"g:a:v"` shorthand. */
function coordinateOf(value: string): string | undefined {
  const module = /\bmodule\s*=\s*"([^"]+)"/.exec(value)?.[1];
  if (module) return module;

  const group = /\bgroup\s*=\s*"([^"]+)"/.exec(value)?.[1];
  const name = /\bname\s*=\s*"([^"]+)"/.exec(value)?.[1];
  if (group && name) return `${group}:${name}`;

  const shorthand = /^"([^:"]+):([^:"]+)(?::[^"]*)?"/.exec(value.trim());
  if (shorthand) return `${shorthand[1]}:${shorthand[2]}`;
  return undefined;
}

/**
 * Parses a catalog file.
 *
 * `root` is the accessor prefix, which the CALLER must resolve: it comes from
 * the file name by default, but `settings.gradle.kts` can rename it, and a
 * scan hardcoded on `libs.` would then report every alias as dead at once.
 */
export function parseCatalog(text: string, root = 'libs'): Catalog {
  const catalog: Catalog = { root, aliases: [], unparsed: false };
  const lines = text.split('\n');

  // Offsets of each line start, so an entry can carry a removable extent.
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);

  let section: CatalogNamespace | '' = '';
  let inUnknownSection = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripComment(rawLine).trim();
    if (line === '') continue;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1] as CatalogNamespace;
      inUnknownSection = !KNOWN_SECTIONS.has(name);
      section = inUnknownSection ? '' : name;
      continue;
    }
    if (inUnknownSection || section === '') continue;

    const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!entry) {
      catalog.unparsed = true;
      continue;
    }

    const alias = entry[1];
    let value = entry[2];
    let lastLine = i;

    // TOML 1.0 forbids a multi-line inline table, but real catalogs contain
    // them. Reading only the first line would misparse the entry, and a
    // misparse can turn a live alias into a finding.
    const opens = (s: string, o: string, c: string) =>
      (s.split(o).length - 1) - (s.split(c).length - 1);
    let braces = opens(value, '{', '}');
    let brackets = opens(value, '[', ']');
    while ((braces > 0 || brackets > 0) && lastLine + 1 < lines.length) {
      lastLine++;
      const next = stripComment(lines[lastLine]);
      value += ` ${next.trim()}`;
      braces += opens(next, '{', '}');
      brackets += opens(next, '[', ']');
    }
    if (braces > 0 || brackets > 0) {
      catalog.unparsed = true;
      continue;
    }

    const start = lineStarts[i];
    const end = lastLine + 1 < lineStarts.length ? lineStarts[lastLine + 1] : text.length;
    const character = rawLine.indexOf(alias);
    // The continuation lines belong to this entry. Without advancing, the outer
    // loop reads them as entries of their own, fails to parse them, and marks
    // the whole catalog unparsed.
    i = lastLine;

    const common = {
      raw: alias,
      segments: aliasSegments(alias),
      line: i,
      character: character < 0 ? 0 : character,
      removeStart: start,
      removeEnd: end,
      versionRef: /\bversion\.ref\s*=\s*"([^"]+)"/.exec(value)?.[1],
    };

    if (section === 'versions') {
      catalog.aliases.push({ ...common, namespace: 'versions', versionRef: undefined });
      continue;
    }
    if (section === 'bundles') {
      const list = /\[([\s\S]*)\]/.exec(value)?.[1] ?? '';
      const members = [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      catalog.aliases.push({ ...common, namespace: 'bundles', bundleMembers: members });
      continue;
    }

    // libraries and plugins
    const coordinate = section === 'plugins'
      ? /\bid\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? /^"([^":]+)"/.exec(value.trim())?.[1]
      : coordinateOf(value);
    if (!coordinate) {
      catalog.unparsed = true;
      continue;
    }
    catalog.aliases.push({ ...common, namespace: section, coordinate });
  }

  return catalog;
}

/**
 * Finds the alias a type-safe accessor resolves to.
 *
 * The match is SEGMENT BY SEGMENT and longest first. `libs.androidx.browser.get()`
 * has to resolve to `androidx-browser`, and when `foo` and `foo-bar` both exist
 * `libs.foo.bar` must resolve to `foo-bar` alone: a plain `startsWith` would
 * keep `foo` alive too and quietly drop a real finding.
 */
export function resolveAccessor(
  aliases: readonly CatalogAlias[],
  namespace: CatalogNamespace,
  accessorSegments: readonly string[],
): CatalogAlias | undefined {
  let best: CatalogAlias | undefined;
  for (const alias of aliases) {
    if (alias.namespace !== namespace) continue;
    if (alias.segments.length > accessorSegments.length) continue;
    if (alias.segments.some((s, i) => s !== accessorSegments[i])) continue;
    if (!best || alias.segments.length > best.segments.length) best = alias;
  }
  return best;
}

interface ParsedCatalog { entries: Map<string, CatalogEntry>; catalog: Catalog; projectDir: string }

const EMPTY_CATALOG: Catalog = { root: 'libs', aliases: [], unparsed: false };

export class VersionCatalogIndex {
  // One catalog per libs.versions.toml. A single in-memory catalog meant
  // that in a multi-root workspace the last file read won and a delete of
  // any toml emptied everything.
  private readonly catalogs = new Map<string, ParsedCatalog>();

  private primary(): ParsedCatalog | undefined {
    return this.catalogs.values().next().value;
  }

  removeFile(key: string): void {
    this.catalogs.delete(key);
  }

  /** `key` is the toml's uri (or path); omitted, the catalog is the workspace's only one. */
  reindexFile(content: string, key = ''): void {
    const catalog = parseCatalog(content);
    const entries = new Map<string, CatalogEntry>();

    const versions = new Map<string, string>();
    for (const a of catalog.aliases) {
      if (a.namespace === 'versions') {
        versions.set(a.raw, /"([^"]+)"/.exec(content.slice(a.removeStart, a.removeEnd))?.[1] ?? '?');
      }
    }

    for (const a of catalog.aliases) {
      if (a.namespace !== 'libraries' || !a.coordinate) continue;
      const [group, name] = a.coordinate.split(':');
      const entryText = content.slice(a.removeStart, a.removeEnd);
      // `version = "x"` in an inline table, or the third field of the
      // `"group:artifact:version"` shorthand.
      const literal = /(?<!\.)\bversion\s*=\s*"([^"]+)"/.exec(entryText)?.[1]
        ?? /=\s*"[^:"]+:[^:"]+:([^"]+)"/.exec(entryText)?.[1];
      const version = a.versionRef
        ? (versions.get(a.versionRef) ?? a.versionRef)
        : (literal ?? '?');
      entries.set(a.raw, { group, name, version, alias: a.raw });
    }

    // `<project>/gradle/libs.versions.toml`: the project dir is two levels up.
    const projectDir = key.replace(/^file:\/\//, '').replace(/[\\/]gradle[\\/][^\\/]+$/, '');
    this.catalogs.set(key, { entries, catalog, projectDir });
  }

  /**
   * The catalog that applies to a build file: the one whose project dir is
   * the longest prefix of `contextPath`; with a single catalog, that one.
   */
  private catalogFor(contextPath?: string): ParsedCatalog | undefined {
    if (this.catalogs.size <= 1 || !contextPath) return this.primary();
    let best: ParsedCatalog | undefined;
    for (const c of this.catalogs.values()) {
      const dir = c.projectDir;
      if (!dir) continue;
      const inside = contextPath.startsWith(dir + '/') || contextPath.startsWith(dir + '\\');
      if (inside && (!best || dir.length > best.projectDir.length)) best = c;
    }
    return best ?? this.primary();
  }

  /** The parsed catalog, for callers that need aliases rather than coordinates. */
  parsed(): Catalog {
    return this.primary()?.catalog ?? EMPTY_CATALOG;
  }

  /**
   * `accessor` is what follows `libs.`, e.g. `compose.ui`.
   *
   * Split on the same separators as an alias: callers pass the dotted accessor
   * (`coroutines.core`) or the raw alias (`coroutines-core`) interchangeably,
   * and Gradle considers the two identical. `contextPath` is the build file
   * asking, so a multi-root workspace reads its own project's catalog.
   */
  getByAccessor(accessor: string, contextPath?: string): CatalogEntry | undefined {
    const c = this.catalogFor(contextPath);
    if (!c) return undefined;
    const alias = resolveAccessor(c.catalog.aliases, 'libraries', aliasSegments(accessor));
    return alias ? c.entries.get(alias.raw) : undefined;
  }
}
