import type { CoupePlanifiee, IndexDesMentions } from './simulation';
import { normalizeResourceName } from '../util/xmlRefs';

/**
 * From the simulated cuts to reviewable batches.
 *
 * Pure: no file, no git, no editor. The simulation says in which round each
 * cut appears; this module says which cuts travel together, which batch each
 * group lands in, and in what order the batches should be reviewed.
 *
 * Wave 1 holds the round 1 cuts, the ones with zero references today. Wave 2
 * holds the rest, each pointing at the earlier cuts whose removed text named
 * it. A reviewer reading wave 2 against the base branch would otherwise see
 * live code: on the reference project every unanswered objection of one PR
 * was exactly that.
 */

export interface Cause {
  kind: 'orphan' | 'born' | 'unattributed';
  /** What a batch title can say: `TK-123 (pull request #7)`, `born before the repository's history`. */
  label: string;
  ticket?: string;
  pr?: string;
  commit?: string;
  author?: string;
  date?: string;
  /** The history stops before the symbol's real birth: a repository junction or import. */
  truncated?: boolean;
}

export interface OptionsDePlan {
  /** Workspace root; module labels are paths relative to it. */
  racine: string;
  moduleDirs: readonly string[];
  libraryModules?: readonly string[];
  maxFilesPerBatch?: number;
  maxLinesPerBatch?: number;
  groupBy?: 'module' | 'cause';
  /** Git facts by cut key, when the caller computed them. */
  causes?: ReadonlyMap<string, Cause>;
  /** Which files name each cut at HEAD, from the simulation; the proof counts them. */
  mentions?: IndexDesMentions;
}

/**
 * One file, other than the cut's own, whose text names the cut at HEAD, and
 * why that mention changes nothing: it sits in a cut of this plan (`cle`), in
 * a comment or a string, in a homonym's file, in a source set Gradle never
 * compiles, or on another class's member of the same name. `uncounted` is
 * the one kind the detector cannot explain, and the reader must look.
 */
export interface Mention {
  path: string;
  kind: 'cut' | 'comment-only' | 'homonym' | 'declared' | 'baseline' | 'excluded' | 'other-class' | 'uncounted';
  cle?: string;
  /** For a homonym key: the module that declares the other one. */
  module?: string;
}

export interface CoupeDuLot extends CoupePlanifiee {
  /** Keys of earlier cuts whose removed text named this one. */
  declencheurs: string[];
  doutes: string[];
  palier: 1 | 2;
  /** Lines this cut removes on its own; 0 when its file goes whole, or for a binary asset. */
  lignes: number;
  module: string;
  cause?: Cause;
  /** Every other file that names the cut at HEAD, when the simulation indexed them. */
  mentions?: Mention[];
}

export interface Groupe {
  kind: 'module' | 'cause' | 'oversized';
  label: string;
  cause?: Cause;
}

export interface Lot {
  id: number;
  slug: string;
  wave: 1 | 2;
  groupe: Groupe;
  palier: 1 | 2;
  fichiers: string[];
  lignes: number;
  /** Whole asset files deleted, counted apart from the lines. */
  assets: number;
  coupes: CoupeDuLot[];
}

export interface Plan {
  lots: Lot[];
  /** Wave 2 cuts no earlier cut explains. */
  sansDeclencheur: string[];
  vagues: { 1: number; 2: number };
}

const DEFAUTS = { maxFilesPerBatch: 40, maxLinesPerBatch: 1000, groupBy: 'module' as const };
/** The share of a batch's roots one cause must reach to give the batch its title. */
const PART_DE_LA_CAUSE = 0.6;
const FICHIERS = new Set(['fichiers', 'vides', 'ressources']);
const DECLARATIONS = new Set(['symboles', 'ilots', 'membres']);
/**
 * Declarations other removed texts may name: a cut of the same round that
 * names one travels with it. Members stay out: `run` or `observe` would weld
 * every batch to every other.
 */
const NOMMABLES = new Set(['symboles', 'ilots', 'enums', 'evenements', 'implementations', 'contrats']);
/** Judged inside their file, or not by name: no workspace wide count can be promised for them. */
export const SANS_VERIFICATION = new Set(['fichiers', 'vides', 'baseline', 'balayage', 'parametres', 'arguments']);
/** Families whose references live in strings and attributes: a string mention is a real one. */
const TEXTE_EST_CODE = new Set(['cles', 'remoteconfig', 'ressources']);
/** Keys declared per module: the same name in another module is another key. */
const CLES_PAR_MODULE = new Set(['cles', 'remoteconfig']);
export const IDENTIFIANT_RE = /^[A-Za-z_$][\w$]*$/;
const BASELINE_RE = /baseline[^\\/]*\.xml$/i;

