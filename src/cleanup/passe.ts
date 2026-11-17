import type { AndroidApi } from '../util/androidApi';
import { findUnusedSymbols } from '../providers/unusedSymbols';
import { findUnusedMembers } from '../providers/unusedMembers';
import { scanEnums } from '../providers/unusedEnumEntries';
import { findIdleImplementations } from '../providers/idleImplementations';
import { findUnusedContracts } from '../providers/unusedContracts';
import { findDeadIslands } from '../providers/deadIslands';
import { sweepFile, planFileEdits, SweepEdit, SweepFinding } from '../providers/DeadCodeSweep';
import { findMemberImports, memberKey } from '../util/memberImports';
import { findOrphanSourceSets, OrphanSourceSet } from '../providers/orphanSourceSets';
import { findStaleBaselineEntries } from '../providers/staleBaselineEntries';
import { findEmptySourceFiles } from '../providers/emptySourceFiles';
import { findUnusedGradleDependencies } from '../providers/unusedGradleDependencies';
import { findUnheardEvents } from '../providers/unheardEvents';
import { findUnusedRemoteConfigKeys } from '../providers/unusedRemoteConfigKeys';
import { findUnusedConstructorParameters } from '../providers/unusedConstructorParameters';
import { findUnusedResourceKeys, expandToWholeLines } from '../providers/unusedResourceKeys';
import { collectValueKeyDeclarations, parseValuesPath } from '../indexer/ValueResourceScanner';
import { findUnusedResources } from '../providers/unusedResources';
import type { FileResEntry } from '../indexer/FileResourceIndex';
import { UnusedSettings, islandIgnoreNames } from '../util/unusedSettings';
import type { Preuve } from './preuve';

/**
 * One pass over every family, and what to do with its cuts.
 *
 * Nothing here knows an editor exists: sources come in as path and text, cuts
 * go out as offsets. The command that applies them lives in
 * `commands/RemoveEverythingUnused`, which re-exports this module.
 */

export interface Coupe {
  start: number; end: number; texte: string; famille: string; quoi: string;
  /** What the cut can say for itself; absent on cuts built before the campaign existed. */
  preuve?: Preuve;
}

export type Tally = Record<string, number>;

/**
 * What a pass saw and deliberately did not cut: a report owes it to the
 * reader, a removal must leave it alone.
 */
export interface ARevoir {
  path: string;
  /** 0-based. */
  line: number;
  famille: string;
  quoi: string;
  /** `testOnly`: only tests mention it. `reviewOnly`: a kind never deleted unasked. */
  raison: 'testOnly' | 'reviewOnly';
}

/** The cuts one pass finds, per file, already free of overlaps. */
/**
 * Ce qu'une passe a besoin en plus des sources, pour les familles qui ne se
 * contentent pas du texte.
 *
 * Optionnel par necessite : le temoin et les scripts appellent
 * `collecterUnePasse` avec deux arguments, et une famille sans son entree se
 * tait au lieu de rendre zero constat, ce qui ressemblerait a un succes.
 */
export interface ContexteDePasse {
  /**
   * G61 : ce que la plateforme Android declare. Sans lui, une chaine qui sort
   * du corpus reste invisible aux membres et aux contrats, comme avant.
   */
  androidApi?: AndroidApi;
  /** Repertoires de module portant du .kt ou .java. Sans eux, pas de cles. */
  modulesWithCode?: readonly string[];
  libraryModules?: readonly string[];
  /** Index des FICHIERS de ressources, binaires inclus. Sans lui, pas de fichiers. */
  resourceEntries?: readonly FileResEntry[];
  /**
   * KJ-081 : les fichiers de `src/main/assets/`, hors de `sources`. Sans eux,
   * pas d'assets morts ; avec eux dans `sources`, leur texte garderait en vie
   * toute declaration dont le nom y figure par hasard.
   */
  assets?: readonly { path: string; text: string }[];
  /**
   * Repertoires de module, TOUS. KJ-055 en a besoin pour savoir quels dossiers
   * sous `src/` Gradle sait construire. Sans eux, aucun source set orphelin
   * n'est ecarte et les familles comptent ce qu'un source set orphelin nomme.
   */
  moduleDirs?: readonly string[];
  /**
   * G43 : les exclusions de l'utilisateur, celles que Find Everything Unused
   * applique. Sans elles, Remove supprimait ce que le rapport avait tu.
   */
  reglages?: Partial<UnusedSettings>;
}

