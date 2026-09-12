import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import {
  ResourceCorpus,
  declaresPublishing,
} from '../indexer/ResourceCorpus';
import {
  collectValueKeyDeclarations,
  parseValuesPath,
} from '../indexer/ValueResourceScanner';
import { DeadCodeSweepReport, describeFindings, scanWorkspace } from './DeadCodeSweep';
import {
  UnusedResourceKeyProvider,
  findUnusedResourceKeys,
} from '../providers/UnusedResourceKeyProvider';
import {
  UnusedResourceProvider,
  findUnusedResources,
  readSettings as readResourceSettings,
} from '../providers/UnusedResourceProvider';
import {
  UnusedSymbolProvider,
  findUnusedSymbols,
} from '../providers/UnusedSymbolProvider';
import { UnheardEventProvider, findUnheardEvents } from '../providers/UnheardEventProvider';
import { UnusedEnumEntryProvider, findUnusedEnumEntries } from '../providers/UnusedEnumEntryProvider';
import { UnusedRemoteConfigKeyProvider, findUnusedRemoteConfigKeys } from '../providers/UnusedRemoteConfigKeyProvider';
import { UnusedGradleDependencyProvider, findUnusedGradleDependencies } from '../providers/UnusedGradleDependencyProvider';
import { UnusedMemberProvider, findUnusedMembers } from '../providers/UnusedMemberProvider';
import { DeadIslandProvider, findDeadIslands } from '../providers/DeadIslandProvider';
import { plural } from '../util/plural';

/**
 * One command for the whole picture: every dead-code detector the extension
 * has, run in a single pass, reporting into a single summary.
 *
 * The four families answer different questions and none of them overlaps:
 *   - the sweep: what is dead INSIDE a file (imports, params, locals…)
 *   - symbols:   what no OTHER file references
 *   - keys:      which `values/` entries nothing points at
 *   - files:     which resource files nothing points at
 *
 * They share one `ResourceCorpus` read, so running them together costs barely
 * more than running the most expensive one alone.
 */

export interface Section {
  /** Plural form of the label, and the singular the count may need. */
  label: string;
  one: string;
  count: number;
  detail?: string;
}