/** The name the mention index files a cut under: `kind/name` for a resource key, which is never searched as a bare word. */
export function nomIndexe(c: CoupePlanifiee): string {
  if (c.famille !== 'cles') return nomDe(c);
  const [kind, ...reste] = c.quoi.split('/');
  return `${kind}/${normalizeResourceName(reste.join('/'))}`;
}
const CADRE_RE = /(Activity|Fragment|Service|Receiver|Provider|ViewModel|Worker|Application|Dialog)$/;
const TOKEN_RE = /[A-Za-z_$][\w$]*/g;

/** The name a cut answers to: what other texts would have to mention to keep it alive. */
export function nomDe(c: CoupePlanifiee): string {
  switch (c.famille) {
    case 'cles': return c.quoi.split('/').pop() ?? c.quoi;
    case 'contrats': return c.quoi.split('.').pop() ?? c.quoi;
    case 'implementations': return c.quoi.split(' de ')[0];
    case 'parametres': return /constructor parameter (\w+) of/.exec(c.quoi)?.[1] ?? c.quoi;
    case 'enums': return c.quoi.replace(/^enum\s+/, '');
    // `stale baseline entry for X.kt, which no longer exists`: the file whose deletion orphaned it.
    case 'baseline': return (/entry for (?:.*[\\/])?([^\\/\s]+?)\.(?:kt|java)\b/.exec(c.quoi)?.[1]) ?? c.quoi;
    case 'fichiers': case 'vides': case 'ressources':
      return (c.path.split(/[\\/]/).pop() ?? '').replace(/(\.9)?\.[^.]+$/, '');
    default: return c.quoi || c.preuve?.nom || c.preuve?.suit || '';
  }
}

export const estAsset = (c: CoupePlanifiee): boolean => c.famille === 'ressources' && !/\.xml$/i.test(c.path);
export const estCascade = (c: CoupePlanifiee): boolean => c.preuve?.verdict === 'cascade';
/** Families judged by name across the whole workspace: the only ones a cause can be read for. */
const CAUSABLES = new Set(['symboles', 'membres', 'ilots', 'entrees', 'enums', 'contrats', 'implementations', 'cles', 'remoteconfig', 'alias', 'evenements']);
export const aUneCause = (c: CoupePlanifiee): boolean => CAUSABLES.has(c.famille) && !estCascade(c);
const compteLignes = (texte: string) => texte.split('\n').length - 1;

function lignesDe(c: CoupePlanifiee): number {
  if (c.fichierSupprime || estAsset(c)) return 0;
  return compteLignes(c.extrait);
}

function moduleDe(path: string, options: OptionsDePlan): { dir: string; label: string } {
  let meilleur = '';
  for (const d of options.moduleDirs) if (path.startsWith(`${d}/`) && d.length > meilleur.length) meilleur = d;
  if (meilleur === '' || meilleur === options.racine) return { dir: meilleur, label: 'root' };
  const prefixe = `${options.racine}/`;
  return { dir: meilleur, label: meilleur.startsWith(prefixe) ? meilleur.slice(prefixe.length) : meilleur };
}

function doutesDe(c: CoupePlanifiee): string[] {
  const doutes: string[] = [];
  if (c.famille === 'cles') doutes.push('resource-key');
  if (c.famille === 'remoteconfig') doutes.push('remote-config-key');
  if (c.preuve?.homonyme) doutes.push('homonym');
  if (DECLARATIONS.has(c.famille) && CADRE_RE.test(nomDe(c))) doutes.push('framework-suffix');
  return doutes;
}

