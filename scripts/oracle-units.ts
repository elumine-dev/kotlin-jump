/**
 * Compares what a hand-written deletion commit removed with what Remove All
 * removed from the same parent, unit by unit.
 *
 *   node dist/perf/oracle-units.cjs <repo> <sha> <worktree-at-sha~1-after-remove-all>
 *
 * Driven by `oracle-commit.mts`, which builds the worktree and runs Remove All.
 *
 * WHY UNITS AND NOT LINES. Kevin and the extension cut the same declaration
 * with extents that differ by a blank line, a KDoc or an annotation. Counting
 * lines would score that as a partial miss. A unit is what a reviewer would
 * name: a deleted file, a declaration, an import, a Remote Config key, a
 * resource entry. Both sides are read from a diff against the same parent,
 * and declarations come from the extension's own parsers, so a member and a
 * class are told apart the way the outline does.
 *
 * WHY EXPLAIN ON THE AFTER STATE. A unit Remove All left behind was judged by
 * its LAST round. Asking the detectors on the untouched parent would give the
 * reason of the first round, which is often just a caller that a later round
 * removed.
 */
import * as path from 'path';
import { spawnSync } from 'child_process';
import { readAndroidApi, readCorpus } from './kjCorpus';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import { parse } from '../src/indexer/KotlinParser';
import { parseJava } from '../src/indexer/JavaParser';
import { findUnusedImports } from '../src/providers/unusedImports';
import { explainSymbols, findUnusedSymbols } from '../src/providers/unusedSymbols';
import { explainMembers } from '../src/providers/unusedMembers';
import { explainIslands } from '../src/providers/deadIslands';
import { explainRemoteConfigKeys } from '../src/providers/unusedRemoteConfigKeys';

interface FileDiff {
  path: string;
  deleted: boolean;
  /** 0-based lines of the parent's text that the diff removes. */
  removed: Set<number>;
}

interface Unit {
  key: string;
  path: string;
  kind: 'file' | 'decl' | 'import' | 'rc-key' | 'res';
  name: string;
  line: number;
  /**
   * False for what follows another unit: a declaration nested in a removed
   * one, anything in a deleted file but the file itself, an import. Counting
   * them as findings scored the fields of a dropped class as misses of their
   * own, 584 units for a commit whose misses had far fewer causes.
   */
  root: boolean;
}

/**
 * Fixed prefixes: with `diff.mnemonicprefix` set, a work tree diff reads
 * `c/` and `w/` instead of `a/` and `b/`, and every file of Remove All's side
 * went unparsed, scoring 0 found on a run that had found 61 of 86.
 */
const DIFF = ['--no-renames', '--no-color', '--no-ext-diff', '-U0', '--src-prefix=a/', '--dst-prefix=b/'];

function git(cwd: string, ...argv: string[]): string {
  const r = spawnSync('git', ['--no-pager', ...argv], { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${argv.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | undefined;
  let oldLine = 0;
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git ')) { cur = undefined; continue; }
    if (l.startsWith('--- ')) {
      cur = { path: l.startsWith('--- a/') ? l.slice(6) : '', deleted: false, removed: new Set() };
      if (cur.path !== '') files.push(cur);
      continue;
    }
    if (l.startsWith('+++ ')) { if (cur && l === '+++ /dev/null') cur.deleted = true; continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+/.exec(l);
    if (h) { oldLine = Number(h[1]) - 1; continue; }
    if (!cur) continue;
    if (l.startsWith('-')) cur.removed.add(oldLine++);
    else if (l.startsWith(' ')) oldLine++;
  }
  return files;
}

const RC_KEY_RE = /<key>\s*([\w.-]+)\s*<\/key>/;
const RES_ENTRY_RE = /<(string|dimen|color|declare-styleable|attr|style|plurals|string-array|integer-array|array|integer|bool|item)\s[^>]*\bname="([^"]+)"/;
const IMPORT_RE = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)/;

