/**
 * Dry-run harness for KJ-044, outside VS Code.
 *
 *   npx vite-node scripts/scan-unused-dto-fields.ts <project-root> [--why]
 */
import * as fs from 'fs';
import * as path from 'path';
import { explainDtoFields, findUnusedDtoFields } from '../src/providers/unusedDtoFields';

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
  if (!root) { console.error('usage: scan-unused-dto-fields.ts <root> [--why]'); process.exit(2); }
  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, f => { try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ } });

  const input = { sources, testSourceSets: TEST_SOURCE_SETS };
  const found = findUnusedDtoFields(input);
  console.log(`sources   : ${sources.length}`);
  console.log(`unread    : ${found.length} fields in ${new Set(found.map(f => f.className)).size} classes`);
  console.log(`elapsed   : ${Date.now() - started} ms`);
  if (args.includes('--why')) {
    const why = explainDtoFields(input);
    const by = new Map<string, number>();
    for (const w of why) by.set(w.outcome.split('@')[0], (by.get(w.outcome.split('@')[0]) ?? 0) + 1);
    console.log(`\nevery candidate field (${why.length}), by outcome:`);
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${o}`);
  }
  console.log('\nthe findings:');
  for (const f of found) {
    const removable = f.removeStart >= 0 ? '' : '  (not removable: constructed by hand)';
    console.log(`  ${f.verdict.padEnd(13)} ${(f.className + '.' + f.name).padEnd(52)} ${f.path}:${f.line + 1}${removable}`);
  }
}
main();
