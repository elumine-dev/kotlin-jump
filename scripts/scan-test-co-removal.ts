/**
 * KJ-047 dry-run: for every testOnly finding, the tests that would go with it.
 *
 *   npx vite-node scripts/scan-test-co-removal.ts <project-root> [--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { findDeadIslands } from '../src/providers/deadIslands';
import { findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';
import { planTestCoRemoval, isOfferable } from '../src/providers/testCoRemoval';
import { parse } from '../src/indexer/KotlinParser';
import { parseJava } from '../src/indexer/JavaParser';
import { isTestSourceSet } from '../src/util/testPaths';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const EXCLUDED = new Set(['build', '.gradle', 'generated', '.idea', '.git', 'node_modules']);
const IGNORE_PATHS = ['**/buildSrc/**', '**/build-logic/**'];

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!EXCLUDED.has(x.name)) walk(full, hit); }
    else if (SOURCE_RE.test(x.name)) hit(full);
  }
}

function main(): void {
  const root = process.argv.slice(2).find(a => !a.startsWith('--'))!;
  const apply = process.argv.includes('--apply');
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, f => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(f)) moduleDirs.push(f.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    try { sources.push({ path: f, text: fs.readFileSync(f, 'utf8') }); } catch { /* unreadable */ }
  });
  const libraryModules = moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && /com\.android\.library|android-library/.test(s.text)));

  const symbols = findUnusedSymbols({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, libraryModules, ignorePaths: IGNORE_PATHS, includeTestOnly: true, frameworkNameSuffixes: false });
  const members = findUnusedMembers({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, ignorePaths: IGNORE_PATHS, includeTestOnly: true, includeSelfOnly: true, deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })) });
  const islands = findDeadIslands({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true, maxIslandSize: 8 });
  const enums = findUnusedEnumEntries({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true });

  // Tout ce que la production declare : un test qui en exerce un n est pas a nous.
  const liveNames = new Set<string>();
  for (const s of sources) {
    if (!/\.(kt|java)$/.test(s.path)) continue;
    if (isTestSourceSet(s.path, DEFAULT_TEST_SEGMENTS)) continue;
    const parsed = s.path.endsWith('.java') ? parseJava(s.path, s.text) : parse(s.path, s.text);
    // Premier niveau seulement : les locales et les parametres partagent des
    // noms communs, et les compter disqualifiait presque tous les tests.
    for (const sym of parsed.symbols) if (sym.depth === 0) liveNames.add(sym.name);
  }
  console.log(`noms vivants         : ${liveNames.size}`);

  const groupes: { famille: string; libelle: string; noms: string[]; allowed?: string[] }[] = [];
  for (const s of symbols) if (s.verdict === 'testOnly') groupes.push({ famille: 'symbole', libelle: s.name, noms: [s.name] });
  for (const m of members) if (m.verdict === 'testOnly') groupes.push({ famille: 'membre', libelle: `${m.container}.${m.name}`, noms: [m.name], allowed: (m.container ?? '').split('.') });
  for (const i of islands) if (i.verdict === 'testOnly') groupes.push({ famille: 'ilot', libelle: i.members.map(m => m.name).join('+'), noms: i.members.map(m => m.name) });
  for (const e of enums) if (e.verdict === 'testOnly') groupes.push({ famille: 'enum', libelle: `${e.enumName}.${e.name}`, noms: [e.name], allowed: [e.enumName] });

  let offrables = 0, fichiers = 0, fonctions = 0, retenus = 0;
  const parFamille = new Map<string, { total: number; ok: number }>();
  const tousFichiers = new Set<string>();
  const lignes: string[] = [];
  const raisons = new Map<string, number>();
  const detail: string[] = [];
  for (const g of groupes) {
    const plan = planTestCoRemoval(g.noms, sources, DEFAULT_TEST_SEGMENTS, liveNames, g.allowed ?? []);
    const stat = parFamille.get(g.famille) ?? { total: 0, ok: 0 };
    stat.total++;
    if (isOfferable(plan)) {
      stat.ok++; offrables++;
      fichiers += plan.files.length; fonctions += plan.functions;
      for (const f of plan.files) tousFichiers.add(f);
      lignes.push(`  ${g.famille.padEnd(8)} ${g.libelle.padEnd(48)} ${plan.files.length} fichier(s), ${plan.cuts.filter(c => c.kind === 'function').length} fonction(s)`);
    } else {
      retenus++;
      const r = plan.unresolved[0]?.reason ?? 'aucun test trouve';
      raisons.set(r.replace(/ [A-Za-z_]\w*$/, ' <nom>'), (raisons.get(r.replace(/ [A-Za-z_]\w*$/, ' <nom>')) ?? 0) + 1);
      if (detail.length < 12 && plan.unresolved[0]) detail.push(`  ${g.libelle.padEnd(46)} ${plan.unresolved[0].reason}`);
    }
    parFamille.set(g.famille, stat);
  }
  console.log(`trouvailles testOnly : ${groupes.length}`);
  for (const [f, s] of parFamille) console.log(`  ${f.padEnd(8)} ${s.ok}/${s.total} avec un plan complet`);
  console.log(`plan offert          : ${offrables}, retenu ${retenus}`);
  console.log(`emporterait          : ${tousFichiers.size} fichier(s) de test entiers, ${fonctions} fonction(s)`);
  for (const l of lignes.slice(0, 40)) console.log(l);
  console.log('\nretenus, par raison:');
  for (const [r, n] of [...raisons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);
  console.log('\nquelques cas:');
  for (const d of detail) console.log(d);
  if (apply) {
    for (const f of tousFichiers) fs.rmSync(f, { force: true });
    console.log(`\nsupprime ${tousFichiers.size} fichier(s) de test`);
  }
}

main();
