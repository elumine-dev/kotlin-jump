/**
 * Dry-run harness for KJ-042, outside VS Code.
 *
 *   npx vite-node scripts/scan-unused-members.ts <project-root> [--why]
 *
 * Runs KJ-032 first, exactly as the command does: a member of a class already
 * reported whole must not be re-reported (M12).
 */

import * as fs from 'fs';
import * as path from 'path';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { explainMembers, findUnusedMembers } from '../src/providers/unusedMembers';

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
  if (!root) { console.error('usage: scan-unused-members.ts <project-root> [--why]'); process.exit(2); }

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, file => {
    try { sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
  });

  const kj032 = findUnusedSymbols({ sources, testSourceSets: TEST_SOURCE_SETS });
  const input = {
    sources,
    testSourceSets: TEST_SOURCE_SETS,
    deadDeclarations: kj032.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  };
  const found = findUnusedMembers(input);
  const elapsed = Date.now() - started;

  const byVerdict = new Map<string, number>();
  for (const m of found) byVerdict.set(m.verdict, (byVerdict.get(m.verdict) ?? 0) + 1);

  console.log(`sources      : ${sources.length}`);
  console.log(`members found: ${found.length}`);
  for (const [v, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) console.log(`  ${v.padEnd(14)} ${n}`);
  console.log(`elapsed      : ${elapsed} ms (KJ-032 included)`);

  if (args.includes('--why')) {
    const why = explainMembers(input);
    const by = new Map<string, number>();
    for (const w of why) by.set(w.outcome.split('@')[0], (by.get(w.outcome.split('@')[0]) ?? 0) + 1);
    console.log(`\nevery member (${why.length}), by outcome:`);
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${o}`);
  }

  console.log('\nthe findings:');
  for (const m of found) {
    const removable = m.removeStart >= 0 ? '' : '  (not removable)';
    console.log(`  ${m.verdict.padEnd(13)} ${(m.container + '.' + m.name).padEnd(58)} ${m.path}:${m.line + 1}${removable}`);
  }
}

main();
