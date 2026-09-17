/**
 * Applies, on disk, exactly what `Remove Everything Unused` applies.
 *
 *   npx vite-node scripts/apply-kj-removals.ts <project-root> [--apply] [--only=a,b] [--max=16]
 *
 * Without `--apply` it runs ONE round and prints the plan. With `--apply` it
 * loops to the fixed point, the same 16-round ceiling the command uses.
 *
 * WHY IT CALLS THE COMMAND'S OWN COLLECTION FUNCTION. This script used to wire
 * nine detector families by hand, one pass, no cascade. Three wirings existed
 * in the repository at once: this script's nine families, the eight
 * `FindEverythingUnused` reports, and the four `RemoveEverythingUnused` wrote.
 * The audit that measured the extension against five hand written branches
 * therefore measured something no button produces. Of the 427 cuts that audit
 * applied, 100 belonged to families no removal command touched.
 *
 * Calling `collecterUnePasse` and `planCascade` removes the divergence by
 * construction: what this script writes is what the command writes, and a
 * family added to one is added to both. The cost is that `--only` now filters
 * the collected cuts by family name instead of skipping the scan, which is
 * slower and gives the same answer.
 *
 * This is the delete-and-build audit: the extension's own extents are cut out
 * of a real workspace, and the Gradle build is the oracle. A range that is one
 * line off does not produce a debatable diagnostic, it deletes live code.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_TEST_SEGMENTS } from '../src/util/testPaths';
import {
  collecterUnePasse, coupesRetenues, plagesDuFichier, compteLesFamilles,
} from '../src/commands/RemoveEverythingUnused';
import { planCascade } from '../src/providers/removalCascade';
import { orphanSummary } from '../src/providers/orphanSourceSets';
import { FileResourceIndex } from '../src/indexer/FileResourceIndex';

/** What the detectors read as text. */
const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$|[\\/]nitro\.json$/;
/** Wider: the file-resource index must see binaries to know a name is backed. */
const RES_RE = /\.(xml|png|webp|svg|jpg|jpeg|gif|bmp|json|txt|mp3|mp4|ogg|wav|ttf|otf|lottie)$/i;
const EXCLUDED_DIRS = new Set(['build', '.gradle', 'generated', '.idea', '.git', 'node_modules', '.worktrees', '.kotlin']);

const LIBRARY_PLUGIN_RE = /com\.android\.library|android-library|android\.library\b|androidLibrary/;
const withoutUnappliedPlugins = (t: string) => t.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');
const declaresLibraryPlugin = (t: string) => LIBRARY_PLUGIN_RE.test(withoutUnappliedPlugins(t));

interface Corpus {
  sources: { path: string; text: string }[];
  modulesWithCode: string[];
  libraryModules: string[];
  /** Every module directory: KJ-055 needs them to know the legal source sets. */
  moduleDirs: string[];
  resourceEntries: ReturnType<FileResourceIndex['entries']>;
}

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) walk(full, hit); }
    else hit(full);
  }
}

/** The same corpus `ResourceCorpus` hands the command, rebuilt from disk. */
function readCorpus(root: string): Corpus {
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  const index = new FileResourceIndex();
  const resFiles: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    if (RES_RE.test(file)) resFiles.push(file);
    if (SOURCE_RE.test(file) || /[\\/]META-INF[\\/]services[\\/]/.test(file)) {
      try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* unreadable */ }
    }
  });
  // The index is built from the file names, so it needs the binaries too: a
  // `drawable/x.webp` backs the name `x` exactly as a `drawable/x.xml` does.
  for (const file of resFiles) index.addFile(file, moduleDirs);
  return {
    sources,
    moduleDirs,
    modulesWithCode: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path))),
    libraryModules: moduleDirs.filter(d => sources.some(s => s.path.startsWith(`${d}/build.gradle`) && declaresLibraryPlugin(s.text))),
    resourceEntries: index.entries(),
  };
}

