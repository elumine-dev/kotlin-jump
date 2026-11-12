import * as vscode from 'vscode';
import { AndroidApi } from '../util/androidApi';
import { DEFAULT_TEST_SEGMENTS } from '../util/testPaths';
import { ResourceCorpus } from '../indexer/ResourceCorpus';
import { corpusUri } from '../util/corpusUri';
import { plural } from '../util/plural';
import { askHowToApply } from '../util/bulkEdit';
import { planCascade } from '../providers/removalCascade';
import { addCascadePlan } from '../providers/applyCascade';
import { stillTheMeasuredText } from '../util/measuredText';
import { UnusedSettings, readUnusedSettings } from '../util/unusedSettings';
import { baseDe, cleDeBase, cleDImportOrphelin, cleDuFichierMort, estUnFichierVide } from '../cleanup/cles';

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

import {
  Coupe, Tally, collecterUnePasse, compteLesFamilles, contexteDuCorpus, debutsDeLigne,
  sansTrouDeLignesVides, coupesRetenues as coupesRetenuesSelon,
} from '../cleanup/passe';

export {
  collecterUnePasse, compteLesFamilles, sansChevauchement, sansTrouDeLignesVides,
} from '../cleanup/passe';
export type { Coupe, Tally, ContexteDePasse } from '../cleanup/passe';

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
  autres: readonly { start: number; end: number }[] = [],
): { start: vscode.Position; end: vscode.Position; texte: string; quoi: string }[] | undefined {
  if (stillTheMeasuredText(path, mesure) === undefined) return undefined;
  const starts = debutsDeLigne(mesure);
  // `famille` voyage avec la plage : le temoin ne peut pas exiger des lignes
  // entieres d'une coupe d'entree d'enum, qui est partielle par contrat, et
  // sans ce champ il ne peut pas faire la difference.
  return sansTrouDeLignesVides(mesure, coupes, autres).map(c => ({
    start: posAt(starts, c.start), end: posAt(starts, c.end), texte: c.texte, quoi: c.quoi,
    famille: c.famille,
  }));
}

/**
 * The files whose cuts will actually be sent, judged against the editor.
 *
 * The rule itself is `coupesRetenues` in `cleanup/passe`; this is the one
 * place that knows what an open document is.
 */
export function coupesRetenues(
  parFichier: ReadonlyMap<string, Coupe[]>,
  textes: ReadonlyMap<string, string>,
): { retenu: Map<string, Coupe[]>; bouges: string[] } {
  return coupesRetenuesSelon(parFichier, textes, (p, texte) => stillTheMeasuredText(p, texte) !== undefined);
}

export async function removeEverythingUnusedCommand(
  corpus: ResourceCorpus,
  /** G61 : l index de la plateforme, charge a la demande. */
  loadAndroidApi?: () => Promise<AndroidApi | undefined>,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage('Open a folder before scanning.');
    return;
  }
  const cfg = vscode.workspace.getConfiguration('kotlinJump');
  const segs = cfg.get<string[]>('testSourceSets', DEFAULT_TEST_SEGMENTS);
  const reglages = readUnusedSettings((key, fallback) => cfg.get(key, fallback));

  const api = await loadAndroidApi?.();
  const premier = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Looking for everything unused…', cancellable: true },
    async (_p, token) => {
      const data = await corpus.get(token);
      if (token.isCancellationRequested || data.sourcesTruncated) return undefined;
      // Le MEME contexte que les rondes suivantes. Sans lui, la premiere passe
      // taisait les familles de ressources et le dialogue d'ouverture
      // annoncait moins que ce que la commande allait retirer.
      return { data, ...collecterUnePasse(data.sources, segs, { ...contexteDuCorpus(data), androidApi: api, reglages }) };
    },
  );
  if (!premier) {
    void vscode.window.showWarningMessage('The workspace is too large to prove that nothing uses these declarations.');
    return;
  }

  // Les fichiers de ressources comptent dans ce total : ils ne portent aucune
  // coupe, et sans eux la commande annoncait « Nothing unused left to remove »
  // sur un espace de travail ou dix layouts morts attendaient.
  const total = [...premier.parFichier.values()].reduce((n, l) => n + l.length, 0)
    + (premier.fichiersMorts?.size ?? 0);
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

  const bilan = await executerLesRondes({ corpus, segs, api, reglages, choix, premier });
  if (bilan.refuse) { void vscode.window.showWarningMessage('Nothing was applied.'); return; }
  void vscode.window.showInformationMessage(phraseDuBilan(bilan, choix));
}

/** The closing sentence of a run, from what the rounds did. Exported for the batch command. */
export function phraseDuBilan(bilan: BilanDesRondes, choix: 'apply' | 'review'): string {
  const { cumul, ecartes, annule, restait, incomplet } = bilan;

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
  return compteRendu(fait, { verbe, queue, annule, restait, bouges, incomplet });
}

