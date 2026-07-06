/**
 * Pre-parses the bundled Kotlin stdlib sources JAR
 * (`bundled/kotlin-stdlib-X-sources.jar`, fetched by
 * download-bundled-stdlib.js) into a single JSON asset
 * (`bundled/kotlin-stdlib-X-index.json`) that BundledStdlibProvider loads
 * at runtime via `vscode.workspace.fs.readFile` + `JSON.parse`: no zip
 * library, no `fs`, works identically on desktop and web.
 *
 * Run manually whenever BUNDLED_VERSION (here and in BundledStdlibProvider.ts)
 * is bumped. The output is committed to git next to the source JAR, same as
 * the JAR itself. This is a build-time tool, never run at extension
 * activation.
 *
 * Usage:
 *   node dist/scripts/build-bundled-stdlib-index.js [version]
 *   (default version: 1.9.25, must match the already-downloaded JAR)
 */
import * as fs from 'fs';
import * as path from 'path';
import StreamZip from 'node-stream-zip';
import { parse } from '../src/indexer/KotlinParser';
import { buildSnapshotFile } from '../src/indexer/SnapshotFormat';
import type { BundledStdlibIndex } from '../src/kotlin/BundledStdlibProvider';

const SCHEMA_VERSION  = 1;
const MAX_ENTRY_BYTES = 200 * 1024;
const DEFAULT_VERSION = '1.9.25';

const bundledVersion = process.argv[2] || DEFAULT_VERSION;
// process.cwd(), not path.resolve(__dirname, '..'): once bundled by esbuild,
// __dirname reflects the OUTPUT depth (dist/scripts/), not the source depth
// (scripts/). Resolving from __dirname here would look under dist/bundled/
// instead of the repo's real bundled/. This script is always run via the
// npm script from the repo root, so cwd is reliable.
const bundledDir      = path.resolve(process.cwd(), 'bundled');
const jarPath         = path.join(bundledDir, `kotlin-stdlib-${bundledVersion}-sources.jar`);
const outPath         = path.join(bundledDir, `kotlin-stdlib-${bundledVersion}-index.json`);

function entryUri(entryName: string): string {
  return `kotlin-stdlib-jar:/${entryName}`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(jarPath)) {
    console.error(`✗ Missing ${jarPath}. Run "node scripts/download-bundled-stdlib.js ${bundledVersion}" first.`);
    process.exit(1);
  }

  const out: BundledStdlibIndex = {
    schemaVersion:  SCHEMA_VERSION,
    bundledVersion,
    symbols:        {},
    sources:        {},
  };
  const moduleName = `kotlin-stdlib:${bundledVersion} (bundled)`;

  const zip = new StreamZip.async({ file: jarPath });
  let count = 0;
  try {
    const entries = await zip.entries();
    for (const [name, entry] of Object.entries(entries)) {
      if (!name.endsWith('.kt')) continue;
      if (entry.size > MAX_ENTRY_BYTES) continue;
      try {
        const data = await zip.entryData(name);
        const text = data.toString('utf8');
        const parsed = parse(entryUri(name), text);
        out.symbols[name] = buildSnapshotFile(
          parsed.symbols, parsed.packageName, moduleName, 0, undefined, parsed.imports,
        );
        out.sources[name] = text;
        count++;
      } catch { /* corrupted entry, skip; matches BundledStdlibProvider's old runtime behavior */ }
    }
  } finally {
    await zip.close().catch(() => {});
  }

  fs.writeFileSync(outPath, JSON.stringify(out));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ Wrote ${outPath} (${count} files, ${kb} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
