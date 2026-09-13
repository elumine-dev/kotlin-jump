/**
 * Ce que la famille des ENTREES D ENUM coupe, sur un vrai projet.
 *
 *   npx vite-node scripts/verify-enum-entry-removals.ts <racine>
 *
 * Cinq temoins existaient : symboles, ilots de membres, cascade d imports,
 * co-suppression des tests, balayage. Aucun ne regardait celle ci, et elle
 * calcule pourtant une etendue de coupe comme les autres. Elle a livre
 * pendant une trentaine de versions une coupe qui laissait une annotation
 * multiligne derriere elle, rattachee a l entree suivante quand il y en avait
 * une et collee a l accolade fermante quand il n y en avait pas, auquel cas le
 * fichier cessait de parser.
 *
 * Invariants :
 *   nom        le nom de l entree est dans sa coupe
 *   bornes     la coupe tient dans le texte et n est pas vide
 *
 * Pas de regle « lignes entieres » ici, contrairement aux autres temoins :
 * retirer la DERNIERE entree oblige a manger la virgule de la precedente, donc
 * une coupe juste commence en milieu de ligne et franchit un retour. Mesure
 * sur le projet de reference : 3 des 33 coupes ont cette forme.
 *   solde      accolades et parentheses du fichier restent equilibrees
 *   orpheline  aucune annotation ne reste sans declaration derriere elle
 *   croise     deux coupes du meme fichier ne se chevauchent pas
 *   liste      l enum RELU apres la coupe porte exactement les memes entrees
 *              qu avant, moins celle qui part. C est l invariant qui compte :
 *              les autres decrivent la forme du texte, celui ci relit le sens.
 *              Un decalage d un caractere echappait a tous les autres 22 fois
 *              sur 33 ; il n echappe plus a celui la.
 *   deplacee   aucune entree SURVIVANTE n herite d une annotation qu elle
 *              n avait pas. `orpheline` ne voit que l annotation restee sans
 *              rien derriere elle ; celle ci voit celle qui s est recollee sur
 *              la voisine vivante, ou le fichier compile toujours et ou le
 *              `@Deprecated` du mort devient celui du vif.
 *   virgule    ce qui reste ne porte pas deux virgules de suite ni `{ ,`
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedEnumEntries, collectEnums } from '../src/providers/unusedEnumEntries';
import { sanitizeForUsageScan } from '../src/util/kotlinScan';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, vu: (f: string) => void): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, vu);
    else if (/\.(kt|java)$/.test(e.name)) vu(p);
  }
}

const solde = (t: string): string => {
  let a = 0, p = 0;
  for (const c of t) {
    if (c === '{') a++; else if (c === '}') a--;
    else if (c === '(') p++; else if (c === ')') p--;
  }
  return `${a}/${p}`;
};

/**
 * Une annotation que plus rien ne suit.
 *
 * Formule a l envers de la regle de production : celle ci ne demande pas ou la
 * coupe aurait du commencer, elle cherche dans le RESTE une annotation dont la
 * declaration est partie. Sur le texte assaini, donc sans commentaire ni corps
 * de chaine pour la brouiller.
 */
function annotationOrpheline(reste: string): string | undefined {
  const lignes = sanitizeForUsageScan(reste).split('\n');
  for (let i = 0; i < lignes.length; i++) {
    if (!/^\s*@/.test(lignes[i])) continue;
    let j = i;
    // Une annotation peut s etaler : avancer jusqu a l equilibre de ses parens.
    let p = 0;
    do {
      for (const c of lignes[j]) { if (c === '(') p++; else if (c === ')') p--; }
      j++;
    } while (p > 0 && j < lignes.length);
    // Ce qui suit, en sautant les lignes vides et les autres annotations.
    let k = j;
    while (k < lignes.length && (lignes[k].trim() === '' || /^\s*@/.test(lignes[k]))) k++;
    if (k >= lignes.length || /^\s*[})]/.test(lignes[k])) return lignes[i].trim() || '@?';
  }
  return undefined;
}

/** Les noms d entrees que le parseur retrouve dans ce texte, dans l ordre. */
function entreesDe(texte: string, chemin: string): string[] {
  try {
    return collectEnums([{ path: chemin, text: texte }] as any, [])
      .flatMap(e => e.entries.map((x: any) => x.name));
  } catch {
    return [];
  }
}

/**
 * Pour chaque entree, le nombre d annotations qui la precedent dans son enum.
 *
 * Comptees dans l espace qui va de la fin de l entree precedente, ou de la
 * declaration de l enum pour la premiere, jusqu au nom de celle ci. Une
 * suppression juste laisse ce compte inchange pour toutes les survivantes ;
 * une annotation abandonnee par le mort fait grimper celui de sa voisine.
 */