/** Line starts, to turn a `Position` back into an offset. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
const offsetOf = (starts: readonly number[], line: number, character: number) =>
  (starts[line] ?? starts[starts.length - 1] ?? 0) + character;

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: apply-kj-removals.ts <project-root> [--apply] [--only=...] [--max=N]'); process.exit(2); }
  const doApply = args.includes('--apply');
  const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const max = doApply ? Number(args.find(a => a.startsWith('--max='))?.slice('--max='.length) ?? 16) : 1;
  const segs = DEFAULT_TEST_SEGMENTS as readonly string[];

  const manifest: { round: number; path: string; start: number; end: number; why: string }[] = [];
  const cumul = new Map<string, number>();
  const bump = (k: string, n = 1) => cumul.set(k, (cumul.get(k) ?? 0) + n);
  const deleted = new Set<string>();
  let totalCut = 0, totalLines = 0;

  for (let round = 0; round < max; round++) {
    const corpus = readCorpus(root);
    if (round === 0) {
      console.log(`sources ${corpus.sources.length}  modules ${corpus.modulesWithCode.length} with code, ${corpus.libraryModules.length} library  resource names ${corpus.resourceEntries.length}`);
    }
    const { parFichier, fichiersMorts, tally, orphelins } = collecterUnePasse(corpus.sources, segs, {
      modulesWithCode: corpus.modulesWithCode,
      libraryModules: corpus.libraryModules,
      moduleDirs: corpus.moduleDirs,
      resourceEntries: corpus.resourceEntries,
    });
    if (round === 0 && orphelins.length > 0) {
      console.log(`\n${orphanSummary(orphelins)} Their mentions keep nothing alive:`);
      for (const o of orphelins) console.log(`  ${path.relative(root, o.path)}  ${o.files.length} file(s): ${o.reason}`);
    }

    // `--only` filters the COLLECTED cuts. Skipping a scan would change the
    // inputs the other families see: `findUnusedMembers` takes the dead
    // declarations `findUnusedSymbols` found, so a plan with symbols off is
    // not the plan minus symbols.
    const garde = new Map<string, typeof parFichier extends Map<string, infer C> ? C : never>();
    for (const [p, list] of parFichier) {
      const kept = only === undefined ? list : list.filter(c => only.includes(c.famille));
      if (kept.length > 0) garde.set(p, kept as any);
    }
    const morts = only === undefined || only.includes('ressources') ? fichiersMorts : new Set<string>();

    const found = [...garde.values()].reduce((n, l) => n + l.length, 0);
    if (found === 0 && morts.size === 0) { console.log(`round ${round + 1}: nothing found, fixed point`); break; }
    if (round === 0 && only === undefined) {
      console.log('\nplan by family:');
      for (const [k, n] of [...Object.entries(tally)].sort()) if (n > 0) console.log(`  ${String(n).padStart(5)}  ${k}`);
      if (fichiersMorts.size > 0) console.log(`  ${String(fichiersMorts.size).padStart(5)}  ressources (whole files)`);
    }

    const textes = new Map(corpus.sources.map(s => [s.path, s.text]));
    const { retenu, bouges } = coupesRetenues(garde as any, textes);
    if (bouges.length > 0) bump('skipped (moved on disk)', bouges.length);
    if (retenu.size === 0 && morts.size === 0) { console.log(`round ${round + 1}: ${found} found, none kept`); break; }

    const cascade = planCascade(
      new Map([...retenu].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end }))])),
      textes,
      morts,
    );

    let cutThisRound = 0, linesThisRound = 0;
    for (const p of new Set([...retenu.keys(), ...cascade.imports.keys()])) {
      if (cascade.deleteFiles.has(p) || morts.has(p)) continue;
      const texte = textes.get(p);
      if (texte === undefined) continue;
      const plages = plagesDuFichier(p, texte, retenu.get(p) ?? [], cascade.imports.get(p));
      if (plages === undefined) continue;
      const starts = lineStarts(texte);
      const spans = plages
        .map(r => ({
          start: offsetOf(starts, r.start.line, r.start.character),
          end: offsetOf(starts, r.end.line, r.end.character),
          texte: r.texte,
          quoi: r.quoi,
        }))
        .sort((a, b) => a.start - b.start);
      let out = texte;
      for (const s of [...spans].reverse()) out = out.slice(0, s.start) + s.texte + out.slice(s.end);
      if (out === texte) continue;
      cutThisRound += spans.length;
      linesThisRound += texte.split('\n').length - out.split('\n').length;
      for (const s of spans) manifest.push({ round: round + 1, path: path.relative(root, p), start: s.start, end: s.end, why: s.quoi || 'cut' });
      if (doApply) fs.writeFileSync(p, out);
    }

    for (const p of [...cascade.deleteFiles, ...morts]) {
      if (deleted.has(p)) continue;
      deleted.add(p);
      manifest.push({ round: round + 1, path: path.relative(root, p), start: -1, end: -1, why: morts.has(p) ? 'resource-file-deleted' : 'file-deleted' });
      if (doApply) fs.rmSync(p, { force: true });
    }

    const applique = compteLesFamilles(retenu);
    for (const [k, n] of Object.entries(applique)) if (n > 0) bump(k, n);
    totalCut += cutThisRound;
    totalLines += linesThisRound;
    console.log(`round ${round + 1}: ${found} found, ${retenu.size} file(s) kept, ${cutThisRound} cut(s) written, ${cascade.deleteFiles.size + morts.size} file(s) deleted, ${linesThisRound} line(s)`);
    if (!doApply) { console.log('(dry run: nothing written, pass --apply to loop to the fixed point)'); break; }
    if (cutThisRound === 0 && cascade.deleteFiles.size === 0 && morts.size === 0) { console.log('round with no effect, stopping'); break; }
  }

  if (doApply) {
    console.log('\napplied by family:');
    for (const [k, n] of [...cumul].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
  }
  console.log(`\n${totalCut} cut(s), ${deleted.size} file(s) deleted, ${totalLines} line(s)`);
  const out = process.env.KJ_MANIFEST;
  if (out) fs.writeFileSync(out, JSON.stringify(manifest, null, 1));
}

main();
