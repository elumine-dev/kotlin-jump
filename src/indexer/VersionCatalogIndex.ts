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
    // Counted outside strings: `strictly = "[4.0, 5.0["` (the Gradle doc's
    // own example) swallowed the rest of the file and flagged it unparsed.
    const opens = (s: string, o: string, c: string) => {
      let n = 0, inStr = false;
      for (let k = 0; k < s.length; k++) {
        const ch = s[k];
        if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === o) n++; else if (ch === c) n--;
      }
      return n;
    };
    const firstLine = i;
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
      // The alias line, not the `}` closing a multi-line entry: the
      // diagnostic sat on the brace and the quick fix never found the name.
      line: firstLine,
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

interface ParsedCatalog {
  entries: Map<string, CatalogEntry>;
  catalog: Catalog;
  projectDir: string;
  key: string;
  /** Full URI of the catalog file, scheme included. */
  uri: string;
  /** `[versions]` alias to its literal, so a `version.ref` can be resolved. */
  versions: Map<string, string>;
}

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

  /**
   * `key` is the toml's path, used to match a build file to its catalog;
   * omitted, the catalog is the workspace's only one. `uriString` is how a
   * caller reaches that file again: on vscode.dev the document scheme is
   * `vscode-vfs` and `fsPath` keeps only the path, so rebuilding a `file://`
   * from the key pointed at a file the web host does not have.
   */
  reindexFile(content: string, key = '', uriString = key): void {
    // La racine vient du NOM du fichier : `deps.versions.toml` se lit
    // `deps.x`. On passait ici sans racine, donc tout catalogue renomme
    // repondait `libs`, et le Ctrl+clic depuis un build file ne trouvait
    // jamais son accesseur. Un nom que Gradle ne reconnait pas rend
    // `undefined`, et le `root = 'libs'` de parseCatalog le rattrape.
    const catalog = parseCatalog(content, catalogRootOf(key || uriString, []));
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
    this.catalogs.set(key, { entries, catalog, projectDir, key, uri: uriString, versions });
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

  /** Accessor root of the catalog a build file reads, `libs` unless renamed. */
  rootFor(contextPath?: string): string {
    return this.catalogFor(contextPath)?.catalog.root ?? 'libs';
  }

  /**
   * One line describing what an accessor resolves to, for the hover.
   *
   * A library keeps the exact `group:name:version` it has always shown. The
   * other three namespaces showed nothing at all, which read as "this accessor
   * is unknown" on a line that Gradle resolves perfectly well.
   */
  describeAccessor(accessor: string, contextPath?: string): string | undefined {
    const c = this.catalogFor(contextPath);
    const hit = this.locate(accessor, contextPath);
    if (!c || !hit) return undefined;
    const { alias } = hit;
    const version = alias.versionRef ? c.versions.get(alias.versionRef) : undefined;
    switch (alias.namespace) {
      case 'libraries': {
        const e = c.entries.get(alias.raw);
        return e ? `${e.group}:${e.name}:${e.version}` : undefined;
      }
      case 'plugins':
        return alias.coordinate ? `${alias.coordinate}:${version ?? alias.versionRef ?? '?'}` : undefined;
      case 'versions':
        return c.versions.get(alias.raw);
      case 'bundles':
        return alias.bundleMembers?.length ? alias.bundleMembers.join(', ') : undefined;
    }
  }

  /**
   * Where an accessor is declared: the alias and the catalog file holding it.
   *
   * The first segment picks the namespace the way Gradle does, so
   * `plugins.android.library` looks under `[plugins]` for `android-library`
   * and never under `[libraries]`. A name that resolves nowhere as a
   * namespaced accessor is retried as a plain library, which is what an alias
   * literally called `versions-something` needs.
   */
  locate(accessor: string, contextPath?: string): { alias: CatalogAlias; file: string } | undefined {
    const c = this.catalogFor(contextPath);
    if (!c) return undefined;
    const segments = aliasSegments(accessor);
    if (segments.length === 0) return undefined;
    const head = segments[0];
    const namespaced: CatalogNamespace | undefined =
      head === 'plugins' ? 'plugins' : head === 'bundles' ? 'bundles' : head === 'versions' ? 'versions' : undefined;
    const alias = (namespaced && segments.length > 1
      ? resolveAccessor(c.catalog.aliases, namespaced, segments.slice(1))
      : undefined)
      ?? resolveAccessor(c.catalog.aliases, 'libraries', segments);
    return alias ? { alias, file: c.uri } : undefined;
  }
}

/**
 * Reads the accessor root a catalog is exposed under.
 *
 * `gradle/libs.versions.toml` gives `libs`, but `settings.gradle.kts` can
 * rename it with `versionCatalogs { create("deps") }`. A scan hardcoded on
 * `libs.` would then find no reference at all and report every alias as dead,
 * which is the loudest possible false positive.
 */
export function catalogRootOf(path: string, settingsTexts: readonly string[]): string | undefined {
  const fileName = path.split(/[\\/]/).pop() ?? '';
  const fromName = /^(.+)\.versions\.toml$/.exec(fileName)?.[1];
  if (!fromName) return undefined;

  for (const settings of settingsTexts) {
    if (!settings.includes('versionCatalogs')) continue;
    // A catalog built in Kotlin rather than declared in TOML: we cannot know
    // its aliases, so the caller must stay silent.
    if (/versionCatalogs\s*\{[\s\S]{0,400}?\blibrary\s*\(/.test(settings)) return undefined;
    const created = [...settings.matchAll(/create\s*\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
    const froms = [...settings.matchAll(/from\s*\(\s*files\s*\(\s*"([^"]+)"/g)].map(m => m[1]);
    // `create("deps") { from(files("gradle/libs.versions.toml")) }`: the root
    // is the created name, not the file name. Each block is read on its own:
    // with two catalogs, every file used to map to the first `create`.
    for (const block of settings.matchAll(/create\s*\(\s*"([^"]+)"\s*\)\s*\{([^}]*)\}/g)) {
      const from = /from\s*\(\s*files\s*\(\s*"([^"]+)"/.exec(block[2])?.[1];
      if (from && (from === fileName || from.endsWith('/' + fileName))) return block[1];
    }
    if (froms.some(f => f === fileName || f.endsWith('/' + fileName))) {
      // A `from` naming this file outside a readable block: unknown root.
      return created.length === 1 ? created[0] : undefined;
    }
    if (created.length > 0 && froms.length === 0 && created[0] !== fromName) {
      // Renamed without an explicit `from`: Gradle still maps the default file.
      if (fromName === 'libs') return created[0];
    }
  }
  return fromName;
}
