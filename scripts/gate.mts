/**
 * The gate a gap fix must cross: one command, one line per proof.
 *
 *   node scripts/gate.mts G54 [--no-gradle] [--no-mutation] [--gradle]
 *   node scripts/gate.mts --baseline [--no-gradle]
 *   node scripts/gate.mts --audit [--no-gradle]     steps 3 to 5 only, for the nightly audit
 *
 * WHY ONE COMMAND. Closing a gap used to mean an agent rebuilding its own
 * harness, reading thousands of lines of output, and deciding by eye. Two
 * such runs cost six million tokens. Here every proof is an exit code or a
 * count, the full logs go to files, and the caller reads about thirty lines.
 *
 * The proofs, in order, stopping at the first red:
 *   1 witness    the gap's test file passes and no `it.fails` is left
 *   2 suite      the whole unit suite and `tsc --noEmit` pass
 *   3 report     on the untouched reference project, what the report
 *                announces matches what the edit takes (verify-report-matches-edit)
 *   4 real       Remove All applied to the fixed point on the reference project,
 *                compared with the baseline taken on main: a finding LOST is red
 *   5 build      only when step 4 moved something: Gradle compiles main, test,
 *                release and staging sources of both apps (compile only, so no
 *                minify and no Crashlytics upload)
 *   6 teeth      scripts/mutate-gate.mts reverts each hunk of the fix alone and
 *                expects the witness to turn red
 *   7 perf       a warning when the fix touches the parser or the index
 *
 * Environment: KJ_GATE_WORKTREE (default ~/Desktop/work/lapresse-kj-clean), a
 * worktree this script owns and resets; KJ_GATE_DIR (default
 * ~/Desktop/work/kj-gate) for the baseline and the logs, outside the repository
 * so a publish never packages them.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const WORKTREE = process.env.KJ_GATE_WORKTREE ?? path.join(os.homedir(), 'Desktop/work/lapresse-kj-clean');
const OUT = process.env.KJ_GATE_DIR ?? path.join(os.homedir(), 'Desktop/work/kj-gate');
const LOGS = path.join(OUT, 'logs');
const BASELINE = path.join(OUT, 'baseline.json');
const QUEUE = path.join(REPO, 'doc/gaps-queue.json');

/**
 * Compile tasks, not assemble: `replicaBuild` assembles release variants,
 * which minifies and uploads Crashlytics mappings on every run. Compiling the
 * four source sets catches what a cut breaks without either side effect.
 * `assembleDebug` alone misses test, release and staging sources, a third of
 * the risk (reference_delete_and_build_audit).
 */
const GRADLE_TASKS = [
  'compileDebugUnitTestSources',
  'compileReleaseSources',
  ':replica:app:compileReplicaLaPresseDebugUnitTestSources',
  ':replica:app:compileAdPreflightLaPresseDebugUnitTestSources',
  ':replica:app:compileReplicaLaPresseReleaseSources',
  ':replica:app:compileReplicaLaPresseStagingSources',
  ':replica:app:compileAdPreflightLaPresseStagingSources',
  ':replica:app:compileAdPreflightLaPresseReleaseSources',
  ':replica:shell:compileLaPresseDebugUnitTestSources',
  ':rubicon:app:compileStagingSources',
];

interface Entry {
  id: string;
  temoin?: string;
  perdusAutorises?: string[];
  mutantsEquivalents?: string[];
}

interface Baseline {
  worktreeHead: string;
  repoHead: string;
  keys: Record<string, number>;
  gradleOk: boolean | null;
  gradleErrors: string[];
  rapport: Record<string, number>;
  extraits: Record<string, string>;
  testKeys: Record<string, number>;
}

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const audit = flag('--audit');
const id = audit ? 'AUDIT' : args.find(a => !a.startsWith('--'));

fs.mkdirSync(LOGS, { recursive: true });
const stamp = (flag('--baseline') ? 'baseline' : id ?? 'baseline').toLowerCase();

