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
import { readCorpus } from './kjCorpus';
import { scanTestOnly } from '../src/commands/RemoveTestOnlyCode';

/** Line starts, to turn a `Position` back into an offset. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}
const offsetOf = (starts: readonly number[], line: number, character: number) =>
  (starts[line] ?? starts[starts.length - 1] ?? 0) + character;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) { console.error('usage: apply-kj-removals.ts <project-root> [--apply] [--only=...] [--max=N]'); process.exit(2); }
  const doApply = args.includes('--apply');
  const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length).split(',');
  const max = doApply ? Number(args.find(a => a.startsWith('--max='))?.slice('--max='.length) ?? 16) : 1;
  const segs = DEFAULT_TEST_SEGMENTS as readonly string[];

  // `--tests`: what « Remove Test Only Code » would offer in review mode (every
  // group, closure plans included), measured on the untouched project and
  // written to KJ_TEST_MANIFEST. Remove All never calls that planner, so a
  // gate reading only the Remove All manifest was blind to it (G52).
  const testManifest = process.env.KJ_TEST_MANIFEST;
  if (args.includes('--tests') && testManifest) {
    const corpus = readCorpus(root);
    const scan = await scanTestOnly({ get: async () => ({ ...corpus, sourcesTruncated: false }) } as any, undefined, true);
    const textes = new Map(corpus.sources.map(s => [s.path, s.text]));
    const coupes: { path: string; why: string; extrait: string }[] = [];
    for (const { plan } of scan?.groups ?? []) {
      for (const f of plan.files) coupes.push({ path: path.relative(root, f), why: 'test-file-deleted', extrait: '' });
      for (const c of plan.cuts) {
        const extrait = (textes.get(c.path) ?? '').slice(c.start, c.end).replace(/\s+/g, ' ').trim().slice(0, 60);
        coupes.push({ path: path.relative(root, c.path), why: `${c.kind}:${c.name}`, extrait });
      }
    }
    fs.writeFileSync(testManifest, JSON.stringify(coupes, null, 1));
    console.log(`tests: ${scan?.groups.length ?? 0} group(s), ${coupes.length} test cut(s) planned`);
  }

  const manifest: { round: number; path: string; start: number; end: number; why: string; extrait?: string }[] = [];
  const cumul = new Map<string, number>();
  const bump = (k: string, n = 1) => cumul.set(k, (cumul.get(k) ?? 0) + n);
  const deleted = new Set<string>();
  let totalCut = 0, totalLines = 0;

  for (let round = 0; round < max; round++) {
    const corpus = readCorpus(root);
    if (round === 0) {
      console.log(`sources ${corpus.sources.length}  modules ${corpus.modulesWithCode.length} with code, ${corpus.libraryModules.length} library  resource names ${corpus.resourceEntries.length}  assets ${corpus.assets.length}`);
    }
    const { parFichier, fichiersMorts, tally, orphelins } = collecterUnePasse(corpus.sources, segs, {
      modulesWithCode: corpus.modulesWithCode,
      libraryModules: corpus.libraryModules,
      moduleDirs: corpus.moduleDirs,
      resourceEntries: corpus.resourceEntries,
      assets: corpus.assets,
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
      // `extrait` names a bare 'cut' for a reader: the gate shows it when a
      // finding is lost or gained, and the file is reset right after.
      for (const s of spans) manifest.push({ round: round + 1, path: path.relative(root, p), start: s.start, end: s.end, why: s.quoi || 'cut', extrait: texte.slice(s.start, s.end).replace(/\s+/g, ' ').trim().slice(0, 60) });
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

main().catch(e => { console.error(e); process.exit(1); });