/** The files that name `c` at HEAD, each with what explains it. Undefined when nothing was indexed for the name. */
function mentionsDe(c: CoupeDuLot, idx: IndexDesMentions, index: ReadonlyMap<string, CoupeDuLot[]>, options: OptionsDePlan): Mention[] | undefined {
  if (estCascade(c) || SANS_VERIFICATION.has(c.famille)) return undefined;
  const nom = nomDe(c);
  if (!IDENTIFIANT_RE.test(nom)) return undefined;
  const cle = nomIndexe(c);
  const brut = idx.brut.get(cle);
  const codeIndexe = idx.code.get(cle);
  // A name the index looked for and found nowhere is a real answer: 0 files.
  if (idx.noms ? !idx.noms.has(cle) : !brut && !codeIndexe) return undefined;
  // A key's references are qualified (`R.string.x`, `@string/x`): the index already
  // read them the way the detector does. The other string borne families are
  // referenced by their bare word inside strings, so a string mention is a real one.
  const code = c.famille === 'cles' ? codeIndexe ?? new Set<string>()
    : TEXTE_EST_CODE.has(c.famille) ? brut ?? new Set<string>() : codeIndexe ?? new Set<string>();
  const homonyme = !!c.preuve?.homonyme || c.preuve?.via === 'visibility';
  const declarants = idx.declare.get(cle);
  const moduleC = moduleDe(c.path, options).dir;
  const out: Mention[] = [];
  for (const f of [...new Set([...(brut ?? []), ...code])].sort()) {
    if (f === c.path) continue;
    if (!code.has(f)) { out.push({ path: f, kind: 'comment-only' }); continue; }
    // A cut of this plan holds the mention: an earlier or same round cut, the
    // declaration itself when it falls in a later round, or a later cut this
    // one triggers (a stale baseline entry). Any other later cut still names
    // it when this one goes, and explains nothing.
    const d = (index.get(nom) ?? []).find(d => d.path === f && d.cle !== c.cle
      && (d.round <= c.round || nomDe(d) === nom || d.declencheurs.includes(c.cle)));
    if (d) { out.push({ path: f, kind: 'cut', cle: d.cle }); continue; }
    if (BASELINE_RE.test(f)) { out.push({ path: f, kind: 'baseline' }); continue; }
    if (idx.exclus.has(f)) { out.push({ path: f, kind: 'excluded' }); continue; }
    if (CLES_PAR_MODULE.has(c.famille)) {
      const moduleF = moduleDe(f, options);
      if (moduleF.dir !== moduleC && declarants && [...declarants].some(p => moduleDe(p, options).dir === moduleF.dir)) {
        out.push({ path: f, kind: 'homonym', module: moduleF.label });
        continue;
      }
    } else if (declarants?.has(f)) {
      // The cut declares the name itself: the file declares another one. A
      // posted event does not: the file declares the event the post names.
      out.push({ path: f, kind: c.famille === 'evenements' ? 'declared' : 'homonym' });
      continue;
    }
    if (homonyme) { out.push({ path: f, kind: 'homonym' }); continue; }
    out.push({ path: f, kind: c.famille === 'membres' ? 'other-class' : 'uncounted' });
  }
  return out;
}

function palierDe(c: CoupePlanifiee, doutes: readonly string[]): 1 | 2 {
  if (doutes.length > 0) return 2;
  if ((c.preuve?.mentions?.tests ?? 0) > 0) return 2;
  const v = c.preuve?.verdict;
  if (v === 'write-only' || v === 'unheard' || v === 'test-only') return 2;
  return 1;
}

