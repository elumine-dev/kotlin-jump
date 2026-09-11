/**
 * Every removal a quick fix offers must leave the file intact.
 *
 *   npx vite-node scripts/verify-symbol-removals.ts <project-root>
 *
 * KJ-032 cuts `[removeStart, removeEnd)` out of the file. A bound that is one
 * line off does not produce a debatable diagnostic, it DELETES live code, so
 * this applies every removal the scan offers on a real project and checks five
 * invariants. Zero is only worth reading once the probe is shown to fail on a
 * deliberately shifted bound: move `removeStart` one line up and the fifth
 * invariant reports the declarations that would be swallowed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { stripKotlinComments } from '../src/util/xmlRefs';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const IGNORE_PATHS = ['**/buildSrc/**', '**/build-logic/**'];

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP_DIRS.has(x.name)) walk(full, hit); }
    else hit(full);
  }
}

/** Solde des accolades, parentheses et crochets, hors chaines et commentaires. */
function solde(texte: string): { c: number; p: number; b: number } {
  const propre = stripKotlinComments(texte);
  let c = 0, p = 0, b = 0, dansChaine = false, dansBrute = false;
  for (let i = 0; i < propre.length; i++) {
    const ch = propre[i];
    if (dansBrute) { if (propre.startsWith('"""', i)) { dansBrute = false; i += 2; } continue; }
    if (dansChaine) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"' || ch === '\n') dansChaine = false;
      continue;
    }
    if (propre.startsWith('"""', i)) { dansBrute = true; i += 2; continue; }
    if (ch === '"') { dansChaine = true; continue; }
    if (ch === "'" ) { // litteral de caractere
      const fin = propre.indexOf("'", i + 1);
      if (fin > 0 && fin - i <= 4) { i = fin; continue; }
    }
    if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return { c, p, b };
}

/** Noms declares au premier niveau, vus par un extracteur unique. */
const DECL_RE = /^(?:(?:public|private|internal|protected|open|abstract|final|sealed|data|enum|annotation|value|inline|suspend|external|expect|actual|operator|infix|tailrec|lateinit|const|override)\s+)*(?:class|object|interface|fun|val|var|typealias)\s+[^\n=({]*?([A-Za-z_]\w*)\s*[(<:={\n]/gm;

function declares(texte: string): Set<string> {
  const out = new Set<string>();
  const propre = stripKotlinComments(texte);
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(propre)) !== null) out.add(m[1]);
  return out;
}

function main(): void {
  const root = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    const spi = /[\\/]META-INF[\\/]services[\\/]/.test(file);
    if (!SOURCE_RE.test(file) && !spi) return;
    try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* ignore */ }
  });
  const publishedModules = moduleDirs.filter(d => {
    const b = sources.find(s => s.path.startsWith(`${d}${path.sep}build.gradle`));
    return b !== undefined && /maven-publish|com\.vanniktech\.maven\.publish/.test(b.text);
  });
  const libraryModules = moduleDirs.filter(d =>
    sources.some(s => s.path.startsWith(`${d}${path.sep}build.gradle`)
      && /com\.android\.library|java-library/.test(s.text)));

  const scan = findUnusedSymbols({
    sources, testSourceSets: TEST_SOURCE_SETS, publishedModules, libraryModules, ignorePaths: IGNORE_PATHS,
  });
  const findings = (scan as any).findings ?? scan;
  const parPath = new Map(sources.map(s => [s.path, s.text]));

  let removables = 0;
  const fautes: string[] = [];
  const compte = { nom: 0, bornes: 0, solde: 0, ligne: 0, voisin: 0 };

  for (const f of findings as any[]) {
    const start = f.removeStart, end = f.removeEnd;
    if (start === undefined || start < 0 || end <= start) continue;
    removables++;
    const texte = parPath.get(f.path);
    if (texte === undefined) { fautes.push(`texte introuvable ${f.path}`); continue; }
    const coupe = texte.slice(start, end);

    // 1. la coupe contient bien le nom du symbole
    if (!coupe.includes(f.name)) {
      compte.nom++;
      if (fautes.length < 12) fautes.push(`NOM absent ${f.name} ${f.path}:${f.line + 1} coupe=${JSON.stringify(coupe.slice(0, 80))}`);
    }
    // 2. bornes dans le texte
    if (end > texte.length) {
      compte.bornes++;
      if (fautes.length < 12) fautes.push(`BORNE hors texte ${f.name} ${f.path} end=${end} len=${texte.length}`);
    }
    // 3. la coupe part d un debut de ligne et finit en fin de ligne
    const debutLigne = start === 0 || texte[start - 1] === '\n';
    const finLigne = end === texte.length || texte[end] === '\n' || texte[end - 1] === '\n';
    if (!debutLigne || !finLigne) {
      compte.ligne++;
      if (fautes.length < 12) fautes.push(`LIGNE ${f.name} ${f.path}:${f.line + 1} debut=${debutLigne} fin=${finLigne} avant=${JSON.stringify(texte.slice(Math.max(0,start-20), start))} apres=${JSON.stringify(texte.slice(end, end+20))}`);
    }
    // 4bis. la PREMIERE ligne de code de la coupe doit etre la declaration
    // elle meme. C est ce qui pince la borne de DEPART : une borne trop haute
    // avale la declaration du dessus sans rien desequilibrer, donc les trois
    // premiers invariants la laissent passer. Les commentaires et les
    // annotations au dessus font bien partie de la coupe et sont donc sautes.
    const lignesCoupe = stripKotlinComments(coupe).split('\n');
    const premiere = lignesCoupe.find(l => l.trim() !== '' && !l.trim().startsWith('@'));
    if (premiere !== undefined && !premiere.includes(f.name)) {
      compte.voisin++;
      if (fautes.length < 12) fautes.push(`DEPART ${f.name} ${f.path}:${f.line + 1} premiere ligne de code coupee = ${JSON.stringify(premiere.trim().slice(0, 70))}`);
    }

    // 4. le fichier reste equilibre apres la coupe
    const avant = solde(texte);
    const apres = solde(texte.slice(0, start) + texte.slice(end));
    if (avant.c !== apres.c || avant.p !== apres.p || avant.b !== apres.b) {
      compte.solde++;
      if (fautes.length < 12) fautes.push(`SOLDE ${f.name} ${f.path}:${f.line + 1} avant=${JSON.stringify(avant)} apres=${JSON.stringify(apres)}`);
    }
  }

  console.log(JSON.stringify({ sources: sources.length, findings: (findings as any[]).length, removables, ...compte }));
  for (const x of fautes) console.log('  ' + x);
}

main();
