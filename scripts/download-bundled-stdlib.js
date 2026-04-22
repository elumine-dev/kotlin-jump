#!/usr/bin/env node
/**
 * Downloads `kotlin-stdlib-X-sources.jar` from Maven Central into
 * `bundled/`. Run as part of the build prep when bumping the bundled
 * version — the result is committed to git so end-users get it inside
 * the VSIX without any runtime download.
 *
 * Usage:
 *   node scripts/download-bundled-stdlib.js [version]
 *   (default version: 1.9.25 — pin a known-good Kotlin stdlib)
 *
 * Why bundled? When a user opens a Kotlin project on a fresh machine
 * (no Gradle cache, no IntelliJ history), `List.first()`, `String
 * .uppercase()`, and other stdlib calls would have no source to
 * navigate to. Bundling the stdlib sources guarantees Cmd+Click
 * works from minute zero, even offline. ~600 KB cost on the VSIX.
 */

const fs    = require('node:fs');
const https = require('node:https');
const path  = require('node:path');

const DEFAULT_VERSION = '1.9.25';
const BUNDLED_DIR     = path.resolve(__dirname, '..', 'bundled');

const version = process.argv[2] || DEFAULT_VERSION;
const url     = `https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/${version}/kotlin-stdlib-${version}-sources.jar`;
const dest    = path.join(BUNDLED_DIR, `kotlin-stdlib-${version}-sources.jar`);

if (!fs.existsSync(BUNDLED_DIR)) fs.mkdirSync(BUNDLED_DIR, { recursive: true });

console.log(`→ Downloading ${url}`);
const file = fs.createWriteStream(dest);
https.get(url, (res) => {
  if (res.statusCode !== 200) {
    console.error(`✗ HTTP ${res.statusCode} — ${res.statusMessage}`);
    fs.unlinkSync(dest);
    process.exit(1);
  }
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    const kb = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`✓ Wrote ${dest} (${kb} KB)`);
  });
}).on('error', (err) => {
  console.error(`✗ Network error: ${err.message}`);
  fs.unlinkSync(dest);
  process.exit(1);
});
