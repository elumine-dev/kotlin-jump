import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS, isTestSourceSet } from '../util/testPaths';
import { Corpus, ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { findDeadIslands } from '../providers/deadIslands';
import { findUnusedEnumEntries } from '../providers/unusedEnumEntries';
import { isOfferable, planTestCoRemoval, TestCoRemovalPlan } from '../providers/testCoRemoval';
import { addCascadePlan, planCascade } from '../providers/applyCascade';
import { plural } from '../util/plural';
import { stillTheMeasuredText, estLeFichier } from '../util/measuredText';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';

/**
 * KJ-047: remove a declaration used only by its tests, AND those tests, in one
 * Refactor Preview.
 *
 * The four detectors already say "used only from tests" and then stop, because
 * deleting the declaration alone breaks the test compilation. Doing both at
 * once is the only move that leaves the workspace green, and doing it by hand
 * means finding the tests yourself.
 *
 * Nothing here is offered on a guess: a finding whose tests cannot be
 * delimited, or whose test also exercises something that survives, is counted
 * and reported, never edited.
 */

interface Group {
  label: string;
  names: string[];
  allowed: string[];
  path: string;
  removeStart: number;
  removeEnd: number;
  fileBecomesEmpty: boolean;
}

/** Everything production declares at top level, for the "covers something else" guard. */
function liveTopLevelNames(sources: readonly { path: string; text: string }[], segs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    if (!/\.(kt|java)$/.test(s.path)) continue;
    if (isTestSourceSet(s.path, segs)) continue;
    const parsed = s.path.endsWith('.java') ? parseJava(s.path, s.text) : parse(s.path, s.text);
    for (const sym of parsed.symbols) if (sym.depth === 0) out.add(sym.name);
  }
  return out;
}

export interface TestOnlyScan {
  groups: { group: Group; plan: TestCoRemovalPlan }[];
  /** The exact text every offset in this scan was measured on. */
  textByPath: Map<string, string>;
  offered: number;
  withheld: number;
  testFiles: Set<string>;
  testFunctions: number;
  /** The exact corpus this verdict came from, to tell whether it has aged. */
  data: Corpus;
}

export async function scanTestOnly(
  corpus: ResourceCorpus,
  token?: vscode.CancellationToken,
): Promise<TestOnlyScan | undefined> {
  const data = await corpus.get(token);
  if (token?.isCancellationRequested || data.sourcesTruncated) return undefined;
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const segs = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
  const ignorePaths = cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']);

  const symbols = findUnusedSymbols({
    sources: data.sources, testSourceSets: segs, libraryModules: data.libraryModules,
    ignorePaths, includeTestOnly: true,
    frameworkNameSuffixes: cfg.get<boolean>('unusedSymbolsFrameworkNameSuffixes', false),
  });
  const members = findUnusedMembers({
    sources: data.sources, testSourceSets: segs, ignorePaths, includeTestOnly: true, includeSelfOnly: false,
    deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  });
  const islands = findDeadIslands({
    sources: data.sources, testSourceSets: segs, includeTestOnly: true,
    maxIslandSize: cfg.get<number>('deadIslandsMaxSize', 8),
  });
  const entries = findUnusedEnumEntries({ sources: data.sources, testSourceSets: segs, includeTestOnly: true });

  const groups: Group[] = [];
  for (const s of symbols) {
    if (s.verdict !== 'testOnly' || s.removeStart < 0) continue;
    groups.push({ label: s.name, names: [s.name], allowed: [], path: s.path, removeStart: s.removeStart, removeEnd: s.removeEnd, fileBecomesEmpty: s.fileBecomesEmpty });
  }
  for (const m of members) {
    if (m.verdict !== 'testOnly' || m.removeStart < 0) continue;
    groups.push({ label: `${m.container}.${m.name}`, names: [m.name], allowed: (m.container ?? '').split('.'), path: m.path, removeStart: m.removeStart, removeEnd: m.removeEnd, fileBecomesEmpty: false });
  }
  for (const e of entries) {
    if (e.verdict !== 'testOnly' || e.removeStart < 0) continue;
    groups.push({ label: `${e.enumName}.${e.name}`, names: [e.name], allowed: [e.enumName], path: e.path, removeStart: e.removeStart, removeEnd: e.removeEnd, fileBecomesEmpty: false });
  }
  // An island is ONE group: a test naming two of its members is one test.
  for (const i of islands) {
    if (i.verdict !== 'testOnly' || !i.fixable) continue;
    const names = i.members.map(m => m.name);
    for (const m of i.members) {
      groups.push({ label: names.join(' + '), names, allowed: [], path: m.path, removeStart: m.removeStart, removeEnd: m.removeEnd, fileBecomesEmpty: false });
    }
  }

  const live = liveTopLevelNames(data.sources, segs);
  const result: TestOnlyScan = {
    groups: [], textByPath: new Map(data.sources.map(s => [s.path, s.text])),
    offered: 0, withheld: 0, testFiles: new Set(), testFunctions: 0,
    data,
  };
  const planByLabel = new Map<string, TestCoRemovalPlan>();
  for (const group of groups) {
    let plan = planByLabel.get(group.label);
    if (plan === undefined) {
      plan = planTestCoRemoval(group.names, data.sources, segs, live, group.allowed);
      planByLabel.set(group.label, plan);
      if (isOfferable(plan)) result.offered++; else result.withheld++;
      // Counted with the PLAN, not with the group: an island pushes one group
      // per member and they all share a plan, so counting here announced three
      // times the tests a three member island actually removes.
      if (isOfferable(plan)) {
        for (const f of plan.files) result.testFiles.add(f);
        result.testFunctions += plan.functions;
      }
    }
    if (!isOfferable(plan)) continue;
    result.groups.push({ group, plan });
  }
  return result;
}

