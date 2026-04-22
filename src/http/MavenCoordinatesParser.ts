/**
 * Parse and represent Maven coordinates (`group:artifact:version`)
 * and convert them to Maven Central download URLs.
 *
 * No network. No JVM. Pure string manipulation.
 */

export interface MavenCoords {
  group:    string;
  artifact: string;
  version:  string;
}

/**
 * Parses a `group:artifact:version` string. Returns `undefined` on
 * malformed input. Trims surrounding whitespace and surrounding
 * quotes (common in build.gradle.kts string interpolation).
 */
export function parseCoords(raw: string): MavenCoords | undefined {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  const parts = cleaned.split(':');
  if (parts.length < 3) return undefined;
  const [group, artifact, version, ...rest] = parts;
  if (!group || !artifact || !version) return undefined;
  // Reject coords with a classifier ('group:artifact:version:classifier@type')
  // — we only want the canonical sources artifact.
  if (rest.length > 0) return undefined;
  return { group: group.trim(), artifact: artifact.trim(), version: version.trim() };
}

/**
 * Builds the Maven Central URL for the `-sources.jar` of a coordinate.
 * Maven Central layout: `<repo>/<group_with_slashes>/<artifact>/<version>/<artifact>-<version>-sources.jar`
 */
export function sourcesJarUrl(
  coords: MavenCoords,
  repo: string = 'https://repo.maven.apache.org/maven2',
): string {
  const groupPath = coords.group.replace(/\./g, '/');
  return `${repo}/${groupPath}/${coords.artifact}/${coords.version}/${coords.artifact}-${coords.version}-sources.jar`;
}

/**
 * Builds the matching SHA1 URL — used to verify the downloaded JAR
 * is intact. Maven Central publishes a `.sha1` file beside every
 * artifact (40-hex-char checksum).
 */
export function sourcesJarSha1Url(
  coords: MavenCoords,
  repo: string = 'https://repo.maven.apache.org/maven2',
): string {
  return `${sourcesJarUrl(coords, repo)}.sha1`;
}

/**
 * Computes the local cache path matching Gradle's layout. By writing
 * downloaded JARs there, the existing `GradleSourcesScanner` picks
 * them up on next scan — no separate "HTTP cache" to maintain.
 *
 * Layout: `<gradleCache>/<group>/<artifact>/<version>/<sha1>/<artifact>-<version>-sources.jar`
 *
 * The `<sha1>` directory mirrors Gradle's behavior — it uses the
 * SHA1 of the artifact as the directory name. We use the sha1
 * computed from the downloaded bytes.
 */
export function gradleCachePath(
  coords: MavenCoords,
  gradleCacheRoot: string,
  sha1: string,
): string {
  return [
    gradleCacheRoot,
    coords.group,
    coords.artifact,
    coords.version,
    sha1,
    `${coords.artifact}-${coords.version}-sources.jar`,
  ].join('/');
}

/**
 * Format coords as a human-readable string for UI / logs.
 *   `{ group: "androidx.compose.material", artifact: "material", version: "1.6.2" }`
 *   → `"androidx.compose.material:material:1.6.2"`
 */
export function formatCoords(coords: MavenCoords): string {
  return `${coords.group}:${coords.artifact}:${coords.version}`;
}

/**
 * Two coords are equal if their group + artifact + version all match.
 * Used to deduplicate when multiple parsers extract the same dep.
 */
export function coordsEqual(a: MavenCoords, b: MavenCoords): boolean {
  return a.group === b.group && a.artifact === b.artifact && a.version === b.version;
}
