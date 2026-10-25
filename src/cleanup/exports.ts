import type { Lot, Plan, CoupeDuLot, Cause, Mention } from './planner';
import { estAsset, estCascade, nomDe, IDENTIFIANT_RE, SANS_VERIFICATION } from './planner';
import { baseDe } from './cles';
import { plural } from '../util/plural';

/**
 * What the cleanup plan writes.
 *
 * One file per batch: its first line is the commit title, the block after it
 * the commit body, one proof line per cut in the words the detector can
 * stand behind. Then "Verify it yourself", one command per cut with the count
 * a reviewer should see, and the channels the pass read. `plan.md` is the
 * overview, `plan.json` the same facts as data for other tools.
 *
 * English only: the repository is public and so are its artifacts. Whoever
 * pastes a body into a PR translates it there.
 */

export interface SimulationResume {
  rondes: number;
  complete: boolean;
  ecartes: readonly string[];
  canaux: readonly string[];
  nonJuges: readonly string[];
}

export interface Entrees {
  plan: Plan;
  simulation: SimulationResume;
  racine: string;
  head?: string;
  branch?: string;
  generatedAt: Date;
  settings?: Record<string, unknown>;
}

const EXTRAIT_MAX = 600;

const FAMILLE_LABEL: Record<string, string> = {
  cles: 'resource key', remoteconfig: 'Remote Config key', alias: 'catalog alias', evenements: 'post',
  fichiers: 'file', vides: 'file', ressources: 'resource file', baseline: 'baseline entry', entrees: 'enum entry',
  contrats: 'interface method', implementations: 'implementation', parametres: 'constructor parameter',
  arguments: 'argument', injections: 'injection declaration', imports: 'import', enums: 'enum',
};
const DECL_RE = /\b(enum class|data class|sealed class|annotation class|value class|class|interface|object|fun|const val|val|var|typealias|enum)\b/;

export function relatif(path: string, racine: string): string {
  const prefixe = `${racine}/`;
  return path.startsWith(prefixe) ? path.slice(prefixe.length) : path;
}

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;
const estFichier = (c: CoupeDuLot) => c.famille === 'fichiers' || c.famille === 'vides' || c.famille === 'ressources';
const estDeclaration = (c: CoupeDuLot) => !estCascade(c) && !estFichier(c);

/** `class Screen`, `import a.b.C`, `resource key kiosk_title`: what the line names. */
export function etiquette(c: CoupeDuLot): string {
  const premiere = c.extrait.split('\n').find(l => l.trim() !== '')?.trim() ?? '';
  if (c.famille === 'balayage' || c.famille === 'imports') return premiere.replace(/;$/, '');
  const nom = nomDe(c);
  if (c.famille === 'symboles' || c.famille === 'membres' || c.famille === 'ilots') {
    const m = DECL_RE.exec(premiere);
    return `${m ? m[1] : 'declaration'} ${nom}`;
  }
  const label = FAMILLE_LABEL[c.famille];
  return label ? `${label} ${nom}` : `${c.famille} ${nom}`;
}

function cause(c: Cause | undefined): string {
  if (!c) return '';
  if (c.kind === 'orphan') return `; orphaned by ${c.label}${c.date ? `, ${c.date}` : ''}`;
  if (c.kind === 'born') return `; born in ${c.label}${c.truncated ? ' (the history starts there)' : ''}, never referenced since`;
  return '';
}

/** The lot's cascade cuts that follow `nom`, for "takes the import in X:n". */
function suiveurs(lot: Lot, nom: string): CoupeDuLot[] {
  return lot.coupes.filter(k => estCascade(k) && k.preuve?.suit === nom);
}

function emporte(lot: Lot, c: CoupeDuLot, racine: string): string {
  const nom = nomDe(c);
  const parts = suiveurs(lot, nom).map(k => {
    const quoi = k.famille === 'injections' ? 'the injection declaration' : k.famille === 'arguments' ? 'the argument' : 'the import';
    return `${quoi} in ${base(k.path)}:${k.line + 1}`;
  });
  if (parts.length === 0 && c.preuve?.emporte?.length) {
    for (const e of c.preuve.emporte) parts.push(`lines in ${relatif(e.path, racine)}:${e.line + 1}`);
  }
  return parts.length > 0 ? `; takes ${parts.join(', ')}` : '';
}

function lotsDe(plan: Plan): Map<string, Lot> {
  const m = new Map<string, Lot>();
  for (const lot of plan.lots) for (const k of lot.coupes) m.set(k.cle, lot);
  return m;
}

