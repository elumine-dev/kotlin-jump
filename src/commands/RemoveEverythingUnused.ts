import * as vscode from 'vscode';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { plural } from '../util/plural';
import { askHowToApply } from '../util/bulkEdit';
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
  // `renommages` a part : le balayage ne fait pas que supprimer, il rebaptise
  // aussi `_` ce qui est declare et jamais lu, ce qui ne retire rien et n'est
  // pas une declaration. Les compter ensemble faisait annoncer
  // « Remove 320 unused declarations » pour 279 suppressions et 41 renommages.
  //
  // Deux choses recoivent ce traitement, un parametre de lambda et une
  // exception attrapee, et sur le projet de reference 38 des 41 sont des
  // exceptions. Les appeler des parametres etait faux dans le cas ordinaire,
  // pas dans un cas de bord.
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
    }
    parFichier.set(p, gardees);
  }
  return { parFichier, tally: compteLesFamilles(parFichier) };
}

/**
 * Combien de coupes, famille par famille.
 *
 * Une seule ecriture de la liste des familles et de la regle du renommage,
 * parce que l'appelant en a besoin DEUX fois et sur deux ensembles differents :
 * ce que le balayage a trouve, pour la question, et ce que l'edition emporte
 * vraiment, pour le compte rendu. Les compter au meme endroit sur deux
 * ensembles est la seule facon que les deux nombres veuillent dire la meme
 * chose.
 */
export function compteLesFamilles(parFichier: ReadonlyMap<string, Coupe[]>): Tally {
  const tally: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0, imports: 0, fichiers: 0 };
  for (const l of parFichier.values()) {
    for (const c of l) tally[c.famille === 'balayage' && c.texte !== '' ? 'renommages' : c.famille]++;
  }
  return tally;
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
/**
 * The cuts, each grown by the blank line it would otherwise strand.
 *
 * A declaration almost always has a blank line on either side of it. Take the
 * declaration and both blanks stay, side by side, where a single one used to
 * separate two neighbours. Measured on the reference project: 66 of the 199
 * files this command cuts come back with such a hole, a third of the diff
 * someone has to read.
 *
 * A lone blank line is never taken. There must be one on EACH side and only
 * one goes, so the separation the author wrote is preserved and never
 * invented. A cut that does not take whole lines is left alone, and so is a
 * replacement, which removes nothing.
 *
 * Exported for the witness.
 */
export function sansTrouDeLignesVides(texte: string, coupes: readonly Coupe[]): Coupe[] {
  const triees = [...coupes].sort((a, b) => a.start - b.start);
  const suivante = (i: number): number => triees[i + 1]?.start ?? texte.length;
  const ligneVide = (debut: number, fin: number): boolean => texte.slice(debut, fin).trim() === '';
  return triees.map((c, i) => {
    if (c.texte !== '') return c;
    const debutDeLigne = c.start === 0 || texte[c.start - 1] === '\n';
    const finDeLigne = c.end === texte.length || texte[c.end - 1] === '\n';
    if (!debutDeLigne || !finDeLigne) return c;
    // La ligne juste avant la coupe.
    const avantFin = c.start - 1;
    if (avantFin < 0) return c;
    const avantDebut = texte.lastIndexOf('\n', avantFin - 1) + 1;
    if (!ligneVide(avantDebut, avantFin)) return c;
    // La ligne juste apres.
    const apresFin = texte.indexOf('\n', c.end);
    if (apresFin === -1 || !ligneVide(c.end, apresFin)) return c;
    const etendu = apresFin + 1;
    return etendu <= suivante(i) ? { ...c, end: etendu } : c;
  });
}

