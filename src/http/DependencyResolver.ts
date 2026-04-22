import * as fs from 'fs/promises';
import * as path from 'path';
import { MavenCoords, parseCoords, coordsEqual } from './MavenCoordinatesParser';

/**
 * Walks the workspace to find dependency declarations and extracts
 * Maven coordinates. Supports three formats:
 *
 *   1. `build.gradle.kts` / `build.gradle` — Kotlin DSL or Groovy
 *      Patterns:
 *        implementation("group:artifact:version")
 *        implementation 'group:artifact:version'
 *        implementation(libs.foo)            // resolves via libs.versions.toml
 *
 *   2. `pom.xml` — Maven XML
 *      <dependency>
 *        <groupId>...</groupId>
 *        <artifactId>...</artifactId>
 *        <version>...</version>
 *      </dependency>
 *
 *   3. `gradle/libs.versions.toml` — Gradle Version Catalog
 *      [libraries]
 *      retrofit = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
 *
 *      [versions]
 *      retrofit = "2.9.0"
 *
 * Pure parsing — no network, no JVM, no Gradle/Maven invocation. Best
 * effort: complex Gradle constructs (BOMs, plugins, conditional deps,
 * subprojects { } blocks) may not be fully captured. The trade-off is
 * deliberate: 80 % coverage with zero external process is better than
 * 100 % coverage requiring a JVM invocation.
 */
export class DependencyResolver {
  /**
   * Scans a workspace folder and returns every Maven coord it can
   * extract from the dependency manifests it finds.
   */
  async resolveAll(workspaceRoot: string): Promise<MavenCoords[]> {
    const all: MavenCoords[] = [];

    // Read libs.versions.toml first — its versions table feeds the
    // build.gradle.kts resolution that follows.
    const versionCatalog = await this.readVersionCatalog(workspaceRoot);

    // Walk for build files (max depth 3 to keep it fast on large monorepos).
    const buildFiles = await this.findBuildFiles(workspaceRoot, 3);

    for (const file of buildFiles) {
      try {
        const text = await fs.readFile(file, 'utf8');
        const base = path.basename(file);
        const found = base.endsWith('.gradle.kts') || base.endsWith('.gradle')
          ? this.parseGradle(text, versionCatalog)
          : base === 'pom.xml'
            ? this.parsePom(text)
            : [];
        for (const c of found) {
          if (!all.some(existing => coordsEqual(existing, c))) all.push(c);
        }
      } catch { /* unreadable — skip */ }
    }

    return all;
  }

