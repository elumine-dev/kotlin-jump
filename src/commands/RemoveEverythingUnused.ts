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
import { stillTheMeasuredText } from '../util/measuredText';

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

export interface Coupe { start: number; end: number; texte: string; famille: string; quoi: string }

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
  // `renommages` a part : le balayage ne fait pas que supprimer, il remplace
  // aussi un parametre de lambda inutilise par `_`, ce qui ne retire rien et
  // n'est pas une declaration. Les compter ensemble faisait annoncer
  // « Remove 320 unused declarations » pour 279 suppressions et 41 renommages.
  const tally: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0, imports: 0, fichiers: 0 };
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
      tally[c.famille === 'balayage' && c.texte !== '' ? 'renommages' : c.famille]++;
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

/**
 * The ranges of one file, or undefined when its text moved since the scan.
 *
 * Exported for the witness. Every other bulk command holds this rule and the
 * newest one did not: the corpus snapshot lives for a minute, and its own
 * staleness check only looks at DIRTY documents. A file open and CLEAN but
 * reloaded underneath, by a checkout or another tool, passes that check with
 * different content, and the offsets then aim at the wrong lines. That is the
 * exact distinction `stillTheMeasuredText` was written for.
 */
export function plagesDuFichier(
  path: string,
  mesure: string,
  coupes: readonly Coupe[],
): { start: vscode.Position; end: vscode.Position; texte: string; quoi: string }[] | undefined {
  if (stillTheMeasuredText(path, mesure) === undefined) return undefined;
  const starts = debutsDeLigne(mesure);
  return coupes.map(c => ({
    start: posAt(starts, c.start), end: posAt(starts, c.end), texte: c.texte, quoi: c.quoi,
  }));
}

/**
 * The files whose cuts will actually be sent, and how many were left alone.
 *
 * Exported for the witness, because the ORDER matters: planning the cascade on
 * every cut and then sending only some of them would remove the import of a
 * symbol that stayed. The cascade takes the caller's word for what is being
 * removed, it verifies nothing, so it must only ever be told the truth.
 */
