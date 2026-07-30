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
