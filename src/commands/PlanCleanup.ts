import * as vscode from 'vscode';
import type { AndroidApi } from '../util/androidApi';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { readUnusedSettings } from '../util/unusedSettings';
import type { ResourceCorpus } from '../indexer/ResourceCorpus';
import { executerLesRondes, phraseDuBilan } from './RemoveEverythingUnused';
import { simulerLePointFixe, CoupePlanifiee } from '../cleanup/simulation';
import { planifier, nomDe, aUneCause, Cause } from '../cleanup/planner';
import { plural } from '../util/plural';
import { lotMarkdown, planJson, planMarkdown } from '../cleanup/exports';
import { baseDe } from '../cleanup/cles';
import type { GitFacts } from '../git/GitFacts';

/**
 * The cleanup campaign: a plan of reviewable batches, and a way to apply one.
 *
 * "Plan a Dead Code Cleanup" simulates Remove Everything Unused to its fixed
 * point in memory, groups the cuts into batches a reviewer can read, writes
 * `plan.md`, `plan.json` and one file per batch into the extension's storage,
 * and opens the plan. "Apply a Cleanup Batch" runs the real removal loop with
 * the batch's keys as a filter, so the offsets are fresh, the cascade is the
 * real one and a file that moved since the scan is left alone.
 *
 * Nothing here touches git. The user creates the branch; this applies the
 * edits; the commit stays theirs.
 */

const DOSSIER = 'cleanup/latest';
const PLAN_JSON = `${DOSSIER}/plan.json`;
const PLAN_MD = `${DOSSIER}/plan.md`;
const PAS_DE_PLAN = 'No cleanup plan yet. Run "Kotlin Jump: Plan a Dead Code Cleanup" first.';

export interface Stockage {
  ecrire(rel: string, texte: string): Promise<void>;
  lire(rel: string): Promise<string | undefined>;
  /** Removes everything under a folder, before a plan is rewritten. */
  vider(dossier: string): Promise<void>;
  ouvrir(rel: string): Promise<vscode.TextDocument | undefined>;
}

/** The extension's per workspace storage, outside the repository. */
export function stockageDe(base: vscode.Uri | undefined): Stockage {
  if (!base) return stockageEnMemoire();
  const uri = (rel: string) => vscode.Uri.joinPath(base, ...rel.split('/'));
  return {
    async ecrire(rel, texte) {
      const cible = uri(rel);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(cible, '..'));
      await vscode.workspace.fs.writeFile(cible, new TextEncoder().encode(texte));
    },
    async lire(rel) {
      try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri(rel))); } catch { return undefined; }
    },
    async vider(dossier) {
      try { await vscode.workspace.fs.delete(uri(dossier), { recursive: true, useTrash: false }); } catch { /* absent */ }
    },
    async ouvrir(rel) {
      try { return await vscode.workspace.openTextDocument(uri(rel)); } catch { return undefined; }
    },
  };
}

/** For a host without storage, and for the tests: the plan lives in memory and opens as an untitled document. */
export function stockageEnMemoire(): Stockage {
  const fichiers = new Map<string, string>();
  return {
    async ecrire(rel, texte) { fichiers.set(rel, texte); },
    async lire(rel) { return fichiers.get(rel); },
    async vider(dossier) { for (const k of [...fichiers.keys()]) if (k.startsWith(`${dossier}/`)) fichiers.delete(k); },
    async ouvrir(rel) {
      const content = fichiers.get(rel);
      if (content === undefined) return undefined;
      return vscode.workspace.openTextDocument({ content, language: rel.endsWith('.json') ? 'json' : 'markdown' });
    },
  };
}

export interface Dependances {
  corpus: ResourceCorpus;
  loadAndroidApi?: () => Promise<AndroidApi | undefined>;
  stockage: Stockage;
  /** Node host only; the web build passes nothing and the plan groups by module. */
  git?: GitFacts;
}

interface Reglages {
  segs: string[];
  reglages: ReturnType<typeof readUnusedSettings>;
  maxFilesPerBatch: number;
  maxLinesPerBatch: number;
  groupBy: 'module' | 'cause';
  gitFacts: boolean;
}