/**
 * Le contexte qu'un corpus donne, defensivement.
 *
 * Defensif par necessite, et le temoin l'a prouve : vingt d'entre eux
 * construisent un corpus partiel, sans index de ressources, et
 * `data.index.entries()` y levait. Le contrat de `ContexteDePasse` dit qu'une
 * famille sans son entree se TAIT ; cette fonction est l'endroit ou ce contrat
 * se tient, plutot que de demander a chaque appelant d'y penser.
 */
export function contexteDuCorpus(data: {
  modulesWithCode?: readonly string[];
  libraryModules?: readonly string[];
  moduleDirs?: readonly string[];
  assets?: readonly { path: string; text: string }[];
  index?: { entries?: () => FileResEntry[] };
}): ContexteDePasse {
  return {
    modulesWithCode: data.modulesWithCode,
    libraryModules: data.libraryModules,
    moduleDirs: data.moduleDirs,
    assets: data.assets,
    resourceEntries: typeof data.index?.entries === 'function' ? data.index.entries() : undefined,
  };
}

export function collecterUnePasse(
  sources: readonly { path: string; text: string }[],
  segs: readonly string[],
  ctx: ContexteDePasse = {},
): { parFichier: Map<string, Coupe[]>; fichiersMorts: Set<string>; tally: Tally; orphelins: OrphanSourceSet[]; aRevoir: ARevoir[] } {
  // KJ-055 en premier, parce qu'il change ce que TOUT le reste lit. Un dossier
  // sous `src/` qu'aucune variante Gradle ne construit n'est compile par rien,
  // donc ses mentions ne peuvent garder aucune declaration en vie. Sur le
  // projet de reference, 150 fichiers votaient et tenaient sept declarations.
  //
  // Rien n'est supprime ici : les fichiers restent sur le disque et les
  // dossiers sont RAPPORTES. Ce qui change, c'est que le code de production
  // qu'ils nomment devient trouvable.
  const orphelins = ctx.moduleDirs === undefined ? []
    : findOrphanSourceSets({ sources, moduleDirs: ctx.moduleDirs });
  if (orphelins.length > 0) {
    const ecartes = new Set(orphelins.flatMap(o => o.files));
    sources = sources.filter(s => !ecartes.has(s.path));
  }
  const r = ctx.reglages ?? {};
  const base = { sources, testSourceSets: segs, androidApi: ctx.androidApi } as any;
  const syms = findUnusedSymbols({
    ...base, ignoreNames: r.symbolsIgnoreNames, ignorePaths: r.symbolsIgnorePaths,
    includeTestOnly: r.includeTestOnly, frameworkNameSuffixes: r.frameworkNameSuffixes,
  }) as any[];
  const membres = findUnusedMembers({
    ...base, includeSelfOnly: false,
    ignoreNames: r.membersIgnoreNames, ignorePaths: r.symbolsIgnorePaths, includeTestOnly: r.includeTestOnly,
    deadDeclarations: syms.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  } as any) as any[];
  const { entries: entrees, emptied: enumsVides } = scanEnums({
    ...base, ignoreNames: r.enumEntriesIgnoreNames, includeTestOnly: r.enumEntriesIncludeTestOnly,
  }) as any;
  const iles = findDeadIslands({
    ...base, maxIslandSize: r.islandsMaxSize,
    ignoreNames: islandIgnoreNames(r as UnusedSettings), ignorePaths: r.symbolsIgnorePaths, includeTestOnly: r.includeTestOnly,
  } as any) as any[];

  const aRevoir: ARevoir[] = [];
  for (const [famille, liste] of [['symboles', syms], ['membres', membres], ['entrees', entrees]] as const) {
    for (const t of liste) if (t.verdict === 'testOnly') aRevoir.push({ path: t.path, line: t.line, famille, quoi: t.name, raison: 'testOnly' });
  }
  for (const i of iles) {
    if (i.verdict !== 'testOnly') continue;
    for (const m of i.members) aRevoir.push({ path: m.path, line: m.line, famille: 'ilots', quoi: m.name, raison: 'testOnly' });
  }

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
  const ajoute = (p: string, start: number, end: number, texte: string, famille: string, quoi: string, preuve?: Preuve) => {
    if (start < 0 || end <= start) return;
    const l = brut.get(p) ?? [];
    l.push(preuve ? { start, end, texte, famille, quoi, preuve } : { start, end, texte, famille, quoi });
    brut.set(p, l);
  };

  // The imports that name a removed declaration in OTHER files go with it, as
  // in the lightbulb. This predates KJ-068, which taught the sweep the Java
  // import forms: before that, a Java file kept
  // `import ...TernRookViewWolverineEvent;` once the class was gone and javac
  // stopped on it. Both readings now find the same line, and the duplicate
  // collapses in the overlap pass below.
  const textes = new Map(sources.map(src => [src.path, src.text]));
  const importPerime = (imp: { path: string; line: number }, nom: string) => {
    const texte = textes.get(imp.path);
    if (texte === undefined) return;
    let debut = 0;
    for (let l = 0; l < imp.line; l++) {
      const nl = texte.indexOf('\n', debut);
      if (nl === -1) return;
      debut = nl + 1;
    }
    const nl = texte.indexOf('\n', debut);
    const fin = nl === -1 ? texte.length : nl + 1;
    if (!new RegExp(`^\\s*import\\s+(?:static\\s+)?[\\w.]*\\b${nom}\\b`).test(texte.slice(debut, fin))) return;
    // The statement itself is the cut's name: two long imports of one file
    // must never share a key once the text is shortened.
    ajoute(imp.path, debut, fin, '', 'balayage', '', { verdict: 'cascade', suit: nom, nom: texte.slice(debut, fin).trim() });
  };
  for (const s of syms) {
    if (s.verdict !== 'unreferenced') continue;
    ajoute(s.path, s.removeStart, s.removeEnd, '', 'symboles', s.name, preuveDuSymbole(s));
    if (s.removeStart >= 0) for (const imp of s.staleImports ?? []) importPerime(imp, s.name);
    // KJ-067 : les declarations `inject(target: X)` qui nommaient la classe.
    // Toutes ou aucune : couper la ligne du composant sans l'`override` du
    // faux composant, ou l'inverse, ne compile pas. Le fournisseur les rend
    // deja d'un bloc, ou pas du tout.
    if (s.removeStart >= 0) {
      for (const site of s.injectionSites ?? []) {
        ajoute(site.path, site.removeStart, site.removeEnd, '', 'injections', s.name, { verdict: 'cascade', suit: s.name });
      }
    }
  }
  for (const m of membres) if (m.verdict === 'unreferenced') { ajoute(m.path, m.removeStart, m.removeEnd, '', 'membres', m.name, nonReference(m)); }
  for (const e of entrees) if (e.verdict === 'unreferenced') { ajoute(e.path, e.removeStart, e.removeEnd, '', 'entrees', e.name, nonReference(e)); }
  // KJ-066 : un enum imbrique dont toutes les entrees partent et dont rien
  // n'ecrit le nom s'en va entier, au lieu de laisser `enum OrderBy {\n\n}`.
  // Sa coupe commence avant celles de ses entrees, donc la passe de
  // chevauchement plus bas les fait tomber d'elles-memes.
  for (const e of enumsVides) {
    ajoute(e.path, e.removeStart, e.removeEnd, '', 'enums', `enum ${e.enumName}`, { verdict: 'emptied' });
  }

  // Same for class members and enum entries, which Java reaches through a
  // static import (src/util/memberImports.ts).
  const membresRetires = new Set<string>();
  for (const m of membres) if (m.verdict === 'unreferenced' && m.removeStart >= 0) membresRetires.add(memberKey(m.container ?? '', m.name));
  for (const e of entrees) if (e.verdict === 'unreferenced' && e.removeStart >= 0) membresRetires.add(`${e.enumName}.${e.name}`);
  for (const imp of findMemberImports(sources, membresRetires)) ajoute(imp.path, imp.start, imp.end, '', 'balayage', '', { verdict: 'cascade' });
  for (const i of iles) {
    if (i.verdict !== 'unreferenced' || !i.fixable) continue;
    for (const m of i.members) {
      ajoute(m.path, m.removeStart, m.removeEnd, '', 'ilots', m.name,
        { verdict: 'island', mentions: { tests: i.testMentions }, gardePar: m.keptAliveBy });
    }
    for (const imp of i.staleImports ?? []) importPerime(imp, imp.name);
  }
  for (const src of sources) {
    if (!/\.(kt|java)$/.test(src.path)) continue;
    const trouvailles = sweepFile(src.text, src.path.endsWith('.java') ? 'java' : 'kotlin');
    // `planFileEdits` keeps the edit objects themselves, so each kept edit
    // still knows the finding it came from, and its detector names the proof.
    const origine = new Map<SweepEdit, SweepFinding>();
    for (const t of trouvailles) for (const e of t.edits) origine.set(e, t);
    for (const e of planFileEdits(trouvailles)) {
      const t = origine.get(e);
      ajoute(src.path, e.start, e.end, e.text, 'balayage', '',
        { verdict: t?.detector === 'writeOnly' ? 'write-only' : 'unreferenced', ...(t ? { nom: t.name, detecteur: t.detector } : {}) });
    }
  }

  // ── Les cinq familles que `FindEverythingUnused` rapportait sans que cette
  //    commande ne les retire jamais. L'ecart etait invisible a l'usage : on
  //    voyait 82 cles de ressources dans le rapport, on cliquait Remove, et
  //    aucune ne partait, sans un mot pour le dire.
  //
  //    Chacune garde la regle de son fournisseur, aucune n'est relachee ici.

  // Alias du catalogue Gradle, et la version devenue orpheline avec l'alias.
  for (const g of findUnusedGradleDependencies({ sources, ignoreNames: r.gradleIgnoreNames } as any) as any[]) {
    ajoute(g.path, g.removeStart, g.removeEnd, '', 'alias', g.name, { verdict: 'unreferenced' });
    if (g.orphanedVersion) {
      ajoute(g.path, g.orphanedVersion.removeStart, g.orphanedVersion.removeEnd, '', 'alias', g.orphanedVersion.name,
        { verdict: 'cascade', suit: g.name });
    }
  }

  // Posts que personne n'ecoute. Un seul abonnement illisible retire la
  // famille entiere : le fournisseur raisonne par soustraction, et une
  // soustraction sur un corpus incomplet ne prouve aucune absence.
  const scanEvenements = findUnheardEvents({
    sources, testSourceSets: segs, ignoreNames: r.eventsIgnoreNames, assumeSubscribed: r.eventsAssumeSubscribed,
  } as any) as any;
  if ((scanEvenements.unreadable?.length ?? 0) === 0) {
    for (const e of (scanEvenements.events ?? []) as any[]) {
      if (e.verdict !== 'unheard') continue;
      // `removeStart` vaut -1 quand la coupe changerait la structure, un post
      // seul dans sa branche par exemple. `ajoute` l'ecarte de lui meme.
      ajoute(e.path, e.removeStart, e.removeEnd, '', 'evenements', e.name, { verdict: 'unheard' });
      // KJ-069 : le post seul dans un `finally` sans `catch` remonte le corps
      // du `try` au lieu de laisser un bloc vide. C'est un REMPLACEMENT, et il
      // voyage dans ses propres champs pour qu'un consommateur qui ne sait que
      // supprimer ne supprime pas le corps.
      if (e.rewriteText !== undefined) {
        ajoute(e.path, e.rewriteStart, e.rewriteEnd, e.rewriteText, 'evenements', e.name, { verdict: 'unheard' });
      }
    }
  }

  // KJ-072 : une interface qu'une classe implemente pour rien. La clause, les
  // surcharges vides et l'inscription partent d'un bloc : une surcharge seule
  // ne compile pas sans sa clause, et l'inverse non plus.
  for (const impl of findIdleImplementations({ sources, testSourceSets: segs } as any)) {
    for (const c of impl.cuts) {
      ajoute(impl.path, c.start, c.end, c.replacement, 'implementations', `${impl.interfaceName} de ${impl.className}`, { verdict: 'unreferenced' });
    }
  }

  // G44 : une methode d'interface que rien n'appelle, et chaque surcharge.
  // Coupe liee : la declaration et toutes les surcharges, ou rien (voir la
  // passe de chevauchement plus bas).
  for (const k of findUnusedContracts({ sources, testSourceSets: segs, androidApi: ctx.androidApi })) {
    for (const c of k.cuts) ajoute(c.path, c.start, c.end, '', 'contrats', `${k.interfaceFqn}.${k.name}`, { verdict: 'unreferenced' });
  }

  // Cles de Remote Config que rien ne lit.
  //
  // Une trouvaille porte un NOM et la liste de ses declarations, une par
  // variante de build : la coupe est sur chaque declaration, pas sur la
  // trouvaille. Lue comme une coupe plate, elle rendait `path`, `removeStart`
  // et `removeEnd` indefinis, et `ajoute` les rangeait sous la clef
  // `undefined`. Invisible jusqu'ici parce que le coupe circuit de la famille
  // rendait zero trouvaille sur le projet de reference.
  for (const k of findUnusedRemoteConfigKeys({ sources, ignoreNames: r.remoteConfigIgnoreNames } as any) as any[]) {
    for (const d of k.declarations as any[]) {
      ajoute(d.path, d.removeStart, d.removeEnd, '', 'remoteconfig', k.name, { verdict: 'unreferenced', variantes: k.declarations.length });
    }
  }

  // KJ-058 : parametres de constructeur que rien ne lit, et l'argument nomme
  // de chaque site avec eux. Deux familles et non une : « Removed 3
  // constructor parameters » pour deux parametres et un argument serait le
  // meme compte faux que celui des renommages, corrige plus haut.
  for (const p of findUnusedConstructorParameters({ sources })) {
    ajoute(p.path, p.removeStart, p.removeEnd, '', 'parametres',
      `constructor parameter ${p.name} of ${p.className}, nothing reads it`, { verdict: 'unreferenced' });
    for (const s of p.sites) {
      ajoute(s.path, s.removeStart, s.removeEnd, '', 'arguments', `argument ${p.name}, the parameter is gone`,
        { verdict: 'cascade', suit: p.name });
    }
  }

  // KJ-059 : une entree de baseline detekt dont le fichier n'existe plus.
  // Detekt ne se plaint jamais d'un defaut qu'il ne trouve pas, donc rien ne
  // pointe jamais sur la ligne. La passe suivante de la boucle voit les
  // fichiers que celle-ci supprime : aucun couplage avec les autres familles.
  for (const e of findStaleBaselineEntries({ sources })) {
    ajoute(e.path, e.removeStart, e.removeEnd, '', 'baseline', `stale baseline entry for ${e.file}, which no longer exists`, { verdict: 'stale' });
  }

  // Cles de values/, toutes leurs variantes de qualificatif. Les offsets sont
  // recalcules sur le texte courant, jamais portes depuis le scan.
  if (ctx.modulesWithCode !== undefined) {
    const declarations = sources
      .filter(src => parseValuesPath(src.path) !== undefined)
      .flatMap(src => collectValueKeyDeclarations(src.path, src.text, ctx.modulesWithCode));
    const cles = findUnusedResourceKeys({
      declarations, sources,
      modulesWithCode: ctx.modulesWithCode, libraryModules: ctx.libraryModules,
      ignorePrefixes: r.resourceKeysIgnorePrefixes,
    } as any) as any[];
    for (const k of cles) {
      for (const v of k.variants as any[]) {
        const texte = textes.get(v.path);
        if (texte === undefined) continue;
        const frais = (collectValueKeyDeclarations(v.path, texte) as any[])
          .find(d => d.kind === k.kind && d.name === k.name);
        if (!frais) continue;
        const w = expandToWholeLines(texte, frais.start, frais.end);
        ajoute(v.path, w.start, w.end, '', 'cles', `${k.kind}/${k.name}`, { verdict: 'unreferenced', variantes: k.variants.length });
      }
    }
  }

  // FICHIERS de ressources que rien ne nomme. Ceux la ne se coupent pas, ils
  // se suppriment, donc ils sortent par `fichiersMorts` et non par `ajoute`.
  const fichiersMorts = new Set<string>();
  if (ctx.resourceEntries !== undefined && ctx.modulesWithCode !== undefined) {
    const trouves = findUnusedResources({
      entries: ctx.resourceEntries as any, sources, assets: ctx.assets ?? [],
      modulesWithCode: ctx.modulesWithCode, libraryModules: ctx.libraryModules,
      includeDrawables: false,
    } as any) as any[];
    for (const r of trouves) {
      if (!r.deletable) {
        for (const chemin of r.paths as string[]) aRevoir.push({ path: chemin, line: 0, famille: 'ressources', quoi: `${r.kind}/${r.name}`, raison: 'reviewOnly' });
        continue;
      }
      for (const chemin of r.paths as string[]) fichiersMorts.add(chemin);
    }
  }
  // KJ-060 : un fichier source qui ne declare rien. La cascade supprime un
  // fichier qu'elle VIDE dans la ronde ; celui qui etait deja vide au depart
  // n'etait vu par personne, chaque detecteur cherchant des declarations.
  for (const f of findEmptySourceFiles({ sources })) fichiersMorts.add(f.path);

  const parFichier = sansChevauchement(brut);
  // An island tests keep can hold a declaration nothing calls at all: that one
  // is cut as a symbol, and a cut is not a doubt.
  const coupee = (a: ARevoir): boolean => {
    const coupes = parFichier.get(a.path);
    const texte = textes.get(a.path);
    if (!coupes || texte === undefined) return false;
    const debut = debutsDeLigne(texte)[a.line] ?? -1;
    return coupes.some(c => c.start <= debut && debut < c.end);
  };
  const dejaVus = new Set<string>();
  return {
    parFichier, fichiersMorts, tally: compteLesFamilles(parFichier), orphelins,
    aRevoir: aRevoir.filter(a => {
      // Two families can see one declaration, a symbol and the island it heads.
      const cle = `${a.path}\t${a.line}\t${a.quoi}`;
      if (dejaVus.has(cle) || coupee(a)) return false;
      dejaVus.add(cle);
      return true;
    }),
  };
}

