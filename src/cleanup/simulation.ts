import type { AndroidApi } from '../util/androidApi';
import type { FileResEntry } from '../indexer/FileResourceIndex';
import type { UnusedSettings } from '../util/unusedSettings';
import type { Preuve } from './preuve';
import { collecterUnePasse, coupesRetenues, sansTrouDeLignesVides, Coupe } from '../commands/RemoveEverythingUnused';
import { planCascade } from '../providers/removalCascade';
import { sanitizeForUsageScan, sanitizeJavaForUsageScan } from '../util/kotlinScan';
import { collectValueResourceRefs, normalizeResourceName, stripXmlComments } from '../util/xmlRefs';
import { cleDImportOrphelin, cleDeBase, estUnFichierVide, nomImporte, normalise } from './cles';
import { estCascade, nomDe, nomIndexe, IDENTIFIANT_RE, SANS_VERIFICATION } from './planner';

/**
 * The fixed point of Remove Everything Unused, simulated in memory.
 *
 * The command applies a round, re-reads the disk, and goes again until a
 * round finds nothing. A cleanup plan needs the same sequence without writing
 * anything: every cut gets the round it appears in, and a round 2 cut is one
 * that only exists once round 1 is applied. That is the line between wave 1,
 * zero references today, and wave 2, dead once the first batch is merged.
 *
 * Each round runs `collecterUnePasse` on the texts the previous round left,
 * plans the same cascade, and applies both to the in memory copy. Offsets
 * never leave this module: a cut travels under a stable key.
 */

export interface Source { path: string; text: string }

export interface CorpusSimule {
  sources: readonly Source[];
  assets?: readonly Source[];
  modulesWithCode?: readonly string[];
  libraryModules?: readonly string[];
  moduleDirs?: readonly string[];
  resourceEntries?: readonly FileResEntry[];
}

export interface ExtrasDePasse {
  androidApi?: AndroidApi;
  reglages?: Partial<UnusedSettings>;
}

export interface OptionsDeSimulation {
  /** The command's own ceiling is 16. */
  maxRondes?: number;
  /** Read before every round; a cancelled simulation keeps what it has. */
  estAnnule?: () => boolean;
  surRonde?: (ronde: number) => void;
}

export interface CoupePlanifiee {
  /** `famille \t path \t name`, with `#n` on a repeat. Never an offset. */
  cle: string;
  round: number;
  path: string;
  /** 0-based, in the text as it stands on disk when the line is still there. */
  line: number;
  famille: string;
  quoi: string;
  /** The whole text the cut removes; a deleted file carries its whole text. */
  extrait: string;
  /** What a rewrite puts back; empty for a deletion. */
  texte: string;
  preuve?: Preuve;
  /** For a file cut: the names of the cuts the file held, which go with it. */
  contenait?: string[];
  /**
   * The cut's file goes whole in the same round. The cut is kept for its
   * proof, which the file's own cut cannot carry; the file is what the edit
   * deletes and what a count of the edit sees.
   */
  fichierSupprime?: boolean;
}

/**
 * Which files name each cut in the texts as they stood before any round: what
 * a reviewer's `rg -w` will show at HEAD. The detectors count on a copy with
 * comments and strings blanked, and they ignore some files; the proof must
 * account for every file the reviewer will see, or the first wrong count
 * costs the whole plan its credit.
 */
export interface IndexDesMentions {
  /** Files whose raw text holds the name as a whole word. */
  brut: Map<string, Set<string>>;
  /** The same, with comments and string contents blanked, the way the detectors read. */
  code: Map<string, Set<string>>;
  /** Files that declare the name. */
  declare: Map<string, Set<string>>;
  /** Files in a source set no Gradle task compiles: their mentions keep nothing alive. */
  exclus: Set<string>;
  /** Every name the index looked for: a name here with no file is a name nothing mentions. */
  noms?: Set<string>;
}

export interface Simulation {
  coupes: CoupePlanifiee[];
  /** Rounds that applied something. */
  rondes: number;
  /** A round found nothing: the fixed point was reached. */
  complete: boolean;
  /** Files left alone because an open document no longer matched the text read. */
  ecartes: string[];
  /** What the pass read, for the proof's "channels read" line. */
  canaux: string[];
  /** What no family judged, said rather than implied. */
  nonJuges: string[];
  mentions?: IndexDesMentions;
}

const RONDES_MAX = 16;
const TOKEN_RE = /[A-Za-z_$][\w$]*/g;

