import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { Corpus, ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { isOfferable, TestCoRemovalPlan, TestCut, testFunctionsOf } from '../providers/testCoRemoval';
import { withoutOrphanSourceSets } from '../providers/orphanSourceSets';
import { addCascadePlan, planCascade } from '../providers/applyCascade';
import { plural } from '../util/plural';
import { intersectionParCle } from '../util/intersectionParCle';
import { stillTheMeasuredText, estLeFichier } from '../util/measuredText';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';
import { Group, planTestOnly } from '../cleanup/testOnlyPlan';

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

/**
 * `Rewrite x.setFoo(v) as x.foo = v`, with the receiver, the setter and the
 * property the cut really names. The argument is not repeated: the preview
 * shows it, and it can run over several lines.
 */
function rewriteLabel(cut: TestCut): string {
  const m = /^\s*([\w$.]+)\.([\w$]+)\s*=/.exec(cut.replacement ?? '');
  if (!m) return `Rewrite the call to ${cut.name}`;
  return `Rewrite ${m[1]}.${cut.name}(v) as ${m[1]}.${m[2]} = v`;
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
  /**
   * Include the groups `isOfferable` withholds.
   *
   * False for the ordinary command, whose whole value is offering nothing on a
   * guess. True for its sibling, which applies nothing either: it opens the
   * Refactor Preview with EVERY box unticked and the reason on each label. The
   * mechanical half, finding the tests and computing the extents, is
   * automated; the judgement stays with the reader.
   */
  includeUnproven = false,
): Promise<TestOnlyScan | undefined> {
  const corpusData = await corpus.get(token);
  if (token?.isCancellationRequested || corpusData.sourcesTruncated) return undefined;
  // KJ-055: a source set Gradle never builds cannot make a declaration
  // testOnly, because nothing ever compiles the test that names it. On the
  // reference project three groups read as held by a shared base test class
  // that lives in a directory no Gradle task touches.
  const { sources: vivantes } = withoutOrphanSourceSets({
    sources: corpusData.sources, moduleDirs: corpusData.moduleDirs,
  });
  const data = vivantes === corpusData.sources
    ? corpusData
    : { ...corpusData, sources: vivantes as typeof corpusData.sources };
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const segs = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
  const ignorePaths = cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']);

  const plans = planTestOnly(data, {
    segs, ignorePaths, includeUnproven,
    frameworkNameSuffixes: cfg.get<boolean>('unusedSymbolsFrameworkNameSuffixes', false),
    islandsMaxSize: cfg.get<number>('deadIslandsMaxSize', 32),
  });
  const result: TestOnlyScan = { ...plans, data };
  return result;
}

export async function removeTestOnlyCodeCommand(
  corpus: ResourceCorpus,
  /**
   * The UNPROVEN mode, the sibling command.
   *
   * Same scan, except the groups `isOfferable` withholds are kept, and nothing
   * is ever applied silently: the Refactor Preview opens with every box
   * unticked and the reason for the doubt on each label. Nothing goes without
   * one click per item.
   *
   * Why a separate command rather than a flag on the big one: the value of
   * `Remove Everything Unused` and of this command is offering nothing on a
   * guess. Merging the two would erase the one guarantee this tool can keep.
   */
  unproven = false,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }
  const scanBrut = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: unproven
        ? 'Scanning for code kept alive only by its tests, unproven groups included…'
        : 'Scanning for code kept alive only by its tests…',
      cancellable: true,
    },
    (_p, token) => scanTestOnly(corpus, token, unproven),
  );
  // In unproven mode only the DOUBTFUL groups are kept: the proven ones are
  // the other command's work, and mixing them would have the reader tick the
  // certain and the doubtful in one pass without telling them apart.
  const scan = scanBrut === undefined || !unproven ? scanBrut : (() => {
    const retenus = scanBrut.groups.filter(g => g.group.unprovenReason !== undefined);
    const testFiles = new Set<string>();
    let testFunctions = 0;
    for (const g of retenus) {
      for (const f of g.plan.files) testFiles.add(f);
      testFunctions += g.plan.functions;
    }
    return { ...scanBrut, groups: retenus, testFiles, testFunctions, offered: retenus.length };
  })();
  if (!scan) {
    void vscode.window.showWarningMessage('The workspace is too large to prove that nothing else uses these declarations.');
    return;
  }
  if (scan.groups.length === 0) {
    if (unproven) {
      void vscode.window.showInformationMessage(
        'No unproven group either: nothing is kept alive only by its tests.');
      return;
    }
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
        // A rewrite removes nothing but the setter's name, which no import
        // targets. Noted as a removal, it had the cascade sweep the import
        // the ARGUMENT still needs: `spec.other = Other()` kept, its
        // `import com.y.Other` gone.
        if (cut.kind === 'rewrite') continue;
        const cleCut = `${cut.path}:${cut.start}`;
        if (vus.has(cleCut) || deletedFiles.has(cut.path)) continue;
        vus.add(cleCut);
        note(cut.path, cut.start, cut.end);
      }
    }
    const cascade = planCascade(planned, scan.textByPath, deletedFiles);
    const doomed = new Set([...deletedFiles, ...cascade.deleteFiles]);
    // The planner drops a rewrite nested in a test function IT cuts whole.
    // Two groups are planned apart and can meet on one test, one rewriting a
    // line the other removes with the function: nested ranges, one
    // WorkspaceEdit VS Code rejects whole. The removal wins here too, and a
    // FIELD or STATEMENT cut counts as much as a function cut: a plan that
    // takes `spec.setOther(foo)` as a statement of a leaving field subsumes
    // the rewrite of that same line, and emitting both left a call to `foo`
    // after `foo` was gone.
    const functionCuts = new Map<string, { start: number; end: number }[]>();
    for (const { plan } of scan.groups) {
      for (const cut of plan.cuts) {
        if (cut.kind === 'rewrite') continue;
        (functionCuts.get(cut.path) ?? functionCuts.set(cut.path, []).get(cut.path)!).push({ start: cut.start, end: cut.end });
      }
    }
    const absorbed = (cut: TestCut): boolean => cut.kind === 'rewrite'
      && (functionCuts.get(cut.path) ?? []).some(f => cut.start >= f.start && cut.end <= f.end);

    // Never a deleteFile AND range edits on the same URI: VS Code rejects the
    // whole WorkspaceEdit, silently.
    // The OPERATIONS this edit really carries. The plan's own numbers, the
    // declarations offered and the test functions, do not stand in for them:
    // when a file goes whole its functions produce no edit of their own, and
    // the plan counts them all the same. Measured on the plainest case there
    // is, a class and the two tests that are its only users: the plan said
    // four, the edit carried two.
    let operations = 0;
    const nonProuves = new Set(scan.groups.filter(g => g.group.unprovenReason).flatMap(g => g.plan.files));
    for (const p of deletedFiles) {
      edit.deleteFile(corpusUri(p), { ignoreIfNotExists: true }, {
        needsConfirmation: confirm,
        label: `${nonProuves.has(p) ? 'UNPROVEN: delete' : 'Delete'} ${p.split(/[\\/]/).pop()}`,
      });
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
    // A test file that goes whole produces no cut for its functions: counting
    // cuts alone reported `0 tests` for a removal that took one.
    let tests = 0;
    for (const p of scan.testFiles) {
      const text = scan.textByPath.get(p);
      if (text !== undefined) tests += testFunctionsOf(p, text).length;
    }
    // Import lines of the plans, in test files and, since 1.42.336, in main
    // ones: applied, and missing from the report.
    let importsDuPlan = 0;
    // Setter calls written as assignments: nothing is removed there, so they
    // are neither a test nor an import in the report.
    let rewrites = 0;
    for (const { group, plan } of scan.groups) {
      const key = `${group.path}:${group.removeStart}`;
      if (!done.has(key)) {
        done.add(key);
        if (doomed.has(group.path)) {
          declarations++;
        } else {
          const range = rangeOf(group.path, group.removeStart, group.removeEnd);
          if (range) {
            edit.replace(corpusUri(group.path), range, '', {
              needsConfirmation: confirm,
              label: group.unprovenReason
                ? `UNPROVEN: remove ${group.label} (${group.unprovenReason})`
                : `Remove ${group.label}`,
            });
            operations++;
            declarations++;
            touches.add(group.path);
          } else { skipped++; }
        }
      }
      for (const cut of plan.cuts) {
        const cutKey = `${cut.path}:${cut.start}`;
        if (done.has(cutKey)) continue;
        // Absorption is decided BEFORE the key is claimed: the other plan's
        // removal of the same line still has to be emitted, and claiming the
        // key here let the rewrite win the line it had just yielded.
        if (absorbed(cut)) continue;
        done.add(cutKey);
        if (doomed.has(cut.path)) {
          // A function of a whole test file is already counted with its file.
          if (cut.kind === 'function' && !scan.testFiles.has(cut.path)) tests++;
          continue;
        }
        const range = rangeOf(cut.path, cut.start, cut.end);
        if (!range) { skipped++; continue; }
        edit.replace(corpusUri(cut.path), range, cut.replacement ?? '', {
          needsConfirmation: confirm,
          label: cut.kind === 'rewrite'
            ? rewriteLabel(cut)
            : cut.kind === 'import'
              ? `Remove the stale import of ${cut.name}`
              : `${group.unprovenReason ? 'UNPROVEN: remove' : 'Remove'} the test ${cut.name}`,
        });
        operations++;
        if (cut.kind === 'function') tests++;
        else if (cut.kind === 'import') importsDuPlan++;
        else rewrites++;
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
      declarations, tests, imports: swept.imports + importsDuPlan, rewrites,
    };
  };

  const apercu = construire(true, scan);
  const combien = apercu.operations;
  // Files are DELETED here, not just edited, and Apply all skips the preview
  // that would have shown it. Saying how many, before the click, is the least
  // this owes the reader.
  // No "Apply all" in unproven mode. What this command offers is, by
  // definition, not proven, so the only honest gesture is the preview, one box
  // at a time.
  const choix = unproven
    ? 'review' as const
    : await askHowToApply(
      `Remove ${plural(scan.offered, 'declaration')} and ${plural(scan.testFunctions, 'test')}?`,
      bulkDetail(combien, apercu.fichiers)
        + (apercu.supprimes > 0 ? ` ${plural(apercu.supprimes, 'file')} deleted outright.` : ''),
    );
  if (choix === 'cancel') return;
  if (unproven) {
    void vscode.window.showWarningMessage(
      `${plural(scan.offered, 'unproven group')} in the Refactor Preview, every box unticked.`
      + ` Each label says why it is unproven. Nothing is applied until you tick it.`);
  }

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
      // Counted, not just matched. The key is textual, path and label, because
      // an offset does not survive the edit that happened in between, and it
      // is NOT unique: a dead island pushes one group per member and they all
      // carry the same label. Measured on the reference project, two of the
      // five groups share a key.
      //
      // Today that ambiguity cannot be exploited, and the honest reason is
      // worth writing down rather than a scarier one: the label is the member
      // names joined, so a key borne by several groups always names ONE
      // island, announced and read back as a unit. Lose a member and the label
      // changes with it, so the key disappears instead of changing count.
      // Measured both ways.
      //
      // The count is used all the same, because that reasoning holds only
      // while the label happens to encode the membership. It costs nothing and
      // it does not depend on how labels are built.
      const cleDuGroupe = (g: { group: Group }) => `${g.group.path}\u0000${g.group.label}`;
      const retenus = intersectionParCle(scan.groups, relu.groups, cleDuGroupe);
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
      + (choisi.imports > 0 ? `, plus ${plural(choisi.imports, 'import')} left with no user` : '')
      + (choisi.rewrites > 0 ? `, with ${plural(choisi.rewrites, 'setter call')} rewritten as an assignment` : '')
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