/** The proof a symbol cut carries: verdict, channel, and the files it takes lines from. */
function preuveDuSymbole(s: {
  testMentions: number; via?: 'visibility' | 'injection';
  staleImports?: readonly { path: string; line: number }[];
  injectionSites?: readonly { path: string; line: number }[];
}): Preuve {
  const emporte = [...(s.staleImports ?? []), ...(s.injectionSites ?? [])].map(e => ({ path: e.path, line: e.line }));
  const preuve: Preuve = { verdict: 'unreferenced', mentions: { tests: s.testMentions } };
  if (s.via) preuve.via = s.via;
  if (emporte.length > 0) preuve.emporte = emporte;
  return preuve;
}

/** The proof of a plain unreferenced finding, with its test mentions when the detector counts them. */
function nonReference(x: { testMentions?: number }): Preuve {
  return typeof x.testMentions === 'number'
    ? { verdict: 'unreferenced', mentions: { tests: x.testMentions } }
    : { verdict: 'unreferenced' };
}

/**
 * Chevauchements : la premiere coupe gagne, comme chez chaque fournisseur.
 *
 * G44 : une coupe de contrat entierement contenue dans une autre part avec
 * elle, rien a craindre. Une coupe de contrat qui ne tombe qu'A MOITIE
 * laisserait une surcharge sans declaration, ou l'inverse, et le module ne
 * compilerait plus : tout le contrat est alors retire, dans tous les fichiers.
 */
