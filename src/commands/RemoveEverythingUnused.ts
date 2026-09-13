import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { plural } from '../util/plural';
import { askHowToApply, bulkDetail } from '../util/bulkEdit';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { findUnusedEnumEntries } from '../providers/unusedEnumEntries';
import { findDeadIslands } from '../providers/deadIslands';
import { sweepFile, planFileEdits } from '../providers/DeadCodeSweep';
import { planCascade } from '../providers/removalCascade';
import { addCascadePlan } from '../providers/applyCascade';

/**
 * One command for the whole family.
 *
 * Five commands removed five kinds of dead code, and running them by hand in
 * the right order was the user's job. Worse, one pass is never enough: a
 * deletion orphans the next thing, so on a real project the removals only
 * settled after FOUR rounds. Doing that by hand means running five commands
 * four times and knowing when to stop.
 *
 * Cuts of one pass are all measured on the SAME corpus text, which is what
 * makes them safe to send as a single edit. Overlaps inside a file are
 * resolved the way every provider resolves them: the first one wins.
 */

interface Coupe { start: number; end: number; texte: string; famille: string; quoi: string }

export type Tally = Record<string, number>;

/** The cuts one pass finds, per file, already free of overlaps. */
export function collecterUnePasse(
  sources: readonly { path: string; text: string }[],
  segs: readonly string[],
): { parFichier: Map<string, Coupe[]>; tally: Tally } {
  const base = { sources, testSourceSets: segs } as any;
  const syms = findUnusedSymbols(base) as any[];
  const membres = findUnusedMembers({
    ...base, includeSelfOnly: false,
    deadDeclarations: syms.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  } as any) as any[];
  const entrees = findUnusedEnumEntries(base) as any[];
  const iles = findDeadIslands({ ...base, maxIslandSize: 8 } as any) as any[];

  const brut = new Map<string, Coupe[]>();
  const tally: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, imports: 0, fichiers: 0 };
  const ajoute = (p: string, start: number, end: number, texte: string, famille: string, quoi: string) => {
    if (start < 0 || end <= start) return;
    const l = brut.get(p) ?? [];
    l.push({ start, end, texte, famille, quoi });
    brut.set(p, l);
  };

  for (const s of syms) if (s.verdict === 'unreferenced') { ajoute(s.path, s.removeStart, s.removeEnd, '', 'symboles', s.name); }
  for (const m of membres) if (m.verdict === 'unreferenced') { ajoute(m.path, m.removeStart, m.removeEnd, '', 'membres', m.name); }
  for (const e of entrees) if (e.verdict === 'unreferenced') { ajoute(e.path, e.removeStart, e.removeEnd, '', 'entrees', e.name); }
  for (const i of iles) {
    if (i.verdict !== 'unreferenced' || !i.fixable) continue;
    for (const m of i.members) ajoute(m.path, m.removeStart, m.removeEnd, '', 'ilots', m.name);
  }
  for (const src of sources) {
    if (!/\.(kt|java)$/.test(src.path)) continue;
    const plan = planFileEdits(sweepFile(src.text, src.path.endsWith('.java') ? 'java' : 'kotlin'));
    for (const e of plan) ajoute(src.path, e.start, e.end, e.text, 'balayage', '');
  }

  // Chevauchements : la premiere gagne, comme chez chaque fournisseur.
  const parFichier = new Map<string, Coupe[]>();
  for (const [p, l] of brut) {
    l.sort((a, b) => a.start - b.start || b.end - a.end);
    const gardees: Coupe[] = [];
    let fin = -1;
    for (const c of l) {
      if (c.start < fin) continue;
      fin = c.end;
      gardees.push(c);
      tally[c.famille]++;
    }
    parFichier.set(p, gardees);
  }
  return { parFichier, tally };
}