export async function removeTestOnlyCodeCommand(corpus: ResourceCorpus): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }
  const scan = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for code kept alive only by its tests…', cancellable: true },
    (_p, token) => scanTestOnly(corpus, token),
  );
  if (!scan) {
    void vscode.window.showWarningMessage('The workspace is too large to prove that nothing else uses these declarations.');
    return;
  }
  if (scan.groups.length === 0) {
    void vscode.window.showInformationMessage(
      scan.withheld > 0
        ? `Nothing to remove on its own: ${plural(scan.withheld, 'declaration')} used only from tests, each with a test that also covers something else.`
        : 'No declaration is kept alive only by its tests.',
    );
    return;
  }

  // Asked once, up front. The flag that opens the Refactor Preview is the same
  // one that leaves every box in it unticked, and that view has no "select
  // all", so a hundred cuts meant a hundred clicks. Building the edit twice
  // costs nothing: a WorkspaceEdit is a data structure, not an effect.
  const construire = (confirm: boolean, scan: TestOnlyScan) => {
    const edit = new vscode.WorkspaceEdit();
    const touches = new Set<string>();
    const deletedFiles = new Set<string>([...scan.testFiles]);
    for (const { group } of scan.groups) if (group.fileBecomesEmpty) deletedFiles.add(group.path);

    // KJ-048 asked FIRST. A testOnly declaration alone in its file is never
    // marked as emptying it by the scan, so the cascade is the only thing that
    // knows, and a WorkspaceEdit that both deletes a URI and edits a range in it
    // is rejected whole and in silence.
    const planned = new Map<string, { start: number; end: number }[]>();
    const note = (path: string, start: number, end: number) => {
      (planned.get(path) ?? planned.set(path, []).get(path)!).push({ start, end });
    };
    const vus = new Set<string>();
    for (const { group, plan } of scan.groups) {
      const cle = `${group.path}:${group.removeStart}`;
      if (!vus.has(cle) && !deletedFiles.has(group.path)) { vus.add(cle); note(group.path, group.removeStart, group.removeEnd); }
      for (const cut of plan.cuts) {
        const cleCut = `${cut.path}:${cut.start}`;
        if (vus.has(cleCut) || deletedFiles.has(cut.path)) continue;
        vus.add(cleCut);
        note(cut.path, cut.start, cut.end);
      }
    }
    const cascade = planCascade(planned, scan.textByPath, deletedFiles);
    const doomed = new Set([...deletedFiles, ...cascade.deleteFiles]);

    // Never a deleteFile AND range edits on the same URI: VS Code rejects the
    // whole WorkspaceEdit, silently.
    // The OPERATIONS this edit really carries. The plan's own numbers, the
    // declarations offered and the test functions, do not stand in for them:
    // when a file goes whole its functions produce no edit of their own, and
    // the plan counts them all the same. Measured on the plainest case there
    // is, a class and the two tests that are its only users: the plan said
    // four, the edit carried two.
    let operations = 0;
    for (const p of deletedFiles) {
      edit.deleteFile(corpusUri(p), { ignoreIfNotExists: true }, { needsConfirmation: confirm, label: `Delete ${p.split(/[\\/]/).pop()}` });
      operations++;
      touches.add(p);
    }
    const rangeOf = makeRangeOf(scan.textByPath);
    const done = new Set<string>();
    let skipped = 0;
    // What actually goes, declaration by declaration and test by test. The
    // report read the SCAN's own totals, which are fixed before the question
    // is even asked, while this loop runs after the click and drops whatever
    // moved in between. It knows: it warns about those a few lines below, and
    // still counted them as removed.
    //
    // One inside a doomed file counts too: it goes with the file rather than
    // through an edit of its own.
    let declarations = 0;
    let tests = 0;
    for (const { group, plan } of scan.groups) {
      const key = `${group.path}:${group.removeStart}`;
      if (!done.has(key)) {
        done.add(key);
        if (doomed.has(group.path)) {
          declarations++;
        } else {
          const range = rangeOf(group.path, group.removeStart, group.removeEnd);
          if (range) {
            edit.replace(corpusUri(group.path), range, '', { needsConfirmation: confirm, label: `Remove ${group.label}` });
            operations++;
            declarations++;
            touches.add(group.path);
          } else { skipped++; }
        }
      }
      for (const cut of plan.cuts) {
        const cutKey = `${cut.path}:${cut.start}`;
        if (done.has(cutKey)) continue;
        done.add(cutKey);
        if (doomed.has(cut.path)) {
          if (cut.kind !== 'import') tests++;
          continue;
        }
        const range = rangeOf(cut.path, cut.start, cut.end);
        if (!range) { skipped++; continue; }
        edit.replace(corpusUri(cut.path), range, '',
          { needsConfirmation: confirm, label: cut.kind === 'import' ? `Remove the stale import of ${cut.name}` : `Remove the test ${cut.name}` });
        operations++;
        if (cut.kind !== 'import') tests++;
        touches.add(cut.path);
      }
    }

    const swept = addCascadePlan(edit, cascade, scan.textByPath, confirm);
    for (const p of cascade.imports.keys()) touches.add(p);
    for (const p of cascade.deleteFiles) touches.add(p);
    return {
      edit, swept, skipped, fichiers: touches.size,
      supprimes: deletedFiles.size + swept.files,
      operations: operations + swept.imports + swept.files,
      declarations, tests,
    };
  };

  const apercu = construire(true, scan);
  const combien = apercu.operations;
  // Files are DELETED here, not just edited, and Apply all skips the preview
  // that would have shown it. Saying how many, before the click, is the least
  // this owes the reader.
  const choix = await askHowToApply(
    `Remove ${plural(scan.offered, 'declaration')} and ${plural(scan.testFunctions, 'test')}?`,
    bulkDetail(combien, apercu.fichiers)
      + (apercu.supprimes > 0 ? ` ${plural(apercu.supprimes, 'file')} deleted outright.` : ''),
  );
  if (choix === 'cancel') return;

  // What is APPLIED is what must be REPORTED. The dialog gives the workspace
  // all the time it needs to move, and reading the counts off the first build
  // described an edit that was never the one sent.
  // The verdict is read again too. The modal leaves the workspace all the time
  // it needs to move, and a PRODUCTION use that appears meanwhile does not
  // touch the declaring file: its cut passes the text check and the
  // declaration goes, taking the test that covered it. Same fix as 1.42.296
  // and 1.42.297.
  //
  // Without paying for the scan twice: the corpus hands back its cached object
  // untouched while nothing has invalidated it, so identity says whether the
  // judgement has to be made again.
  let courant = scan;
  {
    const frais = await corpus.get();
    if (frais !== scan.data) {
      // Under a progress bar: this second judgement is the LONG part, twenty
      // seconds on six thousand files, and it sits after the question, when
      // the first bar has already closed. Left bare, the editor showed nothing
      // between the click and the edit. Only when the workspace actually
      // moved, so an unchanged one does not make a notification flash for
      // nothing.
      const relu = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'The workspace changed, checking again…' },
        () => scanTestOnly(corpus),
      );
      if (!relu) {
        void vscode.window.showWarningMessage(
          'Could not read the whole workspace, so nothing was removed.');
        return;
      }
      if (relu.groups.length === 0) {
        void vscode.window.showInformationMessage(
          'Nothing to remove: the workspace changed while the question was open.');
        return;
      }
      // An INTERSECTION with what was announced, never a fresh list. Judging
      // again cuts both ways: a change that kills the last user of something
      // else makes the new list BIGGER, and the question asked about the old
      // one. The reader consented to a set, not to an intention.
      const annonce = new Set(scan.groups.map(g => `${g.group.path}\u0000${g.group.label}`));
      const retenus = relu.groups.filter(g => annonce.has(`${g.group.path}\u0000${g.group.label}`));
      if (retenus.length === 0) {
        void vscode.window.showInformationMessage(
          'Nothing to remove: the workspace changed while the question was open.');
        return;
      }
      // The sets DERIVED from the groups have to be narrowed with them. Left
      // whole, `testFiles` still named the test files of a subject the
      // intersection had just dropped, and `construire` deletes every file in
      // that set outright.
      const testFiles = new Set<string>();
      let testFunctions = 0;
      for (const g of retenus) {
        for (const f of g.plan.files) testFiles.add(f);
        testFunctions += g.plan.functions;
      }
      courant = { ...relu, groups: retenus, testFiles, testFunctions };
    }
  }
  // Rebuilt for BOTH answers. Only the flag that opens the preview differs.
  // The preview used to receive the ranges measured BEFORE the question: two
  // lines added at the top of a file during the modal and it showed a cut two
  // lines too high, which the reader can accept in one click. An offset is
  // only worth anything against the text it was measured on, and that holds
  // whether the edit goes out silently or through the preview.
  const choisi = construire(choix === 'review', courant);
  const { edit, swept, skipped } = choisi;

  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok
    ? `Removed ${plural(choisi.declarations, 'declaration')} and ${plural(choisi.tests, 'test')}`
      + (swept.imports > 0 ? `, plus ${plural(swept.imports, 'import')} left with no user` : '')
      + (swept.files > 0 ? ` and ${plural(swept.files, 'emptied file')}` : '')
      + (courant.withheld > 0 ? `. ${plural(courant.withheld, 'other')} withheld: their tests cover more than the declaration.` : '.')
    : 'Nothing was applied.');
  if (skipped > 0) {
    void vscode.window.showWarningMessage(
      `${plural(skipped, 'edit')} skipped: the file changed since the scan. Run the command again.`);
  }
}