function annotationsAvantChaqueEntree(texte: string, chemin: string): Map<string, number> {
  const out = new Map<string, number>();
  const lignes = sanitizeForUsageScan(texte).split('\n');
  let enums: any[];
  try {
    enums = collectEnums([{ path: chemin, text: texte }] as any, []);
  } catch {
    return out;
  }
  for (const e of enums) {
    let precedente = -1;
    for (const en of e.entries as any[]) {
      // Depuis la fin de l'entree precedente, et jamais au dela de l'accolade
      // qui ouvre le corps de l'enum : pour la PREMIERE entree le bloc partait
      // sinon de la ligne 0 et comptait toutes les annotations du fichier
      // au dessus, ce qui faisait crier sur un enum qui n'en porte aucune.
      const bloc: string[] = [];
      for (let l = en.line - 1; l > precedente; l--) {
        if ((lignes[l] ?? '').includes('{')) break;
        bloc.unshift(lignes[l] ?? '');
      }
      bloc.push((lignes[en.line] ?? '').slice(0, en.character));
      out.set(`${e.name}.${en.name}`, bloc.join('\n').split('@').length - 1);
      precedente = en.line;
    }
  }
  return out;
}

function main(): void {
  const racine = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(racine, f => { try { sources.push({ path: f, text: fs.readFileSync(f, 'utf8') }); } catch { /* illisible */ } });

  const compte = { nom: 0, bornes: 0, solde: 0, orpheline: 0, croise: 0, virgule: 0, liste: 0, deplacee: 0 };
  const fautes: string[] = [];
  const trouvailles = findUnusedEnumEntries({ sources: sources as any, testSourceSets: [] }) as any[];

  const parFichier = new Map<string, any[]>();
  for (const e of trouvailles) {
    if (e.removeStart < 0) continue;
    const l = parFichier.get(e.path) ?? [];
    l.push(e);
    parFichier.set(e.path, l);
  }

  let coupes = 0;
  for (const [p, liste] of parFichier) {
    const texte = sources.find(s => s.path === p)!.text;
    const rel = path.relative(racine, p);
    liste.sort((a, b) => a.removeStart - b.removeStart);
    let finPrec = -1;
    for (const e of liste) {
      coupes++;
      if (e.removeStart < 0 || e.removeEnd > texte.length || e.removeEnd <= e.removeStart) {
        compte.bornes++;
        if (fautes.length < 12) fautes.push(`BORNES ${rel} ${e.name} ${e.removeStart}..${e.removeEnd}`);
        continue;
      }
      const coupe = texte.slice(e.removeStart, e.removeEnd);
      if (!coupe.includes(e.name)) {
        compte.nom++;
        if (fautes.length < 12) fautes.push(`NOM ${rel} ${e.name} absent de sa coupe`);
      }
      if (e.removeStart < finPrec) {
        compte.croise++;
        if (fautes.length < 12) fautes.push(`CROISE ${rel} ${e.name}`);
      }
      finPrec = Math.max(finPrec, e.removeEnd);

      const reste = texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);
      if (solde(texte) !== solde(reste)) {
        compte.solde++;
        if (fautes.length < 12) fautes.push(`SOLDE ${rel} ${e.name} ${solde(texte)} -> ${solde(reste)}`);
      }
      const avantListe = entreesDe(texte, p);
      const apresListe = entreesDe(reste, p);
      const attendu = avantListe.filter(n => n !== e.name);
      if (avantListe.length > 0 && apresListe.join(',') !== attendu.join(',')) {
        compte.liste++;
        if (fautes.length < 12) {
          fautes.push(`LISTE ${rel} ${e.name} attendu [${attendu.join(' ')}] obtenu [${apresListe.join(' ')}]`);
        }
      }
      const avantAnnos = annotationsAvantChaqueEntree(texte, p);
      const apresAnnos = annotationsAvantChaqueEntree(reste, p);
      for (const [cle, n] of apresAnnos) {
        const ancien = avantAnnos.get(cle);
        if (ancien !== undefined && n > ancien) {
          compte.deplacee++;
          if (fautes.length < 12) fautes.push(`DEPLACEE ${rel} ${e.name} laisse ${n - ancien} annotation(s) a ${cle}`);
          break;
        }
      }
      const orpheline = annotationOrpheline(reste);
      if (orpheline !== undefined && annotationOrpheline(texte) === undefined) {
        compte.orpheline++;
        if (fautes.length < 12) fautes.push(`ORPHELINE ${rel} ${e.name} laisse ${JSON.stringify(orpheline)}`);
      }
      if (/,\s*,/.test(sanitizeForUsageScan(reste)) || /\{\s*,/.test(sanitizeForUsageScan(reste))) {
        compte.virgule++;
        if (fautes.length < 12) fautes.push(`VIRGULE ${rel} ${e.name}`);
      }
    }
  }

  console.log(JSON.stringify({ sources: sources.length, trouvailles: trouvailles.length, coupes, ...compte }));
  for (const x of fautes) console.log('  ' + x);
}

main();
