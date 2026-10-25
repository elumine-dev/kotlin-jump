import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { applyCleanupBatchCommand, openCleanupPlanCommand, planCleanupCommand, stockageEnMemoire } from '../../../src/commands/PlanCleanup';

/**
 * Campagne de nettoyage, T5 : les trois commandes.
 *
 * « Plan a Dead Code Cleanup » simule, planifie, ecrit `plan.md`, `plan.json`
 * et un fichier par lot dans le stockage de l extension, puis ouvre le plan.
 * « Open the Cleanup Plan » rouvre le dernier. « Apply a Cleanup Batch »
 * propose les lots, confirme, et passe par la boucle reelle de Remove avec le
 * filtre des cles du lot. Le stockage est une interface : en test, une Map.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const MORT_A = { path: `${MAIN}/A.kt`, text: 'package com.x\n\nclass MortA\n' };
const MORT_B = { path: `${MAIN}/B.kt`, text: 'package com.x\n\nclass MortB\n' };
const RACINE = { path: `${MAIN}/R.kt`, text: 'package com.x\n\nfun main() {\n    println(1)\n}\n' };

afterEach(() => vi.restoreAllMocks());

function monde(rondes: { path: string; text: string }[][], reglages: Record<string, unknown> = {}) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (k: string, d: any) => (k in reglages ? reglages[k] : d) } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let n = 0;
  const corpus: any = {
    invalidate: () => {},
    get: async () => ({
      sources: rondes[Math.min(n++, rondes.length - 1)], moduleDirs: ['/w/app'], modulesWithCode: ['/w/app'],
      libraryModules: [], truncated: false, sourcesTruncated: false, assets: [], index: { entries: () => [] },
    }),
  };
  win.withProgress = (_o: any, t: any) => t({ report: () => {} }, { isCancellationRequested: false });
  const messages: string[] = [];
  win.showInformationMessage = async (m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) return rest[1];
    messages.push(m);
    return undefined;
  };
  win.showWarningMessage = async (m: string) => { messages.push(m); return undefined; };
  const ouverts: string[] = [];
  win.showTextDocument = async (doc: any) => { ouverts.push(doc?.uri?.path ?? doc?.path ?? String(doc)); return {}; };
  w.openTextDocument = async (uri: any) => ({ uri });
  const editions: any[] = [];
  w.applyEdit = async (e: any) => { editions.push(e); return true; };
  return { corpus, messages, ouverts, editions };
}

describe('T5, Plan a Dead Code Cleanup', () => {
  it('ecrit le plan et ses lots dans le stockage, puis ouvre plan.md', async () => {
    const m = monde([[MORT_A, MORT_B, RACINE]]);
    const stockage = stockageEnMemoire();
    await planCleanupCommand({ corpus: m.corpus, stockage });
    const plan = JSON.parse((await stockage.lire('cleanup/latest/plan.json'))!);
    expect(plan.version).toBe(1);
    expect(plan.batches.length).toBeGreaterThanOrEqual(1);
    expect(await stockage.lire('cleanup/latest/plan.md')).toContain('# Dead code cleanup plan');
    expect(await stockage.lire(`cleanup/latest/${plan.batches[0].slug}.md`)).toMatch(/^Remove dead code/);
    // Le stockage en memoire ouvre un document sans titre : un document montre, c est le plan.
    expect(m.ouverts).toHaveLength(1);
    expect(m.messages.join(' | ')).toMatch(/batch/);
  });

  it('n ecrit rien dans l espace de travail', async () => {
    const m = monde([[MORT_A, MORT_B, RACINE]]);
    await planCleanupCommand({ corpus: m.corpus, stockage: stockageEnMemoire() });
    expect(m.editions).toHaveLength(0);
  });
});

describe('T5, Open the Cleanup Plan', () => {
  it('sans plan, le dit au lieu d ouvrir', async () => {
    const m = monde([[RACINE]]);
    await openCleanupPlanCommand(stockageEnMemoire());
    expect(m.ouverts).toHaveLength(0);
    expect(m.messages.join(' ')).toMatch(/Plan a Dead Code Cleanup/);
  });
});

describe('T5, Apply a Cleanup Batch', () => {
  it('propose les lots, confirme, et n applique que les cles du lot choisi', async () => {
    // Un lot par fichier, pour que le choix ait un sens ; le corpus garde B
    // tant que seul A est applique, et la boucle doit s arreter sur B tu.
    const m = monde([[MORT_A, MORT_B, RACINE], [MORT_A, MORT_B, RACINE], [MORT_B, RACINE], [MORT_B, RACINE]], { 'cleanup.maxFilesPerBatch': 1 });
    const stockage = stockageEnMemoire();
    await planCleanupCommand({ corpus: m.corpus, stockage });
    const plan = JSON.parse((await stockage.lire('cleanup/latest/plan.json'))!);
    expect(plan.batches).toHaveLength(2);
    const win = vscodeMock.window as any;
    let propositions: any[] = [];
    win.showQuickPick = async (items: any[]) => { propositions = items; return items.find(i => i.detail.includes('A.kt')); };
    await applyCleanupBatchCommand({ corpus: m.corpus, stockage });
    expect(propositions.length).toBe(plan.batches.length);
    expect(m.editions).toHaveLength(1);
    const bilan = m.messages.join(' | ');
    expect(bilan).toMatch(/Removed/);
    // Le lot promettait la classe et son fichier, vide par la cascade : les deux sont retrouves.
    expect(bilan).toMatch(/2 keys applied of 2 promised/);
    expect(bilan).not.toMatch(/not found/);
  });

  it('sans plan, renvoie vers la commande qui en fait un', async () => {
    const m = monde([[RACINE]]);
    await applyCleanupBatchCommand({ corpus: m.corpus, stockage: stockageEnMemoire() });
    expect(m.editions).toHaveLength(0);
    expect(m.messages.join(' ')).toMatch(/Plan a Dead Code Cleanup/);
  });
});