export function plagesDuFichier(
  path: string,
  mesure: string,
  coupes: readonly Coupe[],
): { start: vscode.Position; end: vscode.Position; texte: string; quoi: string }[] | undefined {
  if (stillTheMeasuredText(path, mesure) === undefined) return undefined;
  const starts = debutsDeLigne(mesure);
  // `famille` voyage avec la plage : le temoin ne peut pas exiger des lignes
  // entieres d'une coupe d'entree d'enum, qui est partielle par contrat, et
  // sans ce champ il ne peut pas faire la difference.
  return sansTrouDeLignesVides(mesure, coupes).map(c => ({
    start: posAt(starts, c.start), end: posAt(starts, c.end), texte: c.texte, quoi: c.quoi,
    famille: c.famille,
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
): { retenu: Map<string, Coupe[]>; bouges: string[] } {
  const retenu = new Map<string, Coupe[]>();
  // Les CHEMINS, pas leur nombre. L'appelant boucle jusqu'au point fixe et
  // additionnait ce compte a chaque ronde, alors qu'un fichier qui diverge de
  // son document ouvert diverge encore a la ronde suivante : le meme fichier
  // etait annonce quatre fois. Un ensemble de chemins ne peut pas se tromper
  // la dessus.
  const bouges: string[] = [];
  for (const [p, l] of parFichier) {
    const texte = textes.get(p);
    if (texte === undefined) continue;
    if (plagesDuFichier(p, texte, l) === undefined) { bouges.push(p); continue; }
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
  const demande = libelleDeLaDemande(total, renommages, premier.parFichier.size);
  const choix = await askHowToApply(
    demande.titre,
    demande.detail,
  );
  if (choix === 'cancel') return;

  const cumul: Tally = { symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0, imports: 0, fichiers: 0, bouges: 0 };
  const ajouteTally = (t: Tally) => { for (const k of Object.keys(t)) cumul[k] = (cumul[k] ?? 0) + t[k]; };
  /** Les fichiers ecartes, par chemin : la boucle repasse sur les memes. */
  const ecartes = new Set<string>();

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
  /** Une ronde a recu un corpus que le balayage n'a pas pu lire en entier. */
  let incomplet = false;
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
      // La premiere ronde relit, elle aussi. Le balayage a lieu AVANT la boite
      // modale, et reutiliser son instantane laissait passer ce qui est arrive
      // pendant le temps de reflexion : une utilisation apparue ailleurs par un
      // `git pull` ou une sauvegarde dans un autre editeur n'existe pas dans
      // l'instantane, la declaration y est toujours morte, et elle partait.
      // Le controle d'obsolescence ne rattrape pas ce cas, il confronte le
      // texte mesure aux documents OUVERTS fichier par fichier, et le fichier
      // declarant, lui, n'a pas bouge.
      //
      // Sans le payer : le corpus rend l'objet de son cache tel quel tant que
      // rien ne l'a invalide, donc l'identite suffit a savoir s'il faut
      // recompter. Un `git pull` passe par le veilleur, qui invalide, donc
      // l'objet change et la passe est refaite.
      const data = await corpus.get();
      // Le premier balayage refuse un corpus tronque et rend la main. Les
      // rondes suivantes le prenaient sans regarder, alors qu'une passe qui
      // raisonne sur une liste de sources amputee juge « non reference » un
      // symbole que seul un fichier non lu utilise, et que cette commande
      // APPLIQUE ce verdict.
      //
      // Elle se le declenche a elle meme : elle supprime des fichiers a chaque
      // ronde, et un fichier que `findFiles` liste encore mais qui vient de
      // partir fait echouer sa lecture, ce qui marque le corpus tronque. Le
      // contrat du corpus est ecrit dans sa propre classe : un balayage
      // incomplet ne peut pas prouver une absence.
      if (data.sourcesTruncated) { incomplet = true; break; }
      const { parFichier } = n === 0 && data === premier.data
        ? { parFichier: premier.parFichier }
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
      for (const p of bouges) ecartes.add(p);
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
      // Ce qui est RETENU, jamais ce que la passe a trouve. Un fichier ecarte
      // parce qu'il a bouge garde ses coupes dans `parFichier`, et les compter
      // faisait annoncer « Removed 2 declarations » sur une edition d'une seule
      // operation, une ligne avant de dire qu'un des deux fichiers avait ete
      // laisse de cote. Les quatre autres commandes de la famille ont recu ce
      // correctif entre la 1.42.277 et la 1.42.280.
      //
      // Les fichiers que la CASCADE supprime comptent, eux : leurs declarations
      // partent avec le fichier, elles ne sont simplement pas coupees une a une.
      const applique = compteLesFamilles(retenu);
      applique.imports += swept.imports;
      applique.fichiers += swept.files;
      ajouteTally(applique);

      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) { refuse = true; break; }
      corpus.invalidate();
      // La derniere passe autorisee a quand meme travaille. On ne sait PAS
      // s'il reste quelque chose : la passe suivante n'a pas eu lieu, et sur
      // le projet de reference celle qui suit la derniere productive ne
      // trouvait rien. Ce qu'on sait, c'est qu'on s'est arrete sur le plafond.
      if (n === passes - 1 && choix === 'apply') restait = true;
      }
    },
  );

  if (refuse) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }

  cumul.bouges = ecartes.size;
  const fait = resumeDesFamilles(cumul);
  const bouges = cumul.bouges > 0
    ? `${plural(cumul.bouges, 'file')} changed since the scan and ${cumul.bouges > 1 ? 'were' : 'was'} left alone.`
    : '';
  // En relecture, le compte decrit ce qui a ete PROPOSE. Ce que le lecteur a
  // coche dans l'apercu ne revient pas jusqu'ici, et annoncer « Removed » sur
  // une base qu'on n'a pas serait un chiffre invente.
  const verbe = choix === 'review' ? 'Sent' : 'Removed';
  const queue = choix === 'review' ? ' to the preview.' : '.';
  void vscode.window.showInformationMessage(
    compteRendu(fait, { verbe, queue, annule, restait, bouges, incomplet }),
  );
}

