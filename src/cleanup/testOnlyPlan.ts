import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { findDeadIslands } from '../providers/deadIslands';
import { findUnusedEnumEntries } from '../providers/unusedEnumEntries';
import { isOfferable, liveOutside, planTestCoRemoval, productionDeclarations, TestCoRemovalPlan } from '../providers/testCoRemoval';
import { isClosed, planClosure } from '../providers/testCoRemovalClosure';
import { findRefusedPosts } from '../providers/unprovenPosts';
import { findMemberImports, memberKey } from '../util/memberImports';
import { plural } from '../util/plural';

/**
 * KJ-047, without the editor: every declaration only tests use, grouped, each
 * with the plan that removes its tests. The command `Remove Test-Only Code`
 * and `kdead remove --all` both read it, so the two cannot drift.
 */

export interface Group {
  label: string;
  names: string[];
  allowed: string[];
  path: string;
  removeStart: number;
  removeEnd: number;
  fileBecomesEmpty: boolean;
  /** Set when the tests cannot be planned by name: nothing is offered. */
  withholdReason?: string;
  /**
   * Why this group is NOT proven, when the review command offers it anyway.
   * Carried all the way to the Refactor Preview label: the reader has to see
   * the reason next to the box being ticked, not in a message that is gone by
   * then.
   */
  unprovenReason?: string;
  /** Imports naming the declaration anywhere, main sources included. */
  staleImports?: { path: string; line: number; name: string }[];
  /**
   * KJ-067: the Dagger members injection declarations that go with the class
   * (`fun inject(target: X)` and its fake's empty override). Only filled with
   * `withInjections`, whose caller cuts them too.
   */
  injectionSites?: { path: string; start: number; end: number }[];
}

/** The import lines of `imports` as cuts of `plan`, each line once, only while it still names its declaration. */
function ajouteLesImports(
  plan: TestCoRemovalPlan,
  imports: readonly { path: string; line: number; name: string }[],
  textByPath: ReadonlyMap<string, string>,
): void {
  for (const imp of imports) {
    const text = textByPath.get(imp.path);
    if (text === undefined) continue;
    let start = 0;
    for (let l = 0; l < imp.line && start >= 0; l++) {
      const nl = text.indexOf('\n', start);
      start = nl === -1 ? -1 : nl + 1;
    }
    if (start < 0) continue;
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl + 1;
    if (!new RegExp(`^\\s*import\\s+(?:static\\s+)?[\\w.]*\\b${imp.name}\\b`).test(text.slice(start, end))) continue;
    if (plan.cuts.some(c => c.path === imp.path && c.start === start)) continue;
    plan.cuts.push({ path: imp.path, start, end, name: imp.name, kind: 'import' });
  }
}


export interface TestOnlyOptions {
  segs?: readonly string[];
  ignorePaths?: readonly string[];
  frameworkNameSuffixes?: boolean;
  islandsMaxSize?: number;
  /** Include the groups `isOfferable` withholds, when their closure plan closes. */
  includeUnproven?: boolean;
  /**
   * Count a class's injection declarations among the production extents and
   * hand them over on the group. The caller must cut them: `kdead remove --all`.
   */
  withInjections?: boolean;
  /** Told of each unproven group whose closure did not close, and why. */
  onWithheld?: (label: string, reason: string) => void;
  /** The posts of unheard events the safe removal refused; with `includeUnproven` by default. */
  includeRefusedPosts?: boolean;
}

export interface TestOnlyPlans {
  groups: { group: Group; plan: TestCoRemovalPlan }[];
  textByPath: Map<string, string>;
  offered: number;
  withheld: number;
  testFiles: Set<string>;
  testFunctions: number;
}

