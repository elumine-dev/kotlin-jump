/**
 * Dry-run harness for the cleanup campaign, outside VS Code.
 *
 *   npx vite-node scripts/plan-cleanup.ts <project-root> <out-dir> [--max-files=40] [--max-lines=1000] [--group-by=module|cause] [--no-git] [--causes-from=plan.json]
 *
 * Reads the project the way `ResourceCorpus` would, simulates Remove
 * Everything Unused to its fixed point in memory, plans the batches and
 * writes `plan.md`, `plan.json` and one `NN-slug.md` per batch into
 * `<out-dir>`. Nothing in the project is touched.
 *
 * The same functions the command runs: a plan this script writes is the plan
 * the command would write.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import { readUnusedSettings } from '../src/util/unusedSettings';
import { readAndroidApi, readCorpus } from './kjCorpus';
import { simulerLePointFixe } from '../src/cleanup/simulation';
import { planifier } from '../src/cleanup/planner';
import { lotMarkdown, planJson, planMarkdown } from '../src/cleanup/exports';
import { nomDe, aUneCause, Cause } from '../src/cleanup/planner';
import { GitFacts } from '../src/git/GitFacts';

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['--no-pager', '-c', 'color.ui=never', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim();
  } catch { return undefined; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [root, out] = args.filter(a => !a.startsWith('--'));
  if (!root || !out) { console.error('usage: plan-cleanup.ts <project-root> <out-dir> [--max-files=N] [--max-lines=N] [--group-by=module|cause]'); process.exit(2); }
  const num = (flag: string, d: number) => Number(args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? d);
  const groupBy = (args.find(a => a.startsWith('--group-by='))?.split('=')[1] ?? 'module') as 'module' | 'cause';

  const t0 = Date.now();
  const corpus = readCorpus(root);
  console.log(`sources ${corpus.sources.length}  modules ${corpus.moduleDirs.length}  assets ${corpus.assets.length}`);
  const simulation = await simulerLePointFixe(
    corpus,
    DEFAULT_TEST_SEGMENTS as readonly string[],
    { androidApi: readAndroidApi(), reglages: readUnusedSettings((_k, d) => d) },
    { surRonde: n => console.log(`round ${n}… (${((Date.now() - t0) / 1000).toFixed(0)} s)`) },
  );
  console.log(`${simulation.coupes.length} cut(s) in ${simulation.rondes} round(s), fixed point ${simulation.complete ? 'reached' : 'NOT reached'}`);

  // Git facts, unless --no-git: one pickaxe per root, the whole repository as
  // scope, because the last caller of a shared helper usually lived elsewhere.
  let causes: Map<string, Cause> | undefined;
  const faits = new GitFacts(root);
  const reprise = args.find(a => a.startsWith('--causes-from='))?.split('=')[1];
  if (reprise) {
    // Iterating on the plan or the exports: reuse the causes of a previous plan.json.
    const ancien = JSON.parse(fs.readFileSync(reprise, 'utf8')) as { batches: { cuts: { cle: string; cause?: Cause }[] }[] };
    causes = new Map(ancien.batches.flatMap(b => b.cuts).filter(c => c.cause).map(c => [c.cle, c.cause!]));
    console.log(`causes reused from ${reprise}: ${causes.size}`);
  } else if (!args.includes('--no-git') && await faits.disponibleIci()) {
    const racines = simulation.coupes.filter(aUneCause);
    const t1 = Date.now();
    causes = await faits.causesPour(racines.map(c => ({ cle: c.cle, nom: nomDe(c), chemins: [] })), {
      progres: (fait, total) => { if (fait % 50 === 0 || fait === total) console.log(`git facts ${fait}/${total} (${((Date.now() - t1) / 1000).toFixed(0)} s)`); },
    });
    const parKind = new Map<string, number>();
    for (const c of causes.values()) parKind.set(c.kind, (parKind.get(c.kind) ?? 0) + 1);
    console.log(`causes: ${[...parKind].map(([k, n]) => `${k} ${n}`).join(', ')} of ${racines.length} roots`);
  }
  const plan = planifier(simulation.coupes, {
    racine: root, moduleDirs: corpus.moduleDirs, libraryModules: corpus.libraryModules,
    maxFilesPerBatch: num('max-files', 40), maxLinesPerBatch: num('max-lines', 1000), groupBy, causes,
    mentions: simulation.mentions,
  });
  const entrees = {
    plan, simulation, racine: root, generatedAt: new Date(),
    head: git(root, ['rev-parse', '--short', 'HEAD']), branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    settings: { maxFilesPerBatch: num('max-files', 40), maxLinesPerBatch: num('max-lines', 1000), groupBy, gitFacts: !!causes },
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'plan.md'), planMarkdown(entrees));
  fs.writeFileSync(path.join(out, 'plan.json'), planJson(entrees));
  for (const lot of plan.lots) fs.writeFileSync(path.join(out, `${lot.slug}.md`), lotMarkdown(entrees, lot));
  const parVague = (w: 1 | 2) => plan.lots.filter(l => l.wave === w).length;
  console.log(`${plan.lots.length} batch(es): wave 1 ${parVague(1)}, wave 2 ${parVague(2)}; ${plan.sansDeclencheur.length} cut(s) without a trigger; written to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch(e => { console.error(e); process.exit(1); });
