import StreamZip from 'node-stream-zip';
import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { parseJava } from '../indexer/JavaParser';
import { buildKotlinJarUri } from '../providers/KotlinJarContentProvider';
import { Logger } from '../util/logger';
import { detectJdkHome, JdkLocation } from './JavaHomeDetector';

// The JDK's own big classes live well past 200 KB: Arrays, Collections,
// Character, Pattern and BigDecimal were all skipped, so Cmd+Click on them
// found nothing. The cap only exists to keep one pathological entry from
// stalling the scan, and 2 MB covers every real source file in src.zip.
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

/**
 * Modules worth indexing. A modern `src.zip` is mostly the compiler, JFR,
 * JShell, Swing and the `sun` internals: measured on a real JDK, 81 % of the
 * entries come from modules a Kotlin or Android developer never opens, and
 * indexing them cost seconds of CPU and hundreds of megabytes on every start.
 */
const JDK_MODULES = /^(?:java\.base|java\.logging|java\.net\.http|java\.sql|java\.xml|java\.naming|java\.instrument|java\.compiler)\//;

/** JDK 8 entries have no module prefix (`java/lang/String.java`) and are all kept. */
export function keepJdkEntry(name: string): boolean {
  const slash = name.indexOf('/');
  if (slash < 0) return false;
  const first = name.slice(0, slash);
  if (!first.includes('.')) return true;
  return JDK_MODULES.test(name);
}

/**
 * Indexes the Java source files inside a JDK's `lib/src.zip`. Mirrors
 * `GradleSourcesScanner` but for a single ZIP rather than a directory
 * walk.
 *
 * Layout in JDK 9+: `<module>/<package>/<Class>.java`
 *   e.g. `java.base/java/lang/String.java`,
 *        `java.util/java/util/ArrayList.java`
 *
 * Layout in JDK 8 (legacy): `<package>/<Class>.java`
 *   e.g. `java/lang/String.java` (no module prefix)
 *
 * Both layouts are handled transparently — we index every `.java` entry
 * regardless of nesting depth. Non-source entries (.class, META-INF,
 * package-info, module-info) are skipped by extension filter.
 *
 * The scanner is silent on failure: missing JDK, missing src.zip,
 * corrupted ZIP entries — all degrade gracefully so the rest of the
 * extension stays functional.
 */
export class JdkSourcesScanner {
  private cancelToken = { cancelled: false };
  private _location: JdkLocation | undefined;

  constructor(
    private readonly index: SymbolIndex,
    private readonly log: Logger,
  ) {}

  /** Cancel any in-flight scan. Safe to call even if no scan is running. */
  cancel(): void {
    this.cancelToken.cancelled = true;
  }

  /** Last detected JDK location (or `undefined` if none). For status bar. */
  location(): JdkLocation | undefined {
    return this._location;
  }

  async scanAll(): Promise<{ files: number; jdkHome: string | undefined }> {
    const token = this.cancelToken = { cancelled: false };

    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('indexSourcesJars', true)) {
      return { files: 0, jdkHome: undefined };
    }

    const loc = await detectJdkHome();
    this._location = loc;
    if (!loc) {
      this.log.info('[jdkscan] no JDK found — install OpenJDK or set kotlinJump.jdkHome');
      return { files: 0, jdkHome: undefined };
    }
    this.log.info(`[jdkscan] using JDK at ${loc.jdkHome} (source: ${loc.source}, v${loc.majorVersion ?? '?'})`);

    if (!loc.srcZip) {
      this.log.warn(`[jdkscan] JDK detected but no lib/src.zip — install JDK with sources`);
      return { files: 0, jdkHome: loc.jdkHome };
    }

    if (token.cancelled) return { files: 0, jdkHome: loc.jdkHome };

    let files = 0;
    try {
      files = await this.indexSrcZip(loc.srcZip, loc.jdkHome);
    } catch (err) {
      this.log.warn(`[jdkscan] indexSrcZip failed: ${(err as Error).message}`);
    }

    if (!token.cancelled) {
      this.log.info(`[jdkscan] done — ${files} JDK source files indexed`);
    }
    return { files, jdkHome: loc.jdkHome };
  }

  private async indexSrcZip(srcZipPath: string, jdkHome: string): Promise<number> {
    const moduleName = `jdk:${jdkHome}`;
    const zip = new StreamZip.async({ file: srcZipPath });
    let count = 0;
    try {
      const entries = await zip.entries();
      for (const [name, entry] of Object.entries(entries)) {
        if (this.cancelToken.cancelled) break;
        if (!name.endsWith('.java')) continue;
        if (!keepJdkEntry(name)) continue;
        // Skip module-info / package-info — they describe modules/packages,
        // not types worth navigating to.
        if (name.endsWith('module-info.java') || name.endsWith('package-info.java')) continue;
        if (entry.size > MAX_ENTRY_BYTES) continue;
        try {
          const data      = await zip.entryData(name);
          const text      = data.toString('utf8');
          const uriString = buildKotlinJarUri(srcZipPath, name).toString();
          const parsed    = parseJava(uriString, text);
          this.index.add(parsed, moduleName);
          count++;
        } catch { /* corrupted entry — skip silently */ }
      }
    } finally {
      await zip.close().catch(() => {});
    }
    return count;
  }
}
