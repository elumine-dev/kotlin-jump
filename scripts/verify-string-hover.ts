/**
 * What the string resource hover claims, checked against the XML itself.
 *
 *   node_modules/.bin/esbuild scripts/verify-string-hover.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/shover.cjs
 *   node dist/perf/shover.cjs <project-root>
 *
 * The hover answers three things about `R.string.x`: which file declares it,
 * on which line, and what its value is. All three are checkable against the
 * XML without trusting the index that produced them.
 *
 * `KJ_TEMOIN=1` shifts the announced line by one, which must light every check
 * up. Without that, a zero says nothing.
 *
 * Two normalisations belong to the CHECKER, not to the provider: a value is
 * unwrapped from `<![CDATA[…]]>` and Android's `\n` escapes are folded, or the
 * checker reports as faults exactly what the provider does right.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { StringResourceIndex } from '../src/indexer/StringResourceIndex';

const RACINE = process.argv[2];
const liste = (motif: string) => execSync(
  `find ${RACINE} -type f -name '${motif}' -not -path '*/build/*' -not -path '*/.gradle/*'`,
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
).trim().split('\n').filter(Boolean);

const index = new StringResourceIndex();
const xml = liste('*.xml').filter(p => /[/\\]values[^/\\]*[/\\][^/\\]+\.xml$/.test(p));
const textesXml = new Map<string, string>();
for (const p of xml) {
  let t: string;
  try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
  textesXml.set('file://' + p, t);
  index.reindexFile({ toString: () => 'file://' + p }, t);
}

// Toutes les references R.string.X du code.
const REF = /\bR\.string\.([A-Za-z_]\w*)/g;
const refs = new Map<string, string>();   // cle -> chemin du fichier referent
for (const p of [...liste('*.kt'), ...liste('*.java')]) {
  let t: string;
  try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
  if (!t.includes('R.string.')) continue;
  REF.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF.exec(t)) !== null) if (!refs.has(m[1])) refs.set(m[1], p);
}

let vues = 0, sansEntree = 0, ligneFausse = 0, valeurFausse = 0, fichierAbsent = 0;
const fautes: string[] = [];
const sansExemples: string[] = [];
const NAME = (cle: string) => new RegExp(`<string\\b[^>]*\\bname\\s*=\\s*"${cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);

for (const [cle, referent] of refs) {
  const e: any = index.getValue(cle, referent);
  if (!e) {
    sansEntree++;
    if (sansExemples.length < 10) sansExemples.push(`${cle}  (vu dans ${referent.slice(RACINE.length + 1)})`);
    continue;
  }
  vues++;
  const uri = e.uri.toString();
  const texte = textesXml.get(uri);
  if (texte === undefined) {
    fichierAbsent++;
    if (fautes.length < 8) fautes.push(`FICHIER ${cle} -> ${uri}`);
    continue;
  }
  const lignes = texte.split('\n');
  // Temoin : decaler d une ligne doit allumer le controle, sinon il ne prouve
  // rien sur la position annoncee.
  const ligneAnnoncee = e.line + (process.env.KJ_TEMOIN ? 1 : 0);
  const ligne = lignes[ligneAnnoncee] ?? '';
  // 1. la ligne annoncee doit vraiment declarer cette cle
  if (!NAME(cle).test(ligne)) {
    ligneFausse++;
    if (fautes.length < 8) fautes.push(`LIGNE ${cle} annoncee ${uri.split('/').slice(-3).join('/')}:${ligneAnnoncee + 1} = ${JSON.stringify(ligne.trim().slice(0, 80))}`);
    continue;
  }
  // 2. la valeur affichee doit etre celle du XML a cet endroit
  const bloc = lignes.slice(ligneAnnoncee, ligneAnnoncee + 12).join('\n');
  const mm = /<string\b[^>]*>([\s\S]*?)<\/string>/.exec(bloc);
  const brut = mm ? mm[1] : undefined;
  if (brut !== undefined) {
    // Normalisation des DEUX cotes, sinon la sonde compte comme faute ce que
    // le fournisseur fait justement bien : deballer un CDATA et traduire les
    // echappements Android.
    const nu = (s: string) => s
      .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
      .replace(/\\n/g, ' ').replace(/\\t/g, ' ')
      .replace(/\\'/g, "'").replace(/\\"/g, '"')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#160;|&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (nu(brut) !== nu(String(e.value))) {
      valeurFausse++;
      if (fautes.length < 8) fautes.push(`VALEUR ${cle}\n      xml   = ${JSON.stringify(nu(brut).slice(0, 90))}\n      bulle = ${JSON.stringify(nu(String(e.value)).slice(0, 90))}`);
    }
  }
}
console.log(JSON.stringify({ xml: xml.length, refs: refs.size, vues, sansEntree, fichierAbsent, ligneFausse, valeurFausse }));
for (const f of fautes) console.log('  ' + f);
for (const x of sansExemples) console.log('  SANS ENTREE ' + x);