function sansCommentairesNiChaines(path: string, text: string): string {
  if (/\.kt$/.test(path)) return sanitizeForUsageScan(text);
  if (/\.java$/.test(path)) return sanitizeJavaForUsageScan(text);
  if (/\.xml$/.test(path)) return stripXmlComments(text);
  return text;
}

/** `R.string.x` in code, `@string/x` or `@+id/x` in XML, read raw: what `rg` will show, comments included. */
const REF_CODE_BRUTE_RE = /\bR2?\.([a-z]+)\.([A-Za-z_]\w*)/g;
const REF_XML_BRUTE_RE = /@\+?([a-z]+)\/([A-Za-z_][\w.]*)/g;
const VALUES_PATH_RE = /[\\/]res[\\/]values[^\\/]*[\\/][^\\/]+\.xml$/;
const REMOTE_CONFIG_PATH_RE = /remote_config_defaults\.xml$/;
const TAG_KIND: Record<string, string> = {
  string: 'string', color: 'color', dimen: 'dimen', style: 'style', attr: 'attr', integer: 'integer', bool: 'bool',
  array: 'array', 'string-array': 'array', 'integer-array': 'array', plurals: 'plurals',
};

/** `kind/name` for every value declared in a values file: `<string name="x">`, `<item name="x" type="id">`. */
function clesDeclarees(xml: string): string[] {
  const out: string[] = [];
  for (const m of stripXmlComments(xml).matchAll(/<([a-z-]+)\b([^>]*)>/g)) {
    const name = /\bname="([^"]+)"/.exec(m[2])?.[1];
    if (!name) continue;
    const kind = m[1] === 'item' ? /\btype="([^"]+)"/.exec(m[2])?.[1] : TAG_KIND[m[1]];
    if (kind) out.push(`${kind}/${normalizeResourceName(name)}`);
  }
  return out;
}

export function indexerLesMentions(sources: readonly Source[], coupes: readonly CoupePlanifiee[], exclus: ReadonlySet<string>): IndexDesMentions {
  // Bare identifiers for most families; `kind/name` for resource keys, whose
  // bare word (`delete`, `suspend`, `resume` on the reference) is everywhere.
  const mots = new Set<string>();
  const cles = new Set<string>();
  for (const c of coupes) {
    if (estCascade(c) || SANS_VERIFICATION.has(c.famille)) continue;
    if (!IDENTIFIANT_RE.test(nomDe(c))) continue;
    (c.famille === 'cles' ? cles : mots).add(nomIndexe(c));
  }
  const kinds = [...new Set([...cles].map(k => k.split('/')[0]))];
  const brut = new Map<string, Set<string>>(), code = new Map<string, Set<string>>(), declare = new Map<string, Set<string>>();
  const note = (m: Map<string, Set<string>>, nom: string, path: string) => {
    let s = m.get(nom);
    if (!s) m.set(nom, s = new Set());
    s.add(path);
  };
  const cleDe = (kind: string, name: string) => `${kind}/${normalizeResourceName(name)}`;
  for (const s of sources) {
    let touche = false;
    for (const m of s.text.matchAll(TOKEN_RE)) if (mots.has(m[0])) { note(brut, m[0], s.path); touche = true; }
    if (cles.size > 0) {
      for (const re of [REF_CODE_BRUTE_RE, REF_XML_BRUTE_RE]) {
        for (const m of s.text.matchAll(re)) { const k = cleDe(m[1], m[2]); if (cles.has(k)) { note(brut, k, s.path); touche = true; } }
      }
    }
    const estValues = VALUES_PATH_RE.test(s.path);
    if (estValues && cles.size > 0) for (const k of clesDeclarees(s.text)) if (cles.has(k)) note(declare, k, s.path);
    if (REMOTE_CONFIG_PATH_RE.test(s.path)) for (const m of s.text.matchAll(/<key>\s*([\w.]+)\s*<\/key>/g)) if (mots.has(m[1])) note(declare, m[1], s.path);
    if (!touche) continue;
    for (const m of sansCommentairesNiChaines(s.path, s.text).matchAll(TOKEN_RE)) if (mots.has(m[0])) note(code, m[0], s.path);
    if (cles.size > 0) {
      for (const r of collectValueResourceRefs(s.text, s.path, kinds)) { const k = cleDe(r.kind, r.name); if (cles.has(k)) note(code, k, s.path); }
    }
    if (/\.(kt|java)$/.test(s.path)) for (const m of s.text.matchAll(DECLARATION_RE)) if (mots.has(m[1])) note(declare, m[1], s.path);
  }
  return { brut, code, declare, exclus: new Set(exclus), noms: new Set([...mots, ...cles]) };
}

