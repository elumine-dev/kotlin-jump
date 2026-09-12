/**
 * What the five per file sweep detectors CUT, read back on a real project.
 *
 *   npx vite-node scripts/verify-sweep-removals.ts <project-root>
 *
 * `Clean dead code in this file` applies these edits to the user's own source
 * behind a preview, so a bound that is one unit off deletes live code. The
 * other eight destructive detectors of the family have been read back this
 * way; these five had not.
 *
 * Four invariants, each of which a real defect would break:
 *   1. brace, paren and bracket balance is unchanged;
 *   2. no orphan comma appears, COUNTED rather than tested for, since a
 *      trailing comma before a closing paren is already legal Kotlin and a
 *      presence test would disarm the check for the whole file;
 *   3. every cut is either whole lines or contained in one line;
 *   4. the declarations that disappear from the parser are exactly the ones
 *      the findings name.
 *
 * `KJ_TEMOIN=fin` widens every cut by one character and `KJ_TEMOIN=ligne`
 * pushes it to the end of the next line: both must be caught, otherwise the
 * probe proves nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sweepFile, planFileEdits, applyEdits, SweepEdit } from '../src/providers/DeadCodeSweep';
import { parse } from '../src/indexer/KotlinParser';
import { stripKotlinComments } from '../src/util/xmlRefs';

const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP_DIRS.has(x.name)) walk(full, hit); }
    else if (/\.(kt|java)$/.test(x.name)) hit(full);
  }
}

/** Balance and orphan commas, on text with comments, strings and chars out. */
function mesure(t: string): { p: number; c: number; b: number; virgules: number } {
  const propre = stripKotlinComments(t);
  let p = 0, c = 0, b = 0, s = false, r = false, ch = false;
  const garde: string[] = [];
  for (let i = 0; i < propre.length; i++) {
    const x = propre[i];
    if (r) { if (propre.startsWith('"""', i)) { r = false; i += 2; } continue; }
    if (s) { if (x === '\\') { i++; continue; } if (x === '"' || x === '\n') s = false; continue; }
    // A Java or Kotlin char literal can hold a brace: `case '}':` counted one.
    if (ch) { if (x === '\\') { i++; continue; } if (x === "'" || x === '\n') ch = false; continue; }
    if (propre.startsWith('"""', i)) { r = true; i += 2; continue; }
    if (x === '"') { s = true; continue; }
    if (x === "'") { ch = true; continue; }
    if (x === '(') p++; else if (x === ')') p--;
    else if (x === '{') c++; else if (x === '}') c--;
    else if (x === '[') b++; else if (x === ']') b--;
    garde.push(x);
  }
  const nu = garde.join('');
  const compte = (re: RegExp) => (nu.match(re) ?? []).length;
  return { p, c, b, virgules: compte(/,\s*,/g) + compte(/\(\s*,/g) + compte(/,\s*\)/g) + compte(/,\s*\}/g) };
}

const declarations = (t: string) =>
  parse('file:///x.kt', t).symbols.map(s => `${s.kind} ${s.name}`).sort();

function temoiner(edits: readonly SweepEdit[], texte: string): SweepEdit[] {
  const mode = process.env.KJ_TEMOIN;
  if (!mode) return [...edits];
  return edits.map(e => {
    if (mode === 'fin') return { ...e, end: Math.min(e.end + 1, texte.length) };
    const finLigne = texte.indexOf('\n', e.end + 1);
    return { ...e, end: finLigne < 0 ? texte.length : finLigne };
  });
}

function main(): void {
  const racine = process.argv[2];
  if (!racine) { console.error('usage: verify-sweep-removals <project-root>'); process.exit(2); }
  const fichiers: string[] = [];
  walk(racine, f => fichiers.push(f));

  let avecTrouvailles = 0, coupes = 0, lignesEntieres = 0, dansUneLigne = 0;
  const violations: string[] = [];
  for (const f of fichiers) {
    const avant = fs.readFileSync(f, 'utf8');
    const lang = f.endsWith('.java') ? 'java' : 'kotlin';
    const trouvailles = sweepFile(avant, lang);
    const plan = temoiner(planFileEdits(trouvailles), avant);
    if (plan.length === 0) continue;
    avecTrouvailles++;
    coupes += plan.length;
    const apres = applyEdits(avant, plan);
    const rel = path.relative(racine, f);

    const a = mesure(avant), b = mesure(apres);
    if (a.p !== b.p || a.c !== b.c || a.b !== b.b) {
      violations.push(`SOLDE ${rel}: () ${a.p}->${b.p}  {} ${a.c}->${b.c}  [] ${a.b}->${b.b}`);
    }
    if (b.virgules > a.virgules) {
      violations.push(`VIRGULE ${rel}: ${a.virgules} -> ${b.virgules} orphelines`);
    }
    for (const e of plan) {
      const debutLigne = e.start === 0 || avant[e.start - 1] === '\n';
      const finLigne = e.end >= avant.length || avant[e.end] === '\n' || avant[e.end - 1] === '\n';
      const memeLigne = avant.slice(e.start, e.end).indexOf('\n') < 0;
      if (debutLigne && finLigne) lignesEntieres++;
      else if (memeLigne) dansUneLigne++;
      else violations.push(`BORD ${rel}: coupe de ${e.start} a ${e.end} ni ligne entiere ni dans une ligne`);
    }
    if (lang === 'kotlin') {
      const perdues = declarations(avant).filter(d => {
        const restantes = declarations(apres);
        return !restantes.includes(d);
      });
      // Toute famille confondue : `locals` et `writeOnly` retirent aussi des
      // `val` et des `var` que l'indexeur voit. Un objet anonyme porte un nom
      // synthetique construit sur son offset, donc la moindre coupe renumerote
      // ceux d'apres : ce n'est pas une disparition.
      const attendues = new Set(trouvailles.map(t => t.name));
      const inattendues = perdues
        .filter(d => !d.includes('$anon$'))
        .filter(d => !attendues.has(d.split(' ').slice(1).join(' ')));
      if (inattendues.length > 0) {
        violations.push(`SYMBOLE ${rel}: disparu sans etre signale: ${inattendues.slice(0, 3).join(', ')}`);
      }
    }
  }

  console.log(JSON.stringify({
    fichiers: fichiers.length, avecTrouvailles, coupes, lignesEntieres, dansUneLigne,
    violations: violations.length,
  }));
  for (const v of violations.slice(0, 25)) console.log('  ' + v);
}

main();
