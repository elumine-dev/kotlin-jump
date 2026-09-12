/**
 * KJ-047 on disk: every testOnly finding whose tests can be delimited, and
 * those tests, removed together.
 *
 *   npx vite-node scripts/apply-testonly-removals.ts <project-root> [--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_TEST_SEGMENTS, isTestSourceSet } from '../src/util/testPaths';
import { parse } from '../src/indexer/KotlinParser';
import { parseJava } from '../src/indexer/JavaParser';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { findDeadIslands } from '../src/providers/deadIslands';
import { findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';
import { planTestCoRemoval, isOfferable } from '../src/providers/testCoRemoval';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const EXCLUDED = new Set(['build', '.gradle', 'generated', '.idea', '.git', 'node_modules']);
const IGNORE = ['**/buildSrc/**', '**/build-logic/**'];

function walk(d: string, hit: (f: string) => void): void {
  let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(d, x.name);
    if (x.isDirectory()) { if (!EXCLUDED.has(x.name)) walk(full, hit); } else if (SOURCE_RE.test(x.name)) hit(full);
  }
}

interface G { label: string; names: string[]; allowed: string[]; path: string; start: number; end: number }

function main(): void {
  const root = process.argv.filter(a => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isDirectory()).pop()!;
  const apply = process.argv.includes('--apply');
  // `--force` leve la garde de JUGEMENT (« ce test couvre aussi X »), que
  // l'utilisateur a tranchee, et garde la garde de DELIMITATION (« je ne sais
  // pas ou couper »), qui n'est pas une question d'avis.
  const force = process.argv.includes('--force');
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, f => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(f)) moduleDirs.push(f.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    try { sources.push({ path: f, text: fs.readFileSync(f, 'utf8') }); } catch { /* ignore */ }
  });
  const libraryModules = moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && /com\.android\.library|android-library/.test(s.text)));

  const symbols = findUnusedSymbols({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, libraryModules, ignorePaths: IGNORE, includeTestOnly: true, frameworkNameSuffixes: false });
  const members = findUnusedMembers({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, ignorePaths: IGNORE, includeTestOnly: true, includeSelfOnly: false, deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })) });
  const islands = findDeadIslands({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true, maxIslandSize: 8 });
  const entries = findUnusedEnumEntries({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true });

  const live = new Set<string>();
  for (const s of sources) {
    if (!/\.(kt|java)$/.test(s.path) || isTestSourceSet(s.path, DEFAULT_TEST_SEGMENTS)) continue;
    const p = s.path.endsWith('.java') ? parseJava(s.path, s.text) : parse(s.path, s.text);
    for (const sym of p.symbols) if (sym.depth === 0) live.add(sym.name);
  }

  const groups: G[] = [];
  for (const s of symbols) if (s.verdict === 'testOnly' && s.removeStart >= 0) groups.push({ label: s.name, names: [s.name], allowed: [], path: s.path, start: s.removeStart, end: s.removeEnd });
  for (const m of members) if (m.verdict === 'testOnly' && m.removeStart >= 0) groups.push({ label: `${m.container}.${m.name}`, names: [m.name], allowed: (m.container ?? '').split('.'), path: m.path, start: m.removeStart, end: m.removeEnd });
  for (const e of entries) if (e.verdict === 'testOnly' && e.removeStart >= 0) groups.push({ label: `${e.enumName}.${e.name}`, names: [e.name], allowed: [e.enumName], path: e.path, start: e.removeStart, end: e.removeEnd });
  for (const i of islands) if (i.verdict === 'testOnly' && i.fixable) for (const m of i.members) groups.push({ label: i.members.map(x => x.name).join(' + '), names: i.members.map(x => x.name), allowed: [], path: m.path, start: m.removeStart, end: m.removeEnd });

  const cuts = new Map<string, { start: number; end: number }[]>();
  const doomed = new Set<string>();
  const plans = new Map<string, ReturnType<typeof planTestCoRemoval>>();
  let offered = 0, withheld = 0, fonctions = 0;
  const lignes: string[] = [];
  const raisons = new Map<string, number>();
  for (const g of groups) {
    let plan = plans.get(g.label);
    if (plan === undefined) {
      plan = planTestCoRemoval(g.names, sources, DEFAULT_TEST_SEGMENTS, force ? undefined : live, g.allowed);
      plans.set(g.label, plan);
      if (isOfferable(plan)) {
        offered++; fonctions += plan.functions;
        lignes.push(`  ${g.label.padEnd(52)} ${plan.files.length} fichier(s), ${plan.cuts.filter(c => c.kind === 'function').length} fonction(s)`);
      } else {
        withheld++;
        const r = (plan.unresolved[0]?.reason ?? 'aucun test trouve').replace(/ [A-Za-z_]\w*$/, ' <nom>');
        raisons.set(r, (raisons.get(r) ?? 0) + 1);
      }
    }
    if (!isOfferable(plan)) continue;
    (cuts.get(g.path) ?? cuts.set(g.path, []).get(g.path)!).push({ start: g.start, end: g.end });
    for (const f of plan.files) doomed.add(f);
    for (const c of plan.cuts) (cuts.get(c.path) ?? cuts.set(c.path, []).get(c.path)!).push({ start: c.start, end: c.end });
  }
  console.log(`testOnly : ${plans.size} groupe(s), ${offered} offert(s), ${withheld} retenu(s), ${fonctions} fonction(s) de test`);
  for (const l of lignes) console.log(l);
  console.log('\nretenus, par raison :');
  for (const [r, n] of [...raisons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);
  if (apply) {
    for (const [p, list] of cuts) {
      if (doomed.has(p)) continue;
      let t = fs.readFileSync(p, 'utf8');
      const uniq = [...new Map(list.map(c => [`${c.start}:${c.end}`, c])).values()].sort((a, b) => b.start - a.start);
      let prev = Infinity;
      for (const c of uniq) { if (c.end > prev) continue; t = t.slice(0, c.start) + t.slice(c.end); prev = c.start; }
      fs.writeFileSync(p, t);
    }
    for (const p of doomed) fs.rmSync(p, { force: true });
    console.log(`\napplique : ${cuts.size} fichier(s) coupes, ${doomed.size} fichier(s) de test supprimes`);
  }
}

main();
