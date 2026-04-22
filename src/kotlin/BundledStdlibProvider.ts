import * as fs from 'fs/promises';
import * as path from 'path';
import StreamZip from 'node-stream-zip';
import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { parse } from '../indexer/KotlinParser';
import { buildKotlinJarUri } from '../providers/KotlinJarContentProvider';
import { Logger } from '../util/logger';

const MAX_ENTRY_BYTES = 200 * 1024;

/** Pinned version of the bundled Kotlin stdlib sources JAR. */
const BUNDLED_VERSION = '1.9.25';
const BUNDLED_FILENAME = `kotlin-stdlib-${BUNDLED_VERSION}-sources.jar`;

/**
 * Loads the Kotlin stdlib sources JAR shipped inside the VSIX
 * (`bundled/kotlin-stdlib-X-sources.jar`) and indexes its `.kt`
 * entries — guaranteeing `List`, `String`, `Sequence`, etc. are
 * navigable from the first second the user opens a Kotlin file,
 * even with a cold Gradle cache and offline.
 *
 * The provider is a *fallback*: if the user's project already has a
 * matching kotlin-stdlib in its Gradle/Maven cache, that takes
 * precedence (added before this one in `runJarScan`). The bundled
 * version is ~600 KB on disk — a small price for guaranteed nav.
 *
 * Disabled via `kotlinJump.useBundledStdlib: false`.
 */
export class BundledStdlibProvider {
  constructor(
    private readonly index:    SymbolIndex,
    private readonly log:      Logger,
    /** Provided by the extension context — points to the VSIX root. */
    private readonly extensionPath: string,
  ) {}

  async load(): Promise<{ files: number; jarPath: string | undefined }> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('useBundledStdlib', true)) {
      return { files: 0, jarPath: undefined };
    }
    if (!cfg.get<boolean>('indexSourcesJars', true)) {
      return { files: 0, jarPath: undefined };
    }

    const jarPath = path.join(this.extensionPath, 'bundled', BUNDLED_FILENAME);
    try {
      await fs.access(jarPath);
    } catch {
      this.log.warn(`[bundled-stdlib] missing JAR at ${jarPath} — VSIX packaging issue?`);
      return { files: 0, jarPath: undefined };
    }

    const moduleName = `kotlin-stdlib:${BUNDLED_VERSION} (bundled)`;
    let count = 0;
    const zip = new StreamZip.async({ file: jarPath });
    try {
      const entries = await zip.entries();
      for (const [name, entry] of Object.entries(entries)) {
        if (!name.endsWith('.kt')) continue;
        if (entry.size > MAX_ENTRY_BYTES) continue;
        try {
          const data      = await zip.entryData(name);
          const text      = data.toString('utf8');
          const uriString = buildKotlinJarUri(jarPath, name).toString();
          const parsed    = parse(uriString, text);
          this.index.add(parsed, moduleName);
          count++;
        } catch { /* corrupted entry — skip */ }
      }
    } finally {
      await zip.close().catch(() => {});
    }

    this.log.info(`[bundled-stdlib] loaded ${count} files from ${BUNDLED_FILENAME}`);
    return { files: count, jarPath };
  }
}