export interface OptionsDeRondes {
  corpus: ResourceCorpus;
  segs: readonly string[];
  api?: AndroidApi;
  reglages: Partial<UnusedSettings>;
  choix: 'apply' | 'review';
  /** The progress title; the command's own by default. */
  titre?: string;
  /** The command's first pass, reused when the corpus object has not changed. */
  premier?: { data: unknown; parFichier: Map<string, Coupe[]>; fichiersMorts: Set<string> };
  /** Base keys (see `cleDeBase`) the rounds may apply. Everything else stays. */
  filtre?: ReadonlySet<string>;
}

export interface BilanDesRondes {
  cumul: Tally;
  ecartes: Set<string>;
  annule: boolean;
  restait: boolean;
  refuse: boolean;
  incomplet: boolean;
  /** Base keys of every cut and whole file the rounds applied. */
  appliquees: Set<string>;
}

/** The pass reduced to the keys a batch names. Exported for the delete-and-build harness, which applies one batch the same way. */
export function selonLeFiltre(
  passe: { parFichier: Map<string, Coupe[]>; fichiersMorts: Set<string> },
  textes: ReadonlyMap<string, string>,
  filtre: ReadonlySet<string>,
): { parFichier: Map<string, Coupe[]>; fichiersMorts: Set<string> } {
  const parFichier = new Map<string, Coupe[]>();
  for (const [p, l] of passe.parFichier) {
    const texte = textes.get(p);
    if (texte === undefined) continue;
    const gardees = l.filter(c => filtre.has(baseDe(cleDeBase(c, p, texte))));
    if (gardees.length > 0) parFichier.set(p, gardees);
  }
  const fichiersMorts = new Set([...passe.fichiersMorts].filter(p => filtre.has(cleDuFichierMort(p))));
  return { parFichier, fichiersMorts };
}

/**
 * The fixed point loop of Remove Everything Unused: a round, a re-read, again
 * until a round finds nothing. Exported for the cleanup campaign, which applies
 * a batch through this very loop with a filter on, so that offsets are fresh at
 * each round, the cascade is the real one and the moved files guard holds.
 */