export function sansChevauchement(brut: ReadonlyMap<string, Coupe[]>): Map<string, Coupe[]> {
  const parFichier = new Map<string, Coupe[]>();
  const contratsRompus = new Set<string>();
  for (const [p, l] of brut) {
    const triees = [...l].sort((a, b) => a.start - b.start || b.end - a.end);
    const gardees: Coupe[] = [];
    let fin = -1;
    for (const c of triees) {
      if (c.start < fin) {
        if (c.famille === 'contrats' && c.end > fin) contratsRompus.add(c.quoi);
        continue;
      }
      fin = c.end;
      gardees.push(c);
    }
    parFichier.set(p, gardees);
  }
  if (contratsRompus.size > 0) {
    for (const [p, l] of parFichier) parFichier.set(p, l.filter(c => !(c.famille === 'contrats' && contratsRompus.has(c.quoi))));
  }
  return parFichier;
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
  const tally: Tally = {
    symboles: 0, membres: 0, entrees: 0, ilots: 0, balayage: 0, renommages: 0,
    imports: 0, fichiers: 0,
    // Les cinq familles rapatriees depuis `FindEverythingUnused`. Absentes de
    // cet objet, `tally[famille]++` valait NaN et la phrase du compte rendu
    // annoncait `NaN resource keys`.
    alias: 0, evenements: 0, remoteconfig: 0, cles: 0, ressources: 0,
    parametres: 0, arguments: 0, baseline: 0, vides: 0, enums: 0, injections: 0, implementations: 0, contrats: 0,
  };
  for (const l of parFichier.values()) {
    for (const c of l) tally[c.famille === 'balayage' && c.texte !== '' ? 'renommages' : c.famille]++;
  }
  return tally;
}