/**
 * Offsets to a Range, on the TEXT the scan measured them on.
 *
 * Exported for the witness: the rule below is a one line condition whose
 * failure deletes the wrong lines, and it deserves to be checked directly.
 *
 * The first version asked `isDirty`, which answers "was this edited in the
 * editor", not "is this still what we measured". A document reloaded from disk
 * by a checkout or by another tool is CLEAN and has different content, and the
 * corpus keeps its copy for a minute: the positions were then computed on the
 * stale text and applied to the live document.
 */
export function makeRangeOf(textByPath: ReadonlyMap<string, string>) {
  const startsByPath = new Map<string, number[]>();
  const startsOf = (path: string): number[] | undefined => {
    const cached = startsByPath.get(path);
    if (cached) return cached;
    const text = textByPath.get(path);
    if (text === undefined) return undefined;
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    startsByPath.set(path, starts);
    return starts;
  };
  const posAt = (starts: readonly number[], offset: number): vscode.Position => {
    let low = 0, high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid; else high = mid - 1;
    }
    return new vscode.Position(low, offset - starts[low]);
  };
  return (path: string, start: number, end: number): vscode.Range | undefined => {
    const mesure = stillTheMeasuredText(path, textByPath.get(path));
    if (mesure === undefined) return undefined;
    const doc = vscode.workspace.textDocuments.find(estLeFichier(path));
    if (doc) return new vscode.Range(doc.positionAt(start), doc.positionAt(end));
    const starts = startsOf(path);
    if (!starts) return undefined;
    return new vscode.Range(posAt(starts, start), posAt(starts, end));
  };
}