export function coupesRetenues(
  parFichier: ReadonlyMap<string, Coupe[]>,
  textes: ReadonlyMap<string, string>,
): { retenu: Map<string, Coupe[]>; bouges: number } {
  const retenu = new Map<string, Coupe[]>();
  let bouges = 0;
  for (const [p, l] of parFichier) {
    const texte = textes.get(p);
    if (texte === undefined) continue;
    if (plagesDuFichier(p, texte, l) === undefined) { bouges++; continue; }
    retenu.set(p, l);
  }
  return { retenu, bouges };
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
  const renommages = premier.tally.renommages ?? 0;
  const choix = await askHowToApply(
    `Remove ${plural(total - renommages, 'unused declaration, local or import')}?`,
    bulkDetail(total, premier.parFichier.size)
      + (renommages > 0
        ? ` ${plural(renommages, 'unused parameter')} renamed to \`_\` rather than removed.`
        : '')
      + ' Apply all repeats until nothing is left, since each removal orphans the next.',
  );
  if (choix === 'cancel') return;

  const cumul: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0, imports: 0, fichiers: 0, bouges: 0 };
  const ajouteTally = (t: Tally) => { for (const k of Object.keys(t)) cumul[k] = (cumul[k] ?? 0) + t[k]; };

  // Une seule passe en relecture : l'utilisateur choisit quoi accepter, et
  // repasser derriere lui sans savoir ce qu'il a garde serait une devinette.
  //
  // Le plafond etait a 8, ecrit sans mesure. Applique pour de vrai jusqu'au
  // point fixe sur le projet de reference, 6329 sources, il en faut DIX : la
  // queue est une chaine de constantes dont chacune n'etait vivante que pour
  // la suivante, et les passes 4 a 9 ne retirent qu'une poignee de coupes
  // chacune. A huit, la commande s'arretait deux passes trop tot sur le projet
  // meme pour lequel elle existe, en demandant de la relancer. Seize laisse de
  // la marge sans etre un chiffre magique : la boucle affiche sa ronde et
  // s'annule entre deux, donc le plafond borne le pire cas, il ne le decide
  // pas.
  const PASSES_MAX = 16;
  const passes = choix === 'apply' ? PASSES_MAX : 1;
  let restait = false;
  let annule = false;
  // Le `return` d'avant sortait de la COMMANDE. Depuis que la boucle vit
  // dans un callback, il n'en sortirait plus : un drapeau dit la meme chose
  // sans dependre de l'endroit ou il est ecrit.
  let refuse = false;
  // La boucle est la partie LONGUE : une passe coute une vingtaine de
  // secondes sur un projet de six mille fichiers, et Apply all en enchaine
  // jusqu'a huit. Sans barre, l'interface ne montrait plus rien apres le
  // premier scan et la commande avait l'air bloquee deux minutes et demie.
  // Annulable aussi : entre deux passes l'espace de travail est dans un
  // etat coherent, c'est le seul endroit ou s'arreter est sans danger.
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Removing everything unused…', cancellable: true },
    async (progress, jeton) => {
    for (let n = 0; n < passes; n++) {
        if (jeton.isCancellationRequested) { annule = true; break; }
        if (passes > 1) progress.report({ message: `round ${n + 1}…` });
      const data = n === 0 ? premier.data : await corpus.get();
      const { parFichier, tally } = n === 0
        ? { parFichier: premier.parFichier, tally: premier.tally }
        : collecterUnePasse(data.sources, segs);
      const combien = [...parFichier.values()].reduce((a, l) => a + l.length, 0);
      if (combien === 0) break;

      const textes = new Map(data.sources.map(s => [s.path, s.text]));

      // Les fichiers qui ont bouge sont ecartes AVANT de planifier la cascade.
      // La calculer sur toutes les coupes puis n'en appliquer qu'une partie
      // reviendrait a retirer l'import d'un symbole qui, lui, est reste : la
      // cascade croit qu'une declaration est partie parce qu'on la lui a
      // annoncee, elle ne verifie rien.
      const { retenu, bouges } = coupesRetenues(parFichier, textes);
      if (bouges > 0) cumul.bouges = (cumul.bouges ?? 0) + bouges;
      if (retenu.size === 0) break;

      const cascade = planCascade(
        new Map([...retenu].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end }))])),
        textes,
      );
      const edit = new vscode.WorkspaceEdit();
      for (const [p, l] of retenu) {
        if (cascade.deleteFiles.has(p)) continue;
        const plages = plagesDuFichier(p, textes.get(p)!, l);
        if (plages === undefined) continue;
        for (const r of plages) {
          edit.replace(corpusUri(p), new vscode.Range(r.start, r.end), r.texte,
            { needsConfirmation: choix === 'review', label: r.quoi ? `Remove ${r.quoi}` : 'Remove dead code' });
        }
      }
      const swept = addCascadePlan(edit, cascade, textes, choix === 'review');
      tally.imports += swept.imports;
      tally.fichiers += swept.files;
      ajouteTally(tally);

      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) { refuse = true; break; }
      corpus.invalidate();
      // La derniere passe autorisee a quand meme trouve du travail : il en
      // reste. Le taire laisserait croire que le nettoyage est fini.
      if (n === passes - 1 && choix === 'apply') restait = true;
      }
    },
  );

  if (refuse) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }

  const morceaux = [
    cumul.symboles > 0 ? plural(cumul.symboles, 'declaration') : '',
    cumul.membres > 0 ? plural(cumul.membres, 'class member') : '',
    cumul.entrees > 0 ? plural(cumul.entrees, 'enum entry', 'enum entries') : '',
    cumul.ilots > 0 ? `${plural(cumul.ilots, 'declaration')} of dead islands` : '',
    cumul.balayage > 0 ? plural(cumul.balayage, 'local or import') : '',
    cumul.renommages > 0 ? `${plural(cumul.renommages, 'unused parameter')} renamed to \`_\`` : '',
    cumul.imports > 0 ? plural(cumul.imports, 'orphaned import') : '',
    cumul.fichiers > 0 ? plural(cumul.fichiers, 'emptied file') : '',
  ].filter(Boolean);
  const bouges = cumul.bouges > 0
    ? `${plural(cumul.bouges, 'file')} changed since the scan and ${cumul.bouges > 1 ? 'were' : 'was'} left alone.`
    : '';
  // En relecture, le compte decrit ce qui a ete PROPOSE. Ce que le lecteur a
  // coche dans l'apercu ne revient pas jusqu'ici, et annoncer « Removed » sur
  // une base qu'on n'a pas serait un chiffre invente.
  const verbe = choix === 'review' ? 'Sent' : 'Removed';
  const queue = choix === 'review' ? ' to the preview.' : '.';
  void vscode.window.showInformationMessage(
    compteRendu(morceaux.join(', '), { verbe, queue, annule, restait, bouges }),
  );
}

/**
 * The one sentence this command ends on.
 *
 * Exported for the witness. Glueing a headline to a note produced answers that
 * contradicted each other in the same breath: stopping on the first round said
 * `Nothing unused left to remove. Stopped on request: run it again to finish.`
 * which is two opposite answers to one question, and the test written for it
 * passed because it only looked for the second half.
 */
export function compteRendu(
  fait: string,
  e: { verbe: string; queue: string; annule: boolean; restait: boolean; bouges: string },
): string {
  const suite = e.bouges ? ` ${e.bouges}` : '';
  if (fait === '') {
    // Rien n'a ete retire : la raison EST la reponse, il n'y a pas de titre a
    // mettre devant.
    if (e.annule) return `Stopped on request. Nothing was removed.${suite}`;
    if (e.bouges) return `Nothing was removed: ${e.bouges} Run it again.`;
    return 'Nothing unused left to remove.';
  }
  const fin = e.annule ? ' Stopped on request: run it again to finish.'
    : e.restait ? ' There was still work left after the last round: run it again.'
      : '';
  return `${e.verbe} ${fait}${e.queue}${suite}${fin}`;
}
