import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS, isTestSourceSet } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
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

  const edit = new vscode.WorkspaceEdit();
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
  for (const p of deletedFiles) {
    edit.deleteFile(corpusUri(p), { ignoreIfNotExists: true }, { needsConfirmation: true, label: `Delete ${p.split(/[\\/]/).pop()}` });
  }
  const rangeOf = makeRangeOf(scan.textByPath);
  const done = new Set<string>();
  let skipped = 0;
  for (const { group, plan } of scan.groups) {
    const key = `${group.path}:${group.removeStart}`;
    if (!done.has(key) && !doomed.has(group.path)) {
      done.add(key);
      const range = rangeOf(group.path, group.removeStart, group.removeEnd);
      if (range) {
        edit.replace(corpusUri(group.path), range, '', { needsConfirmation: true, label: `Remove ${group.label}` });
      } else { skipped++; }
    }
    for (const cut of plan.cuts) {
      if (doomed.has(cut.path)) continue;
      const cutKey = `${cut.path}:${cut.start}`;
      if (done.has(cutKey)) continue;
      done.add(cutKey);
      const range = rangeOf(cut.path, cut.start, cut.end);
      if (!range) { skipped++; continue; }
      edit.replace(corpusUri(cut.path), range, '',
        { needsConfirmation: true, label: cut.kind === 'import' ? `Remove the stale import of ${cut.name}` : `Remove the test ${cut.name}` });
    }
  }

  const swept = addCascadePlan(edit, cascade, scan.textByPath);

  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok
    ? `Removed ${plural(scan.offered, 'declaration')} and ${plural(scan.testFunctions, 'test')}`
      + (swept.imports > 0 ? `, plus ${plural(swept.imports, 'import')} left with no user` : '')
      + (swept.files > 0 ? ` and ${plural(swept.files, 'emptied file')}` : '')
      + (scan.withheld > 0 ? `. ${plural(scan.withheld, 'other')} withheld: their tests cover more than the declaration.` : '.')
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
