/**
 * Dry-run harness for KJ-041, outside VS Code.
 *
 *   npx vite-node scripts/scan-unused-gradle-dependencies.ts <project-root> [--why]
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  explainGradleDependencies,
  findUnusedGradleDependencies,
} from '../src/providers/unusedGradleDependencies';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|toml|pro|properties)$/;
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
  if (!root) { console.error('usage: scan-unused-gradle-dependencies.ts <project-root> [--why]'); process.exit(2); }

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, file => {
    try { sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
  });

  const found = findUnusedGradleDependencies({ sources });
  const why = explainGradleDependencies({ sources });
  const elapsed = Date.now() - started;

  const byNs = new Map<string, number>();
  for (const f of found) byNs.set(f.namespace, (byNs.get(f.namespace) ?? 0) + 1);

  console.log(`sources        : ${sources.length}`);
  console.log(`aliases declared: ${why.length}`);
  console.log(`never referenced: ${found.length}`);
  for (const [ns, n] of [...byNs].sort((a, b) => b[1] - a[1])) console.log(`  ${ns.padEnd(12)} ${n}`);
  console.log(`elapsed        : ${elapsed} ms`);

  if (args.includes('--why')) {
    const by = new Map<string, number>();
    for (const w of why) by.set(`${w.namespace}/${w.outcome}`, (by.get(`${w.namespace}/${w.outcome}`) ?? 0) + 1);
    console.log('\nevery alias, by outcome:');
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${o}`);
  }

  console.log('\nthe findings:');
  for (const f of found) {
    const version = f.orphanedVersion ? `  + version '${f.orphanedVersion.name}'` : '';
    console.log(`  ${f.namespace.padEnd(10)} ${f.name.padEnd(38)} ${f.coordinate ?? ''}${version}`);
    console.log(`      ${f.path}:${f.line + 1}`);
  }
}

main();