function unitsOf(d: FileDiff, parentText: string): Unit[] {
  const lines = parentText.split('\n');
  const removed = d.deleted ? new Set(lines.map((_, i) => i)) : d.removed;
  const units: Unit[] = [];
  const add = (kind: Unit['kind'], name: string, line: number, root: boolean) =>
    units.push({ key: `${d.path}\t${kind}\t${name}\t${kind === 'decl' ? line : ''}`, path: d.path, kind, name, line, root });

  if (d.deleted) add('file', path.basename(d.path), 0, true);
  if (/\.(kt|java)$/.test(d.path)) {
    const parsed = d.path.endsWith('.java') ? parseJava(d.path, parentText) : parse(d.path, parentText);
    const gone = parsed.symbols.filter(s => removed.has(s.line)).sort((a, b) => a.line - b.line);
    // Nested: an enclosing removed declaration starts above it, shallower,
    // and every line in between is removed too.
    const nested = (s: typeof gone[number]) => gone.some(o => o.line < s.line && o.depth < s.depth
      && Array.from({ length: s.line - o.line }, (_, k) => o.line + k).every(l => removed.has(l)));
    for (const s of gone) add('decl', `${s.kind} ${s.name}`, s.line, !d.deleted && !nested(s));
    for (const i of removed) {
      const m = IMPORT_RE.exec(lines[i] ?? '');
      if (m) add('import', m[1], i, false);
    }
  } else if (d.path.endsWith('.xml')) {
    for (const i of removed) {
      const k = RC_KEY_RE.exec(lines[i] ?? '');
      if (k) { add('rc-key', k[1], i, true); continue; }
      const r = RES_ENTRY_RE.exec(lines[i] ?? '');
      if (r && !d.deleted) add('res', `${r[1]} ${r[2]}`, i, true);
    }
  }
  return units;
}

