/**
 * Ce que le BALAYAGE par fichier coupe, sur un vrai projet.
 *
 *   npx vite-node scripts/verify-sweep-removals.ts <racine>
 *
 * Ce detecteur portait sa propre copie de l'etendue de suppression, restee au
 * niveau d'avant 1.42.233 pendant que l'originale grandissait. Il n'avait
 * aucun temoin ; les quatre autres n'en couvrent pas une seule coupe.
 *
 *   ligne     une SUPPRESSION porte sur des lignes entieres
 *   nom       la coupe contient le nom de la declaration
 *   bornes    la coupe tient dans le texte
 *   solde     les accolades restent equilibrees
 *   brute     la coupe ne scinde pas une chaine brute
 *   orphelin  le reste ne porte pas de ligne plus rentree que la declaration
 *   croise    deux coupes d'un meme fichier ne se recouvrent pas
 */
import * as fs from 'fs';
import * as path from 'path';
import { sweepFile, planFileEdits } from '../src/providers/DeadCodeSweep';
import { sanitizeForUsageScan } from '../src/util/kotlinScan';
import { coupeBienFormee } from './invariants';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(d: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const f = path.join(d, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f, hit); }
    else if (/\.(kt|java)$/.test(x.name)) hit(f);
  }
}

const solde = (t: string): string => {
  const p = sanitizeForUsageScan(t);
  let c = 0, r = 0, b = 0;
  for (const ch of p) {
    if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '(') r++; else if (ch === ')') r--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return `${c}/${r}/${b}`;
};
const marqueurs = (t: string): number => {
  let n = 0;
  for (let i = 0; i + 2 < t.length; i++) if (t[i] === '"' && t[i + 1] === '"' && t[i + 2] === '"') { n++; i += 2; }
  return n;
};
const rentree = (l: string): number => {
  let n = 0;
  for (const c of l) { if (c === ' ') n++; else if (c === '\t') n = n - (n % 4) + 4; else break; }
  return n;
};
const aSauter = (l: string): boolean => {
  const t = l.trim();
  return t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};

function main(): void {
  const root = process.argv[2];
  const fichiers: string[] = [];
  walk(root, f => fichiers.push(f));
  const compte = { ligne: 0, nom: 0, bornes: 0, solde: 0, brute: 0, orphelin: 0, croise: 0 };
  const fautes: string[] = [];
  let trouvailles = 0, coupes = 0;

  for (const f of fichiers) {
    let texte: string;
    try { texte = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const findings = sweepFile(texte, f.endsWith('.java') ? 'java' : 'kotlin');
    trouvailles += findings.length;
    const plan = planFileEdits(findings);
    if (plan.length === 0) continue;

    const rel = path.relative(root, f);
    const parNom = new Map(findings.flatMap(x => x.edits.map(e => [`${e.start}:${e.end}`, x.name])));
    const parDetecteur = new Map(findings.flatMap(x => x.edits.map(e => [`${e.start}:${e.end}`, x.detector])));
    const triees = [...plan].sort((a, b) => a.start - b.start);
    let finPrec = -1;
    for (const e of triees) {
      coupes++;
      if (e.start < 0 || e.end > texte.length || e.end <= e.start) {
        compte.bornes++;
        if (fautes.length < 10) fautes.push(`BORNES ${rel} ${e.start}..${e.end}`);
        continue;
      }
      const coupe = texte.slice(e.start, e.end);
      const nom = parNom.get(`${e.start}:${e.end}`);

      // Une SUPPRESSION porte sur des lignes entieres. Sans cet invariant, le
      // temoin etait aveugle a un decalage d'UN caractere : le nom reste dans
      // la coupe, les accolades restent equilibrees, l'indentation ne bouge
      // pas, et les six autres compteurs annoncent zero pendant que le premier
      // caractere de la declaration reste sur place. Les quatre autres temoins
      // portent cette regle depuis le debut ; celui-ci ne l'avait pas parce
      // que le balayage fait AUSSI des remplacements en milieu de ligne, et
      // l'exception avait ete prise pour une dispense.
      // Une regle de FORME, pas une liste de familles : voir `invariants.ts`
      // pour les deux versions fausses qui ont precede celle-ci.
      if (!coupeBienFormee(texte, e.start, e.end, e.text)) {
        compte.ligne++;
        if (fautes.length < 10) fautes.push(`LIGNE ${rel} ${nom ?? ''} ${JSON.stringify(coupe.slice(0, 40))}`);
      }
      if (nom && !coupe.includes(nom)) {
        compte.nom++;
        if (fautes.length < 10) fautes.push(`NOM ${rel} ${nom} absent de sa coupe`);
      }
      if (e.start < finPrec) {
        compte.croise++;
        if (fautes.length < 10) fautes.push(`CROISE ${rel} ${e.start}..${e.end} apres ${finPrec}`);
      }
      finPrec = Math.max(finPrec, e.end);
      if (marqueurs(coupe) % 2 === 1) {
        compte.brute++;
        if (fautes.length < 10) fautes.push(`BRUTE ${rel} ${nom ?? ''} la coupe scinde une chaine brute`);
      }
      const apres = texte.slice(0, e.start) + e.text + texte.slice(e.end);
      if (solde(texte) !== solde(apres)) {
        compte.solde++;
        if (fautes.length < 10) fautes.push(`SOLDE ${rel} ${nom ?? ''} ${solde(texte)} -> ${solde(apres)}`);
      }
      // Uniquement sur une SUPPRESSION de lignes entieres. Le balayage fait
      // aussi des remplacements en milieu de ligne, `{ footerIcon ->` devenant
      // `{ _ ->`, l'idiome Kotlin pour un parametre de lambda inutilise : y
      // raisonner en lignes fait crier sur une edition parfaitement juste.
      const suppressionDeLignes = e.text === ''
        && (e.start === 0 || texte[e.start - 1] === '\n')
        && (e.end === texte.length || texte[e.end - 1] === '\n' || texte[e.end] === '\n');
      const premiere = suppressionDeLignes
        ? coupe.split('\n').find(l => !aSauter(l) && !l.trim().startsWith('@'))
        : undefined;
      const suivante = texte.slice(e.end).split('\n').find(l => !aSauter(l));
      if (premiere !== undefined && suivante !== undefined && rentree(suivante) > rentree(premiere)) {
        compte.orphelin++;
        if (fautes.length < 10) fautes.push(`ORPHELIN ${rel} ${nom ?? ''} laisse ${JSON.stringify(suivante.slice(0, 50))}`);
      }
    }
  }

  console.log(JSON.stringify({ fichiers: fichiers.length, trouvailles, coupes, ...compte }));
  for (const x of fautes) console.log('  ' + x);
}

main();
