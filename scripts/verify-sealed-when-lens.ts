/**
 * What the sealed `when` coverage lens claims, checked on a real project.
 *
 *   npx vite-node ... no: bundle it, SymbolIndex imports vscode.
 *   node_modules/.bin/esbuild scripts/verify-sealed-when-lens.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/sealed.cjs
 *   node dist/perf/sealed.cjs <project-root>
 *
 * A lens reading `✓ N/N branches` tells the reader the `when` is exhaustive.
 * That is the claim worth doubting: a wrong warning is noise, a wrong `✓` is a
 * missing branch nobody will look for. Every complete claim is re checked here
 * WITHOUT trusting the same analysis, by requiring each expected subtype name
 * to appear in the text of the `when` block.
 *
 * `KJ_TEMOIN=1` forces every lens to claim completeness, which must light the
 * check up. Without that, a zero says nothing.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { SymbolIndex } from '../src/indexer/SymbolIndex';
import { parse } from '../src/indexer/KotlinParser';
import { analyzeDocument, lensTitle } from '../src/providers/SealedWhenCoverageProvider';

const RACINE = process.argv[2];
const fichiers = execSync(
  `find ${RACINE} -type f -name '*.kt' -not -path '*/build/*' -not -path '*/.gradle/*' -not -path '*/generated/*'`,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
).trim().split('\n').filter(Boolean);

const textes = new Map<string, string>();
const index = new SymbolIndex();
for (const f of fichiers) {
  let t: string;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  textes.set(f, t);
  try { index.add(parse('file://' + f, t)); } catch { /* illisible */ }
}
index.finalize();

let lentilles = 0, complets = 0, incomplets = 0, avecElse = 0, faux = 0;
const fauxExemples: string[] = [];
const exemples: string[] = [];
for (const [f, texte] of textes) {
  const doc = { getText: () => texte, uri: { toString: () => 'file://' + f, fsPath: f } } as any;
  let res: any[] = [];
  try { res = analyzeDocument(doc, index); } catch { continue; }
  for (const a of res) {
    lentilles++;
    if (a.missing.length === 0 || process.env.KJ_TEMOIN) {
      complets++;
      // Un « ✓ N/N » affirme que le when traite CHAQUE sous type attendu. Le
      // verifier sans faire confiance a la meme analyse : chaque nom attendu
      // doit apparaitre textuellement dans le bloc du when.
      const lignes = texte.split('\n');
      const bloc = lignes.slice(a.whenLine, Math.min(a.whenLine + 80, lignes.length)).join('\n');
      const absents = [...a.expected].map((e: any) => e.name).filter((n: string) => !new RegExp(`\\b${n}\\b`).test(bloc));
      if (absents.length > 0) {
        faux++;
        if (fauxExemples.length < 8) {
          fauxExemples.push(`${f.slice(RACINE.length + 1)}:${a.whenLine + 1} annonce complet mais ${absents.join(', ')} n apparait pas`);
        }
      }
    }
    else if (a.hasElse) avecElse++;
    else {
      incomplets++;
      if (exemples.length < 10) {
        exemples.push(`${f.slice(RACINE.length + 1)}:${a.whenLine + 1}  ${lensTitle(a)}`);
      }
    }
  }
}
console.log(JSON.stringify({ fichiers: fichiers.length, lentilles, complets, incomplets, avecElse, faux }));
for (const e of fauxExemples) console.log('  FAUX ' + e);
for (const e of exemples) console.log('  ' + e);