function main(): void {
  const [repo, sha, wt, until = sha] = process.argv.slice(2);
  if (!repo || !sha || !wt) { console.error('usage: oracle-units.cjs <repo> <sha> <worktree> [until]'); process.exit(2); }

  const parentText = new Map<string, string>();
  const textOf = (p: string) => {
    if (!parentText.has(p)) parentText.set(p, git(repo, 'show', `${sha}~1:${p}`));
    return parentText.get(p)!;
  };
  const collect = (diff: string) => {
    const m = new Map<string, Unit>();
    for (const d of parseDiff(diff)) for (const u of unitsOf(d, textOf(d.path))) m.set(u.key, u);
    return m;
  };
  // `until` widens the oracle to everything the branch removed up to it: the
  // precision question, « of what Remove All cuts here, how much did Kevin
  // end up cutting by hand ? ».
  const oracle = collect(git(repo, 'diff', ...DIFF, `${sha}~1`, until));
  const kj = collect(git(wt, 'diff', ...DIFF, 'HEAD'));

  const found = [...oracle.values()].filter(u => kj.has(u.key));
  const missed = [...oracle.values()].filter(u => !kj.has(u.key));
  const extra = [...kj.values()].filter(u => !oracle.has(u.key));

  // The after state, as the last round of Remove All saw it.
  const corpus = readCorpus(wt);
  const base = { sources: corpus.sources, testSourceSets: DEFAULT_TEST_SEGMENTS, androidApi: readAndroidApi() } as any;
  const abs = (p: string) => path.join(wt, p);
  const missedPaths = new Set(missed.map(u => abs(u.path)));
  const symbols = explainSymbols(base).filter(r => missedPaths.has(r.path));
  const dead = (findUnusedSymbols(base) as any[]).map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd }));
  const members = explainMembers({ ...base, includeSelfOnly: false, deadDeclarations: dead }).filter(r => missedPaths.has(r.path));
  const islands = explainIslands({ ...base, maxIslandSize: 8 }).filter(r => missedPaths.has(r.path));
  const rcKeys = new Map(explainRemoteConfigKeys({ sources: corpus.sources } as any).map(r => [r.name, r.outcome]));
  const current = new Map(corpus.sources.map(s => [path.relative(wt, s.path), s.text]));

  const why = (u: Unit): string => {
    if (u.kind === 'rc-key') return `remote-config: ${rcKeys.get(u.name) ?? 'absente de explain'}`;
    if (u.kind === 'res' || (u.kind === 'file' && u.path.endsWith('.xml'))) return 'ressource';
    if (u.kind === 'import') {
      const text = current.get(u.path);
      if (text === undefined) return 'fichier parti, import compris';
      return findUnusedImports(text).some(i => i.statement.includes(u.name))
        ? 'KJ-068 le voit mort, Remove All ne le retire pas'
        : 'encore lu selon KJ';
    }
    // A file stays because its top-level declarations do.
    if (u.kind === 'file') {
      const tops = symbols.filter(r => r.path === abs(u.path));
      return tops.length > 0
        ? `symboles ${[...new Set(tops.map(r => r.outcome))].join(' ; ')} [${tops.map(r => r.name).join(', ')}]`
        : 'aucun symbole candidat';
    }
    const name = u.name.split(' ').pop()!;
    const reasons = [
      ...symbols.filter(r => r.name === name && r.path === abs(u.path)).map(r => `symbole ${r.outcome} (${r.mainMentions} main, ${r.testMentions} test)`),
      ...members.filter(r => r.name === name && r.path === abs(u.path)).map(r => `membre ${r.outcome}`),
      ...islands.filter(r => r.name === name && r.path === abs(u.path)).map(r => `ilot ${r.outcome}`),
    ];
    return reasons.length > 0 ? [...new Set(reasons)].join(' ; ') : 'aucun détecteur ne le considère';
  };

  const byKind = (us: Unit[]) => {
    const n = new Map<string, number>();
    for (const u of us) n.set(u.kind, (n.get(u.kind) ?? 0) + 1);
    return [...n].map(([k, v]) => `${v} ${k}`).join(', ') || 'rien';
  };
  const show = (u: Unit) => `${u.path}:${u.line + 1}  ${u.kind} ${u.name}`;

  console.log(`ORACLE ${sha}${until === sha ? '' : `~1..${until}`}  ${oracle.size} unités (${byKind([...oracle.values()])})`);
  console.log(`TROUVÉ  ${found.length}/${oracle.size}  (${byKind(found)})`);
  const roots = [...oracle.values()].filter(u => u.root);
  const missedRoots = missed.filter(u => u.root).sort((a, b) => a.key.localeCompare(b.key));
  console.log(`RACINES  ${roots.length - missedRoots.length}/${roots.length} trouvées (le reste suit une racine : imbriqué, fichier supprimé, import)`);

  // The reason without its numbers and paths, so causes can be counted.
  const shape = (r: string) => r.replace(/ \(\d+ main, \d+ test\)/g, '').replace(/root\([^)]*\)/g, 'root(…)')
    .replace(/via \w+/g, 'via …').replace(/every-key-read:\S+/g, 'every-key-read').replace(/ \[[^\]]*\]$/, '');
  const reasons = new Map<string, Unit[]>();
  for (const u of missedRoots) {
    const r = `${u.kind}  ${shape(why(u))}`;
    reasons.set(r, [...(reasons.get(r) ?? []), u]);
  }
  console.log(`\nRACINES RATÉES PAR CAUSE  ${missedRoots.length}`);
  for (const [r, us] of [...reasons].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(us.length).padStart(4)}  ${r}`);
    for (const u of us.slice(0, 3)) console.log(`          ${show(u)}`);
  }

  console.log(`\nRACINES RATÉES  ${missedRoots.length}`);
  for (const u of missedRoots) console.log(`  ${show(u)}\n      → ${why(u)}`);
  const missedImports = missed.filter(u => u.kind === 'import');
  const deadImports = missedImports.filter(u => why(u).startsWith('KJ-068'));
  console.log(`\nIMPORTS RATÉS  ${missedImports.length}, dont ${deadImports.length} que KJ-068 voit morts (les autres suivent un membre resté)`);
  for (const u of deadImports) console.log(`  ${show(u)}`);

  // An import Remove All left dead in a file it cut is a residue of its own
  // pass, whatever the oracle says: the cascade exists to take it.
  const residue: string[] = [];
  for (const d of parseDiff(git(wt, 'diff', ...DIFF, 'HEAD'))) {
    if (d.deleted || !/\.(kt|java)$/.test(d.path)) continue;
    const before = new Set(findUnusedImports(textOf(d.path)).map(i => i.statement.trim()));
    for (const i of findUnusedImports(current.get(d.path) ?? '')) {
      if (!before.has(i.statement.trim())) residue.push(`${d.path}:${i.line + 1}  ${i.statement.trim()}`);
    }
  }
  console.log(`\nRÉSIDU D'IMPORTS (morts après Remove All dans un fichier qu'il a coupé)  ${residue.length}`);
  for (const r of residue) console.log(`  ${r}`);

  console.log(`\nHORS ORACLE (KJ seul)  ${extra.length}  (${byKind(extra)})`);
  for (const u of extra.slice(0, 40)) console.log(`  ${show(u)}`);
  if (extra.length > 40) console.log(`  … ${extra.length - 40} de plus`);
}

main();
