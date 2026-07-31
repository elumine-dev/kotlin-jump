/**
 * Dry-run harness for KJ-039, outside VS Code.
 *
 *   npx vite-node scripts/scan-unused-enum-entries.ts <project-root> [--why]
 *
 * `--why` prints one line per RAW enum entry with the guard that took it out
 * (`E1:walked-as-whole`, `E3:@Serializable`) or the verdict it reached.
 */

import * as fs from 'fs';
import * as path from 'path';
import { explainEnumEntries, findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name)) hit(full);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: scan-unused-enum-entries.ts <project-root> [--why]'); process.exit(2); }
  const why = args.includes('--why');

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, file => {
    try { sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
  });

  const input = { sources, testSourceSets: TEST_SOURCE_SETS };
  const found = findUnusedEnumEntries(input);
  const elapsed = Date.now() - started;

  const byVerdict = new Map<string, number>();
  for (const e of found) byVerdict.set(e.verdict, (byVerdict.get(e.verdict) ?? 0) + 1);

  console.log(`sources      : ${sources.length}`);
  console.log(`unused       : ${found.length} entries across ${new Set(found.map(e => e.enumName)).size} enums`);
  for (const [v, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(16)} ${n}`);
  console.log(`elapsed      : ${elapsed} ms`);

  if (why) {
    const by = new Map<string, number>();
    for (const e of explainEnumEntries(input)) by.set(e.outcome, (by.get(e.outcome) ?? 0) + 1);
    console.log('\nevery entry, by outcome:');
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${o}`);
  }

  console.log('\nthe findings:');
  for (const e of found) {
    const removable = e.removeStart >= 0 ? '' : '  (not removable)';
    console.log(`  ${e.verdict.padEnd(14)} ${`${e.enumName}.${e.name}`.padEnd(48)} ${e.path}:${e.line + 1}${removable}`);
  }
}

main();