function debutsDeLigne(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts: readonly number[], offset: number): vscode.Position {
  let bas = 0, haut = starts.length - 1;
  while (bas < haut) {
    const m = Math.ceil((bas + haut) / 2);
    if (starts[m] <= offset) bas = m; else haut = m - 1;
  }
  return new vscode.Position(bas, offset - starts[bas]);
}

export async function removeEverythingUnusedCommand(corpus: ResourceCorpus): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }
  const segs = vscode.workspace.getConfiguration('kotlinJump')
    .get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);

  const premier = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for everything unused…', cancellable: true },
    async (_p, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested || data.sourcesTruncated) return undefined;
      return { data, ...collecterUnePasse(data.sources, segs) };
    },
  );
  if (!premier) {
    void vscode.window.showWarningMessage('The workspace is too large to prove that nothing uses these declarations.');
    return;
  }

  const total = [...premier.parFichier.values()].reduce((n, l) => n + l.length, 0);
  if (total === 0) {
    void vscode.window.showInformationMessage('Nothing unused left to remove.');
    return;
  }
  const choix = await askHowToApply(
    `Remove ${plural(total, 'unused declaration')}?`,
    bulkDetail(total, premier.parFichier.size)
      + ' Apply all repeats until nothing is left, since each removal orphans the next.',
  );
  if (choix === 'cancel') return;

  const cumul: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, imports: 0, fichiers: 0 };
  const ajouteTally = (t: Tally) => { for (const k of Object.keys(t)) cumul[k] = (cumul[k] ?? 0) + t[k]; };

  // Une seule passe en relecture : l'utilisateur choisit quoi accepter, et
  // repasser derriere lui sans savoir ce qu'il a garde serait une devinette.
  const passes = choix === 'apply' ? 8 : 1;
  for (let n = 0; n < passes; n++) {
    const data = n === 0 ? premier.data : await corpus.get();
    const { parFichier, tally } = n === 0
      ? { parFichier: premier.parFichier, tally: premier.tally }
      : collecterUnePasse(data.sources, segs);
    const combien = [...parFichier.values()].reduce((a, l) => a + l.length, 0);
    if (combien === 0) break;

    const textes = new Map(data.sources.map(s => [s.path, s.text]));
    const cascade = planCascade(
      new Map([...parFichier].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end }))])),
      textes,
    );
    const edit = new vscode.WorkspaceEdit();
    for (const [p, l] of parFichier) {
      if (cascade.deleteFiles.has(p)) continue;
      const texte = textes.get(p);
      if (texte === undefined) continue;
      const starts = debutsDeLigne(texte);
      for (const c of l) {
        edit.replace(corpusUri(p), new vscode.Range(posAt(starts, c.start), posAt(starts, c.end)), c.texte,
          { needsConfirmation: choix === 'review', label: c.quoi ? `Remove ${c.quoi}` : 'Remove dead code' });
      }
    }
    const swept = addCascadePlan(edit, cascade, textes, choix === 'review');
    tally.imports += swept.imports;
    tally.fichiers += swept.files;
    ajouteTally(tally);

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }
    corpus.invalidate();
  }

  const morceaux = [
    cumul.symboles > 0 ? plural(cumul.symboles, 'declaration') : '',
    cumul.membres > 0 ? plural(cumul.membres, 'class member') : '',
    cumul.entrees > 0 ? plural(cumul.entrees, 'enum entry', 'enum entries') : '',
    cumul.ilots > 0 ? `${plural(cumul.ilots, 'declaration')} of dead islands` : '',
    cumul.balayage > 0 ? plural(cumul.balayage, 'local or parameter') : '',
    cumul.imports > 0 ? plural(cumul.imports, 'orphaned import') : '',
    cumul.fichiers > 0 ? plural(cumul.fichiers, 'emptied file') : '',
  ].filter(Boolean);
  void vscode.window.showInformationMessage(
    morceaux.length > 0 ? `Removed ${morceaux.join(', ')}.` : 'Nothing unused left to remove.',
  );
}
