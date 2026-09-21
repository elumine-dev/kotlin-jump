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
import { planCascade } from '../providers/removalCascade';
import { findOrphanSourceSets } from '../providers/orphanSourceSets';
import { findStaleBaselineEntries } from '../providers/staleBaselineEntries';
import { findEmptySourceFiles } from '../providers/emptySourceFiles';
import { planFileEdits } from '../providers/DeadCodeSweep';
import { findIdleImplementations } from '../providers/idleImplementations';
import { UnheardEventProvider, findUnheardEvents } from '../providers/UnheardEventProvider';
import { UnusedEnumEntryProvider, scanEnums } from '../providers/UnusedEnumEntryProvider';
import { UnusedRemoteConfigKeyProvider, findUnusedRemoteConfigKeys } from '../providers/UnusedRemoteConfigKeyProvider';
import { UnusedGradleDependencyProvider, findUnusedGradleDependencies } from '../providers/UnusedGradleDependencyProvider';
import { UnusedMemberProvider, findUnusedMembers } from '../providers/UnusedMemberProvider';
import { DeadIslandProvider, findDeadIslands } from '../providers/DeadIslandProvider';
import { findUnusedConstructorParameters } from '../providers/unusedConstructorParameters';
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
      /**
       * Les etendues que `Remove Everything Unused` couperait, accumulees au
       * fil des familles pour calculer la CASCADE a la fin.
       *
       * Rapportee ici parce qu'elle ne l'etait nulle part : la commande
       * supprime des fichiers devenus vides et des imports orphelins que ce
       * rapport n'annoncait pas, donc le clic sur Remove faisait plus que ce
       * que la lecture avait promis. On accumule au lieu de relancer
       * `collecterUnePasse`, qui ferait un second scan complet.
       */
      const etendues = new Map<string, { start: number; end: number }[]>();
      const noteEtendue = (chemin: string, start: number, end: number) => {
        if (start < 0 || end <= start) return;
        const l = etendues.get(chemin) ?? [];
        l.push({ start, end });
        etendues.set(chemin, l);
      };
      // ── 1. Dead code inside files ────────────────────────────────────────
      progress.report({ message: 'dead code in files…' });
      if (cfg.get<boolean>('deadCodeSweep', true)) {
        const sweep = await scanWorkspace(token);
        if (token.isCancellationRequested) return;
        sweepReport.setScan(sweep);
        const all = sweep.files.flatMap(f => f.findings);
        // `SweptFile` porte une Uri, pas un chemin : la cascade raisonne sur
        // les memes chemins que le corpus, d'ou `fsPath`.
        for (const f of sweep.files) {
          for (const e of planFileEdits(f.findings)) noteEtendue(f.uri.fsPath, e.start, e.end);
        }
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
      const corpusData = await corpus.get(token);
      if (token.isCancellationRequested) return;

      // ── KJ-055, before anything reads the corpus ─────────────────────────
      // A directory under `src/` that no Gradle variant builds is compiled by
      // nothing, so its mentions cannot keep a declaration alive. Taking it
      // out of what the detectors READ is what makes the production code it
      // names findable; nothing here removes a file. On the reference project
      // five such directories hold 150 files and were the only thing keeping
      // seven production declarations alive.
      const orphelins = findOrphanSourceSets({
        sources: corpusData.sources, moduleDirs: corpusData.moduleDirs,
        truncated: corpusData.sourcesTruncated,
      });
      const ecartes = new Set(orphelins.flatMap(o => o.files));
      const data = ecartes.size === 0 ? corpusData
        : { ...corpusData, sources: corpusData.sources.filter(s => !ecartes.has(s.path)) };
      if (orphelins.length > 0) {
        sections.push({
          label: 'orphan source sets',
          one: 'orphan source set',
          count: orphelins.length,
          detail: `${plural(ecartes.size, 'file')} Gradle never compiles, `
            + `keeping nothing alive: ${orphelins.map(o => o.name).join(', ')}`,
        });
      }

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
          for (const f of symbols) {
            if (f.verdict !== 'unreferenced') continue;
            noteEtendue(f.path, f.removeStart, f.removeEnd);
            // KJ-067: the injection declarations go with the class, in other
            // files, so the knock on count matches what Remove sends.
            for (const site of f.injectionSites) noteEtendue(site.path, site.removeStart, site.removeEnd);
          }
          symbolProvider.setFindings(symbols);
          const unreferenced = symbols.filter(s => s.verdict === 'unreferenced');
          const testOnly = symbols.filter(s => s.verdict === 'testOnly');
          const parInjection = unreferenced.filter(s => s.via === 'injection').length;
          keptAliveByTests += testOnly.length;
          sections.push({
            label: 'unreferenced symbols',
            one: 'unreferenced symbol',
            count: unreferenced.length,
            detail: [
              testOnly.length > 0 ? `${testOnly.length} used only from tests` : '',
              parInjection > 0 ? `${parInjection} named only by an injection method` : '',
            ].filter(Boolean).join(', ') || undefined,
          });
        }
      } else {
        skipped.push('unreferenced symbols');
      }

      // ── 2b. Interfaces implemented for nothing ───────────────────────────
      if (!data.sourcesTruncated) {
        const idles = findIdleImplementations({
          sources: data.sources,
          testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
        });
        for (const impl of idles) {
          for (const c of impl.cuts) noteEtendue(impl.path, c.start, c.end);
        }
        const places = idles.reduce((n, impl) => n + impl.cuts.length, 0);
        sections.push({
          label: 'interfaces implemented for nothing',
          one: 'interface implemented for nothing',
          count: idles.length,
          detail: places > 0 ? `${plural(places, 'place')} to cut` : undefined,
        });
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
            assets: data.assets,
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
          const { entries, emptied: entiers } = scanEnums({
            sources: data.sources,
            testSourceSets: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
            ignoreNames: cfg.get<string[]>('unusedEnumEntriesIgnoreNames', []),
            includeTestOnly: cfg.get<boolean>('unusedEnumEntriesIncludeTestOnly', true),
          });
          for (const f of entries) {
            if (f.verdict === 'unreferenced') noteEtendue(f.path, f.removeStart, f.removeEnd);
          }
          enumEntryProvider.setFindings(entries);
          keptAliveByTests += entries.filter(e => e.verdict === 'testOnly').length;
          // Counted on THIS line only when the entry is not already counted on
          // the testOnly one. The symbol and member sections have always
          // excluded their testOnly findings; these two did not, so the total
          // in the headline counted eleven of them twice on a real project.
          const propres = entries.filter(e => e.verdict !== 'testOnly');
          const enums = new Set(propres.map(e => e.enumName)).size;
          // KJ-066: the nested enums that go whole, so the knock on count here
          // matches what Remove sends, file deletion included.
          for (const e of entiers) noteEtendue(e.path, e.removeStart, e.removeEnd);
          const surEnums = enums > 0 ? `across ${enums} enum${enums > 1 ? 's' : ''}` : '';
          const surEntiers = entiers.length > 0 ? `${entiers.length} of them emptied whole` : '';
          sections.push({
            label: 'enum entries',
            one: 'enum entry',
            count: propres.length,
            detail: [surEnums, surEntiers].filter(Boolean).join(', ') || undefined,
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
          for (const f of members) {
            if (f.verdict === 'unreferenced') noteEtendue(f.path, f.removeStart, f.removeEnd);
          }
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
          for (const i of islands) {
            if (i.verdict !== 'unreferenced' || !i.fixable) continue;
            for (const mem of i.members) noteEtendue(mem.path, mem.removeStart, mem.removeEnd);
          }
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

      // ── 11. Constructor parameters nothing reads (KJ-058) ────────────────
      // Reported with the argument lines that go with them, so that what this
      // line announces is what `Remove Everything Unused` sends: the sweep
      // above already counts the parameter but carries no edit for it.
      progress.report({ message: 'constructor parameters…' });
      if (data.sourcesTruncated) {
        skipped.push('constructor parameters (workspace too large to prove absence)');
      } else {
        const params = findUnusedConstructorParameters({ sources: data.sources });
        for (const p of params) {
          noteEtendue(p.path, p.removeStart, p.removeEnd);
          for (const s of p.sites) noteEtendue(s.path, s.removeStart, s.removeEnd);
        }
        const args = params.reduce((n, p) => n + p.sites.length, 0);
        sections.push({
          label: 'constructor parameters',
          one: 'constructor parameter',
          count: params.length,
          detail: args > 0 ? `with ${plural(args, 'named argument')} at call sites` : undefined,
        });
      }

      // ── 12. Baseline entries whose file is gone (KJ-059) ─────────────────
      progress.report({ message: 'stale baseline entries…' });
      if (data.sourcesTruncated) {
        skipped.push('stale baseline entries (workspace too large to prove a file is gone)');
      } else {
        const stale = findStaleBaselineEntries({ sources: data.sources });
        for (const e of stale) noteEtendue(e.path, e.removeStart, e.removeEnd);
        if (stale.length > 0) {
          sections.push({
            label: 'stale baseline entries',
            one: 'stale baseline entry',
            count: stale.length,
            detail: `for ${plural(new Set(stale.map(e => e.file)).size, 'file')} that no longer exist`,
          });
        }
      }

      // ── 13. Source files that declare nothing (KJ-060) ───────────────────
      // What a removal leaves behind when it took the last declaration and
      // nothing looked again; a file already empty when the round began is
      // seen by no other detector.
      progress.report({ message: 'empty source files…' });
      if (data.sourcesTruncated) {
        skipped.push('empty source files (workspace too large to read every file)');
      } else {
        const vides = findEmptySourceFiles({ sources: data.sources });
        if (vides.length > 0) {
          sections.push({
            label: 'source files declaring nothing',
            one: 'source file declaring nothing',
            count: vides.length,
            detail: vides.map(f => f.path.split(/[\\/]/).pop()).slice(0, 6).join(', ') + (vides.length > 6 ? ', …' : ''),
          });
        }
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
      // ── La cascade, ce que Remove emporte EN PLUS des coupes ────────────
      // Elle ne juge rien : elle deduit de coupes deja decidees quels fichiers
      // ne gardent plus rien et quels imports nomment un disparu. La rapporter
      // ici est ce qui rend la lecture et l'ecriture comparables.
      if (etendues.size > 0) {
        const textes = new Map(data.sources.map(s2 => [s2.path, s2.text]));
        const cascade = planCascade(etendues, textes);
        const orphelins = [...cascade.imports.values()].reduce((n, l) => n + l.length, 0);
        if (cascade.deleteFiles.size > 0 || orphelins > 0) {
          sections.push({
            label: 'knock-on removals',
            one: 'knock-on removal',
            count: cascade.deleteFiles.size + orphelins,
            detail: [
              cascade.deleteFiles.size > 0 ? `${cascade.deleteFiles.size} file(s) left empty` : '',
              orphelins > 0 ? `${orphelins} orphaned import(s)` : '',
            ].filter(Boolean).join(', '),
          });
        }
      }

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