const numero = (lot: Lot) => String(lot.id).padStart(2, '0');

function declencheurs(c: CoupeDuLot, plan: Plan, parCle: Map<string, CoupeDuLot>, lots: Map<string, Lot>): string {
  if (c.declencheurs.length === 0) return c.round > 1 ? '; dead since an earlier round, no earlier cut names it' : '';
  const noms = [...new Set(c.declencheurs.map(d => parCle.get(d)).filter((d): d is CoupeDuLot => !!d).map(d => nomDe(d)).filter(Boolean))];
  const numeros = [...new Set(c.declencheurs.map(d => lots.get(d)).filter((l): l is Lot => !!l).map(numero))].sort();
  return `; dead once ${noms.join(', ')} ${noms.length === 1 ? 'goes' : 'go'} (batch ${numeros.join(', ')})`;
}

/** One line, in the detector's own terms. */
export function preuveDe(c: CoupeDuLot, lot: Lot, e: Entrees, parCle: Map<string, CoupeDuLot>, lots: Map<string, Lot>): string {
  const p = c.preuve;
  const tests = p?.mentions?.tests ?? 0;
  const suffixe = declencheurs(c, e.plan, parCle, lots) + cause(c.cause);
  switch (c.famille) {
    case 'cles': return `resource key read nowhere; ${plural(p?.variantes ?? 1, 'declaration')}, one per variant${suffixe}`;
    case 'remoteconfig': return `Remote Config key read nowhere; declared in ${plural(p?.variantes ?? 1, 'variant')}${suffixe}`;
    case 'alias': return p?.verdict === 'cascade' ? `version left with no alias once ${p.suit} goes` : `catalog alias no build file references${suffixe}`;
    case 'evenements': return `posted and never listened to${suffixe}`;
    case 'contrats': return `interface method nobody calls, declaration and overrides together${suffixe}`;
    case 'implementations': return `interface implemented for nothing: clause, empty overrides and registration go together${suffixe}`;
    case 'parametres': return `constructor parameter nothing reads; its arguments go with it${suffixe}`;
    case 'baseline': return 'baseline entry for a file that no longer exists';
    case 'fichiers': return c.contenait?.length ? `declares nothing once ${c.contenait.join(', ')} ${c.contenait.length === 1 ? 'goes' : 'go'}` : 'declares nothing once its last declaration goes';
    case 'vides': return 'declares nothing';
    case 'ressources': return `no file names this resource${suffixe}`;
    case 'ilots': return `kept alive only by ${(p?.gardePar ?? []).join(', ') || 'the other members'}, removed with it${tests ? `; tests mention it ${plural(tests, 'time')}` : ''}${suffixe}`;
  }
  if (p?.verdict === 'cascade') {
    // An orphaned import follows the cuts of its own file that used the name,
    // not the imported class, which stays where it is.
    if (c.famille === 'imports') {
      const re = p.suit ? new RegExp(`\\b${p.suit.replace(/\$/g, '\\$')}\\b`) : undefined;
      const usagers = lot.coupes.filter(k => k.path === c.path && !estCascade(k) && !estFichier(k) && (!re || re.test(k.extrait))).map(nomDe).filter(Boolean);
      const noms = [...new Set(usagers)];
      return noms.length > 0 ? `left with no user once ${noms.join(', ')} ${noms.length === 1 ? 'goes' : 'go'}` : 'left with no user once the cuts in this file go';
    }
    return p.suit ? `left with no user once ${p.suit} goes` : 'left with no user';
  }
  if (p?.verdict === 'write-only') return `assigned and never read${suffixe}`;
  if (p?.verdict === 'emptied') return `left with nothing once its entries go${suffixe}`;
  let ligne = `0 references outside its declaration${tests ? `; tests mention it ${plural(tests, 'time')}` : ''}`;
  if (p?.via === 'injection') ligne += '; named only by members injection declarations, removed with it';
  if (p?.via === 'visibility') ligne += '; the mentions elsewhere belong to a homonym this file cannot see';
  return ligne + emporte(lot, c, e.racine) + suffixe;
}