/**
 * The question this command opens with.
 *
 * A pass can be renamings and nothing else, and it takes very little: one
 * `forEachIndexed { index, value ->` whose index is unused is enough. Asking
 * `Remove 0 unused declarations, locals and imports?` in that case is a
 * dialog asking permission to remove nothing, so the renaming becomes the
 * question instead of a footnote to it.
 *
 * Exported for the witness, like `compteRendu`.
 */
export function libelleDeLaDemande(
  total: number,
  renommages: number,
  fichiers: number,
): { titre: string; detail: string } {
  const aRetirer = total - renommages;
  // What was FOUND, not a count of edit operations. `bulkDetail` promises the
  // latter, and its five other callers can keep that promise because they
  // build their edit before they ask. This one cannot: the edit is built after
  // the click, on purpose, so that a file which moved since the scan is
  // dropped then rather than now. Between the question and the edit, a file
  // emptied of everything goes whole, which replaces its cuts with one
  // deletion, and the cascade adds removals the plan never counted. Measured
  // on three files where one import is orphaned: the line said four changes
  // and the edit carried three operations, all of them deletions. What was
  // really done is the closing report's job to say.
  // The count lives in the title, once. Repeating it here counted what was
  // FOUND while the title counts what is REMOVED, and the two part company as
  // soon as one name is renamed rather than removed: `Remove 7 ...?` sat above
  // `10 ... found`. On a round made only of renamings it was worse, since the
  // title rightly called them names while this line called them declarations,
  // locals and imports, none of which a lambda parameter is. So this says what
  // the title cannot: how far the change reaches.
  const echelle = `Across ${plural(fichiers, 'file')}.`
    + ' Apply all skips the preview; review one by one opens it with nothing ticked.';
  if (aRetirer === 0) {
    return {
      titre: `Rename ${plural(renommages, 'unused name')} to \`_\`?`,
      detail: echelle,
    };
  }
  const note = renommages > 0
    ? ` ${plural(renommages, 'unused name')} renamed to \`_\` rather than removed.`
    : '';
  return {
    titre: `Remove ${plural(aRetirer, 'unused declaration, local or import',
      'unused declarations, locals and imports')}?`,
    // La relance ne se justifie que si quelque chose est RETIRE : un
    // renommage n'orpheline rien.
    detail: `${echelle}${note}`
      + ' Apply all repeats until nothing is left, since each removal orphans the next.',
  };
}