  /**
   * Recursively finds dependency manifests (build.gradle.kts, build.gradle,
   * pom.xml) up to `maxDepth` levels. Skips `node_modules`, `build`,
   * `.gradle`, and other noise.
   */
  private async findBuildFiles(root: string, maxDepth: number): Promise<string[]> {
    const SKIP = new Set(['node_modules', 'build', '.gradle', '.idea', 'out', 'dist', '.git']);
    const TARGETS = new Set(['build.gradle.kts', 'build.gradle', 'pom.xml']);
    const results: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.isFile() && TARGETS.has(e.name)) results.push(full);
      }
    };
    await walk(root, 0);
    return results;
  }

  /**
   * Reads `gradle/libs.versions.toml` if present and returns a map
   * `libs.alias.path` → `MavenCoords`. Used by `parseGradle` to resolve
   * `implementation(libs.retrofit.core)` style references.
   */
  private async readVersionCatalog(workspaceRoot: string): Promise<Map<string, MavenCoords>> {
    const map = new Map<string, MavenCoords>();
    const tomlPath = path.join(workspaceRoot, 'gradle', 'libs.versions.toml');
    let text: string;
    try { text = await fs.readFile(tomlPath, 'utf8'); }
    catch { return map; }

    // Parse [versions] table.
    const versions = new Map<string, string>();
    const versionsBlock = /\[versions\]([\s\S]*?)(?=\n\[|$)/.exec(text);
    if (versionsBlock) {
      const reLine = /^([a-zA-Z0-9_.-]+)\s*=\s*"([^"]+)"\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = reLine.exec(versionsBlock[1])) !== null) {
        versions.set(m[1], m[2]);
      }
    }

    // Parse [libraries] table.
    const libsBlock = /\[libraries\]([\s\S]*?)(?=\n\[|$)/.exec(text);
    if (!libsBlock) return map;

    // Each line: `alias = { group = "g", name = "a", version.ref = "v" }` or
    //            `alias = { module = "g:a", version = "x.y.z" }` or
    //            `alias = "g:a:x.y.z"` (shorthand)
    const reLine = /^([a-zA-Z0-9_.-]+)\s*=\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = reLine.exec(libsBlock[1])) !== null) {
      const alias = m[1];
      const rhs   = m[2].trim();
      const coords = this.parseLibraryEntry(rhs, versions);
      if (coords) {
        // Convert alias dashes to dots so `compose-ui` becomes `libs.compose.ui`
        // (matches Gradle Version Catalog generated accessor naming).
        const aliasPath = alias.replace(/-/g, '.');
        map.set(`libs.${aliasPath}`, coords);
      }
    }
    return map;
  }

  private parseLibraryEntry(rhs: string, versions: Map<string, string>): MavenCoords | undefined {
    // Shorthand: "group:artifact:version"
    if (rhs.startsWith('"') || rhs.startsWith("'")) {
      const literal = rhs.replace(/^["']|["'].*$/g, '');
      return parseCoords(literal);
    }
    // Object form: { group = "g", name = "a", version[.ref] = "..." }
    const groupM   = /group\s*=\s*"([^"]+)"/.exec(rhs);
    const nameM    = /name\s*=\s*"([^"]+)"/.exec(rhs);
    const moduleM  = /module\s*=\s*"([^"]+)"/.exec(rhs);
    const versionM = /version\s*=\s*"([^"]+)"/.exec(rhs);
    const verRefM  = /version\.ref\s*=\s*"([^"]+)"/.exec(rhs);

    let group: string | undefined;
    let artifact: string | undefined;
    if (moduleM) {
      const parts = moduleM[1].split(':');
      if (parts.length === 2) { group = parts[0]; artifact = parts[1]; }
    } else if (groupM && nameM) {
      group = groupM[1];
      artifact = nameM[1];
    }

    let version: string | undefined;
    if (versionM) version = versionM[1];
    else if (verRefM) version = versions.get(verRefM[1]);

    if (!group || !artifact || !version) return undefined;
    return { group, artifact, version };
  }

  /**
   * Extracts coords from a `build.gradle.kts` or `build.gradle` text.
   * Catches three syntaxes:
   *   - `implementation("g:a:v")`           (Kotlin DSL)
   *   - `implementation 'g:a:v'`            (Groovy DSL)
   *   - `implementation(libs.foo.bar)`     (Version Catalog ref)
   */
  parseGradle(text: string, versionCatalog: Map<string, MavenCoords>): MavenCoords[] {
    const results: MavenCoords[] = [];

    // 1. Direct string literals — works for both Kotlin & Groovy DSL.
    const reDirect = /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|kapt|ksp)\s*[(\s]\s*["']([^"']+:[^"']+:[^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = reDirect.exec(text)) !== null) {
      const c = parseCoords(m[1]);
      if (c) results.push(c);
    }

    // 2. Version Catalog refs — `implementation(libs.foo.bar)`.
    const reCatalog = /\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly)\s*\(\s*(libs\.[a-zA-Z0-9_.]+)\s*\)/g;
    while ((m = reCatalog.exec(text)) !== null) {
      const c = versionCatalog.get(m[1]);
      if (c) results.push(c);
    }

    return results;
  }

  /**
   * Extracts coords from a `pom.xml` text. Only the standard
   * `<dependency>` shape — no profiles, no parent inheritance, no
   * properties resolution beyond version (which is already a string).
   */
  parsePom(text: string): MavenCoords[] {
    const results: MavenCoords[] = [];
    const reDep = /<dependency>([\s\S]*?)<\/dependency>/g;
    let m: RegExpExecArray | null;
    while ((m = reDep.exec(text)) !== null) {
      const inner = m[1];
      const groupM   = /<groupId>([^<]+)<\/groupId>/.exec(inner);
      const artifM   = /<artifactId>([^<]+)<\/artifactId>/.exec(inner);
      const versionM = /<version>([^<]+)<\/version>/.exec(inner);
      if (groupM && artifM && versionM) {
        const c = parseCoords(`${groupM[1].trim()}:${artifM[1].trim()}:${versionM[1].trim()}`);
        if (c) results.push(c);
      }
    }
    return results;
  }
}