/** What one foreign mention means, in the words after the file name. */
function sens(m: Mention, nom: string, lot: Lot, lots: Map<string, Lot>, parCle: Map<string, CoupeDuLot>): string {
  switch (m.kind) {
    case 'cut': {
      const l = m.cle ? lots.get(m.cle) : undefined;
      const d = m.cle ? parCle.get(m.cle) : undefined;
      const quoi = !d ? 'a cut'
        : estCascade(d) ? 'an import'
          : d.famille === 'baseline' ? 'a baseline entry'
            : d.famille === 'evenements' ? 'another post'
              : nomDe(d) === nom ? 'declared there'
                : `inside ${nomDe(d)}`;
      return `(${quoi}, ${!l || l === lot ? 'this batch' : `batch ${numero(l)}`})`;
    }
    case 'comment-only': return '(comment or string only)';
    case 'homonym': return m.module ? `(another ${nom}, in ${m.module})` : `(another ${nom})`;
    case 'declared': return '(declared there)';
    case 'baseline': return '(a baseline entry)';
    case 'excluded': return '(never compiled)';
    case 'other-class': return "(another class's member)";
    default: return '(NOT COUNTED, check it)';
  }
}

/** A key is searched qualified: its bare word is anyone's. */
function commande(c: CoupeDuLot, nom: string): string {
  if (c.famille !== 'cles') return `rg -w ${nom}`;
  const [kind, ...reste] = c.quoi.split('/');
  return `rg "(R2?\\.|@\\+?)${kind}[./]${reste.join('/')}\\b"`;
}

/** A key's own file is a declaration the command will not list; its variants are counted apart. */
function declarations(c: CoupeDuLot, lot: Lot, lots: Map<string, Lot>, parCle: Map<string, CoupeDuLot>): string {
  if (c.famille !== 'cles') return '';
  const variantes = [...parCle.values()].filter(k => k.famille === 'cles' && k.quoi === c.quoi);
  const ailleurs = [...new Set(variantes.map(k => lots.get(k.cle)).filter((l): l is Lot => !!l && l !== lot).map(numero))].sort();
  return `; declared in ${plural(variantes.length, 'file')}, ${ailleurs.length ? `batches ${ailleurs.join(', ')} too` : 'all in this batch'}`;
}

/**
 * The count a reviewer's command will show at HEAD, file by file, from the
 * simulation's own index. "Source files": `rg` also lists the notes and data
 * files of a repository, which the pass never reads.
 */
function verificationMesuree(c: CoupeDuLot, nom: string, mentions: readonly Mention[], lot: Lot, lots: Map<string, Lot>, parCle: Map<string, CoupeDuLot>): string {
  const cmd = commande(c, nom);
  // A key's values file and a resource file never contain their own name.
  const propre = c.famille !== 'cles' && c.famille !== 'ressources';
  const total = plural(mentions.length + (propre ? 1 : 0), 'source file');
  const suffixe = declarations(c, lot, lots, parCle) + (c.famille === 'ressources' ? '; the file itself is the declaration' : '');
  if (mentions.length === 0) return `${cmd}  → ${propre ? '1 source file, this one' : '0 source files'}${suffixe}`;
  const etiquettes = mentions.map(m => sens(m, nom, lot, lots, parCle));
  if (etiquettes.every(e => e.endsWith(', this batch)'))) return `${cmd}  → ${total}, all in this batch${suffixe}`;
  const groupes = new Map<string, string[]>();
  mentions.forEach((m, i) => groupes.set(etiquettes[i], [...(groupes.get(etiquettes[i]) ?? []), base(m.path)]));
  const parts = [...groupes].map(([e, fichiers]) => (fichiers.length > 3 || new Set(fichiers).size < fichiers.length
    ? `${plural(fichiers.length, 'file')} ${e}`
    : fichiers.map(f => `${f} ${e}`).join(', ')));
  return `${cmd}  → ${total}: ${propre ? 'this one, ' : ''}${parts.join(', ')}${suffixe}`;
}

function verification(c: CoupeDuLot, lot: Lot, lots: Map<string, Lot>, parCle: Map<string, CoupeDuLot>): string | undefined {
  // A local, a parameter or a sweep finding was judged inside its file: no
  // workspace wide count can be promised for its name.
  if (estCascade(c) || SANS_VERIFICATION.has(c.famille)) return undefined;
  const nom = nomDe(c);
  if (!IDENTIFIANT_RE.test(nom)) return undefined;
  if (c.mentions) return verificationMesuree(c, nom, c.mentions, lot, lots, parCle);
  // Without an index (an older plan), the detector's own terms, no count it cannot stand behind.
  if (c.preuve?.homonyme) {
    return `rg -w ${nom}  → another declaration of this name exists in the workspace; this one is imported nowhere, check the import instead: rg "import .*\\.${nom}$"`;
  }
  if (c.preuve?.via === 'visibility') {
    return `rg -w ${nom}  → more than 1 file: the other mentions resolve to a homonym in another package, and nothing imports this one`;
  }
  // A member's name is shared with other classes' members; only its own calls were counted.
  if (c.famille === 'membres' || c.famille === 'ilots') return `rg -w ${nom}  → every hit outside ${base(c.path)} belongs to another class`;
  if (c.famille === 'ressources') return `rg -w ${nom}  → 0 references expected: the file name is its only mention`;
  if (c.famille === 'cles' || c.famille === 'remoteconfig') {
    return `rg -w ${nom}  → ${plural(c.preuve?.variantes ?? 1, 'file')}, the declarations, all in this batch`;
  }
  const fichiers = new Set<string>([c.path, ...suiveurs(lot, nom).map(k => k.path), ...(c.preuve?.emporte ?? []).map(x => x.path)]);
  return `rg -w ${nom}  → ${plural(fichiers.size, 'file')}, all in this batch`;
}