let failed = false;
function line(state: 'OK' | 'KO' | '--' | '!!', step: string, detail: string): void {
  console.log(`${state}  ${step.padEnd(9)} ${detail}`);
  if (state === 'KO') failed = true;
}

function run(cmd: string, argv: string[], opts: { cwd?: string; log: string; env?: NodeJS.ProcessEnv; timeoutMin?: number }) {
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd ?? REPO,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    timeout: (opts.timeoutMin ?? 30) * 60_000,
  });
  const logPath = path.join(LOGS, `${stamp}-${opts.log}.log`);
  fs.writeFileSync(logPath, `$ ${cmd} ${argv.join(' ')}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, logPath };
}

function git(cwd: string, ...argv: string[]): string {
  return spawnSync('git', ['--no-pager', ...argv], { cwd, encoding: 'utf8' }).stdout.trim();
}

function finish(): never {
  const free = spawnSync('df', ['-g', WORKTREE], { encoding: 'utf8' }).stdout.split('\n')[1]?.split(/\s+/)[3];
  console.log(`\n${failed ? 'PORTE ROUGE' : 'PORTE VERTE'}  logs: ${LOGS}/${stamp}-*.log  disque libre: ${free ?? '?'} Go`);
  process.exit(failed ? 1 : 0);
}

function resetWorktree(): void {
  git(WORKTREE, 'reset', '-q', '--hard');
  git(WORKTREE, 'clean', '-fdq');
}

/** Bundles a harness that imports `src/` (and so `vscode`) for plain node. */
function bundle(entry: string, outName: string): string {
  const outfile = path.join(REPO, 'dist/perf', outName);
  const r = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--log-level=error',
    `--alias:vscode=${path.join(REPO, 'test/unit/__mocks__/vscode.ts')}`, `--outfile=${outfile}`,
  ], { log: `bundle-${outName}` });
  if (r.code !== 0) { line('KO', 'bundle', `${entry} ne se construit pas, voir ${r.logPath}`); finish(); }
  return outfile;
}

/** Runs Remove All to the fixed point on the worktree, returns its cuts as a multiset. */
function applyAll(applyCjs: string): { keys: Map<string, number>; extraits: Map<string, string>; testKeys: Map<string, number>; fixedPoint: boolean; logPath: string } {
  const manifest = path.join(OUT, `${stamp}-manifest.json`);
  const testManifest = path.join(OUT, `${stamp}-tests.json`);
  const r = run('node', [applyCjs, WORKTREE, '--apply', '--tests'], { log: 'apply', env: { KJ_MANIFEST: manifest, KJ_TEST_MANIFEST: testManifest }, timeoutMin: 20 });
  if (r.code !== 0 || !fs.existsSync(manifest)) { line('KO', 'reel', `Remove All a planté, voir ${r.logPath}`); resetWorktree(); finish(); }
  const cuts: { path: string; why: string; extrait?: string }[] = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const keys = new Map<string, number>();
  const extraits = new Map<string, string>();
  for (const c of cuts) {
    const k = `${c.path}\t${c.why}`;
    keys.set(k, (keys.get(k) ?? 0) + 1);
    if (c.extrait && !extraits.has(k)) extraits.set(k, c.extrait);
  }
  const testKeys = new Map<string, number>();
  const testCuts: { path: string; why: string; extrait: string }[] = fs.existsSync(testManifest) ? JSON.parse(fs.readFileSync(testManifest, 'utf8')) : [];
  for (const c of testCuts) {
    const k = `${c.path}\t${c.why}`;
    testKeys.set(k, (testKeys.get(k) ?? 0) + 1);
    if (c.extrait && !extraits.has(k)) extraits.set(k, c.extrait);
  }
  return { keys, extraits, testKeys, fixedPoint: /fixed point|round with no effect|none kept/.test(r.out), logPath: r.logPath };
}

function gradle(): { ok: boolean; errors: string[]; logPath: string } {
  // Not --offline: a develop that moves to a new AGP needs its plugins once.
  const argv = ['--continue', '--console=plain', '-q', ...GRADLE_TASKS];
  let r = run('./gradlew', argv, { cwd: WORKTREE, log: 'gradle', timeoutMin: 60 });
  // A stale incremental KSP cache fails after large deletions and is not the
  // cut's fault (reference_lapresse_build_after_cleanup): clear it, retry once.
  if (r.code !== 0 && /ksp/i.test(r.out)) {
    const found = spawnSync('find', [WORKTREE, '-maxdepth', '5', '-type', 'd', '-name', 'kspCaches', '-path', '*/build/*'], { encoding: 'utf8' });
    for (const d of found.stdout.split('\n').filter(Boolean)) fs.rmSync(d, { recursive: true, force: true });
    r = run('./gradlew', argv, { cwd: WORKTREE, log: 'gradle-retry', timeoutMin: 60 });
  }
  const lines = r.out.split('\n');
  const errors = lines
    .map((l, i) => /What went wrong/.test(l) ? (lines.slice(i + 1).find(x => x.trim() !== '') ?? l).trim() : l)
    .filter((l, i) => /^e: |error:/.test(l) || /What went wrong/.test(lines[i]))
    .slice(0, 20);
  return { ok: r.code === 0, errors, logPath: r.logPath };
}

function readQueueEntry(gap: string): Entry {
  try {
    const q: Entry[] = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
    const e = q.find(x => x.id === gap);
    if (e) return e;
  } catch { /* no queue yet: fall back to the naming convention */ }
  return { id: gap };
}

function witnessFiles(entry: Entry): string[] {
  if (entry.temoin) {
    const dir = path.join(REPO, path.dirname(entry.temoin));
    const re = new RegExp(`^${path.basename(entry.temoin).replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`);
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(path.dirname(entry.temoin!), f)) : [];
  }
  const num = entry.id.replace(/^G/, '').padStart(2, '0');
  const dir = path.join(REPO, 'test/unit/gaps');
  return fs.readdirSync(dir).filter(f => f.startsWith(`G${num}.`) && f.endsWith('.test.ts')).map(f => `test/unit/gaps/${f}`);
}

const RAPPORT_KEYS = ['ecart', 'phrase', 'somme', 'perdu', 'plageLigne', 'plageOrdre'];

/** verify-report-matches-edit on the untouched worktree: its counters, or undefined. */
function rapport(): { counts: Record<string, number>; logPath: string; retenues: number; effaces: number } | undefined {
  const cjs = bundle('scripts/verify-report-matches-edit.ts', 'gate-rapport.cjs');
  const r = run('node', [cjs, WORKTREE], { log: 'rapport', timeoutMin: 20 });
  const json = r.out.split('\n').find(l => l.startsWith('{'));
  if (r.code !== 0 || !json) return undefined;
  const c = JSON.parse(json);
  const counts = Object.fromEntries(RAPPORT_KEYS.map(k => [k, c[k] ?? 0]));
  if (c.temoinVoit === false) counts.temoinAveugle = 1;
  return { counts, logPath: r.logPath, retenues: c.coupesRetenues, effaces: c.fichiersEffaces };
}

// ---------------------------------------------------------------------------

if (git(WORKTREE, 'rev-parse', '--is-inside-work-tree') !== 'true') {
  console.error(`pas de worktree de porte a ${WORKTREE} (KJ_GATE_WORKTREE)`);
  process.exit(2);
}
if (git(WORKTREE, 'status', '--porcelain') !== '') resetWorktree();
// A full disk fails AAPT with « IO error », which reads like a code defect
// (reference_scratchpad_fills_the_disk). Refuse to start below 8 GB.
const freeGb = Number(spawnSync('df', ['-g', WORKTREE], { encoding: 'utf8' }).stdout.split('\n')[1]?.split(/\s+/)[3] ?? 99);
if (freeGb < 8) { line('KO', 'disque', `${freeGb} Go libres, il en faut 8 : vider les copies et caches avant de relancer`); finish(); }

const applyCjs = bundle('scripts/apply-kj-removals.ts', 'gate-apply.cjs');

if (flag('--baseline')) {
  const rap0 = rapport();
  line(rap0 ? 'OK' : 'KO', 'rapport', rap0 ? `compteurs de référence : ${JSON.stringify(rap0.counts)}` : 'le contrôle n\'a rien rendu');
  const { keys, extraits, testKeys, fixedPoint, logPath } = applyAll(applyCjs);
  line('OK', 'tests', `Remove Test Only Code (revue) planifie ${[...testKeys.values()].reduce((a, b) => a + b, 0)} coupe(s) de test`);
  const total = [...keys.values()].reduce((a, b) => a + b, 0);
  line(fixedPoint ? 'OK' : 'KO', 'reel', `${total} coupe(s) au point fixe sur ${path.basename(WORKTREE)}, voir ${logPath}`);
  let g: ReturnType<typeof gradle> | undefined;
  // --no-gradle keeps the build verdict of a baseline taken on the same develop.
  const previous: Baseline | undefined = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : undefined;
  const reuse = flag('--no-gradle') && previous?.worktreeHead === git(WORKTREE, 'rev-parse', 'HEAD') ? previous : undefined;
  if (reuse) line('--', 'build', `repris de la référence précédente : ${reuse.gradleOk ? 'compile' : `${reuse.gradleErrors.length} erreur(s) connues`}`);
  if (!flag('--no-gradle')) {
    g = gradle();
    line(g.ok ? 'OK' : '!!', 'build', g.ok ? 'la référence compile après Remove All' : `la référence NE compile PAS, ${g.errors.length} erreur(s), voir ${g.logPath}`);
  }
  resetWorktree();
  const b: Baseline = {
    worktreeHead: git(WORKTREE, 'rev-parse', 'HEAD'),
    repoHead: git(REPO, 'rev-parse', 'HEAD'),
    keys: Object.fromEntries(keys),
    gradleOk: g ? g.ok : reuse?.gradleOk ?? null,
    gradleErrors: g?.errors ?? reuse?.gradleErrors ?? [],
    rapport: rap0?.counts ?? {},
    extraits: Object.fromEntries(extraits),
    testKeys: Object.fromEntries(testKeys),
  };
  fs.writeFileSync(BASELINE, JSON.stringify(b, null, 1));
  console.log(`référence écrite : ${BASELINE}`);
  finish();
}

if (!id) {
  console.error('usage: node scripts/gate.mts <Gnn> [--no-gradle] [--gradle] [--no-mutation] | --baseline');
  process.exit(2);
}
if (!fs.existsSync(BASELINE)) { console.error(`pas de référence : lancer d'abord node scripts/gate.mts --baseline`); process.exit(2); }
const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
if (git(WORKTREE, 'rev-parse', 'HEAD') !== baseline.worktreeHead) {
  console.error('le worktree de porte a bougé depuis la référence : relancer --baseline');
  process.exit(2);
}
const entry = readQueueEntry(id);

// 1. witness ---------------------------------------------------------------
const witnesses = audit ? [] : witnessFiles(entry);
if (audit) line('--', 'temoin', 'mode audit : témoin et suite sautés');
else if (witnesses.length === 0) {
  line('KO', 'temoin', `aucun témoin pour ${id} (champ temoin de la file, ou test/unit/gaps/G${id.slice(1).padStart(2, '0')}.*)`);
  finish();
}
if (!audit) {
const itFails = witnesses.reduce((n, f) => n + fs.readFileSync(path.join(REPO, f), 'utf8').split('\n').filter(l => /^\s*it\.fails\(/.test(l)).length, 0);
const gapsConfig = witnesses.every(f => f.startsWith('test/unit/gaps/')) ? ['--config', 'vitest.gaps.config.ts'] : [];
const w = run('npx', ['vitest', 'run', ...gapsConfig, ...witnesses], { log: 'temoin' });
if (w.code !== 0) line('KO', 'temoin', `${witnesses.join(' ')} échoue, voir ${w.logPath}`);
else if (itFails > 0) line('KO', 'temoin', `vert mais ${itFails} it.fails restant(s) : le trou n'est pas fermé`);
else line('OK', 'temoin', `${witnesses.length} fichier(s), 0 it.fails`);
if (failed) finish();

// 2. suite -----------------------------------------------------------------
const suite = run('npx', ['vitest', 'run'], { log: 'suite', timeoutMin: 20 });
const tsc = run('npx', ['tsc', '--noEmit', '-p', '.'], { log: 'tsc' });
if (suite.code !== 0) line('KO', 'suite', `tests unitaires rouges, voir ${suite.logPath}`);
else if (tsc.code !== 0) line('KO', 'suite', `tsc rouge, voir ${tsc.logPath}`);
else line('OK', 'suite', 'vitest et tsc verts');
if (failed) finish();
}

// 3. report against edit, on the untouched worktree -------------------------
// Compared with the baseline, like step 4: a counter already non zero on main
// is a known debt, only a WORSE counter is the fix's doing.
const rap = rapport();
if (!rap) line('KO', 'rapport', `le contrôle n'a rien rendu, voir ${LOGS}/${stamp}-rapport.log`);
else {
  const worse = Object.entries(rap.counts).filter(([k, n]) => n > (baseline.rapport?.[k] ?? 0));
  const debt = Object.entries(rap.counts).filter(([, n]) => n > 0);
  if (worse.length > 0) line('KO', 'rapport', `pire que la référence : ${worse.map(([k, n]) => `${k} ${baseline.rapport?.[k] ?? 0}->${n}`).join(', ')}, voir ${rap.logPath}`);
  else if (debt.length > 0) line('!!', 'rapport', `pas pire que la référence, dette connue : ${debt.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  else line('OK', 'rapport', `compte rendu = édition (${rap.retenues} coupes, ${rap.effaces} fichiers)`);
}
if (failed) finish();

// 4. real project, fixed point, against the baseline -----------------------
const { keys, extraits, testKeys, fixedPoint, logPath: applyLog } = applyAll(applyCjs);
const allowed = entry.perdusAutorises ?? [];
const lost: string[] = [];
const gained: string[] = [];
for (const [k, n] of Object.entries(baseline.keys)) for (let i = keys.get(k) ?? 0; i < n; i++) lost.push(k);
for (const [k, n] of keys) for (let i = baseline.keys[k] ?? 0; i < n; i++) gained.push(k);
const lostBad = lost.filter(k => !allowed.some(a => k.includes(a)));
/** One line per key, `×n` when a key repeats (a test file shared by several groups). */
const tally = (l: string[], x: (k: string) => string) => [...new Set(l)].map(k => { const n = l.filter(y => y === k).length; return `${k}\t${x(k)}${n > 1 ? `\t×${n}` : ''}`; }).join('\n');
fs.writeFileSync(path.join(LOGS, `${stamp}-ecart.txt`), `PERDUS (${lost.length})\n${tally(lost, k => baseline.extraits?.[k] ?? '')}\n\nGAGNÉS (${gained.length})\n${tally(gained, k => extraits.get(k) ?? '')}\n`);
const label = (k: string) => { const [p, why] = k.split('\t'); const x = extraits.get(k) ?? baseline.extraits?.[k]; return `${path.basename(p)} ${why === 'cut' && x ? `« ${x} »` : why}`; };
const show = (l: string[]) => [...new Set(l)].slice(0, 3).map(label).join(' ; ');
if (!fixedPoint) line('KO', 'retirable', `pas de point fixe en 16 rondes, voir ${applyLog}`);
else line('OK', 'retirable', 'Remove All atteint le point fixe');
if (lostBad.length > 0) line('KO', 'reel', `${lostBad.length} trouvaille(s) PERDUE(S) : ${show(lostBad)}`);
else line('OK', 'reel', `+${gained.length} gagnée(s)${gained.length ? ` : ${show(gained)}` : ''}, -${lost.length} perdue(s) autorisée(s)`);
// Remove Test Only Code: fewer test cuts is usually the fix (G52), more is the
// risk, and a test FILE newly deleted is the worst of it, so only that is red.
const tLost: string[] = [];
const tGained: string[] = [];
for (const [k, n] of Object.entries(baseline.testKeys ?? {})) for (let i = testKeys.get(k) ?? 0; i < n; i++) tLost.push(k);
for (const [k, n] of testKeys) for (let i = baseline.testKeys?.[k] ?? 0; i < n; i++) tGained.push(k);
const newFiles = tGained.filter(k => k.endsWith('\ttest-file-deleted') && !allowed.some(a => k.includes(a)));
fs.appendFileSync(path.join(LOGS, `${stamp}-ecart.txt`), `\nTESTS PERDUS (${tLost.length})\n${tally(tLost, k => baseline.extraits?.[k] ?? '')}\n\nTESTS GAGNÉS (${tGained.length})\n${tally(tGained, k => extraits.get(k) ?? '')}\n`);
if (newFiles.length > 0) line('KO', 'tests', `${newFiles.length} fichier(s) de test NOUVELLEMENT supprimé(s) : ${show(newFiles)}`);
else if (tLost.length + tGained.length > 0) line('!!', 'tests', `Remove Test Only Code change : -${tLost.length} / +${tGained.length} coupe(s), à justifier une par une (${show([...tLost, ...tGained])})`);
else line('OK', 'tests', 'Remove Test Only Code inchangé');
console.log(`    détail : ${LOGS}/${stamp}-ecart.txt`);

// 5. build -----------------------------------------------------------------
const moved = lost.length + gained.length > 0;
if (failed || flag('--no-gradle') || (!moved && !flag('--gradle'))) {
  line('--', 'build', failed ? 'sauté : déjà rouge' : moved ? 'sauté (--no-gradle)' : 'sauté : aucun écart sur LaPresse');
} else {
  // Compared with the baseline: develop itself may not compile (the adPreflight
  // unit tests have been broken since #1274), and that is not the cut's doing.
  const g = gradle();
  const known = new Set(baseline.gradleErrors);
  const fresh = g.errors.filter(e => !known.has(e));
  if (g.ok) line('OK', 'build', 'LaPresse compile après Remove All (main, test, release, staging)');
  else if (fresh.length === 0 && baseline.gradleOk === false) line('!!', 'build', `mêmes ${g.errors.length} erreur(s) que la référence, aucune nouvelle`);
  else line('KO', 'build', `${fresh[0] ?? g.errors[0] ?? 'échec'}  (+${Math.max(0, fresh.length - 1)} nouvelle(s)), voir ${g.logPath}`);
}
resetWorktree();
if (failed) finish();

// 6. teeth -----------------------------------------------------------------
if (audit) finish();
if (flag('--no-mutation')) line('--', 'dents', 'sauté (--no-mutation)');
else if (git(REPO, 'diff', '--name-only', 'main', '--', 'src/') === '') line('--', 'dents', 'sauté : aucun correctif dans src/ par rapport à main');
else {
  const m = run('node', ['scripts/mutate-gate.mts', ...witnesses, ...(entry.mutantsEquivalents ?? []).map(e => `--equivalent=${e}`)], { log: 'mutation', timeoutMin: 60 });
  const last = m.out.trim().split('\n').pop() ?? '';
  line(m.code === 0 ? 'OK' : 'KO', 'dents', `${last}${m.code === 0 ? '' : `, voir ${m.logPath}`}`);
}

// 7. perf ------------------------------------------------------------------
const hot = git(REPO, 'diff', '--name-only', 'main', '--', 'src/indexer').split('\n').filter(Boolean);
if (hot.length > 0) line('!!', 'perf', `le correctif touche ${hot.join(', ')} : mesurer avant fusion (perf-bench, puis perf-diff)`);
else line('OK', 'perf', 'ni parseur ni index touchés');

finish();
