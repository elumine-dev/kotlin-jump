/**
 * Dry-run harness for KJ-038, outside VS Code.
 *
 *   npx vite-node scripts/scan-unheard-events.ts <project-root> [--json] [--why]
 *
 * `--why` prints one line per RAW post site with the guard that dropped it
 * (`P1:not-a-bus`, `P8:ambiguous-name`) or the verdict it reached, plus the
 * learned bus receivers. Without it, auditing a few hundred post sites is
 * guesswork and the gate gets rubber-stamped instead of crossed.
 *
 * It also prints `poisoned-by:` first when a subscription could not be read,
 * because a bare zero would otherwise read as "all clear" when in fact nothing
 * was proven at all.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  explainUnheardEvents,
  findUnheardEvents,
} from '../src/providers/unheardEvents';

const SOURCE_RE = /\.(kt|kts|java)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, hit);
    } else if (SOURCE_RE.test(entry.name)) {
      hit(full);
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) {
    console.error('usage: scan-unheard-events.ts <project-root> [--json] [--why]');
    process.exit(2);
  }
  const asJson = args.includes('--json');
  const why = args.includes('--why');

  const started = Date.now();
  const sources: { path: string; text: string }[] = [];
  walk(root, file => {
    try {
      sources.push({ path: path.relative(root, file), text: fs.readFileSync(file, 'utf8') });
    } catch { /* unreadable files simply contribute nothing */ }
  });

  const input = { sources, testSourceSets: TEST_SOURCE_SETS };
  const scan = findUnheardEvents(input);
  const elapsed = Date.now() - started;

  if (asJson) {
    console.log(JSON.stringify({ ...scan, sources: sources.length, elapsed }, null, 2));
    return;
  }

  // The poisoning has to come FIRST. A reader who sees "0 findings" without it
  // concludes the workspace is clean, when we in fact proved nothing.
  if (scan.unreadable.length > 0) {
    console.log(`poisoned-by  : ${scan.unreadable.length} unreadable subscription(s)`);
    for (const u of scan.unreadable) console.log(`   ${u.path}:${u.line + 1}`);
    console.log('\nNo event can be reported while a subscription stays unreadable.');
    return;
  }

  const byVerdict = new Map<string, number>();
  for (const e of scan.events) byVerdict.set(e.verdict, (byVerdict.get(e.verdict) ?? 0) + 1);

  console.log(`sources        : ${sources.length}`);
  console.log(`unheard events : ${scan.events.length}`);
  for (const [verdict, n] of [...byVerdict].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(20)} ${n}`);
  }
  console.log(`elapsed        : ${elapsed} ms`);

  console.log(`\ndirection 2   : ${scan.deadSubscriptions.length} starved subscription(s), ${scan.unboundedPosts.length} unbounded post(s)`);
  if (scan.unboundedPosts.length > 0) {
    console.log('  no subscription can be proven starved while a post stays unbounded:');
    for (const u of scan.unboundedPosts.slice(0, 20)) console.log(`    ${u.path}:${u.line + 1}`);
  } else {
    for (const d of scan.deadSubscriptions) {
      console.log(`  ${d.verdict.padEnd(16)} ${d.name.padEnd(38)} ${d.path}:${d.line + 1}`);
    }
  }

  if (!why) {
    for (const e of scan.events) {
      console.log(`  ${e.verdict.padEnd(20)} ${e.name.padEnd(34)} ${e.path}:${e.line + 1}`);
    }
    return;
  }

  const detail = explainUnheardEvents(input);
  console.log(`\nbus receivers  : ${detail.busReceivers.join(', ') || '(none learned)'}`);

  const byOutcome = new Map<string, number>();
  for (const p of detail.posts) byOutcome.set(p.outcome, (byOutcome.get(p.outcome) ?? 0) + 1);
  console.log('\nevery post site, by outcome:');
  for (const [outcome, n] of [...byOutcome].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${outcome}`);
  }

  console.log('\nthe findings:');
  for (const e of scan.events) {
    const removable = e.removeStart >= 0 ? '' : '  (not removable)';
    console.log(`  ${e.verdict.padEnd(20)} ${e.name.padEnd(34)} ${e.path}:${e.line + 1}${removable}`);
  }
}

main();