function tokensDe(texte: string): Set<string> {
  const out = new Set<string>();
  for (const m of texte.matchAll(TOKEN_RE)) if (m[0].length >= 3) out.add(m[0]);
  return out;
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  racine(x: string): string {
    let r = x;
    while (this.parent.get(r) !== undefined && this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (this.parent.get(c) !== undefined && this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  unir(a: string, b: string): void {
    const ra = this.racine(a), rb = this.racine(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  ajoute(x: string): void { if (!this.parent.has(x)) this.parent.set(x, x); }
}

interface Composante {
  coupes: CoupeDuLot[];
  wave: 1 | 2;
  fichiers: Set<string>;
  lignes: number;
  assets: number;
  estAsset: boolean;
  declencheurs: Set<string>;
  module: string;
  /** The cuts a cause can be read for: declarations, keys, resources; never a cascade or an emptied file. */
  racines: CoupeDuLot[];
  cause?: Cause;
}

function causeDominante(racines: readonly CoupeDuLot[]): Cause | undefined {
  const parTicket = new Map<string, { n: number; cause: Cause }>();
  for (const r of racines) {
    if (!r.cause || r.cause.kind === 'unattributed') continue;
    const k = r.cause.ticket ?? r.cause.label;
    const e = parTicket.get(k) ?? { n: 0, cause: r.cause };
    e.n++;
    parTicket.set(k, e);
  }
  const top = [...parTicket.values()].sort((a, b) => b.n - a.n)[0];
  return top && racines.length > 0 && top.n / racines.length >= PART_DE_LA_CAUSE ? top.cause : undefined;
}

function slugifie(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lot';
}

export function planifier(coupes: readonly CoupePlanifiee[], options: OptionsDePlan): Plan {
  const maxFiles = options.maxFilesPerBatch ?? DEFAUTS.maxFilesPerBatch;
  const maxLines = options.maxLinesPerBatch ?? DEFAUTS.maxLinesPerBatch;
  const groupBy = options.groupBy ?? DEFAUTS.groupBy;

  // 1. Enrich, and index the removed texts by token for the trigger lookup.
  const parCle = new Map<string, CoupeDuLot>();
  const index = new Map<string, CoupeDuLot[]>();
  for (const c of coupes) {
    const mod = moduleDe(c.path, options);
    const doutes = doutesDe(c);
    const cause = aUneCause(c) ? options.causes?.get(c.cle) : undefined;
    const e: CoupeDuLot = {
      ...c, declencheurs: [], doutes, palier: palierDe(c, doutes), lignes: lignesDe(c), module: mod.label,
      ...(cause ? { cause } : {}),
    };
    parCle.set(c.cle, e);
    // A deleted file is also reachable by its own name: a baseline entry names
    // the file, and the class inside may spell its name differently.
    const tokens = tokensDe(c.extrait);
    if (FICHIERS.has(c.famille)) tokens.add(nomDe(c));
    for (const t of tokens) {
      const l = index.get(t) ?? [];
      l.push(e);
      index.set(t, l);
    }
  }
  const tout = [...parCle.values()];

  // 2. Triggers: earlier cuts whose removed text named this one.
  for (const c of tout) {
    if (c.round < 2 || estCascade(c)) continue;
    const nom = nomDe(c);
    if (nom === '') continue;
    c.declencheurs = (index.get(nom) ?? []).filter(d => d.round < c.round).map(d => d.cle).sort();
  }
  // Index and triggers are complete: a mention is explained by any cut of the plan that holds it.
  if (options.mentions) {
    for (const e of tout) {
      const m = mentionsDe(e, options.mentions, index, options);
      if (!m) continue;
      e.mentions = m;
      if (m.some(x => x.kind === 'uncounted')) { e.doutes.push('uncounted-mention'); e.palier = 2; }
    }
  }

  // 3. What travels together, within a round.
  const uf = new UnionFind();
  for (const c of tout) uf.ajoute(c.cle);
  const parRonde = new Map<number, CoupeDuLot[]>();
  for (const c of tout) parRonde.set(c.round, [...(parRonde.get(c.round) ?? []), c]);
  for (const [, l] of parRonde) {
    const parNom = new Map<string, CoupeDuLot[]>();
    for (const c of l) {
      const nom = nomDe(c);
      if (nom !== '') parNom.set(nom, [...(parNom.get(nom) ?? []), c]);
    }
    const parChemin = new Map<string, CoupeDuLot[]>();
    for (const c of l) parChemin.set(c.path, [...(parChemin.get(c.path) ?? []), c]);
    // One file, one batch: a reviewer reads a file once. This also carries an
    // orphaned import with the cuts of its own file, the ones that used it.
    for (const [, memeFichier] of parChemin) for (let i = 1; i < memeFichier.length; i++) uf.unir(memeFichier[0].cle, memeFichier[i].cle);
    for (const c of l) {
      // A stale import, an injection line or an argument follows the
      // declaration it names, which may live in another file.
      if (estCascade(c) && c.preuve?.suit && c.famille !== 'imports') {
        for (const d of parNom.get(c.preuve.suit) ?? []) if (d !== c) uf.unir(c.cle, d.cle);
      }
      // A file that goes whole takes the cuts it held.
      if (FICHIERS.has(c.famille)) for (const d of parChemin.get(c.path) ?? []) if (d.fichierSupprime) uf.unir(c.cle, d.cle);
      // Island members hold each other, whatever family found the holder dead.
      if (c.famille === 'ilots') {
        for (const g of c.preuve?.gardePar ?? []) for (const d of parNom.get(g) ?? []) if (!estCascade(d)) uf.unir(c.cle, d.cle);
      }
      // A cut whose removed text names a declaration of the same round travels
      // with it: removing the declaration first would leave that text pointing
      // at nothing. On the reference, three helpers held only by a class the
      // symbol detector found dead landed in another batch than the class;
      // alone, their batch broke the build on its constructor.
      if (NOMMABLES.has(c.famille) && !estCascade(c)) {
        for (const d of index.get(nomDe(c)) ?? []) if (d.round === c.round && d !== c) uf.unir(c.cle, d.cle);
      }
      // A contract and its overrides, a key and its variants, an interface and its places.
      if (c.famille === 'contrats' || c.famille === 'remoteconfig' || c.famille === 'cles' || c.famille === 'implementations') {
        for (const d of parNom.get(nomDe(c)) ?? []) if (d.famille === c.famille && d.quoi === c.quoi) uf.unir(c.cle, d.cle);
      }
    }
  }

  // 4. Components.
  const composantes = new Map<string, Composante>();
  for (const c of tout) {
    const r = uf.racine(c.cle);
    const comp = composantes.get(r) ?? {
      coupes: [], wave: c.round === 1 ? 1 : 2, fichiers: new Set(), lignes: 0, assets: 0, estAsset: true, declencheurs: new Set(), module: '', racines: [],
    };
    comp.coupes.push(c);
    comp.fichiers.add(c.path);
    comp.lignes += c.lignes;
    if (estAsset(c)) comp.assets++; else comp.estAsset = false;
    for (const d of c.declencheurs) comp.declencheurs.add(d);
    if (aUneCause(c)) comp.racines.push(c);
    composantes.set(r, comp);
  }
  for (const comp of composantes.values()) {
    const modules = new Map<string, number>();
    for (const c of comp.coupes) modules.set(c.module, (modules.get(c.module) ?? 0) + 1);
    comp.module = [...modules.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    comp.cause = causeDominante(comp.racines);
  }

  // 5. Pack, first fit decreasing, inside (wave, group).
  const cleDeGroupe = (comp: Composante): string => {
    if (comp.estAsset) return `${comp.wave}\tassets of ${comp.module}`;
    const cause = groupBy === 'cause' && comp.cause ? comp.cause.ticket ?? comp.cause.label : undefined;
    return `${comp.wave}\t${cause ?? comp.module}`;
  };
  const groupes = new Map<string, Composante[]>();
  for (const comp of composantes.values()) groupes.set(cleDeGroupe(comp), [...(groupes.get(cleDeGroupe(comp)) ?? []), comp]);

  const lots: Lot[] = [];
  for (const [, comps] of groupes) {
    comps.sort((a, b) => b.lignes - a.lignes || b.fichiers.size - a.fichiers.size);
    const ouverts: { lot: Lot; fichiers: Set<string> }[] = [];
    for (const comp of comps) {
      const tropGros = comp.fichiers.size > maxFiles || comp.lignes > maxLines;
      const hote = tropGros ? undefined : ouverts.find(o =>
        new Set([...o.fichiers, ...comp.fichiers]).size <= maxFiles && o.lot.lignes + comp.lignes <= maxLines);
      if (hote) {
        hote.lot.coupes.push(...comp.coupes);
        for (const f of comp.fichiers) hote.fichiers.add(f);
        hote.lot.lignes += comp.lignes;
        hote.lot.assets += comp.assets;
        continue;
      }
      const lot: Lot = {
        id: 0, slug: '', wave: comp.wave, groupe: { kind: tropGros ? 'oversized' : 'module', label: comp.module },
        palier: 1, fichiers: [], lignes: comp.lignes, assets: comp.assets, coupes: [...comp.coupes],
      };
      ouverts.push({ lot, fichiers: new Set(comp.fichiers) });
      lots.push(lot);
    }
    for (const o of ouverts) o.lot.fichiers = [...o.fichiers].sort();
  }

  // 6. Titles, tiers, order, ids.
  for (const lot of lots) {
    lot.palier = lot.coupes.some(c => c.palier === 2) ? 2 : 1;
    const cause = causeDominante(lot.coupes.filter(aUneCause));
    const estAssets = lot.coupes.every(estAsset);
    if (estAssets) lot.groupe.label = `assets of ${lot.groupe.label}`;
    if (cause && lot.groupe.kind !== 'oversized') lot.groupe = { kind: 'cause', label: cause.label, cause };
    else if (cause) lot.groupe.cause = cause;
  }
  lots.sort((a, b) => a.wave - b.wave || a.palier - b.palier || b.lignes - a.lignes || b.fichiers.length - a.fichiers.length
    || a.groupe.label.localeCompare(b.groupe.label));
  lots.forEach((lot, i) => {
    lot.id = i + 1;
    lot.slug = `${String(lot.id).padStart(2, '0')}-${slugifie(lot.groupe.label)}`;
    lot.coupes.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  });

  const sansDeclencheur = [...composantes.values()]
    .filter(comp => comp.wave === 2 && comp.declencheurs.size === 0)
    .flatMap(comp => comp.coupes.map(c => c.cle))
    .sort();
  const vagues = { 1: tout.filter(c => c.round === 1).length, 2: tout.filter(c => c.round > 1).length };
  return { lots, sansDeclencheur, vagues };
}
