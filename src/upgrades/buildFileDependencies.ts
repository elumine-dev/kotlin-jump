import type { Dependency, DependencySource, LiteralKind, PinKind } from './model';
import { blankGradleComments } from './repositories';

/**
 * Versions written in build and settings files (KJ-082).
 *
 * A catalog is not the only place a version lives: `implementation("g:a:v")`,
 * `classpath 'g:a:v'`, `id("x") version "y"` and `kotlin("jvm") version "y"`
 * carry literals the catalog never sees. Each becomes a dependency whose
 * version site is the bare version in the ORIGINAL text. Matching runs on a
 * copy with comments blanked and offsets kept, so a commented out line
 * yields nothing and a line below a long comment keeps its true position.
 */

const CONFIGURATIONS = [
  'implementation', 'api', 'compileOnly', 'compileOnlyApi', 'runtimeOnly',
  'testImplementation', 'testCompileOnly', 'testRuntimeOnly',
  'androidTestImplementation', 'androidTestRuntimeOnly', 'debugImplementation', 'releaseImplementation',
  'kapt', 'kaptTest', 'kaptAndroidTest', 'ksp', 'kspTest', 'annotationProcessor',
  'classpath', 'detektPlugins', 'coreLibraryDesugaring', 'lintChecks', 'lintPublish', 'errorprone',
].join('|');

/** `implementation("g:a:v")`, `implementation 'g:a:v'`, `implementation(platform("g:a:v"))`. */
const COORDINATE_RE = new RegExp(
  `(?<![\\w.])(?:${CONFIGURATIONS})\\s*\\(?\\s*(?:(?:platform|enforcedPlatform|testFixtures)\\s*\\(\\s*)?(["'])([^"'\\n]+)\\1`, 'g');

/** `id("x") version "y"`, `id 'x' version 'y'`, `kotlin("jvm") version "y"`, `id("x").version("y")`. */
const PLUGIN_RE = /(?<![\w.])(id|kotlin)\s*\(?\s*(["'])([^"'\n]+)\2\s*\)?\s*(?:version\s+|\.version\s*\(\s*)(["'])([^"'\n]+)\4/g;

const AGP_COORDINATE = 'com.android.tools.build:gradle';
const PIN_RE = /\/\/\s*@pin\b/;
const MARKER_RE = /kotlin-jump:ignore\s+dependency-upgrade\b/;

function literalKind(version: string): LiteralKind {
  if (version.includes('$')) return 'templated';
  if (/\+$/.test(version) || /^latest\./.test(version)) return 'dynamic';
  if (/^[[\]( ]/.test(version)) return 'range';
  if (/^[0-9][A-Za-z0-9.\-+_]*$/.test(version)) return 'exact';
  return 'templated';
}

function lineOf(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** `// @pin` on the line, or a comment line above carrying the pin or the ignore marker. */
function pinAt(text: string, offset: number): PinKind | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const previousStart = lineStart === 0 ? -1 : text.lastIndexOf('\n', lineStart - 2) + 1;
  const previous = previousStart === -1 ? '' : text.slice(previousStart, lineStart - 1).trim();
  const above = previous.startsWith('//') ? previous : '';
  if (MARKER_RE.test(line) || MARKER_RE.test(above)) return 'ignore-marker';
  if (PIN_RE.test(line) || PIN_RE.test(above)) return 'pin-comment';
  return undefined;
}

/** The plugin id a `plugins { }` line names: `kotlin("jvm")` is `org.jetbrains.kotlin.jvm`. */
function pluginId(keyword: string, name: string): string {
  return keyword === 'kotlin' ? `org.jetbrains.kotlin.${name}` : name;
}

class Keys {
  private readonly seen = new Map<string, number>();
  /** `#n` on a repeat, so two configurations of one coordinate stay apart. */
  of(base: string): string {
    const n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  }
}

/**
 * Every version literal of a build or settings file. A `$` makes a literal
 * templated and leaves it without a version site; a trailing `+` is dynamic
 * and keeps its site so a pin can rewrite it; a two part coordinate has no
 * version, a BOM or a platform supplies it.
 */
export function collectBuildFileDependencies(text: string, path: string, kind: 'build' | 'settings'): Dependency[] {
  const clean = blankGradleComments(text);
  const keys = new Keys();
  const found: { at: number; dep: Dependency }[] = [];

  for (const m of clean.matchAll(COORDINATE_RE)) {
    const literal = m[2];
    const parts = literal.split(':');
    if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) continue;
    const quoteAt = (m.index ?? 0) + m[0].lastIndexOf(m[1] + literal);
    const literalStart = quoteAt + 1;
    const [group, artifact] = parts;
    const version = parts.length >= 3 ? parts[2].replace(/@.*$/, '') : undefined;
    const isAgp = `${group}:${artifact}` === AGP_COORDINATE;
    const literalKindOf = version === undefined ? 'none' : literalKind(version);
    const versionStart = literalStart + group.length + 1 + artifact.length + 1;
    const dep: Dependency = {
      kind: isAgp ? 'agp' : 'library',
      key: keys.of(isAgp ? 'agp' : `library:${group}:${artifact}`),
      members: [{ group, artifact }],
      group,
      artifact,
      literal: literalKindOf,
      range: { file: path, start: quoteAt, end: quoteAt + literal.length + 2 },
      line: lineOf(text, quoteAt),
      source: 'build-literal',
      name: `${group}:${artifact}`,
      sharedBy: [],
    };
    if (version !== undefined) dep.currentVersion = version;
    if (version !== undefined && (literalKindOf === 'exact' || literalKindOf === 'dynamic')) {
      dep.versionSite = { file: path, start: versionStart, end: versionStart + version.length, text: version };
    }
    const pin = pinAt(text, quoteAt);
    if (pin) dep.pin = pin;
    found.push({ at: quoteAt, dep });
  }

  const pluginSource: DependencySource = kind === 'settings' ? 'settings-plugin' : 'build-plugin';
  for (const m of clean.matchAll(PLUGIN_RE)) {
    const id = pluginId(m[1], m[3]);
    const version = m[5];
    const quoteAt = (m.index ?? 0) + m[0].lastIndexOf(m[4] + version);
    const isAgp = id.startsWith('com.android.');
    const literalKindOf = literalKind(version);
    const dep: Dependency = {
      kind: isAgp ? 'agp' : 'plugin',
      key: keys.of(isAgp ? 'agp' : `plugin:${id}`),
      members: [{ group: id, artifact: `${id}.gradle.plugin` }],
      group: id,
      artifact: `${id}.gradle.plugin`,
      currentVersion: version,
      literal: literalKindOf,
      range: { file: path, start: quoteAt, end: quoteAt + version.length + 2 },
      line: lineOf(text, quoteAt),
      source: pluginSource,
      name: id,
      sharedBy: [],
    };
    if (literalKindOf === 'exact' || literalKindOf === 'dynamic') {
      dep.versionSite = { file: path, start: quoteAt + 1, end: quoteAt + 1 + version.length, text: version };
    }
    const pin = pinAt(text, quoteAt);
    if (pin) dep.pin = pin;
    found.push({ at: quoteAt, dep });
  }

  return found.sort((a, b) => a.at - b.at).map(f => f.dep);
}