export async function executerLesRondes(o: OptionsDeRondes): Promise<BilanDesRondes> {
  const { corpus, segs, api, reglages, choix, filtre } = o;
  const cumul: Tally = {
    symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0,
    imports: 0, fichiers: 0, bouges: 0,
    alias: 0, evenements: 0, remoteconfig: 0, cles: 0, ressources: 0,
    parametres: 0, arguments: 0, baseline: 0, vides: 0, enums: 0, injections: 0, implementations: 0, contrats: 0,
  };
  const ajouteTally = (t: Tally) => { for (const k of Object.keys(t)) cumul[k] = (cumul[k] ?? 0) + t[k]; };
  /** Les fichiers ecartes, par chemin : la boucle repasse sur les memes. */
  const ecartes = new Set<string>();
  /** Base keys of what the rounds applied, for a batch to compare with what it promised. */
  const appliquees = new Set<string>();

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
    { location: vscode.ProgressLocation.Notification, title: o.titre ?? 'Removing everything unused…', cancellable: true },
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
      // Le corpus porte deja tout ce que les familles de ressources demandent.
      // Sans ce contexte elles se taisaient, et `Find` les rapportait quand
      // meme : c'est l'ecart que cette version supprime.
      const contexte = { ...contexteDuCorpus(data), androidApi: api, reglages };
      const passe = n === 0 && o.premier && data === o.premier.data
        ? { parFichier: o.premier.parFichier, fichiersMorts: o.premier.fichiersMorts }
        : collecterUnePasse(data.sources, segs, contexte);
      const textes = new Map(data.sources.map(s => [s.path, s.text]));
      // A batch names its cuts by key. What it does not name stays where it
      // is, and a key it names that the pass no longer finds is simply not
      // applied: the caller compares `appliquees` with what was promised.
      const { parFichier, fichiersMorts } = filtre ? selonLeFiltre(passe, textes, filtre) : passe;
      const combien = [...parFichier.values()].reduce((a, l) => a + l.length, 0);
      if (combien === 0 && fichiersMorts.size === 0) break;

      // Les fichiers qui ont bouge sont ecartes AVANT de planifier la cascade.
      // La calculer sur toutes les coupes puis n'en appliquer qu'une partie
      // reviendrait a retirer l'import d'un symbole qui, lui, est reste : la
      // cascade croit qu'une declaration est partie parce qu'on la lui a
      // annoncee, elle ne verifie rien.
      const { retenu, bouges } = coupesRetenues(parFichier, textes);
      for (const p of bouges) ecartes.add(p);
      if (retenu.size === 0 && fichiersMorts.size === 0) break;
      for (const [p, l] of retenu) for (const c of l) appliquees.add(cleDeBase(c, p, textes.get(p)!));
      for (const p of fichiersMorts) appliquees.add(cleDuFichierMort(p));

      // `fichiersMorts` passe en troisieme argument : la cascade ne doit pas
      // compter une deuxieme fois un fichier que la famille des ressources
      // emporte deja, ni retirer les imports d'un fichier qui disparait.
      const cascade = planCascade(
        new Map([...retenu].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end, replacement: c.texte === '' ? undefined : c.texte }))])),
        textes,
        fichiersMorts,
      );
      // What the cascade takes is applied too, and a batch promises it under
      // the same keys the simulation gave it.
      for (const p of cascade.deleteFiles) appliquees.add(`fichiers\t${p}\tfile`);
      for (const [p, l] of cascade.imports) for (const e of l) appliquees.add(cleDImportOrphelin(p, textes.get(p)!.slice(e.start, e.end)));
      const edit = new vscode.WorkspaceEdit();
      for (const [p, l] of retenu) {
        if (cascade.deleteFiles.has(p) || fichiersMorts.has(p)) continue;
        const plages = plagesDuFichier(p, textes.get(p)!, l, cascade.imports.get(p));
        if (plages === undefined) continue;
        for (const r of plages) {
          edit.replace(corpusUri(p), new vscode.Range(r.start, r.end), r.texte,
            { needsConfirmation: choix === 'review', label: r.quoi ? `Remove ${r.quoi}` : 'Remove dead code' });
        }
      }
      const swept = addCascadePlan(edit, cascade, textes, choix === 'review');
      // Etiquette distincte de celle de la cascade : un fichier de ressources
      // n'est pas vide, il n'est nomme par personne. Dire « nothing is left in
      // it » d'un layout intact serait faux dans la fenetre de relecture.
      let ressourcesSupprimees = 0;
      let videsSupprimes = 0;
      for (const chemin of fichiersMorts) {
        // Un fichier source vide n'est pas « nomme par personne », il ne
        // declare rien : l'etiquette dit lequel des deux.
        const vide = estUnFichierVide(chemin);
        edit.deleteFile(
          corpusUri(chemin),
          { ignoreIfNotExists: true },
          {
            needsConfirmation: choix === 'review',
            label: `Delete ${chemin.split(/[\\/]/).pop()}, ${vide ? 'it declares nothing' : 'nothing references it'}`,
          },
        );
        if (vide) videsSupprimes++; else ressourcesSupprimees++;
      }
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
      applique.ressources += ressourcesSupprimees;
      applique.vides += videsSupprimes;
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

  return { cumul, ecartes, annule, restait, refuse, incomplet, appliquees };
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
    // Rapatriees de `FindEverythingUnused`. Sans ces lignes la phrase
    // totalisait moins que ce que l'edition emportait, ce que le temoin
    // KJ050.WhatItAnnouncesIsWhatItSends attrape.
    cumul.cles > 0 ? plural(cumul.cles, 'resource key') : '',
    cumul.ressources > 0 ? plural(cumul.ressources, 'resource file') : '',
    cumul.evenements > 0 ? plural(cumul.evenements, 'unheard post') : '',
    cumul.alias > 0 ? plural(cumul.alias, 'catalog alias', 'catalog aliases') : '',
    cumul.remoteconfig > 0 ? plural(cumul.remoteconfig, 'remote config key') : '',
    // KJ-058. Les arguments a part : ce sont des lignes de sites d'appel,
    // pas des parametres, et les compter sous ce nom gonflerait le nombre.
    cumul.parametres > 0 ? plural(cumul.parametres, 'constructor parameter') : '',
    cumul.arguments > 0 ? plural(cumul.arguments, 'argument of a removed parameter', 'arguments of removed parameters') : '',
    cumul.baseline > 0 ? plural(cumul.baseline, 'stale baseline entry', 'stale baseline entries') : '',
    cumul.vides > 0 ? `${plural(cumul.vides, 'source file')} declaring nothing` : '',
    // KJ-066. Le nom dit pourquoi il part : ses entrees sont toutes mortes et
    // le type lui meme n'est ecrit nulle part.
    cumul.enums > 0 ? `${plural(cumul.enums, 'enum')} left with no entry` : '',
    // KJ-067. Une declaration d'injection ne tient aucune instance : elle part
    // avec la classe qu'elle nommait, sinon le projet ne compile plus.
    cumul.injections > 0 ? `${plural(cumul.injections, 'injection method')} of a removed class` : '',
    // KJ-072. Le compte porte sur les PLACES, clause et inscription comprises,
    // parce que c'est ce que l'edition envoie.
    cumul.implementations > 0 ? `${plural(cumul.implementations, 'place')} of an interface implemented for nothing` : '',
    // G44. Une coupe par declaration : le contrat et chaque surcharge.
    cumul.contrats > 0 ? `${plural(cumul.contrats, 'declaration')} of interface methods nobody calls` : '',
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
