/**
 * The only removal in the dead code family that cuts INSIDE a line.
 *
 *   npx vite-node scripts/verify-dto-removals.ts <project-root>
 *
 * KJ-044 removes one parameter from a comma separated list, so a bound that is
 * one unit off yields Kotlin that does not compile: two parameters glued with
 * no separator, or a doubled comma. Counting orphan commas rather than testing
 * for their presence matters, since a trailing comma at the end of the list is
 * already there and a presence test disarms the check for the whole file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedDtoFields } from '../src/providers/unusedDtoFields';
import { stripKotlinComments } from '../src/util/xmlRefs';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP_DIRS.has(x.name)) walk(full, hit); }
    else if (SOURCE_RE.test(x.name)) hit(full);
  }
}

function solde(t: string): { p: number; c: number; b: number } {
  const propre = stripKotlinComments(t);
  let p = 0, c = 0, b = 0, s = false, r = false;
  for (let i = 0; i < propre.length; i++) {
    const ch = propre[i];
    if (r) { if (propre.startsWith('"""', i)) { r = false; i += 2; } continue; }
    if (s) { if (ch === '\\') { i++; continue; } if (ch === '"' || ch === '\n') s = false; continue; }
    if (propre.startsWith('"""', i)) { r = true; i += 2; continue; }
    if (ch === '"') { s = true; continue; }
    if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return { p, c, b };
}

function main(): void {
  const root = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(root, f => { try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ } });
  const found = findUnusedDtoFields({ sources, testSourceSets: TEST_SOURCE_SETS }) as any[];
  const parPath = new Map(sources.map(s => [s.path, s.text]));

  let removables = 0;
  const compte = { nom: 0, virgule: 0, raccord: 0, solde: 0, vide: 0 };
  const fautes: string[] = [];

  for (const f of found) {
    if (f.removeStart === undefined || f.removeStart < 0 || f.removeEnd <= f.removeStart) continue;
    removables++;
    const texte = parPath.get(f.path);
    if (texte === undefined) continue;
    const coupe = texte.slice(f.removeStart, f.removeEnd);
    const apres = texte.slice(0, f.removeStart) + texte.slice(f.removeEnd);

    if (!coupe.includes(f.name)) {
      compte.nom++;
      if (fautes.length < 10) fautes.push(`NOM ${f.className}.${f.name} ${f.path}:${f.line + 1} coupe=${JSON.stringify(coupe.slice(0, 70))}`);
    }
    // Virgules orphelines : on COMPTE, on ne teste pas la presence. Une
    // virgule finale a la ktlint, `dernier: T,\n)`, existe deja dans le
    // fichier, donc un test de presence desarmait la verification pour tout
    // le fichier et laissait passer un `,,` fabrique par la coupe.
    const compteOrph = (t: string) => (stripKotlinComments(t).match(/,\s*,|\(\s*,/g) ?? []).length;
    if (compteOrph(apres) > compteOrph(texte)) {
      compte.virgule++;
      if (fautes.length < 10) fautes.push(`VIRGULE ${f.className}.${f.name} ${f.path}:${f.line + 1} ${compteOrph(texte)} -> ${compteOrph(apres)}`);
    }

    // Le raccord doit se faire sur un separateur : en retirant un parametre du
    // milieu, le caractere qui precede la jointure est forcement `,` ou `(`.
    // Sans ca, deux parametres se retrouvent colles sans virgule, ce qui ne
    // desequilibre rien et ne cree aucune virgule en trop.
    const avantJoint = stripKotlinComments(texte.slice(0, f.removeStart)).replace(/\s+$/, '');
    const dernier = avantJoint.slice(-1);
    if (dernier !== ',' && dernier !== '(') {
      compte.raccord++;
      if (fautes.length < 10) fautes.push(`RACCORD ${f.className}.${f.name} ${f.path}:${f.line + 1} precede par ${JSON.stringify(avantJoint.slice(-40))}`);
    }
    const sa = solde(texte), sb = solde(apres);
    if (sa.p !== sb.p || sa.c !== sb.c || sa.b !== sb.b) {
      compte.solde++;
      if (fautes.length < 10) fautes.push(`SOLDE ${f.className}.${f.name} ${f.path}:${f.line + 1} ${JSON.stringify(sa)} -> ${JSON.stringify(sb)}`);
    }
    if (coupe.trim() === '') {
      compte.vide++;
      if (fautes.length < 10) fautes.push(`VIDE ${f.className}.${f.name} ${f.path}:${f.line + 1}`);
    }
  }

  console.log(JSON.stringify({ sources: sources.length, found: found.length, removables, ...compte }));
  for (const x of fautes) console.log('  ' + x);
}

main();
