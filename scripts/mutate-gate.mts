/**
 * Does the witness have teeth? Reverts each hunk of the fix ALONE and expects
 * the witness to turn red.
 *
 *   node scripts/mutate-gate.mts <test files...> [--base=main] [--equivalent=src/x.ts:120]
 *
 * The fix is `git diff <base> -- src/`, uncommitted work included. The copy is
 * built once with rsync and a node_modules symlink (reference_mutation_testing),
 * each hunk is reverted with `git apply -R`, the tests run, the hunk goes back.
 *
 * Judged by vitest's exit code, never by parsing its output: a harness that
 * read "FAIL (n)" once declared six killed mutants survivors.
 *
 * A survivor is either a weak test or an equivalent mutant (two branches of the
 * fix covering each other). Only a human can tell which, so a survivor is red
 * until it is named with --equivalent=<file>:<first line of the hunk>. The
 * test files the fix added or changed run too: a new witness counts.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const base = args.find(a => a.startsWith('--base='))?.slice('--base='.length) ?? 'main';
const equivalents = args.filter(a => a.startsWith('--equivalent=')).map(a => a.slice('--equivalent='.length));
const tests = new Set(args.filter(a => !a.startsWith('--')));

const git = (...argv: string[]) => spawnSync('git', ['--no-pager', ...argv], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;

for (const t of git('diff', '--name-only', base, '--', 'test/').split('\n')) {
  if (/\.test\.ts$/.test(t) && fs.existsSync(path.join(REPO, t))) tests.add(t);
}
if (tests.size === 0) { console.log('aucun test à lancer'); process.exit(2); }

interface Hunk { file: string; line: number; patch: string }

/** One patch per hunk, each carrying its own file header. */
function hunks(diff: string): Hunk[] {
  const out: Hunk[] = [];
  let header: string[] = [];
  let file = '';
  let current: string[] | undefined;
  let line = 0;
  const flush = () => { if (current) out.push({ file, line, patch: [...header, ...current].join('\n') + '\n' }); current = undefined; };
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) { flush(); header = [l]; file = l.split(' b/')[1] ?? ''; continue; }
    if (current === undefined && !l.startsWith('@@')) { header.push(l); continue; }
    if (l.startsWith('@@')) { flush(); current = [l]; line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0); continue; }
    current!.push(l);
  }
  flush();
  return out;
}

/** A hunk that only touches comments or blank lines cannot be killed by a test. */
function onlyComments(h: Hunk): boolean {
  const changed = h.patch.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map(l => l.slice(1).trim());
  return changed.every(l => l === '' || l.startsWith('//') || l.startsWith('*') || l.startsWith('/*'));
}

// Fixed prefixes: with `diff.mnemonicprefix`, a work tree diff reads `c/` and
// `w/`, the file name parsed from ` b/` came out empty, and no
// `--equivalent=<file>:<line>` could ever match (G57, 2026-10-14).
const all = hunks(git('diff', '--src-prefix=a/', '--dst-prefix=b/', '--no-ext-diff', '--no-color', base, '--', 'src/'));
const candidates = all.filter(h => !onlyComments(h));
if (candidates.length === 0) { console.log(`0 mutant : aucun bloc de code dans git diff ${base} -- src/`); process.exit(all.length === 0 ? 2 : 0); }

const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-mutation-'));
let exitCode = 1;
try {
  // The repository root holds 240 old .vsix (17 GB), plus VS Code downloads and
  // worktrees: none of it is read by a unit test.
  const skip = ['node_modules', '.git', 'dist', 'out', '*.vsix', '.vscode-test', '.claude', 'doc'];
  spawnSync('rsync', ['-a', ...skip.flatMap(x => ['--exclude', x]), `${REPO}/`, `${copy}/`]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(copy, 'node_modules'));
  const vitest = (files: string[]) => {
    const gaps = files.filter(f => f.startsWith('test/unit/gaps/'));
    const rest = files.filter(f => !f.startsWith('test/unit/gaps/'));
    const run = (cfg: string[], fs_: string[]) => fs_.length === 0 ? 0
      : spawnSync('npx', ['vitest', 'run', ...cfg, ...fs_], { cwd: copy, encoding: 'utf8', timeout: 15 * 60_000 }).status ?? 1;
    return run(['--config', 'vitest.gaps.config.ts'], gaps) || run([], rest);
  };

  if (vitest([...tests]) !== 0) { console.log('les tests sont déjà rouges sans mutation : rien à juger'); exitCode = 1; }
  else {

  const survivors: string[] = [];
  let killed = 0;
  for (const h of candidates) {
    const patchFile = path.join(copy, '.mutant.patch');
    fs.writeFileSync(patchFile, h.patch);
    const rev = spawnSync('git', ['apply', '-R', '--unidiff-zero', patchFile], { cwd: copy, encoding: 'utf8' });
    const where = `${h.file}:${h.line}`;
    if (rev.status !== 0) { survivors.push(`${where} (bloc non réversible seul)`); continue; }
    const code = vitest([...tests]);
    spawnSync('git', ['apply', '--unidiff-zero', patchFile], { cwd: copy });
    if (code !== 0) killed++;
    else if (equivalents.includes(where)) killed++;
    else survivors.push(where);
  }
  for (const s of survivors) console.log(`SURVIVANT ${s}`);
  console.log(`${killed}/${candidates.length} mutant(s) tué(s)${survivors.length ? `, ${survivors.length} survivant(s)` : ''}`);
  exitCode = survivors.length === 0 ? 0 : 1;
  }
} finally {
  // process.exit() skips `finally`: a first version left a 21 GB copy behind.
  fs.rmSync(copy, { recursive: true, force: true });
}
process.exit(exitCode);