function ligneDe(texte: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < texte.length; i++) if (texte.charCodeAt(i) === 10) n++;
  return n;
}

/**
 * How many times each name is declared across the corpus. A dead top level
 * declaration whose name is declared elsewhere too is a homonym: the reviewer
 * who greps the name will find the other one, and the proof must say so.
 */
const DECLARATION_RE = /\b(?:class|interface|object|enum|record|typealias|fun|val|var)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/g;
function compteLesDeclarations(sources: readonly Source[]): Map<string, number> {
  const compte = new Map<string, number>();
  for (const s of sources) {
    if (!/\.(kt|java)$/.test(s.path)) continue;
    for (const m of s.text.matchAll(DECLARATION_RE)) compte.set(m[1], (compte.get(m[1]) ?? 0) + 1);
  }
  return compte;
}

function canauxDe(corpus: CorpusSimule): string[] {
  const chemins = corpus.sources.map(s => s.path);
  const un = (re: RegExp) => chemins.some(p => re.test(p));
  const canaux: string[] = [];
  if (un(/\.(kt|java)$/)) canaux.push('Kotlin and Java sources');
  if (un(/[\\/]res[\\/].*\.xml$/)) canaux.push('XML resources, layouts and binding attributes');
  if (un(/AndroidManifest\.xml$/)) canaux.push('manifests');
  if (un(/remote_config_defaults\.xml$/)) canaux.push('Remote Config defaults');
  if (un(/\.(gradle|kts|toml)$/)) canaux.push('Gradle build files and version catalogs');
  if (un(/\.pro$/)) canaux.push('ProGuard rules');
  if (un(/baseline[^\\/]*\.xml$/i)) canaux.push('detekt and lint baselines');
  if ((corpus.assets?.length ?? 0) > 0) canaux.push('assets');
  return canaux;
}

const NON_JUGES = [
  'drawable resource files: Remove Everything Unused never deletes them',
  'declarations used only by tests: Remove Code Used Only by Tests takes them, with their tests',
];

class Cles {
  private readonly vus = new Map<string, number>();
  pour(base: string): string {
    const n = (this.vus.get(base) ?? 0) + 1;
    this.vus.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  }
}

/** The line of `extrait` in the text as it stood before any round, when it is still there. */
function ligneOrigine(original: string | undefined, courant: string, start: number, extrait: string): number {
  if (original === undefined || original === courant) return ligneDe(courant, start);
  const cherche = extrait.trim();
  const i = cherche === '' ? -1 : original.indexOf(cherche);
  return i === -1 ? ligneDe(courant, start) : ligneDe(original, i);
}

function appliquer(texte: string, plages: readonly { start: number; end: number; texte: string }[]): string {
  let out = texte;
  for (const p of [...plages].sort((a, b) => b.start - a.start)) {
    if (p.start < 0 || p.end < p.start) continue;
    out = out.slice(0, p.start) + p.texte + out.slice(p.end);
  }
  return out;
}

