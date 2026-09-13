/**
 * What the dead code quick fixes CUT, for the three detectors that delete a
 * whole declaration: members (KJ-042), dead islands (KJ-046), enum entries
 * (KJ-043).
 *
 *   npx vite-node scripts/verify-member-island-removals.ts <project-root>
 *
 * Same five invariants as `verify-symbol-removals.ts`, plus the one an island
 * needs: it deletes SEVERAL spans of one file in a single edit, so no two of
 * them may partially overlap. A zero here is only worth reading because a
 * deliberately shifted bound makes the fifth invariant report the declarations
 * that would be swallowed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedMembers } from '../src/providers/unusedMembers';
import { findUnusedSymbols } from '../src/providers/unusedSymbols';
import { findDeadIslands } from '../src/providers/deadIslands';
import { findUnusedEnumEntries } from '../src/providers/unusedEnumEntries';
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

function solde(t: string): string {
  const propre = stripKotlinComments(t);
  let c = 0, p = 0, b = 0, s = false, r = false;
  for (let i = 0; i < propre.length; i++) {
    const ch = propre[i];
    if (r) { if (propre.startsWith('"""', i)) { r = false; i += 2; } continue; }
    if (s) { if (ch === '\\') { i++; continue; } if (ch === '"' || ch === '\n') s = false; continue; }
    if (propre.startsWith('"""', i)) { r = true; i += 2; continue; }
    if (ch === '"') { s = true; continue; }
    // Litteral de caractere Java : `'}'` porte une accolade qui n en est pas
    // une. Sans cette garde la sonde criait sur un `record` parfaitement sain.
    if (ch === "'") {
      const fin = propre.indexOf("'", i + 1);
      if (fin > 0 && fin - i <= 4) { i = fin; continue; }
    }
    if (ch === '{') c++; else if (ch === '}') c--;
    else if (ch === '(') p++; else if (ch === ')') p--;
    else if (ch === '[') b++; else if (ch === ']') b--;
  }
  return `${c}/${p}/${b}`;
}

interface Coupe { quoi: string; nom: string; path: string; line: number; start: number; end: number; }

/**
 * `lignesEntieres` : vrai pour une declaration, qui occupe ses lignes seule.
 * Faux pour une entree d'enum, qui depuis 1.42.232 se retire au milieu de sa
 * liste : `ASC, DESC` rend une coupe partielle par CONCEPTION, et exiger un
 * debut de ligne y signalerait le comportement correct. La validite de la
 * liste remplace l'invariant perdu.
 */
