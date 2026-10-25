/**
 * Dependency upgrades outside VS Code (KJ-082).
 *
 *   npx vite-node scripts/check-upgrades.ts <project-root> [--offline] [--json] [--force]
 *       [--policy=preferStable|stable|latest] [--custom-repos] [--cache-dir=<dir>]
 *
 * Reads the Gradle files of a project the way the extension does, refreshes
 * the metadata cache under the queue's limits (unless --offline), and prints
 * one line per version site: what it is, what it runs, what it could move to,
 * and why when it cannot. The counters at the end are the ones to watch on a
 * first run against a large project: requests sent, answers from the cache,
 * 304s, and hosts that asked for a pause.
 *
 * The same engine the command runs: what this prints is what the editor
 * underlines, minus the editor.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UpgradeEngine, fileKindOf, readProjectContext, type GradleFile } from '../src/upgrades/UpgradeEngine';
import { DiskCacheStore } from '../src/upgrades/node/DiskCacheStore';
import { nodeMetadataFetcher } from '../src/upgrades/node/NodeMetadataFetcher';
import { tierOf } from '../src/providers/dependencyUpgrades';
import type { Policy } from '../src/upgrades/model';
import matrix from '../src/data/agp-gradle-matrix.json';

const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (fileKindOf(full) !== undefined) hit(full);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: check-upgrades.ts <project-root> [--offline] [--json] [--force] [--policy=preferStable|stable|latest] [--custom-repos] [--cache-dir=<dir>]'); process.exit(2); }
  const offline = args.includes('--offline');
  const json = args.includes('--json');
  const force = args.includes('--force');
  const policy = (args.find(a => a.startsWith('--policy='))?.split('=')[1] ?? 'preferStable') as Policy;
  const cacheDir = args.find(a => a.startsWith('--cache-dir='))?.split('=')[1] ?? path.join(os.homedir(), '.cache', 'kotlin-jump', 'upgrades');
  const customRepos = args.includes('--custom-repos');

  const t0 = Date.now();
  const files: GradleFile[] = [];
  walk(path.resolve(root), file => {
    try { files.push({ path: file, text: fs.readFileSync(file, 'utf8'), kind: fileKindOf(file)! }); } catch { /* unreadable */ }
  });
  const log = (line: string) => { if (!json) console.error(line); };
  const engine = new UpgradeEngine({
    store: new DiskCacheStore(cacheDir),
    ...(offline ? {} : { fetcher: nodeMetadataFetcher }),
    policy: () => policy,
    consent: () => ({ mode: 'on', workspaceDecision: undefined, sessionGrant: true, trusted: true, customReposOptIn: customRepos }),
    matrix,
    log,
  });
  const ctx = readProjectContext(files, true);
  await engine.warm(files, ctx);
  const stats = offline ? undefined : await engine.refresh(files, ctx, { force });
  const report = engine.evaluate(files, ctx);
  const elapsed = Date.now() - t0;
  const rel = (p: string) => path.relative(path.resolve(root), p);

  if (json) {
    console.log(JSON.stringify({
      files: files.map(f => rel(f.path)), repositories: ctx.repositories, stats, elapsedMs: elapsed,
      findings: report.findings.map(f => ({ key: f.dependency.key, name: f.dependency.name, kind: f.dependency.kind, members: f.dependency.members, current: f.dependency.currentVersion, file: rel(f.dependency.range.file), line: f.dependency.line + 1, verdict: f.verdict })),
      rails: report.rails.map(r => ({ rail: r.rail, name: r.dependency.name, expected: r.expected, actual: r.actual, compatiblePick: r.compatiblePick, message: r.message })),
      pendingKeys: report.pendingKeys, catalogUnparsed: report.catalogUnparsed,
    }, null, 2));
    return;
  }

  console.log(`${files.length} Gradle file(s): ${files.filter(f => f.kind === 'toml').length} catalog(s), ${files.filter(f => f.kind === 'build').length} build file(s), ${files.filter(f => f.kind === 'settings').length} settings, ${files.filter(f => f.kind === 'wrapper').length} wrapper`);
  console.log(`repositories: plugins [${ctx.repositories.plugins.map(r => r.kind === 'custom' ? r.url : r.kind).join(', ')}], project [${ctx.repositories.project.map(r => r.kind === 'custom' ? r.url : r.kind).join(', ')}]`);
  if (report.catalogUnparsed) console.log('WARNING: a catalog could not be read in full; nothing is reported for it');
  console.log('');
  const width = Math.max(8, ...report.findings.map(f => f.dependency.name.length));
  for (const f of report.findings) {
    const d = f.dependency, v = f.verdict;
    const where = `${rel(d.range.file)}:${d.line + 1}`;
    const what = v.kind === 'newer' ? `-> ${v.to} (${tierOf(d.currentVersion ?? '', v.to)}${v.stability === 'preRelease' ? ', preview' : ''}${v.alsoStable ? `, stable ${v.alsoStable}` : ''})`
      : v.kind === 'upToDate' ? 'up to date'
        : v.kind === 'unknown' ? `unknown: ${v.reason}${v.detail ? ` (${v.detail})` : ''}`
          : v.kind === 'pinned' ? `pinned (${v.by})`
            : v.kind === 'rich' ? `${v.form}${v.pin ? `, pin ${v.pin}` : ''}`
              : 'managed by a BOM';
    console.log(`${d.kind.padEnd(7)} ${d.name.padEnd(width)} ${(d.currentVersion ?? '').padEnd(16)} ${what.padEnd(40)} ${where}`);
  }
  if (report.rails.length > 0) {
    console.log('\ncompatibility:');
    for (const r of report.rails) console.log(`  ${r.message}`);
  }
  const by = new Map<string, number>();
  for (const f of report.findings) by.set(f.verdict.kind === 'unknown' ? `unknown ${f.verdict.reason}` : f.verdict.kind, (by.get(f.verdict.kind === 'unknown' ? `unknown ${f.verdict.reason}` : f.verdict.kind) ?? 0) + 1);
  console.log(`\nverdicts: ${[...by].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (stats) console.log(`requests ${stats.requested}, fetched ${stats.fetched}, from cache ${stats.fromCache}, not modified ${stats.notModified}${stats.skipped ? `, skipped (${stats.skipped})` : ''}${stats.quietHosts.length ? `, quiet hosts ${stats.quietHosts.join(', ')}` : ''}`);
  console.log(`elapsed ${elapsed} ms, cache ${cacheDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