export function planTestOnly(
  data: { sources: readonly { path: string; text: string }[]; libraryModules?: readonly string[] },
  o: TestOnlyOptions = {},
): TestOnlyPlans {
  const segs = (o.segs ?? DEFAULT_TEST_SEGMENTS) as string[];
  const ignorePaths = (o.ignorePaths ?? ['**/buildSrc/**', '**/build-logic/**']) as string[];
  const includeUnproven = o.includeUnproven ?? false;
  const includeRefusedPosts = o.includeRefusedPosts ?? includeUnproven;
  const symbols = findUnusedSymbols({
    sources: data.sources, testSourceSets: segs, libraryModules: data.libraryModules,
    ignorePaths, includeTestOnly: true,
    frameworkNameSuffixes: o.frameworkNameSuffixes ?? false,
  });
  const members = findUnusedMembers({
    sources: data.sources, testSourceSets: segs, ignorePaths, includeTestOnly: true, includeSelfOnly: false,
    deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  });
  const islands = findDeadIslands({
    sources: data.sources, testSourceSets: segs, ignorePaths, includeTestOnly: true,
    maxIslandSize: o.islandsMaxSize ?? 32,
  });
  const entries = findUnusedEnumEntries({ sources: data.sources, testSourceSets: segs, includeTestOnly: true });

  const groups: Group[] = [];
  for (const s of symbols) {
    if (s.verdict !== 'testOnly' || s.removeStart < 0) continue;
    const injectionSites = o.withInjections && s.injectionSites.length > 0
      ? s.injectionSites.map(i => ({ path: i.path, start: i.removeStart, end: i.removeEnd }))
      : undefined;
    groups.push({ label: s.name, names: [s.name], allowed: [], path: s.path, removeStart: s.removeStart, removeEnd: s.removeEnd, fileBecomesEmpty: s.fileBecomesEmpty, staleImports: s.staleImports.map(i => ({ ...i, name: s.name })), injectionSites });
  }
  // Java static imports of the members and entries that go, in any file: the
  // plan reads test sources only (src/util/memberImports.ts).
  const clesMembres = new Set<string>();
  for (const m of members) if (m.verdict === 'testOnly' && m.removeStart >= 0) clesMembres.add(memberKey(m.container ?? '', m.name));
  for (const e of entries) if (e.verdict === 'testOnly' && e.removeStart >= 0) clesMembres.add(`${e.enumName}.${e.name}`);
  const importsParCle = new Map<string, { path: string; line: number; name: string }[]>();
  for (const imp of findMemberImports(data.sources, clesMembres)) {
    (importsParCle.get(imp.key) ?? importsParCle.set(imp.key, []).get(imp.key)!).push({ path: imp.path, line: imp.line, name: imp.name });
  }
  for (const m of members) {
    if (m.verdict !== 'testOnly' || m.removeStart < 0) continue;
    groups.push({ label: `${m.container}.${m.name}`, names: [m.name], allowed: (m.container ?? '').split('.'), path: m.path, removeStart: m.removeStart, removeEnd: m.removeEnd, fileBecomesEmpty: false, staleImports: importsParCle.get(memberKey(m.container ?? '', m.name)) });
  }
  for (const e of entries) {
    if (e.verdict !== 'testOnly' || e.removeStart < 0) continue;
    groups.push({
      label: `${e.enumName}.${e.name}`, names: [e.name], allowed: [e.enumName], path: e.path, removeStart: e.removeStart, removeEnd: e.removeEnd, fileBecomesEmpty: false,
      staleImports: importsParCle.get(`${e.enumName}.${e.name}`),
      // The plan looks for the NAME in test files. When another enum declares
      // it, a test importing that enum's entry writes only `FEED`, touches no
      // other production name, and went with this entry: live code lost its test.
      withholdReason: e.testsNameOnlyThisEntry ? undefined : `${e.name} is also an entry of another enum, which a test may name`,
    });
  }
  // An island is ONE group: a test naming two of its members is one test.
  for (const i of islands) {
    if (i.verdict !== 'testOnly' || !i.fixable) continue;
    const names = i.members.map(m => m.name);
    for (const m of i.members) {
      groups.push({ label: names.join(' + '), names, allowed: [], path: m.path, removeStart: m.removeStart, removeEnd: m.removeEnd, fileBecomesEmpty: false, staleImports: i.staleImports });
    }
  }

  const declarations = productionDeclarations(data.sources, segs);
  // Everything one label removes: an island pushes one group per member.
  const extentsByLabel = new Map<string, { path: string; start: number; end: number }[]>();
  for (const g of groups) {
    const l = extentsByLabel.get(g.label) ?? extentsByLabel.set(g.label, []).get(g.label)!;
    l.push({ path: g.path, start: g.removeStart, end: g.removeEnd }, ...(g.injectionSites ?? []));
  }
  const result: TestOnlyPlans = {
    groups: [], textByPath: new Map(data.sources.map(s => [s.path, s.text])),
    offered: 0, withheld: 0, testFiles: new Set(), testFunctions: 0,
  };
  const planByLabel = new Map<string, TestCoRemovalPlan>();
  for (const group of groups) {
    let plan = planByLabel.get(group.label);
    if (plan === undefined) {
      plan = planTestCoRemoval(group.names, data.sources, segs, liveOutside(declarations, extentsByLabel.get(group.label) ?? []), group.allowed);
      if (group.withholdReason) plan.unresolved.push({ path: group.path, line: 0, reason: group.withholdReason });
      planByLabel.set(group.label, plan);
      if (isOfferable(plan)) result.offered++; else result.withheld++;
      // Only once the plan stands on its tests: an import alone must never make
      // a withheld plan offerable. The plan reads test sources only, and a main
      // file that imported the declaration without using it kept its import:
      // the module no longer compiled once the declaration was gone.
      if (isOfferable(plan)) ajouteLesImports(plan, group.staleImports ?? [], result.textByPath);
      // Counted with the PLAN, not with the group: an island pushes one group
      // per member and they all share a plan, so counting here announced three
      // times the tests a three member island actually removes.
      if (isOfferable(plan)) {
        for (const f of plan.files) result.testFiles.add(f);
        result.testFunctions += plan.functions;
      }
    }
    if (!isOfferable(plan)) {
      if (!includeUnproven) continue;
      // Not the withheld plan: it stops planning the moment it doubts, and an
      // edit built from it removed the subject and kept the tests that call
      // it, 15 compilation errors on the reference project. The closure
      // planner builds the whole edit, applies it in memory and proves no
      // surviving source names what leaves. Only a plan that closes is put in
      // the preview; the doubt that withheld it stays on the label.
      const closure = planClosure(group.names, data.sources, segs, extentsByLabel.get(group.label) ?? []);
      if (!isClosed(closure)) {
        // Reached, with nothing to cut: tests name it only in data (a JSON
        // fixture key), so the declaration goes alone. Only for a caller that
        // builds afterwards.
        if (o.withInjections && closure.withheld === undefined) { result.groups.push({ group, plan: closure }); continue; }
        o.onWithheld?.(group.label, closure.withheld ?? closure.unresolved[0]?.reason ?? 'unproven');
        continue;
      }
      // The first reason is enough: they all describe the same doubt, and a
      // Refactor Preview label carrying four of them stops being readable.
      // `plan.unresolved` keeps them all for whoever wants the detail.
      const pourquoi = plan.unresolved[0]?.reason ?? 'unproven';
      const reecrits = closure.cuts.filter(c => c.kind === 'rewrite').length;
      const portee = (closure.files.length > 0
        ? `${plural(closure.files.length, 'test file')} whole, ${plural(closure.cutFunctions, 'test function')}`
        : plural(closure.cutFunctions, 'test function'))
        + (reecrits > 0 ? `, ${plural(reecrits, 'setter call')} rewritten` : '');
      result.groups.push({ group: { ...group, unprovenReason: `${pourquoi}; takes ${portee}` }, plan: closure });
      for (const f of closure.files) result.testFiles.add(f);
      result.testFunctions += closure.functions;
      continue;
    }
    result.groups.push({ group, plan });
  }
  // KJ-061, review mode only: the posts of an unheard event that the safe
  // removal refused, each with the reason on its label. No test goes with a
  // post, so the plan is empty; once the reader ticks the post, the event
  // class and its tests are what the next round finds on its own.
  if (includeRefusedPosts) {
    for (const r of findRefusedPosts({ sources: data.sources, testSourceSets: segs })) {
      result.groups.push({
        group: {
          label: `the post of ${r.name} in ${r.path.split(/[\\/]/).pop()}`,
          names: [], allowed: [], path: r.path, removeStart: r.start, removeEnd: r.end,
          fileBecomesEmpty: false, unprovenReason: r.reason,
        },
        plan: { files: [], cuts: [], unresolved: [], functions: 0 },
      });
    }
  }
  return result;
}
