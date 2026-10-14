/**
 * Replays Remove All on the parent of a hand-written deletion commit, and
 * scores it against what the commit removed.
 *
 *   node scripts/oracle-commit.mts <repo> <sha> [--keep]
 *
 * WHY. Kevin's cleanup commits are the only ground truth the gaps have: each
 * says "this was dead, and here is how much of it". Scoring a detector on its
 * own fixtures measures what someone thought of; this measures what a real
 * branch needed. Three questions per run:
 *   - which units of the commit Remove All also removes (and why not, for the rest);
 *   - which imports Remove All leaves dead in a file it cut, its own residue;
 *   - whether a second Remove All still finds something, which means the
 *     first one stopped before its fixed point.
 *
 * The worktree lives in KJ_ORACLE_DIR (default ~/Desktop/work/kj-oracle), one
 * per commit, reset on each run and removed at the end unless `--keep`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const OUT = process.env.KJ_ORACLE_DIR ?? path.join(os.homedir(), 'Desktop/work/kj-oracle');

const args = process.argv.slice(2);
const [target, sha] = args.filter(a => !a.startsWith('--'));
if (!target || !sha) { console.error('usage: node scripts/oracle-commit.mts <repo> <sha> [--keep]'); process.exit(2); }
const keep = args.includes('--keep');

function run(cmd: string, argv: string[], log?: string, env?: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, argv, { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, ...env } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (log) fs.writeFileSync(log, `$ ${cmd} ${argv.join(' ')}\n${out}`);
  return { code: r.status ?? 1, out };
}
const git = (cwd: string, ...argv: string[]) => run('git', ['-C', cwd, '--no-pager', ...argv]);

function bundle(entry: string, name: string): string {
  const outfile = path.join(REPO, 'dist/perf', name);
  const r = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--log-level=error',
    `--alias:vscode=${path.join(REPO, 'test/unit/__mocks__/vscode.ts')}`, `--outfile=${outfile}`,
  ]);
  if (r.code !== 0) { console.error(r.out); process.exit(1); }
  return outfile;
}

const full = git(target, 'rev-parse', sha).out.trim();
const short = full.slice(0, 10);
const wt = path.join(OUT, short);
const logs = path.join(OUT, 'logs');
fs.mkdirSync(logs, { recursive: true });

if (fs.existsSync(wt)) {
  git(wt, 'checkout', '-q', '--detach', `${full}~1`);
  git(wt, 'reset', '-q', '--hard');
  git(wt, 'clean', '-fdq');
} else {
  const r = git(target, 'worktree', 'add', '-q', '--detach', wt, `${full}~1`);
  if (r.code !== 0) { console.error(r.out); process.exit(1); }
}

function cleanup(): void {
  if (keep) { console.log(`\nworktree gardé : ${wt}`); return; }
  git(target, 'worktree', 'remove', '--force', wt);
}

let code = 0;
try {
  const apply = bundle('scripts/apply-kj-removals.ts', 'oracle-apply.cjs');
  const units = bundle('scripts/oracle-units.ts', 'oracle-units.cjs');

  const first = run('node', [apply, wt, '--apply'], path.join(logs, `${short}-pass1.log`),
    { KJ_MANIFEST: path.join(logs, `${short}-manifest.json`) });
  if (first.code !== 0) throw new Error(`Remove All a échoué, voir ${logs}/${short}-pass1.log`);
  console.log(first.out.split('\n').filter(l => /^round \d+:|cut\(s\), .* file\(s\) deleted/.test(l)).join('\n'));

  // A dry round on the result: what the fixed point should have taken.
  const second = run('node', [apply, wt], path.join(logs, `${short}-pass2.log`));
  const left = /round 1: (\d+) found/.exec(second.out)?.[1] ?? '0';
  console.log(`seconde passe : ${left} trouvaille(s) restante(s)${left === '0' ? '' : `, voir ${logs}/${short}-pass2.log`}\n`);

  const report = run('node', [units, target, full, wt], path.join(logs, `${short}-oracle.txt`));
  console.log(report.out);
  if (report.code !== 0) code = 1;
} catch (e) {
  console.error((e as Error).message);
  code = 1;
}
cleanup();
process.exit(code);
