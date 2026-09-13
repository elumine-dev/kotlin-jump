/**
 * Ce que la CASCADE coupe, sur un vrai projet.
 *
 *   npx vite-node scripts/verify-cascade-imports.ts <racine>
 *
 * Les deux autres harnais jugent les coupes de declarations. Personne ne
 * jugeait la seconde passe : les imports que ces coupes orphelinent, dans des
 * fichiers que l utilisateur n a pas ouverts. Un import retire a tort ne
 * laisse aucune trace visible, il casse la compilation.
 *
 * Invariants :
 *   import   la ligne coupee EST une ligne d import
 *   ligne    la coupe porte sur des lignes entieres
 *   vivant   le nom importe n apparait plus nulle part apres TOUTES les coupes
 *   double   deux coupes du meme fichier ne se chevauchent pas
 *   solde    les accolades du fichier restent equilibrees
 *   vide     un fichier promis a la suppression ne porte plus AUCUNE
 *            declaration apres les coupes. Formule autrement que la regle de
 *            production, qui enumere ce qui a le droit de rester ; celle ci
 *            cherche ce qui n a pas le droit d etre parti.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { planCascade } from '../src/providers/removalCascade';
import { sanitizeForUsageScan } from '../src/util/kotlinScan';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(d: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const f = path.join(d, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f, hit); }
    else if (SOURCE_RE.test(x.name)) hit(f);
  }
}

/** Le nom simple qu un import apporte : `import a.b.C` -> `C`, `... as D` -> `D`. */
function nomApporte(ligne: string): string | undefined {
  const m = /^\s*import\s+([\w.`]+)(?:\s+as\s+(\w+))?/.exec(ligne);
  if (!m) return undefined;
  if (m[2]) return m[2];
  const dernier = m[1].split('.').pop();
  return dernier === '*' ? undefined : dernier;
}

function solde(t: string): string {
  const p = sanitizeForUsageScan(t);
  let c = 0, r = 0, b = 0;
  for (const ch of p) {
    if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '(') r++; else if (ch === ')') r--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return `${c}/${r}/${b}`;
}

function main(): void {
  const root = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(root, f => {
    try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ }
  });
  const parPath = new Map(sources.map(s => [s.path, s.text]));
  const base = { sources, testSourceSets: ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'] };

  const syms = findUnusedSymbols(base as any) as any[];
  const membres = findUnusedMembers({
    ...base,
    deadDeclarations: syms.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  } as any) as any[];

  // Les coupes par fichier, comme un fournisseur les grouperait.
  const coupesParPath = new Map<string, { start: number; end: number }[]>();
  for (const f of [...syms, ...membres]) {
    if (f.removeStart < 0 || f.removeEnd <= f.removeStart) continue;
    const l = coupesParPath.get(f.path) ?? [];
    l.push({ start: f.removeStart, end: f.removeEnd });
    coupesParPath.set(f.path, l);
  }
  // Regle du fournisseur : les etendues qui se chevauchent, la premiere gagne.
  for (const [p, l] of coupesParPath) {
    l.sort((a, b) => a.start - b.start);
    const gardees: { start: number; end: number }[] = [];
    let finPrecedente = -1;
    for (const r of l) { if (r.start < finPrecedente) continue; finPrecedente = r.end; gardees.push(r); }
    coupesParPath.set(p, gardees);
  }

  const plan = planCascade(coupesParPath, parPath);
  const compte = { import: 0, ligne: 0, vivant: 0, double: 0, solde: 0, vide: 0 };
  const fautes: string[] = [];
  let coupes = 0;

  for (const [p, extents] of plan.imports) {
    const texte = parPath.get(p);
    if (texte === undefined) { fautes.push(`texte introuvable ${p}`); continue; }

    const triees = [...extents].sort((a, b) => a.start - b.start);
    let finPrec = -1;
    for (const e of triees) {
      if (e.start < finPrec) {
        compte.double++;
        if (fautes.length < 12) fautes.push(`DOUBLE ${p} ${e.start}..${e.end} chevauche la precedente`);
      }
      finPrec = e.end;
    }

    // Toutes les coupes du fichier : declarations PUIS imports orphelins.
    const toutes = [...(coupesParPath.get(p) ?? []), ...extents].sort((a, b) => b.start - a.start);
    let reste = texte;
    for (const c of toutes) reste = reste.slice(0, c.start) + reste.slice(c.end);

    for (const e of extents) {
      coupes++;
      const coupe = texte.slice(e.start, e.end);
      if (!/^\s*import\s/.test(coupe)) {
        compte.import++;
        if (fautes.length < 12) fautes.push(`IMPORT ${p} la coupe n est pas un import : ${JSON.stringify(coupe.slice(0, 60))}`);
        continue;
      }
      const debutLigne = e.start === 0 || texte[e.start - 1] === '\n';
      const finLigne = e.end === texte.length || texte[e.end - 1] === '\n';
      if (!debutLigne || !finLigne) {
        compte.ligne++;
        if (fautes.length < 12) fautes.push(`LIGNE ${p} debut=${debutLigne} fin=${finLigne} ${JSON.stringify(coupe)}`);
      }
      const nom = nomApporte(coupe);
      if (nom === undefined) continue;
      // Le nom ne doit plus apparaitre nulle part dans le reste, imports exclus.
      const sansImports = sanitizeForUsageScan(reste)
        .split('\n').filter(l => !/^\s*import\s/.test(l)).join('\n');
      const vu = new RegExp(`(?<![\\w.])${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`).test(sansImports);
      if (vu) {
        compte.vivant++;
        if (fautes.length < 12) fautes.push(`VIVANT ${p} l import de ${nom} est coupe mais ${nom} est encore mentionne`);
      }
    }

    if (solde(texte) !== solde(reste)) {
      compte.solde++;
      if (fautes.length < 12) fautes.push(`SOLDE ${p} ${solde(texte)} -> ${solde(reste)}`);
    }
  }

  // La moitie SUPPRESSION de la cascade : 54 fichiers sur lapresse, et rien ne
  // la regardait. Un fichier efface a tort ne laisse pas non plus de trace.
  const DECL_RE = /(?:^|[;{])\s*(?:(?:public|private|internal|protected|open|abstract|final|sealed|data|enum|annotation|value|inline|suspend|external|expect|actual|operator|infix|lateinit|const|override|companion|static|synchronized)\s+)*(?:val|var|fun|class|object|interface|typealias|record)\s+[A-Za-z_`]/;
  for (const p of plan.deleteFiles) {
    const texte = parPath.get(p);
    if (texte === undefined) { fautes.push(`texte introuvable ${p}`); continue; }
    const toutes = [...(coupesParPath.get(p) ?? [])].sort((a, b) => b.start - a.start);
    let reste = texte;
    for (const c of toutes) reste = reste.slice(0, c.start) + reste.slice(c.end);
    const sansImports = sanitizeForUsageScan(reste)
      .split('\n').filter(l => !/^\s*(?:import|package|@file:)/.test(l)).join('\n');
    if (DECL_RE.test(sansImports)) {
      compte.vide++;
      if (fautes.length < 12) {
        const ligne = sansImports.split('\n').find(l => DECL_RE.test(l)) ?? '';
        fautes.push(`VIDE ${p} promis a la suppression mais porte encore ${JSON.stringify(ligne.trim().slice(0, 60))}`);
      }
    }
  }

  console.log(JSON.stringify({
    sources: sources.length, fichiers: plan.imports.size, coupes,
    fichiersSupprimes: plan.deleteFiles.size, ...compte,
  }));
  for (const f of fautes) console.log('  ' + f);
}

main();