/**
 * What was done, family by family, in one clause.
 *
 * Exported for the witness, like `compteRendu` and `libelleDeLaDemande`. It
 * was built inline, so a wrong word here was invisible to every test: putting
 * `unused parameter` back in this list broke nothing at all, while the same
 * word in the dialog broke five tests.
 */
export function resumeDesFamilles(cumul: Tally): string {
  return [
    cumul.symboles > 0 ? plural(cumul.symboles, 'declaration') : '',
    cumul.membres > 0 ? plural(cumul.membres, 'class member') : '',
    cumul.entrees > 0 ? plural(cumul.entrees, 'enum entry', 'enum entries') : '',
    cumul.ilots > 0 ? `${plural(cumul.ilots, 'declaration')} of dead islands` : '',
    cumul.balayage > 0 ? plural(cumul.balayage, 'local or import', 'locals and imports') : '',
    // Un parametre de lambda ET une exception attrapee recoivent ce
    // traitement, et sur le projet de reference 38 des 41 sont des exceptions.
    cumul.renommages > 0 ? `${plural(cumul.renommages, 'unused name')} renamed to \`_\`` : '',
    cumul.imports > 0 ? plural(cumul.imports, 'orphaned import') : '',
    cumul.fichiers > 0 ? plural(cumul.fichiers, 'emptied file') : '',
  ].filter(Boolean).join(', ');
}

/**
 * The one sentence this command ends on.
 *
 * `restait` says the loop hit its limit, NOT that work remains: the next round
 * never ran. Claiming otherwise was a fact not in evidence, and on the
 * reference project the round after the last productive one found nothing.
 *
 * Exported for the witness. Glueing a headline to a note produced answers that
 * contradicted each other in the same breath: stopping on the first round said
 * `Nothing unused left to remove. Stopped on request: run it again to finish.`
 * which is two opposite answers to one question, and the test written for it
 * passed because it only looked for the second half.
 */
export function compteRendu(
  fait: string,
  e: {
    verbe: string; queue: string; annule: boolean; restait: boolean; bouges: string;
    /** Une ronde a recu un corpus incomplet, et la boucle s'est arretee la. */
    incomplet?: boolean;
  },
): string {
  const suite = e.bouges ? ` ${e.bouges}` : '';
  // Arrete faute d'avoir pu tout lire : c'est la raison la plus grave des
  // trois, parce que c'est la seule qui dise que la suite du nettoyage aurait
  // pu porter sur du code vivant. Elle passe donc devant.
  const lecture = ' Stopped: the workspace could not be read whole, so the rest was left alone. Run it again.';
  if (fait === '') {
    // Rien n'a ete retire : la raison EST la reponse, il n'y a pas de titre a
    // mettre devant.
    if (e.incomplet) return `Nothing was removed: the workspace could not be read whole. Run it again.${suite}`;
    if (e.annule) return `Stopped on request. Nothing was removed.${suite}`;
    if (e.bouges) return `Nothing was removed: ${e.bouges} Run it again.`;
    return 'Nothing unused left to remove.';
  }
  const fin = e.incomplet ? lecture
    : e.annule ? ' Stopped on request: run it again to finish.'
    : e.restait ? ' Stopped after the last allowed round: run it again to see whether anything is left.'
      : '';
  return `${e.verbe} ${fait}${e.queue}${suite}${fin}`;
}