/** The commit title: what the batch removes, where, how much. */
export function titre(lot: Lot): string {
  const declarations = lot.coupes.filter(c => estDeclaration(c) && c.famille !== 'balayage').length;
  const locaux = lot.coupes.filter(c => c.famille === 'balayage' && !estCascade(c)).length;
  const imports = lot.coupes.filter(c => estCascade(c) && (c.famille === 'imports' || c.famille === 'balayage')).length;
  const vides = lot.coupes.filter(c => c.famille === 'vides' || (c.famille === 'fichiers' && !c.contenait?.length)).length;
  const ressources = lot.coupes.filter(c => c.famille === 'ressources' && !estAsset(c)).length;
  const parts = [
    declarations > 0 ? plural(declarations, 'declaration') : '',
    locaux > 0 ? plural(locaux, 'local or import', 'locals and imports') : '',
    imports > 0 ? plural(imports, 'orphaned import') : '',
    vides > 0 ? plural(vides, 'empty file') : '',
    ressources > 0 ? plural(ressources, 'resource file') : '',
    lot.assets > 0 ? plural(lot.assets, 'asset file') : '',
  ].filter(Boolean);
  // A batch made only of whole files says so once: "2 asset files in 2 files" said it twice.
  const seulementDesFichiers = declarations + locaux + imports === 0;
  const combien = seulementDesFichiers && parts.length > 0
    ? parts.join(', ')
    : `${parts.join(', ') || plural(lot.coupes.length, 'cut')} in ${plural(lot.fichiers.length, 'file')}`;
  const modules = new Map<string, number>();
  for (const k of lot.coupes) modules.set(k.module, (modules.get(k.module) ?? 0) + 1);
  const module = [...modules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const g = lot.groupe;
  if (g.kind === 'cause' && g.cause?.kind === 'orphan') return `Remove what ${g.label} left behind in ${module}: ${combien}`;
  if (g.kind === 'cause' && g.cause?.kind === 'born' && g.cause.truncated) return `Remove dead code ${g.label} in ${module}: ${combien}`;
  if (g.kind === 'cause' && g.cause?.kind === 'born') return `Remove dead code born in ${g.label}, in ${module}: ${combien}`;
  if (g.kind === 'oversized') return `Remove one large dead component in ${g.label}: ${combien}`;
  return `Remove dead code in ${g.label}: ${combien}`;
}

export function lotMarkdown(e: Entrees, lot: Lot): string {
  const parCle = new Map<string, CoupeDuLot>();
  for (const l of e.plan.lots) for (const k of l.coupes) parCle.set(k.cle, k);
  const lots = lotsDe(e.plan);
  const out: string[] = [titre(lot), ''];
  out.push(lot.wave === 1
    ? `Wave 1: every cut below is dead in the workspace at ${e.head ?? 'HEAD'} as it stands, with no other cut applied first.`
    : 'Wave 2: each deletion names the earlier cut that removed its last user.');
  out.push('');
  let dernier = '';
  for (const c of lot.coupes) {
    if (c.path !== dernier) { if (dernier !== '') out.push(''); dernier = c.path; }
    const ligne = estFichier(c) ? '' : `:${c.line + 1}`;
    out.push(`${relatif(c.path, e.racine)}${ligne}  ${etiquette(c)}`);
    out.push(`  ${preuveDe(c, lot, e, parCle, lots)}${c.doutes.length ? ` [${c.doutes.join(', ')}]` : ''}`);
  }
  const verifs = lot.coupes.map(c => verification(c, lot, lots, parCle)).filter((v): v is string => !!v);
  if (verifs.length > 0) {
    out.push('', 'Verify it yourself', ...[...new Set(verifs)].map(v => `  ${v}`));
  }
  out.push('', `Channels read: ${e.simulation.canaux.join(', ')}.`);
  out.push(`Not judged: ${e.simulation.nonJuges.length ? e.simulation.nonJuges.join('; ') : 'nothing'}.`);
  return out.join('\n') + '\n';
}

export function planMarkdown(e: Entrees): string {
  const { plan, simulation } = e;
  const lotsParVague = (w: 1 | 2) => plan.lots.filter(l => l.wave === w).length;
  const out: string[] = ['# Dead code cleanup plan', ''];
  out.push(`Generated ${e.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} at ${e.head ?? 'HEAD'}${e.branch ? ` (${e.branch})` : ''}. `
    + `${plural(simulation.rondes, 'round')}, ${simulation.complete ? 'fixed point reached' : 'stopped before the fixed point'}.`);
  out.push(`Wave 1: ${plural(plan.vagues[1], 'cut')} in ${plural(lotsParVague(1), 'batch', 'batches')}. `
    + `Wave 2: ${plural(plan.vagues[2], 'cut')} in ${plural(lotsParVague(2), 'batch', 'batches')}.`);
  out.push(`Channels read: ${simulation.canaux.join(', ')}. Not judged: ${simulation.nonJuges.join('; ') || 'nothing'}.`);
  if (simulation.ecartes.length > 0) {
    out.push(`Files left alone, changed since the scan: ${simulation.ecartes.map(p => relatif(p, e.racine)).join(', ')}.`);
  }
  out.push('', '| # | Wave | Batch | Files | Lines | Assets | Tier | Doubts |', '|---|---|---|---|---|---|---|---|');
  for (const lot of plan.lots) {
    const doutes = lot.coupes.filter(c => c.doutes.length > 0).length;
    out.push(`| ${lot.id} | ${lot.wave} | ${lot.groupe.label} | ${lot.fichiers.length} | ${lot.lignes} | ${lot.assets} | ${lot.palier} | ${doutes} |`);
  }
  out.push('', '## Batches', '');
  for (const lot of plan.lots) out.push(`- ${lot.slug}.md: ${titre(lot)}`);
  if (plan.sansDeclencheur.length > 0) {
    out.push('', '## No trigger found (wave 2)', '', 'These cuts appear after round 1, yet no earlier cut names them. Read them before the rest of their batch.', '');
    for (const cle of plan.sansDeclencheur) {
      const [famille, path, nom] = baseDe(cle).split('\t');
      out.push(`- ${relatif(path, e.racine)}  ${famille} ${nom}`);
    }
  }
  return out.join('\n') + '\n';
}

export function planJson(e: Entrees): string {
  const { plan, simulation } = e;
  const data = {
    version: 1,
    head: e.head ?? null,
    branch: e.branch ?? null,
    generatedAt: e.generatedAt.toISOString(),
    racine: e.racine,
    settings: e.settings ?? {},
    canaux: simulation.canaux,
    nonJuges: simulation.nonJuges,
    rondes: simulation.rondes,
    complete: simulation.complete,
    ecartes: simulation.ecartes.map(p => relatif(p, e.racine)),
    vagues: plan.vagues,
    sansDeclencheur: plan.sansDeclencheur,
    batches: plan.lots.map(lot => ({
      id: lot.id,
      slug: lot.slug,
      wave: lot.wave,
      title: titre(lot),
      group: lot.groupe,
      tier: lot.palier,
      files: lot.fichiers.map(p => relatif(p, e.racine)),
      lines: lot.lignes,
      assets: lot.assets,
      cuts: lot.coupes.map(c => ({
        cle: c.cle,
        path: relatif(c.path, e.racine),
        line: c.line,
        famille: c.famille,
        quoi: c.quoi,
        nom: nomDe(c),
        round: c.round,
        triggers: c.declencheurs,
        tier: c.palier,
        doutes: c.doutes,
        lines: c.lignes,
        ...(c.preuve ? { preuve: c.preuve } : {}),
        ...(c.cause ? { cause: c.cause } : {}),
        ...(c.contenait ? { contenait: c.contenait } : {}),
        ...(c.fichierSupprime ? { fichierSupprime: true } : {}),
        ...(c.mentions ? { mentions: c.mentions.map(m => ({ ...m, path: relatif(m.path, e.racine) })) } : {}),
        extrait: c.extrait.length > EXTRAIT_MAX ? c.extrait.slice(0, EXTRAIT_MAX) : c.extrait,
        ...(c.extrait.length > EXTRAIT_MAX ? { extraitTronque: true } : {}),
      })),
    })),
  };
  return JSON.stringify(data, null, 2) + '\n';
}
