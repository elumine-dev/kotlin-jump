import {
  Catalog,
  CatalogAlias,
  CatalogNamespace,
  aliasSegments,
  parseCatalog,
  resolveAccessor,
} from '../indexer/VersionCatalogIndex';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { stripKotlinComments } from '../util/xmlRefs';

/**
 * KJ-041: version catalog aliases no build file ever references.
 *
 * This is the first check that reads the BUILD rather than the code. A
 * declared dependency nothing uses costs compile time, APK size and security
 * surface, and Gradle never mentions it.
 *
 * ## Why only the catalog, and not "declared but never imported"
 *
 * The obvious detector is "this module declares a dependency it never
 * imports". It cannot be made safe textually, and one measurement settles it:
 * `com.jakewharton.threetenabp` ships a single package holding `AndroidThreeTen`,
 * imported by 2 modules, while 27 others use `org.threeten.bp.*` coming from a
 * TRANSITIVE. Reporting those 27 and acting on the report removes
 * `org.threeten.bp` from their compile classpath. The build breaks, and no
 * amount of guard tuning changes that a coordinate does not tell you which
 * packages it brings.
 *
 * The catalog level has no such problem, because it never reasons about
 * packages at all: either the alias name appears in a build file, or it does
 * not. That is a textual fact, and it is the whole detector.
 *
 * ## What counts as referencing an alias
 *
 * A type-safe accessor (`libs.androidx.browser`), a lookup by string
 * (`findLibrary("androidx-browser")`), or membership of a live bundle. Matching
 * is segment by segment and longest first, so `libs.foo.bar` keeps `foo-bar`
 * alive without keeping `foo` alive as well.
 */

export interface GradleSource {
  path: string;
  text: string;
}

export interface UnusedGradleDependencyScanInput {
  sources: readonly GradleSource[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** Alias names, globs allowed, never reported. */
  ignoreNames?: readonly string[];
}

export interface UnusedCatalogAlias {
  name: string;
  namespace: CatalogNamespace;
  /** `group:artifact`, or the plugin id. */
  coordinate?: string;
  path: string;
  line: number;
  character: number;
  removeStart: number;
  removeEnd: number;
  /**
   * The `[versions]` entry that dies with it, when nothing else references it.
   * Offered in the same edit: a version left behind is not an error, but a
   * separate finding for it would be noise.
   */
  orphanedVersion?: { name: string; removeStart: number; removeEnd: number };
}

/** One line per declared alias, saying what happened to it. For `--why`. */
export interface CatalogAliasExplanation {
  name: string;
  namespace: CatalogNamespace;
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unused-gradle-dependency';

/**
 * `buildSrc` and `build-logic` are excluded as SITES OF REPORTING, never as
 * SOURCES OF READING.
 *
 * A convention plugin often is the only thing referencing an alias, usually
 * through `findLibrary("…")`. Dropping those files from the read would turn
 * every such alias into a finding, which is the first cause of false "dead
 * alias" reports. Whoever narrows the glob later must see this sentence.
 */
function isConventionPluginPath(path: string): boolean {
  return /(?:^|[\\/])(?:buildSrc|build-logic)[\\/]/.test(path);
}


/**
 * Files that can reference an alias.
 *
 * Build scripts, plus any Kotlin or Java under `buildSrc`/`build-logic`: a
 * convention plugin is ordinary Kotlin, and it is very often the ONLY thing
 * naming an alias, through `findLibrary("…")`.
 */
function canReferenceAlias(path: string): boolean {
  return /(?:\.gradle|\.gradle\.kts|\.kts)$/.test(path)
    || (isConventionPluginPath(path) && /\.(kt|java)$/.test(path));
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
    // is the created name, not the file name.
    for (let i = 0; i < created.length; i++) {
      if (froms.some(f => f.endsWith(fileName))) return created[i];
    }
    if (created.length > 0 && froms.length === 0 && created[0] !== fromName) {
      // Renamed without an explicit `from`: Gradle still maps the default file.
      if (fromName === 'libs') return created[0];
    }
  }
  return fromName;
}

function matchesGlob(name: string, pattern: string): boolean {
  const re = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');
  return re.test(name);
}

interface Reference {
  namespace: CatalogNamespace;
  segments: string[];
}

/**
 * Every accessor and string lookup a build file performs, in one pass.
 *
 * Comments are stripped: a commented-out `implementation(libs.x)` is exactly
 * the case worth reporting.
 */
export function collectAliasReferences(
  sources: readonly GradleSource[],
  roots: ReadonlySet<string>,
): { refs: Reference[]; byName: Set<string> } {
  const refs: Reference[] = [];
  const byName = new Set<string>();
  if (roots.size === 0) return { refs, byName };

  const rootAlternatives = [...roots].map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const accessorRe = new RegExp(`\\b(?:${rootAlternatives})((?:\\.[A-Za-z0-9_]+)+)`, 'g');
  const lookupRe = /\bfind(Library|Plugin|Version|Bundle)\s*\(\s*"([^"]+)"/g;

