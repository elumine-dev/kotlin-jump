/**
 * Ce que le COMPTE RENDU annonce contre ce que l'edition emporte, sur un vrai
 * projet.
 *
 *   npx vite-node ... non : `RemoveEverythingUnused` importe vscode.
 *   node_modules/.bin/esbuild scripts/verify-report-matches-edit.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/rapport.cjs
 *   node dist/perf/rapport.cjs <racine>
 *
 * Onze versions, de la 1.42.277 a la 1.42.293, ont corrige des comptes rendus
 * qui decrivaient le BALAYAGE plutot que l'edition. Les sept temoins existants
 * verifient les ETENDUES ; aucun ne confronte le nombre annonce a ce qui part
 * vraiment. C'est pourtant la, et sur un vrai projet, que la difference se
 * voit : les fichiers que la cascade supprime en entier n'ont pas de coupe a
 * eux, et le plan en compte pourtant les declarations.
 *
 *   ecart      somme des familles = plages emises + coupes des fichiers effaces
 *   phrase     mettre une famille a zero change la phrase (donc elle y est)
 *   somme      la phrase totalise exactement les coupes retenues
 *   perdu      aucun fichier retenu ne se retrouve sans plages ni suppression
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  collecterUnePasse, coupesRetenues, plagesDuFichier, compteLesFamilles, resumeDesFamilles,
} from '../src/commands/RemoveEverythingUnused';
import { planCascade } from '../src/providers/removalCascade';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const GARDE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;

function walk(d: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const f = path.join(d, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f, hit); }
    else if (GARDE.test(x.name)) hit(f);
  }
}

const FAMILLES_DE_PASSE = ['symboles', 'membres', 'entrees', 'ilots', 'balayage', 'renommages'];

function main(): void {
  const racine = process.argv[2];
  if (racine === undefined) { console.error('usage: verify-report-matches-edit.ts <racine>'); process.exit(2); }

  const fichiers: string[] = [];
  walk(racine, f => fichiers.push(f));
  const sources = fichiers.map(p => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  const segs = ['/src/test/', '/src/androidTest/'];

  const { parFichier } = collecterUnePasse(sources, segs);
  const textes = new Map(sources.map(s => [s.path, s.text]));
  const { retenu } = coupesRetenues(parFichier, textes);
  const cascade = planCascade(
    new Map([...retenu].map(([p, l]) => [p, l.map(c => ({ start: c.start, end: c.end }))])),
    textes,
  );

  const applique = compteLesFamilles(retenu);
  const sommeFamilles = FAMILLES_DE_PASSE.reduce((n, k) => n + (applique[k] ?? 0), 0);

  let plages = 0;
  let dansFichiersEffaces = 0;
  const compte = { ecart: 0, phrase: 0, somme: 0, perdu: 0 };
  const fautes: string[] = [];

  for (const [p, l] of retenu) {
    if (cascade.deleteFiles.has(p)) { dansFichiersEffaces += l.length; continue; }
    const r = plagesDuFichier(p, textes.get(p)!, l);
    if (r === undefined) {
      compte.perdu++;
      if (fautes.length < 10) fautes.push(`PERDU ${path.relative(racine, p)} ${l.length} coupes sans plages`);
      continue;
    }
    plages += r.length;
  }

  if (sommeFamilles !== plages + dansFichiersEffaces) {
    compte.ecart++;
    fautes.push(`ECART familles=${sommeFamilles} plages=${plages} effaces=${dansFichiersEffaces}`);
  }

  const phrase = resumeDesFamilles(applique);
  // Par CONSTRUCTION, pas par sous-chaine. Chercher la valeur du compte dans la
  // phrase se laisse satisfaire par le compte d'une AUTRE famille : deux
  // familles a 15 et l'une retiree, « 15 » est toujours la et l'invariant se
  // tait. Mettre la famille a zero doit changer la phrase, c'est la seule
  // formulation qui ne depende ni des libelles ni des valeurs.
  for (const f of FAMILLES_DE_PASSE) {
    if ((applique[f] ?? 0) === 0) continue;
    if (resumeDesFamilles({ ...applique, [f]: 0 }) === phrase) {
      compte.phrase++;
      fautes.push(`PHRASE ${f}=${applique[f]} ne change rien a ${JSON.stringify(phrase)}`);
    }
  }
  const totalDansLaPhrase = [...phrase.matchAll(/(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  if (totalDansLaPhrase !== sommeFamilles) {
    compte.somme++;
    fautes.push(`SOMME phrase=${totalDansLaPhrase} retenues=${sommeFamilles}`);
  }

  // Temoin : l'invariant `phrase` sait-il voir une famille manquante quand une
  // AUTRE porte le meme compte ? Un zero qui ne sait pas voir ne vaut rien.
  const truque: Record<string, number> = {
    symboles: 15, membres: 0, entrees: 15, ilots: 0, balayage: 0, renommages: 0, imports: 0, fichiers: 0,
  };
  const ampute = resumeDesFamilles({ ...truque, entrees: 0 } as never);
  const temoinVoit = ampute !== resumeDesFamilles(truque as never)
    && !ampute.includes('enum');

  console.log(JSON.stringify({
    sources: sources.length, coupesRetenues: sommeFamilles, plages, dansFichiersEffaces,
    fichiersEffaces: cascade.deleteFiles.size, ...compte, temoinVoit,
  }));
  console.log('  ' + phrase);
  for (const x of fautes) console.log('  ' + x);
}

main();
