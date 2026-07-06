import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { restoreSnapshotFile, type SnapshotFile } from '../indexer/SnapshotFormat';
import { registerBundledStdlibSources, buildBundledStdlibUri } from '../providers/BundledStdlibFsProvider';
import { Logger } from '../util/logger';

/** Pinned version of the bundled Kotlin stdlib sources JAR. */
const BUNDLED_VERSION = '1.9.25';
const BUNDLED_INDEX_FILENAME = `kotlin-stdlib-${BUNDLED_VERSION}-index.json`;

/** Prebuilt asset format, written once by scripts/build-bundled-stdlib-index.ts
 *  (run manually when bumping BUNDLED_VERSION, output committed to git next to
 *  the source JAR) and read verbatim at every activation. */
export interface BundledStdlibIndex {
  schemaVersion:  number;
  bundledVersion: string;
  symbols:        Record<string, SnapshotFile>; // entry name → snapshot data
  sources:        Record<string, string>;       // entry name → raw .kt text
}

const SCHEMA_VERSION = 1;

/**
 * Loads the prebuilt index of the Kotlin stdlib sources shipped inside the
 * VSIX (`bundled/kotlin-stdlib-X-index.json`) and restores its entries into
 * the symbol index, guaranteeing `List`, `String`, `Sequence`, etc. are
 * navigable from the first second the user opens a Kotlin file, even with a
 * cold Gradle cache and offline.
 *
 * This used to open and parse the raw `.jar` at every activation via
 * `node-stream-zip` (Node-only, and ~200+ files reparsed live every time VS
 * Code starts). Now it's a single `JSON.parse()` of a prebuilt asset: a
 * startup win on desktop, and the reason this works on the web at all
 * (`vscode.workspace.fs.readFile` against the extension's own bundled files,
 * the same pattern WhatsNewPanel.ts already uses for media/whats-new.json).
 *
 * The provider is a *fallback*: if the user's project already has a
 * matching kotlin-stdlib in its Gradle/Maven cache, that takes precedence
 * (added before this one in `runJarScan`, desktop only).
 *
 * Disabled via `kotlinJump.useBundledStdlib: false`.
 */
export class BundledStdlibProvider {
  constructor(
    private readonly index:        SymbolIndex,
    private readonly log:          Logger,
    private readonly extensionUri: vscode.Uri,
  ) {}

  async load(): Promise<{ files: number }> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('useBundledStdlib', true)) return { files: 0 };
    if (!cfg.get<boolean>('indexSourcesJars', true)) return { files: 0 };

    const uri = vscode.Uri.joinPath(this.extensionUri, 'bundled', BUNDLED_INDEX_FILENAME);
    let data: BundledStdlibIndex;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      data = JSON.parse(new TextDecoder().decode(bytes)) as BundledStdlibIndex;
    } catch (err) {
      this.log.warn(`[bundled-stdlib] failed to load ${uri.toString()}: ${err instanceof Error ? err.message : err}`);
      return { files: 0 };
    }
    if (data.schemaVersion !== SCHEMA_VERSION) {
      this.log.warn(`[bundled-stdlib] schema version mismatch (got ${data.schemaVersion}, expected ${SCHEMA_VERSION}), skipping`);
      return { files: 0 };
    }

    registerBundledStdlibSources(data.sources);

    let count = 0;
    for (const [entryName, sf] of Object.entries(data.symbols)) {
      restoreSnapshotFile(buildBundledStdlibUri(entryName).toString(), sf, this.index);
      count += sf.n.length;
    }
    this.index.finalize();

    this.log.info(`[bundled-stdlib] loaded ${count} symbols from ${BUNDLED_INDEX_FILENAME}`);
    return { files: Object.keys(data.symbols).length };
  }
}
