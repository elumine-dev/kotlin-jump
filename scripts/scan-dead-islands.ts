/**
 * Dry-run harness for KJ-046, outside VS Code.
 *
 *   npx vite-node scripts/scan-dead-islands.ts <project-root> [--why] [--json] [--apply]
 *                                             [--name=<substring>]
 *
 * `--why` prints the outcome histogram over every raw candidate, then the
 * islands. Auditing findings without it is guesswork, and the zero-FP gate
 * would get rubber-stamped instead of crossed.
 *
 * `--name=` prints the outcome of every candidate whose name matches, with the
 * reason spelled out. The histogram buckets `alive:root(path:line)` down to
 * `alive:root`, which hides exactly what an audit needs: WHICH file kept a
 * declaration alive. Answering "why is this one not reported?" needed a
 * throwaway script until this flag existed.
 *
 * `--apply` WRITES the deletions to disk (island extents + stale imports),
 * for the delete-and-build audit on a throwaway branch. It refuses islands
 * with a withheld fix. Not a user-facing path: the extension goes through
 * the Refactor Preview, this goes through git.
 */

import * as fs from 'fs';
import * as path from 'path';
import { explainIslands, findDeadIslands, messageFor } from '../src/providers/deadIslands';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea', '.worktrees', '.kotlin', '.claude-flow', '.swarm']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest', 'sharedTest', 'testShared'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name) || /[\\/]META-INF[\\/]services[\\/]/.test(full)) hit(full);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: scan-dead-islands.ts <project-root> [--why] [--json]'); process.exit(2); }

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  let truncated = false;
  walk(root, file => {
    try { sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }); }
    catch { truncated = true; }
  });

  const input = { sources, testSourceSets: TEST_SOURCE_SETS, truncated };
  const islands = findDeadIslands(input);
  const elapsed = Date.now() - started;

  console.log(`sources : ${sources.length}${truncated ? ' (truncated — nothing can be proven)' : ''}`);
  console.log(`islands : ${islands.length}`);
  console.log(`elapsed : ${elapsed} ms`);

  if (args.includes('--why')) {
    const why = explainIslands(input);
    const by = new Map<string, number>();
    for (const w of why) {
      const bucket = w.outcome.split('(')[0];
      by.set(bucket, (by.get(bucket) ?? 0) + 1);
    }
    console.log(`\nevery candidate (${why.length}), by outcome:`);
    for (const [o, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${o}`);
  }

  const nameFilter = args.find(a => a.startsWith('--name='))?.slice('--name='.length);
  if (nameFilter) {
    const matching = explainIslands(input).filter(w => w.name.includes(nameFilter));
    console.log(`\ncandidates matching '${nameFilter}' (${matching.length}):`);
    for (const w of matching) {
      const label = w.container ? `${w.container}.${w.name}` : w.name;
      console.log(`  ${label.padEnd(52)} ${w.outcome}`);
      console.log(`  ${' '.repeat(52)} declared ${w.path}:${w.line + 1}`);
    }
  }

  console.log('\nthe islands:');
  for (const [i, isl] of islands.entries()) {
    console.log(`\n  island #${i + 1} — ${messageFor(isl)}${isl.fixable ? '' : '  (not removable)'}`);
    for (const m of isl.members) {
      const label = m.container ? `${m.container}.${m.name}` : m.name;
      const tag = m.individuallyDead ? '' : '  ← NEW';
      console.log(`    ${m.kind.padEnd(11)} ${label.padEnd(58)} ${m.path}:${m.line + 1}${tag}`);
    }
    for (const m of isl.members) {
      if (m.keptAliveBy.length > 0) {
        console.log(`      '${m.name}' kept alive only by: ${m.keptAliveBy.join(', ')} — themselves dead`);
      }
    }
  }

  if (args.includes('--apply')) {
    const byFile = new Map<string, { start: number; end: number }[]>();
    let applied = 0;
    let skipped = 0;
    for (const isl of islands) {
      if (!isl.fixable) { skipped++; continue; }
      // A testOnly island is still referenced by its tests: deleting it
      // without them breaks test compilation, and deleting tests is a human
      // call. The audit deletes only the unreferenced islands.
      if (isl.verdict === 'testOnly') { skipped++; continue; }
      applied++;
      for (const m of isl.members) {
        (byFile.get(m.path) ?? byFile.set(m.path, []).get(m.path)!).push({ start: m.removeStart, end: m.removeEnd });
      }
      for (const imp of isl.staleImports) {
        const abs = path.join(root, imp.path);
        const text = fs.readFileSync(abs, 'utf8');
        const lines = text.split('\n');
        let offset = 0;
        for (let l = 0; l < imp.line; l++) offset += lines[l].length + 1;
        (byFile.get(imp.path) ?? byFile.set(imp.path, []).get(imp.path)!).push({ start: offset, end: offset + lines[imp.line].length + 1 });
      }
    }
    for (const [rel, edits] of byFile) {
      const abs = path.join(root, rel);
      let text = fs.readFileSync(abs, 'utf8');
      // A member edit contained in its class's edit must yield to it: deleting
      // the members but keeping the class shell leaves orphan references.
      // (Found by a red audit build — the composition, not the verdict.)
      const outermost = edits.filter(e =>
        !edits.some(o => o !== e && o.start <= e.start && o.end >= e.end
          && (o.start < e.start || o.end > e.end)));
      outermost.sort((a, b) => b.start - a.start);
      let previousStart = Infinity;
      for (const e of outermost) {
        if (e.end > previousStart) continue;
        text = text.slice(0, e.start) + text.slice(e.end);
        previousStart = e.start;
      }
      fs.writeFileSync(abs, text);
    }
    console.log(`\napplied ${applied} island(s) across ${byFile.size} file(s)${skipped ? `, ${skipped} withheld (no fix)` : ''}`);
  }

  if (args.includes('--json')) {
    const out = islands.map((isl, i) => ({
      id: i + 1,
      verdict: isl.verdict,
      fixable: isl.fixable,
      members: isl.members.map(m => ({
        name: m.name, kind: m.kind, container: m.container,
        path: m.path, line: m.line + 1, individuallyDead: m.individuallyDead,
      })),
    }));
    fs.writeFileSync('dead-islands.json', JSON.stringify(out, null, 2));
    console.log(`\nwrote dead-islands.json (${out.length} islands)`);
  }
}

main();
