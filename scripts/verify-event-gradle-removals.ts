/**
 * What the last two dead code quick fixes CUT: an unheard `post(...)` call
 * (KJ-038) and an unreferenced catalog alias (KJ-041, plus its orphaned
 * version entry).
 *
 *   npx vite-node scripts/verify-event-gradle-removals.ts <project-root> [decalage]
 *
 * A post site is a STATEMENT inside a body, so a wrong bound leaves a dangling
 * receiver rather than an unbalanced file. A catalog alias lives in a TOML
 * table, where a wrong bound breaks the build for every module. Pass a
 * decalage to check the probe can still see a shifted bound.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnheardEvents } from '../src/providers/unheardEvents';
import { findUnusedGradleDependencies } from '../src/providers/unusedGradleDependencies';
import { stripKotlinComments } from '../src/util/xmlRefs';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(full, hit); }
    else hit(full);
  }
}

function solde(t: string): string {
  const propre = stripKotlinComments(t);
  let c = 0, p = 0, b = 0, s = false, r = false;
  for (let i = 0; i < propre.length; i++) {
    const ch = propre[i];
    if (r) { if (propre.startsWith('"""', i)) { r = false; i += 2; } continue; }
    if (s) { if (ch === '\\') { i++; continue; } if (ch === '"' || ch === '\n') s = false; continue; }
    if (propre.startsWith('"""', i)) { r = true; i += 2; continue; }
    if (ch === '"') { s = true; continue; }
    if (ch === "'") { const f = propre.indexOf("'", i + 1); if (f > 0 && f - i <= 4) { i = f; continue; } }
    if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return `${c}/${p}/${b}`;
}

function main(): void {
  const root = process.argv[2];
  const decale = Number(process.argv[3] ?? 0);
  const sources: { path: string; text: string }[] = [];
  walk(root, f => {
    if (!/\.(kt|kts|java|gradle|toml|properties)$/.test(f)) return;
    try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ }
  });
  const parPath = new Map(sources.map(s => [s.path, s.text]));

  const verifier = (nom: string, coupes: { nom: string; path: string; start: number; end: number }[]) => {
    const compte = { nom: 0, bornes: 0, ligne: 0, solde: 0, reste: 0, vide: 0 };
    const fautes: string[] = [];
    for (const c of coupes) {
      const texte = parPath.get(c.path);
      if (texte === undefined) { fautes.push(`texte introuvable ${c.path}`); continue; }
      const s0 = c.start + decale, e0 = c.end + decale;
      if (s0 < 0 || e0 > texte.length || e0 <= s0) { compte.bornes++; continue; }
      const coupe = texte.slice(s0, e0);
      if (coupe.trim() === '') { compte.vide++; continue; }
      if (!coupe.includes(c.nom)) {
        compte.nom++;
        if (fautes.length < 8) fautes.push(`NOM ${c.nom} ${c.path} coupe=${JSON.stringify(coupe.slice(0, 80))}`);
      }
      const apres = texte.slice(0, s0) + texte.slice(e0);
      if (solde(texte) !== solde(apres)) {
        compte.solde++;
        if (fautes.length < 8) fautes.push(`SOLDE ${c.nom} ${c.path} ${solde(texte)} -> ${solde(apres)} coupe=${JSON.stringify(coupe.slice(0, 90))}`);
      }
      // La coupe part d un debut de ligne et finit juste apres un saut de
      // ligne. Sans cet invariant, un decalage d un seul caractere passe :
      // il ne fait que grignoter de l indentation, le solde ne bouge pas et
      // le nom reste dans la coupe.
      const debutLigne = s0 === 0 || texte[s0 - 1] === '\n';
      const finLigne = e0 === texte.length || texte[e0 - 1] === '\n';
      if (!debutLigne || !finLigne) {
        compte.ligne++;
        if (fautes.length < 8) fautes.push(`LIGNE ${c.nom} ${c.path} debut=${debutLigne} fin=${finLigne} coupe=${JSON.stringify(coupe.slice(0, 60))}`);
      }

      // Rien d orphelin au raccord : ni un point, ni un operateur, ni une
      // parenthese ouverte laissee seule en bout de ligne.
      const avant = texte.slice(0, s0).split('\n').pop() ?? '';
      const apresLigne = (texte.slice(e0).split('\n')[0] ?? '');
      if (/[.=+\-*/&|,(]\s*$/.test(avant) && apresLigne.trim() === '') {
        compte.reste++;
        if (fautes.length < 8) fautes.push(`RACCORD ${c.nom} ${c.path} avant=${JSON.stringify(avant.slice(-40))}`);
      }
    }
    console.log(`${nom.padEnd(10)} ${JSON.stringify({ coupes: coupes.length, decale, ...compte })}`);
    for (const f of fautes) console.log('    ' + f);
  };

  const ev = findUnheardEvents({ sources: sources as any, testSourceSets: TEST_SETS } as any) as any;
  verifier('evenements', (ev.events as any[])
    .filter(e => e.removeStart >= 0 && e.removeEnd > e.removeStart)
    .map(e => ({ nom: e.name, path: e.path, start: e.removeStart, end: e.removeEnd })));

  const gr = findUnusedGradleDependencies({ sources: sources as any } as any) as any[];
  const coupesGradle: { nom: string; path: string; start: number; end: number }[] = [];
  for (const g of gr) {
    if (g.removeStart >= 0 && g.removeEnd > g.removeStart) {
      coupesGradle.push({ nom: g.name ?? g.alias, path: g.path, start: g.removeStart, end: g.removeEnd });
    }
    if (g.orphanedVersion && g.orphanedVersion.removeStart >= 0) {
      coupesGradle.push({
        nom: g.orphanedVersion.name, path: g.path,
        start: g.orphanedVersion.removeStart, end: g.orphanedVersion.removeEnd,
      });
    }
  }
  verifier('gradle', coupesGradle);
}

main();