function lireLesReglages(): Reglages {
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  return {
    segs: cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS),
    reglages: readUnusedSettings((key, fallback) => cfg.get(key, fallback)),
    maxFilesPerBatch: cfg.get<number>('cleanup.maxFilesPerBatch', 40),
    maxLinesPerBatch: cfg.get<number>('cleanup.maxLinesPerBatch', 1000),
    groupBy: cfg.get<'module' | 'cause'>('cleanup.groupBy', 'module'),
    gitFacts: cfg.get<boolean>('cleanup.gitFacts', true),
  };
}

async function montrer(stockage: Stockage, rel: string): Promise<void> {
  const doc = await stockage.ouvrir(rel);
  if (!doc) return;
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

/** The cuts a cause can be read for: names judged across the whole workspace, never a local, a file or a cascade. */
function racinesDe(coupes: readonly CoupePlanifiee[]): CoupePlanifiee[] {
  return coupes.filter(aUneCause);
}

export async function planCleanupCommand(deps: Dependances): Promise<void> {
  const racine = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!racine) {
    void vscode.window.showWarningMessage('Open a folder before planning a cleanup.');
    return;
  }
  const r = lireLesReglages();
  const api = await deps.loadAndroidApi?.();

  const resultat = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Planning the dead code cleanup…', cancellable: true },
    async (progress, token) => {
      const data = await deps.corpus.get(token);
      if (token.isCancellationRequested) return undefined;
      if (data.sourcesTruncated) return 'truncated' as const;
      const simulation = await simulerLePointFixe(
        {
          sources: data.sources, assets: data.assets, modulesWithCode: data.modulesWithCode,
          libraryModules: data.libraryModules, moduleDirs: data.moduleDirs,
          resourceEntries: typeof data.index?.entries === 'function' ? data.index.entries() : undefined,
        },
        r.segs,
        { androidApi: api, reglages: r.reglages },
        { estAnnule: () => token.isCancellationRequested, surRonde: n => progress.report({ message: `round ${n}…` }) },
      );
      if (token.isCancellationRequested && simulation.coupes.length === 0) return undefined;

      let causes: Map<string, Cause> | undefined;
      if (deps.git && r.gitFacts && await deps.git.disponibleIci()) {
        // The whole repository, not the batch's module: the last caller of a
        // shared helper usually lived somewhere else.
        const demandes = racinesDe(simulation.coupes).map(c => ({ cle: c.cle, nom: nomDe(c), chemins: [] as string[] }));
        causes = await deps.git.causesPour(demandes, {
          progres: (fait, total) => progress.report({ message: `git facts ${fait}/${total}…` }),
          estAnnule: () => token.isCancellationRequested,
        });
      }
      const plan = planifier(simulation.coupes, {
        racine, moduleDirs: data.moduleDirs, libraryModules: data.libraryModules,
        maxFilesPerBatch: r.maxFilesPerBatch, maxLinesPerBatch: r.maxLinesPerBatch, groupBy: r.groupBy, causes,
        mentions: simulation.mentions,
      });
      const entrees = {
        plan, simulation, racine, generatedAt: new Date(),
        head: (await deps.git?.head())?.slice(0, 10), branch: await deps.git?.branche(),
        settings: { maxFilesPerBatch: r.maxFilesPerBatch, maxLinesPerBatch: r.maxLinesPerBatch, groupBy: r.groupBy, gitFacts: !!causes },
      };
      progress.report({ message: 'writing the plan…' });
      await deps.stockage.vider(DOSSIER);
      await deps.stockage.ecrire(PLAN_JSON, planJson(entrees));
      await deps.stockage.ecrire(PLAN_MD, planMarkdown(entrees));
      for (const lot of plan.lots) await deps.stockage.ecrire(`${DOSSIER}/${lot.slug}.md`, lotMarkdown(entrees, lot));
      return { plan, simulation };
    },
  );

  if (resultat === undefined) { void vscode.window.showInformationMessage('Cleanup planning stopped on request. Nothing was written.'); return; }
  if (resultat === 'truncated') {
    void vscode.window.showWarningMessage('The workspace is too large to prove that nothing uses these declarations, so no plan was written.');
    return;
  }
  const { plan, simulation } = resultat;
  await montrer(deps.stockage, PLAN_MD);
  const vagues = (w: 1 | 2) => plan.lots.filter(l => l.wave === w).length;
  const queue = plan.sansDeclencheur.length > 0 ? ` ${plural(plan.sansDeclencheur.length, 'wave 2 cut has', 'wave 2 cuts have')} no known trigger, listed in the plan.` : '';
  const partiel = simulation.complete ? '' : ' The simulation stopped before the fixed point: the plan is partial.';
  void vscode.window.showInformationMessage(
    `Planned ${plural(plan.lots.length, 'batch', 'batches')} for ${plural(simulation.coupes.length, 'cut')} in ${plural(simulation.rondes, 'round')}: `
    + `${vagues(1)} in wave 1, ${vagues(2)} in wave 2.${queue}${partiel}`,
  );
}

