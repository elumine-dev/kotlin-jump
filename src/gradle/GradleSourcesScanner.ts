import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import StreamZip from 'node-stream-zip';
import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { buildKotlinJarUri } from '../providers/KotlinJarContentProvider';
import { Logger } from '../util/logger';

const MAX_ENTRY_BYTES = 200 * 1024;

export class GradleSourcesScanner {
  private cancelToken = { cancelled: false };

  constructor(private readonly index: SymbolIndex, private readonly log: Logger) {}

  /** Cancel any in-flight scan. Safe to call even if no scan is running. */
  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  /**
   * @param toolingJarPaths - Optional explicit list of source JAR paths from the
   *   Gradle Tooling API. When provided, bypasses the filesystem discovery scan
   *   and indexes only the listed JARs (up to `sourcesJarsMaxCount`).
   */
  async scanAll(toolingJarPaths?: string[]): Promise<{ jars: number; files: number }> {
    const token = this.cancelToken = { cancelled: false };

    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('indexSourcesJars', true)) return { jars: 0, files: 0 };

    const maxCount = cfg.get<number>('sourcesJarsMaxCount', 50);

    let jars: { jarPath: string; moduleName: string }[];

    if (toolingJarPaths && toolingJarPaths.length > 0) {
      // Tooling API provided an exact list — skip filesystem discovery
      jars = toolingJarPaths.slice(0, maxCount).map(p => ({
        jarPath:    p,
        moduleName: jarPathToModuleName(p),
      }));
      this.log.info(`[jarscan] using ${jars.length} JARs from Gradle Tooling API`);
    } else {
      const override = cfg.get<string>('gradleCacheDir', '').trim();

      // Validate override if provided
      if (override) {
        try {
          const st = await fs.stat(override);
          if (!st.isDirectory()) {
            this.log.warn(`[jarscan] gradleCacheDir is not a directory: ${override}`);
            return { jars: 0, files: 0 };
          }
        } catch {
          this.log.warn(`[jarscan] gradleCacheDir not found: ${override}`);
          return { jars: 0, files: 0 };
        }
      }

      const gradleHome = await resolveGradleHome();
      const cacheDir   = override || path.join(gradleHome, 'caches', 'modules-2', 'files-2.1');
      jars = await this.discoverJars(cacheDir, maxCount);
    }
    if (token.cancelled) return { jars: 0, files: 0 };
    this.log.info(`[jarscan] found ${jars.length} -sources.jar`);

    let totalFiles = 0;
    for (const info of jars) {
      if (token.cancelled) break;
      try { totalFiles += await this.indexJar(info); }
      catch (err) { this.log.warn(`[jarscan] skip ${path.basename(info.jarPath)}: ${err}`); }
    }

    if (!token.cancelled) {
      this.index.finalize();
      this.log.info(`[jarscan] done — ${totalFiles} source files indexed`);
    }
    return { jars: jars.length, files: totalFiles };
  }

  private async discoverJars(cacheDir: string, maxCount: number): Promise<{ jarPath: string; moduleName: string }[]> {
    if (maxCount <= 0) return [];                               // Bug 5 fix

    const results: { jarPath: string; moduleName: string }[] = [];
    let groups: string[];
    try { groups = await fs.readdir(cacheDir); } catch { return []; }

    outer:
    for (const group of groups) {
      const artifacts = await fs.readdir(path.join(cacheDir, group)).catch(() => [] as string[]);
      for (const artifact of artifacts) {
        const versions = await fs.readdir(path.join(cacheDir, group, artifact)).catch(() => [] as string[]);
        for (const version of versions) {
          const hashes = await fs.readdir(path.join(cacheDir, group, artifact, version)).catch(() => [] as string[]);
          for (const hash of hashes) {
            const hashDir = path.join(cacheDir, group, artifact, version, hash);
            const files = await fs.readdir(hashDir).catch(() => [] as string[]);
            for (const file of files) {
              if (!file.endsWith('-sources.jar') || file.endsWith('-samples-sources.jar')) continue;
              results.push({ jarPath: path.join(hashDir, file), moduleName: `${group}:${artifact}:${version}` });
              if (results.length >= maxCount) break outer;
            }
          }
        }
      }
    }
    return results;
  }

  private async indexJar(info: { jarPath: string; moduleName: string }): Promise<number> {
    const zip = new StreamZip.async({ file: info.jarPath });
    let count = 0;
    try {
      const entries = await zip.entries();
      for (const [name, entry] of Object.entries(entries)) {
        if (!name.endsWith('.kt') && !name.endsWith('.java')) continue;
        if (entry.size > MAX_ENTRY_BYTES) continue;
        try {
          const data      = await zip.entryData(name);
          const text      = data.toString('utf8');
          const uriString = buildKotlinJarUri(info.jarPath, name).toString();
          const parsed    = name.endsWith('.java') ? parseJava(uriString, text) : parse(uriString, text);
          this.index.add(parsed, info.moduleName);
          count++;
        } catch { /* entrée corrompue — on ignore */ }
      }
    } finally {
      await zip.close().catch(() => {});
    }
    return count;
  }
}

// ── GRADLE_USER_HOME resolution ───────────────────────────────────────────────

/**
 * Resolves the Gradle user home directory with the following priority:
 *   1. `GRADLE_USER_HOME` environment variable
 *   2. `GRADLE_USER_HOME` property in `~/.gradle/gradle.properties`
 *   3. Default: `~/.gradle`
 */
async function resolveGradleHome(): Promise<string> {
  // 1. Environment variable (highest priority)
  const envHome = process.env['GRADLE_USER_HOME'];
  if (envHome) return envHome;

  // 2. ~/.gradle/gradle.properties
  const defaultHome  = path.join(os.homedir(), '.gradle');
  const propsPath    = path.join(defaultHome, 'gradle.properties');
  try {
    const content = await fs.readFile(propsPath, 'utf8');
    const match   = /^GRADLE_USER_HOME\s*=\s*(.+)$/m.exec(content);
    if (match) return match[1].trim();
  } catch { /* file absent or unreadable — use default */ }

  return defaultHome;
}

/**
 * Derives a `group:artifact:version` module name from a Gradle cache JAR path.
 * Falls back to the basename when the path doesn't follow the expected layout.
 *
 * Gradle cache layout:
 *   <cacheDir> / <group> / <artifact> / <version> / <hash> / <filename>
 */
function jarPathToModuleName(jarPath: string): string {
  const parts = jarPath.replace(/\\/g, '/').split('/');
  // hash / filename at the end, then version, artifact, group
  if (parts.length >= 5) {
    const version  = parts[parts.length - 3];
    const artifact = parts[parts.length - 4];
    const group    = parts[parts.length - 5];
    return `${group}:${artifact}:${version}`;
  }
  return path.basename(jarPath, '-sources.jar');
}