export async function findEverythingUnusedCommand(
  corpus: ResourceCorpus,
  sweepReport: DeadCodeSweepReport,
  symbolProvider: UnusedSymbolProvider,
  keyProvider: UnusedResourceKeyProvider,
  resourceProvider: UnusedResourceProvider,
  eventProvider: UnheardEventProvider,
  enumEntryProvider: UnusedEnumEntryProvider,
  remoteConfigProvider: UnusedRemoteConfigKeyProvider,
  gradleProvider: UnusedGradleDependencyProvider,
  memberProvider: UnusedMemberProvider,
  islandProvider: DeadIslandProvider,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning for everything unused…', cancellable: true },
    async (progress, token) => {
      const cfg = vscode.workspace.getConfiguration('kotlinJump');
      const sections: Section[] = [];
      const skipped: string[] = [];
      // KJ-047: everything the four cross-file detectors say is exercised and
      // nothing else. It gets its own line, because the fix is a different
      // move: the declaration AND its tests, or neither.
      let keptAliveByTests = 0;

      let symbolFindings: ReturnType<typeof findUnusedSymbols> | undefined;
      // ── 1. Dead code inside files ────────────────────────────────────────
      progress.report({ message: 'dead code in files…' });
      if (cfg.get<boolean>('deadCodeSweep', true)) {
        const sweep = await scanWorkspace(token);
        if (token.isCancellationRequested) return;
        sweepReport.setScan(sweep);
        const all = sweep.files.flatMap(f => f.findings);
        sections.push({
          label: 'dead code',
          one: 'dead code',
          count: all.length,
          detail: describeFindings(all),
        });
      } else {
        skipped.push('dead code');
      }

      // ── one corpus read for the three workspace detectors ────────────────
      progress.report({ message: 'reading the workspace…' });
      const data = await corpus.get(token);
      if (token.isCancellationRequested) return;

      // ── 2. Symbols nothing references ────────────────────────────────────
      progress.report({ message: 'unreferenced symbols…' });
      if (UnusedSymbolProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('unreferenced symbols (workspace too large to prove absence)');
        } else {
          const published = data.moduleDirs.filter(dir =>
            data.sources.some(s => s.path.startsWith(`${dir}/build.gradle`)
              && declaresPublishing(s.text)));
          const symbols = symbolFindings = findUnusedSymbols({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
            publishedModules: published,
            libraryModules: data.libraryModules,
            ignoreNames: cfg.get<string[]>('unusedSymbolsIgnoreNames', []),
            ignorePaths: cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']),
            includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
            frameworkNameSuffixes: cfg.get<boolean>('unusedSymbolsFrameworkNameSuffixes', false),
          });
          symbolProvider.setFindings(symbols);
          const unreferenced = symbols.filter(s => s.verdict === 'unreferenced');
          const testOnly = symbols.filter(s => s.verdict === 'testOnly');
          keptAliveByTests += testOnly.length;
          sections.push({
            label: 'unreferenced symbols',
            one: 'unreferenced symbol',
            count: unreferenced.length,
            detail: testOnly.length > 0 ? `${testOnly.length} used only from tests` : undefined,
          });
        }
      } else {
        skipped.push('unreferenced symbols');
      }

      // ── 3. Resource keys ─────────────────────────────────────────────────
      progress.report({ message: 'resource keys…' });
      if (UnusedResourceKeyProvider.isEnabled()) {
        if (data.truncated) {
          skipped.push('resource keys (workspace too large to prove absence)');
        } else {
          const declarations = data.sources
            .filter(s => parseValuesPath(s.path) !== undefined)
            .flatMap(s => collectValueKeyDeclarations(s.path, s.text, data.modulesWithCode));
          const keys = findUnusedResourceKeys({
            declarations,
            sources: data.sources,
            modulesWithCode: data.modulesWithCode,
            libraryModules: data.libraryModules,
            ignorePrefixes: cfg.get<string[]>('unusedResourceKeysIgnorePrefixes', []),
          });
          keyProvider.setFindings(keys);
          sections.push({ label: 'resource keys', one: 'resource key', count: keys.length });
        }
      } else {
        skipped.push('resource keys');
      }

      // ── 4. Resource files ────────────────────────────────────────────────
      progress.report({ message: 'resource files…' });
      const resourceSettings = readResourceSettings();
      if (resourceSettings.enabled) {
        if (data.truncated) {
          skipped.push('resource files (workspace too large to prove absence)');
        } else {
          const files = findUnusedResources({
            entries: data.index.entries(),
            sources: data.sources,
            modulesWithCode: data.modulesWithCode,
            libraryModules: data.libraryModules,
            includeDrawables: resourceSettings.includeDrawables,
          });
          resourceProvider.setFindings(files);
          sections.push({ label: 'resource files', one: 'resource file', count: files.length });
        }
      } else {
        skipped.push('resource files');
      }

      // ── 5. Events nobody listens to ──────────────────────────────────────
      progress.report({ message: 'unheard events…' });
      if (UnheardEventProvider.isEnabled()) {
        const scan = findUnheardEvents({
          sources: data.sources,
          testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
          truncated: data.sourcesTruncated,
          ignoreNames: cfg.get<string[]>('unheardEventsIgnoreNames', []),
          assumeSubscribed: cfg.get<string[]>('unheardEventsAssumeSubscribed', []),
        });
        // An unreadable subscription means nothing was proven, which is a
        // different thing from finding nothing. Saying "0" here would be a lie.
        if (scan.unreadable.length > 0) {
          eventProvider.setUnreadable(scan.unreadable);
          skipped.push(`unheard events (${scan.unreadable.length} unreadable subscription(s))`);
        } else {
          eventProvider.setFindings(scan.events);
          const types = new Set(scan.events.map(e => e.name)).size;
          sections.push({
            label: 'unheard events',
            one: 'unheard event',
            count: scan.events.length,
            detail: types > 0 ? `${types} event type${types > 1 ? 's' : ''}` : undefined,
          });
        }
      } else {
        skipped.push('unheard events');
      }

      // ── 6. Enum entries nothing names ────────────────────────────────────
      progress.report({ message: 'enum entries…' });
      if (UnusedEnumEntryProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('enum entries (workspace too large to prove absence)');
        } else {
          const entries = findUnusedEnumEntries({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
            ignoreNames: cfg.get<string[]>('unusedEnumEntriesIgnoreNames', []),
            includeTestOnly: cfg.get<boolean>('unusedEnumEntriesIncludeTestOnly', true),
          });
          enumEntryProvider.setFindings(entries);
          keptAliveByTests += entries.filter(e => e.verdict === 'testOnly').length;
          // Counted on THIS line only when the entry is not already counted on
          // the testOnly one. The symbol and member sections have always
          // excluded their testOnly findings; these two did not, so the total
          // in the headline counted eleven of them twice on a real project.
          const propres = entries.filter(e => e.verdict !== 'testOnly');
          const enums = new Set(propres.map(e => e.enumName)).size;
          sections.push({
            label: 'enum entries',
            one: 'enum entry',
            count: propres.length,
            detail: enums > 0 ? `across ${enums} enum${enums > 1 ? 's' : ''}` : undefined,
          });
        }
      } else {
        skipped.push('enum entries');
      }

      // ── 7. Remote Config defaults nothing reads ──────────────────────────
      progress.report({ message: 'Remote Config keys…' });
      if (UnusedRemoteConfigKeyProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('Remote Config keys (workspace too large to prove absence)');
        } else {
          const keys = findUnusedRemoteConfigKeys({
            sources: data.sources,
            ignoreNames: cfg.get<string[]>('unusedRemoteConfigKeysIgnoreNames', []),
          });
          remoteConfigProvider.setFindings(keys);
          const decls = keys.reduce((n, k) => n + k.declarations.length, 0);
          sections.push({
            label: 'Remote Config keys',
            one: 'Remote Config key',
            count: keys.length,
            detail: decls > keys.length ? plural(decls, 'declaration') : undefined,
          });
        }
      } else {
        skipped.push('Remote Config keys');
      }

      // ── 8. Catalog aliases nothing references ────────────────────────────
      progress.report({ message: 'Gradle dependencies…' });
      if (UnusedGradleDependencyProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('Gradle dependencies (workspace too large to prove absence)');
        } else {
          const aliases = findUnusedGradleDependencies({
            sources: data.sources,
            ignoreNames: cfg.get<string[]>('unusedGradleDependenciesIgnoreNames', []),
          });
          gradleProvider.setFindings(aliases);
          const versions = aliases.filter(a => a.orphanedVersion).length;
          sections.push({
            label: 'catalog aliases',
            one: 'catalog alias',
            count: aliases.length,
            detail: versions > 0 ? `${plural(versions, 'version entry', 'version entries')} freed` : undefined,
          });
        }
      } else {
        skipped.push('Gradle dependencies');
      }

      // ── 9. Class members nothing references ──────────────────────────────
      progress.report({ message: 'class members…' });
      if (UnusedMemberProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('class members (workspace too large to prove absence)');
        } else {
          // KJ-032 already ran above; reuse its findings for M12 when it did
          // (it used to run the whole scan a second time here).
          const dead = (symbolFindings ?? []).map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd }));
          const members = findUnusedMembers({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
            ignoreNames: cfg.get<string[]>('unusedMembersIgnoreNames', []),
            ignorePaths: cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']),
            includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
            includeSelfOnly: cfg.get<boolean>('unusedMembersSelfOnly', true),
            deadDeclarations: dead,
          });
          memberProvider.setFindings(members);
          const unref = members.filter(m => m.verdict === 'unreferenced').length;
          const selfOnly = members.filter(m => m.verdict === 'selfOnly').length;
          keptAliveByTests += members.filter(m => m.verdict === 'testOnly').length;
          sections.push({
            label: 'class members',
            one: 'class member',
            count: unref,
            detail: selfOnly > 0 ? `${selfOnly} could be private` : undefined,
          });
        }
      } else {
        skipped.push('class members');
      }

      // ── 10. dead islands (KJ-046) ────────────────────────────────────────
      progress.report({ message: 'dead islands…' });
      if (DeadIslandProvider.isEnabled()) {
        if (data.sourcesTruncated) {
          skipped.push('dead islands (workspace too large to prove absence)');
        } else {
          const islands = findDeadIslands({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
            ignoreNames: cfg.get<string[]>('deadIslandsIgnoreNames', []),
            includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
            maxIslandSize: cfg.get<number>('deadIslandsMaxSize', 8),
          });
          islandProvider.setFindings(islands, new Map(data.sources.map(s => [s.path, s.text])));
          keptAliveByTests += islands.filter(i => i.verdict === 'testOnly').length;
          // Same reason as the enum entries above: one finding, one section.
          const ilotsPropres = islands.filter(i => i.verdict !== 'testOnly');
          const islandDecls = ilotsPropres.reduce((sum, i) => sum + i.members.length, 0);
          sections.push({
            label: 'dead islands',
            one: 'dead island',
            count: ilotsPropres.length,
            detail: ilotsPropres.length > 0
              ? `${plural(islandDecls, 'declaration')}${islandDecls > 1 ? ' holding each other' : ''}`
              : undefined,
          });
        }
      } else {
        skipped.push('dead islands');
      }

      if (keptAliveByTests > 0) {
        sections.push({
          label: 'kept alive only by their tests',
          one: 'kept alive only by its tests',
          count: keptAliveByTests,
          detail: 'Remove Code Used Only by Tests, With Its Tests takes both',
        });
      }

      // ── the one summary ──────────────────────────────────────────────────
      void vscode.window.showInformationMessage(resumeTout(sections, data.sources.length, skipped));
    },
  );
}

/**
 * The one line the aggregate command reports.
 *
 * Every section label was written once, in the plural, and printed as is, so a
 * single finding read `1 dead islands` and `1 enum entries`. The empty list
 * had its own shape too: with everything at zero but a detector skipped, the
 * sentence ended on `: .` before naming what was skipped.
 */
export function resumeTout(
  sections: readonly Section[],
  files: number,
  skipped: readonly string[],
): string {
  const total = sections.reduce((sum, s) => sum + s.count, 0);
  const skippedNote = skipped.length > 0 ? ` Skipped: ${skipped.join('; ')}.` : '';
  if (total === 0) return `Nothing unused found across ${plural(files, 'file')}.${skippedNote}`;

  const parts = sections
    .filter(s => s.count > 0)
    .map(s => `${plural(s.count, s.one, s.label)}${s.detail ? ` (${s.detail})` : ''}`);
  return `${plural(total, 'finding')} across ${plural(files, 'file')}: ${parts.join(' · ')}.${skippedNote}`;
}