export async function openCleanupPlanCommand(stockage: Stockage): Promise<void> {
  if ((await stockage.lire(PLAN_MD)) === undefined) {
    void vscode.window.showInformationMessage(PAS_DE_PLAN);
    return;
  }
  await montrer(stockage, PLAN_MD);
}

interface LotDuPlan { id: number; slug: string; wave: number; title: string; files: string[]; lines: number; cuts: { cle: string }[] }

export async function applyCleanupBatchCommand(deps: Dependances): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before applying a cleanup batch.');
    return;
  }
  const brut = await deps.stockage.lire(PLAN_JSON);
  if (brut === undefined) { void vscode.window.showInformationMessage(PAS_DE_PLAN); return; }
  const plan = JSON.parse(brut) as { head: string | null; batches: LotDuPlan[] };

  const choix = await vscode.window.showQuickPick(
    plan.batches.map(lot => ({
      label: `#${String(lot.id).padStart(2, '0')}  ${lot.title}`,
      description: `wave ${lot.wave}, ${plural(lot.files.length, 'file')}, ${plural(lot.lines, 'line')}`,
      detail: lot.files.slice(0, 4).join(', ') + (lot.files.length > 4 ? ', …' : ''),
      lot,
    })),
    { placeHolder: 'Which batch to apply? The edits land in the open workspace; create your branch first.', matchOnDescription: true, matchOnDetail: true },
  );
  if (!choix) return;
  const lot = choix.lot;

  const head = await deps.git?.head();
  if (plan.head && head && !head.startsWith(plan.head)) {
    const suite = await vscode.window.showWarningMessage(
      `The workspace moved since the plan was written (HEAD ${plan.head} then, ${head.slice(0, 10)} now).`,
      { modal: true, detail: 'The rounds re-read the workspace: a cut the plan promised that is no longer found is skipped and reported. A cut that became live again is still removed if the pass still finds it dead.' },
      'Apply anyway',
    );
    if (suite !== 'Apply anyway') return;
  }
  const ok = await vscode.window.showInformationMessage(
    `Apply batch #${String(lot.id).padStart(2, '0')}: ${lot.title}?`,
    { modal: true, detail: `${plural(lot.files.length, 'file')}, ${plural(lot.lines, 'line')} removed. The edits are applied directly, as Remove Everything Unused does; cuts the pass no longer finds are left alone and reported.` },
    'Apply',
  );
  if (ok !== 'Apply') return;

  const r = lireLesReglages();
  const api = await deps.loadAndroidApi?.();
  const filtre = new Set(lot.cuts.map(c => baseDe(c.cle)));
  const bilan = await executerLesRondes({
    corpus: deps.corpus, segs: r.segs, api, reglages: r.reglages, choix: 'apply', filtre,
    titre: `Applying cleanup batch #${String(lot.id).padStart(2, '0')}…`,
  });
  if (bilan.refuse) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }
  const promises = filtre.size;
  const tenues = [...filtre].filter(k => bilan.appliquees.has(k)).length;
  const manquantes = promises - tenues;
  const raison = lot.wave > 1
    ? 'the batches that trigger them may not be applied yet, or the workspace changed since the plan'
    : 'the workspace changed since the plan';
  const ecart = manquantes > 0
    ? ` ${plural(manquantes, 'promised cut was', 'promised cuts were')} not found by the pass and left alone: ${raison}.`
    : '';
  void vscode.window.showInformationMessage(`${phraseDuBilan(bilan, 'apply')} Batch #${String(lot.id).padStart(2, '0')}: ${plural(tenues, 'key')} applied of ${promises} promised.${ecart}`);
}
