import * as vscode from 'vscode';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import {
  collectValueKeyDeclarations,
  parseValuesPath,
} from '../indexer/ValueResourceScanner';
import { DeadCodeSweepReport, scanWorkspace } from './DeadCodeSweep';
import { summarize as summarizeSweep } from '../providers/DeadCodeSweep';
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

interface Section {
  label: string;
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

      // ── 1. Dead code inside files ────────────────────────────────────────
      progress.report({ message: 'dead code in files…' });
      if (cfg.get<boolean>('deadCodeSweep', true)) {
        const sweep = await scanWorkspace(token);
        if (token.isCancellationRequested) return;
        sweepReport.setScan(sweep);
        const all = sweep.files.flatMap(f => f.findings);
        const byDetector = summarizeSweep(all);
        sections.push({
          label: 'dead code',
          count: all.length,
          detail: [...byDetector.entries()].sort((a, b) => b[1] - a[1])
            .map(([d, n]) => `${n} ${d}`).join(', '),
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
              && /maven-publish|com\.vanniktech\.maven\.publish/.test(s.text)));
          const symbols = findUnusedSymbols({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', []),
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
          sections.push({
            label: 'unreferenced symbols',
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
          sections.push({ label: 'resource keys', count: keys.length });
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
          sections.push({ label: 'resource files', count: files.length });
        }
      } else {
        skipped.push('resource files');
      }

      // ── 5. Events nobody listens to ──────────────────────────────────────
      progress.report({ message: 'unheard events…' });
      if (UnheardEventProvider.isEnabled()) {
        const scan = findUnheardEvents({
          sources: data.sources,
          testSourceSets: cfg.get<string[]>('testSourceSets', []),
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
            testSourceSets: cfg.get<string[]>('testSourceSets', []),
            ignoreNames: cfg.get<string[]>('unusedEnumEntriesIgnoreNames', []),
            includeTestOnly: cfg.get<boolean>('unusedEnumEntriesIncludeTestOnly', true),
          });
          enumEntryProvider.setFindings(entries);
          const enums = new Set(entries.map(e => e.enumName)).size;
          sections.push({
            label: 'enum entries',
            count: entries.length,
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
            count: keys.length,
            detail: decls > keys.length ? `${decls} declarations` : undefined,
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
            count: aliases.length,
            detail: versions > 0 ? `${versions} version entries freed` : undefined,
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
          // KJ-032 already ran above; reuse its findings for M12 when it did.
          const dead = UnusedSymbolProvider.isEnabled() && !data.sourcesTruncated
            ? findUnusedSymbols({
              sources: data.sources,
              testSourceSets: cfg.get<string[]>('testSourceSets', []),
            }).map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd }))
            : [];
          const members = findUnusedMembers({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', []),
            ignoreNames: cfg.get<string[]>('unusedMembersIgnoreNames', []),
            ignorePaths: cfg.get<string[]>('unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']),
            includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
            includeSelfOnly: cfg.get<boolean>('unusedMembersSelfOnly', true),
            deadDeclarations: dead,
          });
          memberProvider.setFindings(members);
          const unref = members.filter(m => m.verdict === 'unreferenced').length;
          const selfOnly = members.filter(m => m.verdict === 'selfOnly').length;
          sections.push({
            label: 'class members',
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
            testSourceSets: cfg.get<string[]>('testSourceSets', []),
            ignoreNames: cfg.get<string[]>('deadIslandsIgnoreNames', []),
            includeTestOnly: cfg.get<boolean>('unusedSymbolsIncludeTestOnly', true),
            maxIslandSize: cfg.get<number>('deadIslandsMaxSize', 8),
          });
          islandProvider.setFindings(islands, new Map(data.sources.map(s => [s.path, s.text])));
          const islandDecls = islands.reduce((sum, i) => sum + i.members.length, 0);
          sections.push({
            label: 'dead islands',
            count: islands.length,
            detail: islands.length > 0 ? `${islandDecls} declarations holding each other` : undefined,
          });
        }
      } else {
        skipped.push('dead islands');
      }

      // ── the one summary ──────────────────────────────────────────────────
      const total = sections.reduce((sum, s) => sum + s.count, 0);
      if (total === 0 && skipped.length === 0) {
        void vscode.window.showInformationMessage(
          `Nothing unused found across ${data.sources.length} files.`,
        );
        return;
      }

      const parts = sections
        .filter(s => s.count > 0)
        .map(s => `${s.count} ${s.label}${s.detail ? ` (${s.detail})` : ''}`);
      const skippedNote = skipped.length > 0 ? ` Skipped: ${skipped.join('; ')}.` : '';
      void vscode.window.showInformationMessage(
        `${total} findings across ${data.sources.length} files: ${parts.join(' · ')}.${skippedNote}`,
      );
    },
  );
}
