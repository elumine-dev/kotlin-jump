/**
 * Ce que KJ-047 coupe DANS LES TESTS, sur un vrai projet.
 *
 *   npx vite-node scripts/verify-test-coremoval.ts <racine>
 *
 * C'est la seule edition de l extension qui supprime des fichiers de test
 * entiers. Un fichier retire a tort n emporte pas seulement sa couverture : il
 * emporte tout ce qu il declarait pour les autres, classe de base, fixture,
 * constante partagee, et c est la compilation des tests voisins qui tombe.
 *
 * Invariants :
 *   ligne          une coupe de fonction porte des lignes entieres
 *   nom            une coupe de fonction porte le nom de cette fonction
 *   bornes         la coupe tient dans le texte
 *   chevauchement  deux coupes d un meme fichier ne se recouvrent pas
 *   solde          les accolades du fichier restent equilibrees apres coupe
 *   coquille       un fichier survivant garde au moins une fonction de test
 *   dependance     un fichier supprime ne declare rien qu un test survivant nomme
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { coupeBienFormee } from './invariants';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { findDeadIslands } from '../src/providers/deadIslands';
import { findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';
import { planTestCoRemoval, isOfferable, testFunctionsOf, productionDeclarations, liveOutside } from '../src/providers/testCoRemoval';
import { parse } from '../src/indexer/KotlinParser';
import { parseJava } from '../src/indexer/JavaParser';
import { sanitizeForUsageScan } from '../src/util/kotlinScan';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const SEGS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function walk(d: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const f = path.join(d, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f, hit); }
    else if (SOURCE_RE.test(x.name)) hit(f);
  }
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

/** Les noms declares au premier niveau d un fichier. */
function declaresDe(p: string, texte: string): string[] {
  const parsed = p.endsWith('.java') ? parseJava(p, texte) : parse(p, texte);
  return parsed.symbols.filter((s: any) => s.depth === 0).map((s: any) => s.name);
}