  for (const src of sources) {
    if (!canReferenceAlias(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const text = stripKotlinComments(src.text);

    accessorRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = accessorRe.exec(text)) !== null) {
      const segments = m[1].split('.').filter(Boolean);
      const head = segments[0];
      const namespace: CatalogNamespace =
        head === 'versions' ? 'versions'
          : head === 'plugins' ? 'plugins'
            : head === 'bundles' ? 'bundles'
              : 'libraries';
      refs.push({
        namespace,
        segments: namespace === 'libraries' ? segments : segments.slice(1),
      });
    }

    lookupRe.lastIndex = 0;
    while ((m = lookupRe.exec(text)) !== null) byName.add(m[2]);
  }

  return { refs, byName };
}

/** Catalog files of the corpus, with their accessor root resolved. */
export function collectCatalogs(
  sources: readonly GradleSource[],
): { path: string; catalog: Catalog; text: string }[] {
  const settingsTexts = sources
    .filter(s => /(?:^|[\\/])settings\.gradle(?:\.kts)?$/.test(s.path))
    .map(s => s.text);

  const out: { path: string; catalog: Catalog; text: string }[] = [];
  for (const src of sources) {
    if (!/\.versions\.toml$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    if (isGeneratedSource(src.text)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;
    const root = catalogRootOf(src.path, settingsTexts);
    if (!root) continue;                                              // G17
    out.push({ path: src.path, catalog: parseCatalog(src.text, root), text: src.text });
  }
  return out;
}

interface Liveness {
  live: Set<string>;
  aliasesByKey: Map<string, CatalogAlias>;
}

/** Which aliases something references, directly or through a live bundle. */
function computeLiveness(
  catalog: Catalog,
  refs: readonly Reference[],
  byName: ReadonlySet<string>,
): Liveness {
  const key = (a: CatalogAlias) => `${a.namespace}:${a.raw}`;
  const aliasesByKey = new Map(catalog.aliases.map(a => [key(a), a]));
  const live = new Set<string>();

  for (const ref of refs) {
    const alias = resolveAccessor(catalog.aliases, ref.namespace, ref.segments);
    if (alias) live.add(key(alias));
  }
  for (const name of byName) {
    const segments = aliasSegments(name);
    for (const ns of ['libraries', 'plugins', 'versions', 'bundles'] as CatalogNamespace[]) {
      const alias = resolveAccessor(catalog.aliases, ns, segments);
      if (alias && alias.segments.length === segments.length) live.add(key(alias));
    }
  }

  // G16: a member of a live bundle stays alive. Removing it breaks the bundle,
  // therefore the build.
  for (const alias of catalog.aliases) {
    if (alias.namespace !== 'bundles' || !live.has(key(alias))) continue;
    for (const member of alias.bundleMembers ?? []) {
      const target = resolveAccessor(catalog.aliases, 'libraries', aliasSegments(member));
      if (target) live.add(key(target));
    }
  }

  // A `[versions]` entry referenced by a LIVE library is alive. One referenced
  // only by dead libraries dies with them, as a cascade rather than a finding.
  for (const alias of catalog.aliases) {
    if (alias.namespace === 'versions' || !alias.versionRef) continue;
    if (!live.has(key(alias))) continue;
    const version = catalog.aliases.find(
      a => a.namespace === 'versions' && a.raw === alias.versionRef);
    if (version) live.add(key(version));
  }

  return { live, aliasesByKey };
}

export function findUnusedGradleDependencies(
  input: UnusedGradleDependencyScanInput,
): UnusedCatalogAlias[] {
  if (input.truncated) return [];                                     // G1

  const catalogs = collectCatalogs(input.sources);
  if (catalogs.length === 0) return [];

  const roots = new Set(catalogs.map(c => c.catalog.root));
  const readable = input.sources.filter(s => !isBuildArtifactPath(s.path));
  const { refs, byName } = collectAliasReferences(readable, roots);
  const ignored = input.ignoreNames ?? [];

  const out: UnusedCatalogAlias[] = [];
  for (const { path, catalog } of catalogs) {
    if (catalog.unparsed) continue;                                   // G17
    const { live } = computeLiveness(catalog, refs, byName);

    for (const alias of catalog.aliases) {
      // A `[versions]` entry is never reported on its own: it is either alive,
      // or it rides along with the library that referenced it.
      if (alias.namespace === 'versions') continue;
      if (live.has(`${alias.namespace}:${alias.raw}`)) continue;
      if (ignored.some(p => matchesGlob(alias.raw, p))) continue;     // G15

      out.push({
        name: alias.raw,
        namespace: alias.namespace,
        coordinate: alias.coordinate,
        path,
        line: alias.line,
        character: alias.character,
        removeStart: alias.removeStart,
        removeEnd: alias.removeEnd,
        orphanedVersion: orphanedVersionOf(catalog, alias, live),
      });
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * The `[versions]` entry that dies with this alias, if any.
 *
 * Only when EVERY entry referencing that version is itself dead. A version
 * shared by three libraries of which one dies is never touched.
 */
function orphanedVersionOf(
  catalog: Catalog,
  alias: CatalogAlias,
  live: ReadonlySet<string>,
): UnusedCatalogAlias['orphanedVersion'] {
  if (!alias.versionRef) return undefined;
  const version = catalog.aliases.find(
    a => a.namespace === 'versions' && a.raw === alias.versionRef);
  if (!version) return undefined;
  if (live.has(`versions:${version.raw}`)) return undefined;

  const others = catalog.aliases.filter(
    a => a.versionRef === alias.versionRef && a.raw !== alias.raw);
  if (others.some(o => live.has(`${o.namespace}:${o.raw}`))) return undefined;

  return { name: version.raw, removeStart: version.removeStart, removeEnd: version.removeEnd };
}

export function explainGradleDependencies(
  input: UnusedGradleDependencyScanInput,
): CatalogAliasExplanation[] {
  const catalogs = collectCatalogs(input.sources);
  const roots = new Set(catalogs.map(c => c.catalog.root));
  const readable = input.sources.filter(s => !isBuildArtifactPath(s.path));
  const { refs, byName } = collectAliasReferences(readable, roots);

  const out: CatalogAliasExplanation[] = [];
  for (const { catalog } of catalogs) {
    if (catalog.unparsed) {
      out.push({ name: '(catalog)', namespace: 'libraries', outcome: 'G17:unparsed' });
      continue;
    }
    const { live } = computeLiveness(catalog, refs, byName);
    for (const alias of catalog.aliases) {
      const outcome = live.has(`${alias.namespace}:${alias.raw}`) ? 'alive'
        : alias.namespace === 'versions' ? 'cascade-candidate'
          : 'unreferenced';
      out.push({ name: alias.raw, namespace: alias.namespace, outcome });
    }
  }
  return out;
}

export function messageFor(alias: UnusedCatalogAlias): string {
  const what = alias.namespace === 'plugins' ? 'Plugin alias' : 'Catalog alias';
  const coordinate = alias.coordinate ? ` (${alias.coordinate})` : '';
  return `${what} '${alias.name}'${coordinate} is never referenced by any build file`;
}

export function deleteTitleFor(alias: UnusedCatalogAlias): string {
  return alias.orphanedVersion
    ? `Delete unused alias ${alias.name} and its version ${alias.orphanedVersion.name}`
    : `Delete unused alias ${alias.name}`;
}

/** Marker exported so the provider and the tests agree on its spelling. */
export { IGNORE_MARKER, isConventionPluginPath };