function verifier(nom: string, coupes: Coupe[], parPath: Map<string, string>, lignesEntieres = true): void {
  const compte = { nom: 0, bornes: 0, ligne: 0, solde: 0, depart: 0, voisine: 0, liste: 0, orphelin: 0 };
  const fautes: string[] = [];
  for (const c of coupes) {
    const texte = parPath.get(c.path);
    if (texte === undefined) { fautes.push(`texte introuvable ${c.path}`); continue; }
    const coupe = texte.slice(c.start, c.end);

    // Une coupe ne contient qu UNE declaration de son niveau. Les cinq autres
    // invariants ont annonce zero violation pendant que
    // `val mort = 1; val vivant = 2` perdait sa moitie vivante : le nom, les
    // bornes, les lignes, le solde et la premiere ligne etaient tous justes.
    const sansCorps = (t: string): string => {
      let p = 0, out = '';
      for (const ch of t) {
        if (ch === '{') { p++; out += ch; continue; }
        if (ch === '}') { p = Math.max(0, p - 1); out += ch; continue; }
        out += p > 0 ? (ch === '\n' ? '\n' : ' ') : ch;
      }
      return out;
    };
    const DECLS = /(?:^|[;{])\s*(?:(?:public|private|internal|protected|open|abstract|final|sealed|data|enum|annotation|value|inline|suspend|external|expect|actual|operator|infix|lateinit|const|override|companion|static|synchronized|native|transient|volatile)\s+)*(?:val|var|fun|class|object|interface|typealias)\s+[A-Za-z_`]/g;
    const combien = (sansCorps(stripKotlinComments(coupe)).match(DECLS) ?? []).length;
    if (combien > 1) {
      compte.voisine++;
      if (fautes.length < 12) fautes.push(`VOISINE ${c.nom} ${c.path}:${c.line + 1} ${combien} declarations dans la coupe`);
    }
    if (!coupe.includes(c.nom)) {
      compte.nom++;
      if (fautes.length < 8) fautes.push(`NOM ${c.nom} ${c.path}:${c.line + 1} coupe=${JSON.stringify(coupe.slice(0, 70))}`);
    }
    if (c.end > texte.length) { compte.bornes++; continue; }
    const debutLigne = !lignesEntieres || c.start === 0 || texte[c.start - 1] === '\n';
    const finLigne = !lignesEntieres || c.end === texte.length || texte[c.end] === '\n' || texte[c.end - 1] === '\n';
    if (!debutLigne || !finLigne) {
      compte.ligne++;
      if (fautes.length < 8) fautes.push(`LIGNE ${c.nom} ${c.path}:${c.line + 1} debut=${debutLigne} fin=${finLigne}`);
    }
    if (solde(texte) !== solde(texte.slice(0, c.start) + texte.slice(c.end))) {
      compte.solde++;
      if (fautes.length < 8) fautes.push(`SOLDE ${c.nom} ${c.path}:${c.line + 1}\n      coupe=${JSON.stringify(coupe)}`);
    }
    // Une coupe ne doit pas laisser de separateur orphelin : `A,, C` ou
    // `{ , B }` ne compilent nulle part. Compare AVANT et APRES plutot que de
    // balayer le resultat, sinon un `,,` deja present dans un litteral de
    // chaine se ferait passer pour un degat de la coupe.
    const ORPHELINS = [/,[\s\n]*,/g, /[{(][\s\n]*,/g];
    const apres = texte.slice(0, c.start) + texte.slice(c.end);
    const combienOrphelins = (t: string): number =>
      ORPHELINS.reduce((n, re) => n + (t.match(re) ?? []).length, 0);
    const nouveaux = combienOrphelins(apres) - combienOrphelins(texte);
    if (nouveaux > 0) {
      compte.liste++;
      if (fautes.length < 8) fautes.push(`LISTE ${c.nom} ${c.path}:${c.line + 1} ${nouveaux} separateur(s) orphelin(s) apres la coupe`);
    }

    // Le RESTE ne doit pas porter d orphelin. Les autres invariants regardent
    // ce que la coupe CONTIENT ; celui ci regarde ce qu elle LAISSE. Une coupe
    // qui s arrete une ligne trop tot laisse un reste equilibre et sans le
    // nom, donc invisible partout ailleurs. Le signal est l indentation, choisi
    // parce qu il ne rejoue pas la regle de production qu il juge.
    // Dans la coupe une annotation appartient a la declaration ; apres la
    // coupe elle ouvre la suivante et ne se saute pas.
    const aSauterDansLaCoupe = (l: string) => {
      const t = l.trim();
      return t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('@');
    };
    const aSauterApres = (l: string) => {
      const t = l.trim();
      return t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
    };
    const rentree = (l: string): number => {
      let n = 0;
      for (const ch of l) { if (ch === ' ') n++; else if (ch === '\t') n = n - (n % 4) + 4; else break; }
      return n;
    };
    // Les bornes BRUTES : `debutLigne` et `finLigne` sont vraies d office pour
    // une coupe partielle, et raisonner en lignes entieres sur le milieu d une
    // liste d enum faisait crier l oracle sur `LAST_ACCESSED`.
    const surLignesEntieres = (c.start === 0 || texte[c.start - 1] === '\n')
      && (c.end === texte.length || texte[c.end] === '\n' || texte[c.end - 1] === '\n');
    if (surLignesEntieres) {
      const premiereCode = coupe.split('\n').find(l => !aSauterDansLaCoupe(l));
      const suivante = texte.slice(c.end).split('\n').find(l => !aSauterApres(l));
      if (premiereCode !== undefined && suivante !== undefined
        && rentree(suivante) > rentree(premiereCode)) {
        compte.orphelin++;
        if (fautes.length < 12) fautes.push(`ORPHELIN ${c.nom} ${c.path}:${c.line + 1} laisse ${JSON.stringify(suivante.slice(0, 60))} plus rentree que ${JSON.stringify(premiereCode.trim().slice(0, 40))}`);
      }
    }

    // `@JvmStatic fun x()` porte l annotation ET la declaration : ne sauter que
    // les lignes qui ne sont QUE des annotations, sinon la sonde crie a tort.
    // `[^)]*` ne sait pas traverser `@Deprecated("x", ReplaceWith("y"))` : la
    // sonde prenait alors la ligne d annotation pour du code et criait sur une
    // coupe parfaitement saine. Les parentheses se comptent.
    const seuleAnnotation = (l: string): boolean => {
      const t = l.trim();
      const tete = /^@[\w.]+\s*/.exec(t);
      if (!tete) return false;
      let i = tete[0].length;
      if (t[i] === '(') {
        let p = 0;
        for (; i < t.length; i++) {
          if (t[i] === '(') p++;
          else if (t[i] === ')' && --p === 0) { i++; break; }
        }
        if (p !== 0) return false;
      }
      return t.slice(i).trim() === '';
    };
    const premiere = stripKotlinComments(coupe).split('\n')
      .find(l => l.trim() !== '' && !seuleAnnotation(l));
    if (lignesEntieres && premiere !== undefined && !premiere.includes(c.nom)) {
      compte.depart++;
      if (fautes.length < 8) fautes.push(`DEPART ${c.nom} ${c.path}:${c.line + 1} premiere ligne coupee = ${JSON.stringify(premiere.trim().slice(0, 70))}`);
    }
  }
  console.log(`${nom.padEnd(14)} ${JSON.stringify({ coupes: coupes.length, ...compte })}`);
  for (const f of fautes) console.log('    ' + f);
}

function main(): void {
  const root = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(root, f => {
    try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ }
  });
  const parPath = new Map(sources.map(s => [s.path, s.text]));
  const base = { sources, testSourceSets: TEST_SOURCE_SETS };

  const kj032 = findUnusedSymbols(base as any) as any[];
  const membres = findUnusedMembers({
    ...base,
    deadDeclarations: kj032.map(f => ({ path: f.path, removeStart: f.removeStart, removeEnd: f.removeEnd })),
  } as any) as any[];
  const coupesMembres: Coupe[] = membres
    .filter(m => m.removeStart >= 0 && m.removeEnd > m.removeStart)
    .map(m => ({ quoi: 'membre', nom: m.name, path: m.path, line: m.line, start: m.removeStart, end: m.removeEnd }));
  verifier('membres', coupesMembres, parPath);

  const entrees = findUnusedEnumEntries(base as any) as any[];
  const coupesEnum: Coupe[] = entrees
    .filter(e => e.removeStart >= 0 && e.removeEnd > e.removeStart)
    .map(e => ({ quoi: 'enum', nom: e.name, path: e.path, line: e.line, start: e.removeStart, end: e.removeEnd }));
  verifier('enum', coupesEnum, parPath, false);

  const iles = findDeadIslands(base as any) as any[];
  const coupesIles: Coupe[] = [];
  for (const ile of iles) {
    for (const m of ile.members) {
      if (m.removeStart < 0 || m.removeEnd <= m.removeStart) continue;
      coupesIles.push({ quoi: 'ile', nom: m.name, path: m.path, line: m.line, start: m.removeStart, end: m.removeEnd });
    }
  }
  verifier('ilots', coupesIles, parPath);

  /**
   * Deux coupes d un meme fichier ne se croisent pas.
   *
   * Verifie pour les ilots depuis le debut, et pour personne d autre. Or la
   * regle vient d une entree d enum : `ASC, DESC` sur une ligne, les deux
   * mortes, chacune reclamant la meme virgule. Appliquer les deux mangeait le
   * `}` de LogDatabaseCriteria.java. Le correctif de 1.42.232 resout le
   * conflit dans le detecteur, et la propriete qu il etablit n avait aucun
   * temoin. Un invariant qui ne couvre qu une famille sur trois n en est pas
   * un.
   */
  function croisements(nom: string, coupes: Coupe[]): number {
    const parFichier = new Map<string, Coupe[]>();
    for (const c of coupes) {
      const l = parFichier.get(c.path) ?? [];
      l.push(c);
      parFichier.set(c.path, l);
    }
    let n = 0;
    for (const [p, l] of parFichier) {
      for (let i = 0; i < l.length; i++) {
        for (let j = i + 1; j < l.length; j++) {
          const a = l[i], b = l[j];
          const croise = a.start < b.end && b.start < a.end;
          // Une etendue qui en CONTIENT une autre est legitime : l ilot liste
          // la classe et ses membres, et la regle du plus englobant tranche.
          // Seul un recouvrement PARTIEL casse une edition.
          const imbrique = (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
          if (croise && !imbrique) {
            n++;
            if (n <= 6) console.log(`    CROISE ${nom} ${p} ${a.nom}[${a.start},${a.end}) et ${b.nom}[${b.start},${b.end})`);
          }
        }
      }
    }
    console.log(`croisements ${nom.padEnd(10)} : ${n}`);
    return n;
  }
  croisements('membres', coupesMembres);
  croisements('enum', coupesEnum);
  croisements('ilots', coupesIles);

  // Propre aux ilots : plusieurs coupes d un meme fichier dans UNE edition.
  // Deux etendues qui se chevauchent partiellement, sans que l une contienne
  // l autre, ne sont pas filtrees par la regle du plus englobant et feraient
  // rejeter l edition entiere.
  let chevauchements = 0;
  for (const ile of iles) {
    const parFichier = new Map<string, { start: number; end: number }[]>();
    for (const m of ile.members) {
      if (m.removeStart < 0) continue;
      const l = parFichier.get(m.path) ?? [];
      l.push({ start: m.removeStart, end: m.removeEnd });
      parFichier.set(m.path, l);
    }
    for (const [p, spans] of parFichier) {
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i], b = spans[j];
          const croise = a.start < b.end && b.start < a.end;
          const imbrique = (a.start <= b.start && a.end >= b.end) || (b.start <= a.start && b.end >= a.end);
          if (croise && !imbrique) {
            chevauchements++;
            console.log(`    CHEVAUCHE ${p} [${a.start},${a.end}) et [${b.start},${b.end})`);
          }
        }
      }
    }
  }
  console.log(`chevauchements partiels dans une meme edition : ${chevauchements}`);
}

main();
