/**
 * What the unused resource key quick fix CUTS, in XML.
 *
 *   npx vite-node scripts/verify-resource-key-removals.ts <project-root>
 *
 * KJ deletes the whole entry, `<` of the open tag through the end of its close
 * tag, widened to whole lines when nothing else shares them. XML fails
 * differently from Kotlin: a bound that is off leaves a dangling tag rather
 * than an unbalanced brace, and the file stops parsing for the whole build.
 *
 * The zero is only worth reading because the probe is shown to fail first on a
 * deliberately shifted bound.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedResourceKeys, expandToWholeLines } from '../src/providers/unusedResourceKeys';
import { collectValueKeyDeclarations, parseValuesPath } from '../src/indexer/ValueResourceScanner';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(full, hit); }
    else hit(full);
  }
}

/** Balise ouvrantes moins fermantes, hors commentaires et hors CDATA. */
function soldeBalises(xml: string): number {
  const sans = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  let solde = 0;
  const re = /<\s*(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sans)) !== null) {
    if (m[4] === '/') continue;            // auto fermante
    solde += m[1] === '/' ? -1 : 1;
  }
  return solde;
}

function main(): void {
  const root = process.argv[2];
  const decale = Number(process.argv[3] ?? 0);
  const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    if (!SOURCE_RE.test(file)) return;
    try { sources.push({ path: file, text: fs.readFileSync(file, 'utf8') }); } catch { /* skip */ }
  });
  const declarations = sources
    .filter(s => parseValuesPath(s.path) !== undefined)
    .flatMap(s => collectValueKeyDeclarations(s.path, s.text, moduleDirs));
  const modulesWithCode = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(`${dir}${path.sep}`) && /\.(kt|java)$/.test(s.path)));
  const libraryModules = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(`${dir}${path.sep}build.gradle`)
      && /com\.android\.library|android-library/.test(s.text)));
  const found = findUnusedResourceKeys({
    declarations, sources, modulesWithCode, libraryModules,
  } as any) as any[];

  const parPath = new Map(sources.map(s => [s.path, s.text]));
  let coupes = 0;
  const compte = { nom: 0, bornes: 0, solde: 0, ouvre: 0, ferme: 0 };
  const fautes: string[] = [];

  for (const f of found) {
    for (const v of f.variants) {
      const texte = parPath.get(v.path);
      if (texte === undefined) continue;
      const large = expandToWholeLines(texte, v.start + decale, v.end + decale);
      coupes++;
      const coupe = texte.slice(large.start, large.end);
      if (!coupe.includes(f.name)) {
        compte.nom++;
        if (fautes.length < 8) fautes.push(`NOM ${f.name} ${v.path} coupe=${JSON.stringify(coupe.slice(0, 80))}`);
      }
      if (large.end > texte.length || large.start < 0) { compte.bornes++; continue; }
      // La coupe doit etre un fragment complet : autant d ouvertures que de fermetures.
      if (soldeBalises(coupe) !== 0) {
        compte.solde++;
        if (fautes.length < 8) fautes.push(`FRAGMENT ${f.name} ${v.path} solde=${soldeBalises(coupe)} coupe=${JSON.stringify(coupe.slice(0, 100))}`);
      }
      // Le fichier restant doit garder le meme solde qu avant.
      const apres = texte.slice(0, large.start) + texte.slice(large.end);
      if (soldeBalises(texte) !== soldeBalises(apres)) {
        compte.ferme++;
        if (fautes.length < 8) fautes.push(`FICHIER ${f.name} ${v.path} ${soldeBalises(texte)} -> ${soldeBalises(apres)}`);
      }
      // La coupe commence sur un `<` ou un debut de ligne, jamais au milieu d une balise.
      const avant = texte.slice(0, large.start);
      if (!(large.start === 0 || texte[large.start - 1] === '\n' || texte[large.start] === '<')) {
        compte.ouvre++;
        if (fautes.length < 8) fautes.push(`DEPART ${f.name} ${v.path} precede par ${JSON.stringify(avant.slice(-40))}`);
      }
    }
  }

  console.log(JSON.stringify({ sources: sources.length, cles: found.length, coupes, decale, ...compte }));
  for (const x of fautes) console.log('  ' + x);
}

main();
