/**
 * Applies, on disk, every removal Kotlin Jump offers on a real project.
 *
 *   npx vite-node scripts/apply-kj-removals.ts <project-root> [--apply] [--only=a,b]
 *
 * Without `--apply` it only prints the plan. This is the delete-and-build
 * audit: the extension's own extents are cut out of a real workspace, and the
 * Gradle build is the oracle. A range that is one line off does not produce a
 * debatable diagnostic, it deletes live code.
 *
 * Each family is wired exactly as `FindEverythingUnused` wires it, defaults
 * included, so the plan is what a user would get from the command palette.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import { sweepFile } from '../src/providers/DeadCodeSweep';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { findDeadIslands } from '../src/providers/deadIslands';
import { findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';
import { findUnusedResourceKeys, expandToWholeLines } from '../src/providers/unusedResourceKeys';
import { collectValueKeyDeclarations, parseValuesPath } from '../src/indexer/ValueResourceScanner';
import { findUnusedGradleDependencies } from '../src/providers/unusedGradleDependencies';
import { findUnheardEvents } from '../src/providers/unheardEvents';

// Same spellings as ResourceCorpus; duplicated because that module hosts the
// VS Code layer and cannot be imported outside an extension host.
const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
const PUBLISHED_MODULE_RE = /maven-publish|mavenPublish|\.publish(?:ing)?\b|\bpublishing\s*\{|cocoapods\s*\{|XCFramework/;
const withoutUnappliedPlugins = (t: string) => t.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');
const declaresLibraryPlugin = (t: string) => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(t));
const declaresPublishing = (t: string) => PUBLISHED_MODULE_RE.test(withoutUnappliedPlugins(t));

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SWEEP_RE = /\.(kt|java)$/;
const EXCLUDED_DIRS = new Set(['build', '.gradle', 'generated', '.idea', '.git', 'node_modules', '.worktrees', '.kotlin']);
const IGNORE_PATHS = ['**/buildSrc/**', '**/build-logic/**'];

interface Edit { start: number; end: number; text: string; why: string }

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name) || /[\\/]META-INF[\\/]services[\\/]/.test(full)) hit(full);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: apply-kj-removals.ts <project-root> [--apply] [--only=...]'); process.exit(2); }
  const doApply = args.includes('--apply');
  const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const wants = (family: string) => only === undefined || only.includes(family);

  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
  });
  const byPath = new Map(sources.map(s => [s.path, s.text]));
  const modulesWithCode = moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path)));
  const libraryModules = moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && declaresLibraryPlugin(s.text)));
  const publishedModules = moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && declaresPublishing(s.text)));
  console.log(`sources ${sources.length}  modules ${moduleDirs.length} (code ${modulesWithCode.length}, library ${libraryModules.length}, published ${publishedModules.length})`);

  const edits = new Map<string, Edit[]>();
  const doomed = new Set<string>();
  const add = (p: string, e: Edit) => { (edits.get(p) ?? edits.set(p, []).get(p)!).push(e); };
  const tally = new Map<string, number>();
  const bump = (k: string, n = 1) => tally.set(k, (tally.get(k) ?? 0) + n);

  // 1 — the per-file sweep: imports, declarations, locals, write-only
  if (wants('sweep')) {
    for (const s of sources) {
      if (!SWEEP_RE.test(s.path)) continue;
      for (const f of sweepFile(s.text, s.path.endsWith('.java') ? 'java' : 'kotlin')) {
        for (const e of f.edits) {
          if (e.start < 0 || e.end < e.start) continue;
          add(s.path, { start: e.start, end: e.end, text: e.text, why: `sweep/${f.detector}:${f.name}` });
          bump(`sweep/${f.detector}`);
        }
      }
    }
  }

  // 2 — symbols nothing references
  const symbols = findUnusedSymbols({
    sources, testSourceSets: DEFAULT_TEST_SEGMENTS, publishedModules, libraryModules,
    ignorePaths: IGNORE_PATHS, includeTestOnly: true, frameworkNameSuffixes: false,
  });
  if (wants('symbols')) {
    for (const f of symbols) {
      if (f.verdict !== 'unreferenced' || f.removeStart < 0) continue;
      bump('symbols');
      if (f.fileBecomesEmpty) { doomed.add(f.path); bump('symbols/file-deleted'); }
      else add(f.path, { start: f.removeStart, end: f.removeEnd, text: '', why: `symbol:${f.name}` });
      for (const stale of f.staleImports) {
        const text = byPath.get(stale.path);
        if (text === undefined) continue;
        const lines = text.split('\n');
        let off = 0;
        for (let l = 0; l < stale.line; l++) off += lines[l].length + 1;
        add(stale.path, { start: off, end: off + lines[stale.line].length + 1, text: '', why: `symbol-stale-import:${f.name}` });
        bump('symbols/stale-import');
      }
    }
  }

  // 3 — class members nothing references
  if (wants('members')) {
    const members = findUnusedMembers({
      sources, testSourceSets: DEFAULT_TEST_SEGMENTS, ignorePaths: IGNORE_PATHS,
      includeTestOnly: true, includeSelfOnly: true,
      deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
    });
    for (const m of members) {
      if (m.verdict !== 'unreferenced' || m.removeStart < 0) continue;
      add(m.path, { start: m.removeStart, end: m.removeEnd, text: '', why: `member:${m.container}.${m.name}` });
      bump('members');
    }
  }

  // 4 — dead islands. testOnly islands are still referenced by their tests.
  if (wants('islands')) {
    const islands = findDeadIslands({
      sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true, maxIslandSize: 8,
    });
    for (const isl of islands) {
      if (!isl.fixable || isl.verdict === 'testOnly') continue;
      bump('islands');
      for (const m of isl.members) {
        add(m.path, { start: m.removeStart, end: m.removeEnd, text: '', why: `island:${m.name}` });
        bump('islands/member');
      }
      for (const imp of isl.staleImports) {
        const text = byPath.get(imp.path);
        if (text === undefined) continue;
        const lines = text.split('\n');
        let off = 0;
        for (let l = 0; l < imp.line; l++) off += lines[l].length + 1;
        add(imp.path, { start: off, end: off + lines[imp.line].length + 1, text: '', why: `island-stale-import:${imp.name}` });
        bump('islands/stale-import');
      }
    }
  }

  // 5 — enum entries nothing names
  if (wants('enums')) {
    for (const e of findUnusedEnumEntries({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS, includeTestOnly: true })) {
      if (e.verdict !== 'unreferenced' || e.removeStart < 0) continue;
      add(e.path, { start: e.removeStart, end: e.removeEnd, text: '', why: `enum:${e.enumName}.${e.name}` });
      bump('enums');
    }
  }

  // 6 — values/ keys nothing points at, every qualifier variant
  if (wants('keys')) {
    const declarations = sources
      .filter(s => parseValuesPath(s.path) !== undefined)
      .flatMap(s => collectValueKeyDeclarations(s.path, s.text, modulesWithCode));
    const keys = findUnusedResourceKeys({ declarations, sources, modulesWithCode, libraryModules });
    for (const k of keys) {
      bump('keys');
      for (const v of k.variants) {
        const text = byPath.get(v.path);
        if (text === undefined) continue;
        const fresh = collectValueKeyDeclarations(v.path, text).find(d => d.kind === k.kind && d.name === k.name);
        if (!fresh) continue;
        const w = expandToWholeLines(text, fresh.start, fresh.end);
        add(v.path, { start: w.start, end: w.end, text: '', why: `key:${k.kind}/${k.name}` });
        bump('keys/variant');
      }
    }
  }

  // 7 — catalog aliases no build file names
  if (wants('gradle')) {
    for (const g of findUnusedGradleDependencies({ sources })) {
      add(g.path, { start: g.removeStart, end: g.removeEnd, text: '', why: `alias:${g.name}` });
      bump('gradle');
      if (g.orphanedVersion) {
        add(g.path, { start: g.orphanedVersion.removeStart, end: g.orphanedVersion.removeEnd, text: '', why: `alias-version:${g.orphanedVersion.name}` });
        bump('gradle/version');
      }
    }
  }

  // 8 — posts nothing subscribes to
  if (wants('events')) {
    const scan = findUnheardEvents({ sources, testSourceSets: DEFAULT_TEST_SEGMENTS });
    if (scan.unreadable.length > 0) {
      console.log(`events: ${scan.unreadable.length} unreadable subscription(s), nothing proven, family skipped`);
    } else {
      for (const e of scan.events) {
        if (e.verdict !== 'unheard' || e.removeStart < 0) continue;
        add(e.path, { start: e.removeStart, end: e.removeEnd, text: '', why: `event:${e.name}` });
        bump('events');
      }
    }
  }

  // 9 — resource FILES nothing references, taken from the editor run
  if (wants('resources')) {
    const listed = process.env.KJ_DEAD_RESOURCES;
    if (listed) {
      for (const p of listed.split(':').filter(Boolean)) {
        if (!fs.existsSync(p)) continue;
        doomed.add(p);
        bump('resources');
      }
    }
  }

  // ── merge and apply ────────────────────────────────────────────────────
  let cut = 0, dropped = 0;
  const manifest: { path: string; start: number; end: number; why: string }[] = [];
  for (const [p, list] of edits) {
    if (doomed.has(p)) { dropped += list.length; continue; }
    // Outermost wins: deleting a member but keeping its class shell leaves
    // orphan references, and two detectors overlapping is untested ground.
    const kept = list.filter(e => !list.some(o => o !== e && o.start <= e.start && o.end >= e.end && (o.start < e.start || o.end > e.end)));
    const seen = new Set<string>();
    const uniq = kept.filter(e => { const k = `${e.start}:${e.end}`; if (seen.has(k)) return false; seen.add(k); return true; });
    uniq.sort((a, b) => a.start - b.start);
    const final: Edit[] = [];
    for (const e of uniq) {
      const previous = final[final.length - 1];
      if (previous && e.start < previous.end) { dropped++; continue; }
      final.push(e);
    }
    dropped += list.length - final.length;
    let text = byPath.get(p)!;
    for (const e of [...final].reverse()) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    cut += final.length;
    for (const e of final) manifest.push({ path: path.relative(root, p), start: e.start, end: e.end, why: e.why });
    if (doApply) fs.writeFileSync(p, text);
  }
  for (const p of doomed) {
    manifest.push({ path: path.relative(root, p), start: -1, end: -1, why: 'file-deleted' });
    if (doApply) fs.rmSync(p, { force: true });
  }
  const out = process.env.KJ_MANIFEST;
  if (out) fs.writeFileSync(out, JSON.stringify(manifest, null, 1));

  console.log('\nplan by family:');
  for (const [k, n] of [...tally].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
  console.log(`\n${cut} cut(s) across ${edits.size - doomed.size} file(s), ${doomed.size} file(s) deleted, ${dropped} edit(s) dropped as overlapping`);
  if (!doApply) console.log('(dry run: nothing written, pass --apply)');
}

main();