function main(): void {
  const root = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(root, f => {
    try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ }
  });
  const parPath = new Map(sources.map(s => [s.path, s.text]));
  const base = { sources, testSourceSets: SEGS, includeTestOnly: true };

  const symbols = findUnusedSymbols(base as any) as any[];
  const membres = findUnusedMembers({
    ...base, includeSelfOnly: false,
    deadDeclarations: symbols.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  } as any) as any[];
  const iles = findDeadIslands({ ...base, maxIslandSize: 8 } as any) as any[];
  const entrees = findUnusedEnumEntries(base as any) as any[];

  type Etendue = { path: string; start: number; end: number };
  const groupes: { label: string; names: string[]; allowed: string[]; etendues: Etendue[] }[] = [];
  for (const s of symbols) if (s.verdict === 'testOnly' && s.removeStart >= 0) groupes.push({ label: s.name, names: [s.name], allowed: [], etendues: [{ path: s.path, start: s.removeStart, end: s.removeEnd }] });
  for (const m of membres) if (m.verdict === 'testOnly' && m.removeStart >= 0) groupes.push({ label: `${m.container}.${m.name}`, names: [m.name], allowed: (m.container ?? '').split('.'), etendues: [{ path: m.path, start: m.removeStart, end: m.removeEnd }] });
  for (const e of entrees) if (e.verdict === 'testOnly' && e.removeStart >= 0) groupes.push({ label: `${e.enumName}.${e.name}`, names: [e.name], allowed: [e.enumName], etendues: [{ path: e.path, start: e.removeStart, end: e.removeEnd }] });
  for (const i of iles) if (i.verdict === 'testOnly' && i.fixable) groupes.push({ label: i.members.map((m: any) => m.name).join(' + '), names: i.members.map((m: any) => m.name), allowed: [], etendues: i.members.map((m: any) => ({ path: m.path, start: m.removeStart, end: m.removeEnd })) });

  // The command's own rule, not a copy of it: a copy drifts in silence.
  const declarations = productionDeclarations(sources, SEGS);

  const compte = { ligne: 0, nom: 0, bornes: 0, chevauchement: 0, solde: 0, coquille: 0, dependance: 0 };
  const fautes: string[] = [];
  const vus = new Set<string>();
  let plans = 0, fichiers = 0, coupes = 0;

  for (const g of groupes) {
    if (vus.has(g.label)) continue;
    vus.add(g.label);
    const plan = planTestCoRemoval(g.names, sources, SEGS, liveOutside(declarations, g.etendues), g.allowed);
    if (!isOfferable(plan)) continue;
    plans++;
    fichiers += plan.files.length;
    coupes += plan.cuts.length;

    // Les coupes, par fichier.
    const parFichier = new Map<string, { start: number; end: number; name: string; kind: string }[]>();
    for (const c of plan.cuts) {
      const l = parFichier.get(c.path) ?? [];
      l.push(c);
      parFichier.set(c.path, l);
    }

    for (const [p, cs] of parFichier) {
      const texte = parPath.get(p);
      if (texte === undefined) { fautes.push(`texte introuvable ${p}`); continue; }
      const triees = [...cs].sort((a, b) => a.start - b.start);
      let finPrec = -1;
      for (const c of triees) {
        if (c.end > texte.length || c.start < 0 || c.end <= c.start) {
          compte.bornes++;
          if (fautes.length < 12) fautes.push(`BORNES ${g.label} ${p} ${c.start}..${c.end} len=${texte.length}`);
          continue;
        }
        // Une coupe de fonction de test porte des lignes ENTIERES. Sans cet
        // invariant le temoin etait aveugle a un decalage d'un caractere : le
        // nom reste dans la coupe, les accolades restent equilibrees, et les
        // six compteurs annoncent zero pendant que le premier caractere de
        // l'annotation reste sur place. Meme omission que celle trouvee la
        // veille dans le temoin du balayage.
        // Toute coupe, quel que soit son `kind`. Nommer un seul genre ici
        // laissait la porte ouverte au genre suivant : rien ne l'aurait dit,
        // et un temoin muet se lit comme un temoin content. Aucun genre de ce
        // plan ne coupe un morceau de ligne, contrairement au balayage ou la
        // famille `locals` retire le seul prefixe d'affectation.
        if (!coupeBienFormee(texte, c.start, c.end, '')) {
          compte.ligne++;
          if (fautes.length < 12) fautes.push(`LIGNE ${g.label} ${p} ${c.name} ${c.kind}`);
        }
        if (c.kind === 'function' && !texte.slice(c.start, c.end).includes(c.name)) {
          compte.nom++;
          if (fautes.length < 12) fautes.push(`NOM ${g.label} ${p} ${c.name} absent de sa coupe`);
        }
        if (c.start < finPrec) {
          compte.chevauchement++;
          if (fautes.length < 12) fautes.push(`CHEVAUCHEMENT ${g.label} ${p} ${c.start}..${c.end} apres ${finPrec}`);
        }
        finPrec = Math.max(finPrec, c.end);
      }

      let reste = texte;
      for (const c of [...cs].sort((a, b) => b.start - a.start)) {
        if (c.start < 0 || c.end > texte.length || c.end <= c.start) continue;
        reste = reste.slice(0, c.start) + reste.slice(c.end);
      }
      if (solde(texte) !== solde(reste)) {
        compte.solde++;
        if (fautes.length < 12) fautes.push(`SOLDE ${g.label} ${p} ${solde(texte)} -> ${solde(reste)}`);
      }
      // Un fichier qu on garde doit garder un test : sinon c est une coquille,
      // et la regle dit qu il aurait du partir en entier.
      if (testFunctionsOf(p, reste).length === 0) {
        compte.coquille++;
        if (fautes.length < 12) fautes.push(`COQUILLE ${g.label} ${p} ne garde plus aucune fonction de test`);
      }
    }

    // Ce que les fichiers supprimes emportent avec eux.
    const supprimes = new Set(plan.files);
    for (const p of plan.files) {
      const texte = parPath.get(p);
      if (texte === undefined) continue;
      const noms = declaresDe(p, texte).filter(n => n.length > 2);
      if (noms.length === 0) continue;
      const re = new RegExp(`\\b(?:${noms.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);
      for (const s of sources) {
        if (s.path === p || supprimes.has(s.path)) continue;
        if (!/\.(kt|java)$/.test(s.path)) continue;
        const m = re.exec(sanitizeForUsageScan(s.text));
        if (m) {
          compte.dependance++;
          if (fautes.length < 12) fautes.push(`DEPENDANCE ${g.label} ${p} supprime, mais ${s.path} nomme encore ${m[0]}`);
          break;
        }
      }
    }
  }

  console.log(JSON.stringify({ sources: sources.length, groupes: vus.size, plans, fichiersSupprimes: fichiers, coupes, ...compte }));
  for (const f of fautes) console.log('  ' + f);
}

main();
