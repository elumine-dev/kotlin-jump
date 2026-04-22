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

/**
 * Scans the Maven local repository (`~/.m2/repository`) for `-sources.jar` files
 * and indexes their Kotlin/Java sources into the symbol index.
 *
 * Maven layout is deterministic (no hash-level directory), so discovery is a
 * straightforward recursive glob over `~/.m2/repository/**\/*-sources.jar`.
 */
export class MavenSourcesScanner {
  private cancelToken = { cancelled: false };

  constructor(private readonly index: SymbolIndex, private readonly log: Logger) {}

  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  async scanAll(): Promise<{ jars: number; files: number }> {
    const token = this.cancelToken = { cancelled: false };

    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('indexMavenSources', true)) return { jars: 0, files: 0 };

    const maxCount = cfg.get<number>('mavenSourcesMaxCount', 2000);
    const override = cfg.get<string>('mavenLocalRepoDir', '').trim();

    const repoDir = override || path.join(os.homedir(), '.m2', 'repository');

    // Skip silently if the directory doesn't exist (Maven not used on this machine)
    try {
      const st = await fs.stat(repoDir);
      if (!st.isDirectory()) {
        this.log.warn(`[mavenscan] mavenLocalRepoDir is not a directory: ${repoDir}`);
        return { jars: 0, files: 0 };
      }
    } catch {
      return { jars: 0, files: 0 }; // ~/.m2 absent — silently skip
    }

    const jars = await this.discoverJars(repoDir, maxCount);
    if (token.cancelled) return { jars: 0, files: 0 };
    this.log.info(`[mavenscan] found ${jars.length} -sources.jar`);

    let totalFiles = 0;
    for (const info of jars) {
      if (token.cancelled) break;
      try { totalFiles += await this.indexJar(info); }
      catch (err) { this.log.warn(`[mavenscan] skip ${path.basename(info.jarPath)}: ${err}`); }
    }

    if (!token.cancelled) {
      this.index.finalize();
      this.log.info(`[mavenscan] done — ${totalFiles} source files indexed`);
    }
    return { jars: jars.length, files: totalFiles };
  }

  /**
   * Maven layout:  repo / {groupId-as-path} / {artifactId} / {version} / {artifactId}-{version}-sources.jar
   * Example: ~/.m2/repository/com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0-sources.jar
   *
   * Module name format mirrors Gradle: `groupId:artifactId:version`
   */
  private async discoverJars(
    repoDir: string,
    maxCount: number,
  ): Promise<{ jarPath: string; moduleName: string }[]> {
    if (maxCount <= 0) return [];

    // Rank by mtime desc so recently-resolved artifacts win over stale
    // residue when maxCount caps the total — otherwise a deep repo with
    // thousands of forgotten JARs can starve the current workspace's deps.
    const candidates: { jarPath: string; moduleName: string; mtime: number }[] = [];
    await this.walkRepo(repoDir, repoDir, candidates);
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates.slice(0, maxCount).map(({ jarPath, moduleName }) => ({ jarPath, moduleName }));
  }

  private async walkRepo(
    root:     string,
    dir:      string,
    results:  { jarPath: string; moduleName: string; mtime: number }[],
  ): Promise<void> {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try { stat = await fs.stat(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        await this.walkRepo(root, fullPath, results);
      } else if (entry.endsWith('-sources.jar') && !entry.endsWith('-samples-sources.jar')) {
        const moduleName = mavenModuleName(root, fullPath);
        results.push({ jarPath: fullPath, moduleName, mtime: stat.mtimeMs });
      }
    }
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
        } catch { /* corrupted entry — skip */ }
      }
    } finally {
      await zip.close().catch(() => {});
    }
    return count;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derives a Maven module name (`groupId:artifactId:version`) from a JAR path.
 *
 * Maven layout: `<root>/<group-path>/<artifactId>/<version>/<filename>`
 * → strip root, convert directory separators to `.` for group, read artifact+version.
 *
 * Example:
 *   root = /home/user/.m2/repository
 *   jar  = /home/user/.m2/repository/com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0-sources.jar
 *   →  com.squareup.okhttp3:okhttp:4.12.0
 */
function mavenModuleName(root: string, jarPath: string): string {
  const rel = path.relative(root, path.dirname(jarPath));  // com/squareup/okhttp3/okhttp/4.12.0
  const parts = rel.split(path.sep);
  if (parts.length < 2) return rel;
  const version    = parts[parts.length - 1];
  const artifactId = parts[parts.length - 2];
  const groupId    = parts.slice(0, -2).join('.');
  return `${groupId}:${artifactId}:${version}`;
}
