/**
 * Dry-run harness for KJ-040, outside VS Code.
 *
 *   npx vite-node scripts/scan-unused-remote-config-keys.ts <project-root> [--why]
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  explainRemoteConfigKeys,
  findUnusedRemoteConfigKeys,
} from '../src/providers/unusedRemoteConfigKeys';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

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
  if (!root) { console.error('usage: scan-unused-remote-config-keys.ts <project-root> [--why]'); process.exit(2); }

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, file => {
    try { sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
  });

  const found = findUnusedRemoteConfigKeys({ sources });
  const why = explainRemoteConfigKeys({ sources });
  const declared = new Set(why.map(w => w.name)).size;

  console.log(`sources      : ${sources.length}`);
  console.log(`keys declared: ${declared} distinct, ${why.length} declarations`);
  console.log(`never read   : ${found.length}`);
  console.log(`elapsed      : ${Date.now() - started} ms`);

  if (args.includes('--why')) {
    const by = new Map<string, number>();
    for (const w of why) by.set(w.outcome.split(':')[0], (by.get(w.outcome.split(':')[0]) ?? 0) + 1);
    console.log('\nevery declaration, by outcome:');
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${o}`);
  }

  console.log('\nthe findings:');
  for (const k of found) {
    console.log(`  ${k.name.padEnd(52)} ${k.declarations.length} declaration(s)`);
    for (const d of k.declarations) console.log(`      ${d.path}:${d.line + 1}`);
  }
}

main();