export function debutsDeLigne(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

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
export function sansTrouDeLignesVides(
  texte: string,
  coupes: readonly Coupe[],
  /** Whole lines another plan removes from this file, the cascade's imports. */
  autres: readonly { start: number; end: number }[] = [],
): Coupe[] {
  const triees = [...coupes].sort((a, b) => a.start - b.start);
  const suivante = (i: number): number => triees[i + 1]?.start ?? texte.length;
  const ligneVide = (debut: number, fin: number): boolean => texte.slice(debut, fin).trim() === '';
  const entieres = (d: number, f: number): boolean =>
    d < f && (d === 0 || texte[d - 1] === '\n') && (f === texte.length || texte[f - 1] === '\n');
  // A hole is a RUN of removed lines. Judged cut by cut, two dead declarations
  // written one under the other each had a non blank neighbour, and the file
  // kept two blank lines in a row; so did an import block split between the
  // sweep and the cascade.
  const retirees: { start: number; end: number }[] = [
    ...triees.filter(c => c.texte === '' && entieres(c.start, c.end)),
    ...autres.filter(a => entieres(a.start, a.end)),
  ];
  return triees.map((c, i) => {
    if (c.texte !== '' || !entieres(c.start, c.end)) return c;
    let debut = c.start;
    for (let r = retirees.find(x => x.end === debut); r; r = retirees.find(x => x.end === debut)) debut = r.start;
    // La ligne juste avant le trou.
    const avantFin = debut - 1;
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
  /**
   * Whether the text of a file is still the one the cuts were measured on.
   * The editor knows; a caller with nothing but the disk says yes.
   */
  encoreMesure: (path: string, texte: string) => boolean = () => true,
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
    if (!encoreMesure(p, texte)) { bouges.push(p); continue; }
    retenu.set(p, l);
  }
  return { retenu, bouges };
}