export async function simulerLePointFixe(
  corpus: CorpusSimule,
  segs: readonly string[],
  extras: ExtrasDePasse = {},
  options: OptionsDeSimulation = {},
): Promise<Simulation> {
  const max = options.maxRondes ?? RONDES_MAX;
  const originaux = new Map(corpus.sources.map(s => [s.path, s.text]));
  let sources: Source[] = [...corpus.sources];
  let assets = corpus.assets === undefined ? undefined : [...corpus.assets];
  let entries = corpus.resourceEntries === undefined ? undefined : [...corpus.resourceEntries];
  const coupes: CoupePlanifiee[] = [];
  const ecartes: string[] = [];
  const exclus = new Set<string>();
  const orphelinsGradle = new Set<string>();
  const declarations = compteLesDeclarations(corpus.sources);
  const cles = new Cles();
  let rondes = 0;
  let complete = false;

  for (let ronde = 1; ronde <= max; ronde++) {
    if (options.estAnnule?.()) break;
    options.surRonde?.(ronde);
    const ctx = {
      androidApi: extras.androidApi, reglages: extras.reglages,
      modulesWithCode: corpus.modulesWithCode, libraryModules: corpus.libraryModules, moduleDirs: corpus.moduleDirs,
      assets, resourceEntries: entries,
    };
    const passe = collecterUnePasse(sources, segs, ctx);
    const textes = new Map(sources.map(s => [s.path, s.text]));
    // Round 1 keeps the command's guard against files whose open document no
    // longer matches what was read. Later rounds work on texts that exist
    // only here, so that guard would compare them with the editor and drop
    // everything: the in memory copy is the truth from then on, and a file
    // set aside once stays aside, or it would come back as a wave 2 orphan.
    let retenu: Map<string, Coupe[]> = passe.parFichier;
    if (ronde === 1) {
      for (const o of passe.orphelins) for (const f of o.files) orphelinsGradle.add(f);
      const r = coupesRetenues(passe.parFichier, textes);
      retenu = r.retenu;
      ecartes.push(...r.bouges);
      for (const p of r.bouges) exclus.add(p);
    } else if (exclus.size > 0) {
      retenu = new Map([...retenu].filter(([p]) => !exclus.has(p)));
    }
    const morts = passe.fichiersMorts;
    const combien = [...retenu.values()].reduce((n, l) => n + l.length, 0);
    if (combien === 0 && morts.size === 0) { complete = true; break; }

    const cascade = planCascade(
      new Map([...retenu].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end, replacement: c.texte === '' ? undefined : c.texte }))])),
      textes,
      morts,
    );
    const supprimes = new Set<string>([...cascade.deleteFiles, ...morts]);
    const nouveaux = new Map<string, string>();

    for (const p of new Set([...retenu.keys(), ...cascade.imports.keys()])) {
      const texte = textes.get(p);
      if (texte === undefined) continue;
      const supprime = supprimes.has(p);
      const imports = supprime ? [] : cascade.imports.get(p) ?? [];
      // A deleted file's cuts keep their raw extents: nothing grows a blank
      // line in a file that is about to go.
      const plages = supprime ? retenu.get(p) ?? [] : sansTrouDeLignesVides(texte, retenu.get(p) ?? [], imports);
      for (const c of plages) {
        const extrait = texte.slice(c.start, c.end);
        const homonyme = c.famille === 'symboles' && c.quoi !== '' && (declarations.get(c.quoi) ?? 0) > 1;
        const preuve = c.preuve ? (homonyme ? { ...c.preuve, homonyme: true } : c.preuve) : undefined;
        coupes.push({
          cle: cles.pour(cleDeBase(c, p, texte)), round: ronde, path: p,
          line: ligneOrigine(originaux.get(p), texte, c.start, extrait),
          famille: c.famille, quoi: c.quoi, extrait, texte: c.texte, ...(preuve ? { preuve } : {}),
          ...(supprime ? { fichierSupprime: true } : {}),
        });
      }
      if (supprime) continue;
      for (const e of imports) {
        const extrait = texte.slice(e.start, e.end);
        const suit = nomImporte(extrait);
        const preuve: Preuve = suit ? { verdict: 'cascade', suit } : { verdict: 'cascade' };
        coupes.push({
          cle: cles.pour(cleDImportOrphelin(p, extrait)), round: ronde, path: p,
          line: ligneOrigine(originaux.get(p), texte, e.start, extrait),
          famille: 'imports', quoi: '', extrait, texte: '', preuve,
        });
      }
      nouveaux.set(p, appliquer(texte, [...plages, ...imports.map(e => ({ start: e.start, end: e.end, texte: '' }))]));
    }

    for (const p of supprimes) {
      const texte = textes.get(p) ?? '';
      const famille = cascade.deleteFiles.has(p) ? 'fichiers' : estUnFichierVide(p) ? 'vides' : 'ressources';
      const contenait = (retenu.get(p) ?? []).map(c => c.quoi || c.preuve?.nom || normalise(texte.slice(c.start, c.end)));
      coupes.push({
        cle: cles.pour(`${famille}\t${p}\tfile`), round: ronde, path: p, line: 0, famille, quoi: '', extrait: texte, texte: '',
        preuve: { verdict: famille === 'ressources' ? 'unreferenced' : 'emptied' },
        ...(contenait.length > 0 ? { contenait } : {}),
      });
    }

    rondes = ronde;
    sources = sources.filter(s => !supprimes.has(s.path)).map(s => (nouveaux.has(s.path) ? { path: s.path, text: nouveaux.get(s.path)! } : s));
    if (assets) assets = assets.filter(a => !supprimes.has(a.path));
    if (entries) {
      entries = entries
        .map(e => ({ ...e, variants: e.variants.filter(v => !supprimes.has(v.path)) }))
        .filter(e => e.variants.length > 0);
    }
  }

  return {
    coupes, rondes, complete, ecartes, canaux: canauxDe(corpus), nonJuges: [...NON_JUGES],
    mentions: indexerLesMentions(corpus.sources, coupes, orphelinsGradle),
  };
}
