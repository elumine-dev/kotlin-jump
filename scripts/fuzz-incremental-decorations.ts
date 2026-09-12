/**
 * Differential oracle for the two incremental decoration providers.
 *
 * The incremental path must return exactly what a full rescan of the same text
 * returns. Anything else is a bug the unit tests did not think of.
 *
 *   node_modules/.bin/esbuild scripts/fuzz-incremental-decorations.ts --bundle \
 *     --platform=node --format=cjs \
 *     --alias:vscode=$PWD/test/unit/__mocks__/vscode.ts --outfile=dist/perf/fuzz.cjs
 *   node dist/perf/fuzz.cjs <project-root> <hex|null> <files> <edits> [seed] [mono]
 *
 * It runs on real sources rather than fixtures, because the shapes that break
 * an incremental scan (a KDoc above a raw string, a block comment at the very
 * end of a file) are the ones a hand written fixture never contains.
 *
 * Chaque edition est traduite en un vrai TextDocumentChangeEvent, appliquee au
 * modele de texte, puis les deux resultats sont compares.
 *
 * `KJ_TEMOIN=1` ne transmet PAS un evenement sur sept au chemin incrementiel,
 * ce que fait une invalidation manquante, et le harnais doit alors crier. Sans
 * ce temoin, zero divergence ne prouve rien : le comparateur pourrait ne rien
 * comparer du tout. L'en tete annonçait ce temoin depuis le premier jour, et
 * il n'existait pas.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HexColorFoldingProvider } from '../src/providers/HexColorFoldingProvider';
import { NullAssertionProvider } from '../src/providers/NullAssertionProvider';

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, hit: (f: string) => void): void {
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const full = path.join(dir, x.name);
    if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(full, hit); }
    else if (x.name.endsWith('.kt')) hit(full);
  }
}

/** Generateur deterministe : une graine, une sequence rejouable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function editeur(lignes: string[]) {
  return {
    document: {
      languageId: 'kotlin',
      get lineCount() { return lignes.length; },
      lineAt: (i: number) => {
        if (i < 0 || i >= lignes.length) throw new Error('hors bornes: ' + i);
        return { text: lignes[i] };
      },
    },
    derniere: [] as any[],
    setDecorations(_t: any, decs: any[]) { this.derniere = decs; },
  } as any;
}

const empreinte = (decs: any[]) =>
  decs.map(d => `${d.range.start.line}:${d.range.start.character}:${d.range.end.character}`)
    .sort().join(',');

const MORCEAUX = [
  'val x = 0xFF112233', 'val y = a!!', '/' + '*', '*' + '/', '"""', '// note',
  'fun z() {}', '', '    val w = b!!.c', 'val s = """texte"""',
];

interface Edition { sl: number; sc: number; el: number; ec: number; texte: string; }

function tirerEdition(lignes: string[], r: () => number): Edition {
  const n = lignes.length;
  const sl = Math.floor(r() * n);
  const acte = r();
  if (acte < 0.30) {                                     // frappe d un caractere
    const sc = Math.floor(r() * (lignes[sl].length + 1));
    return { sl, sc, el: sl, ec: sc, texte: MORCEAUX[Math.floor(r() * MORCEAUX.length)].slice(0, 3) };
  }
  if (acte < 0.55) {                                     // insertion d une ligne
    const sc = Math.floor(r() * (lignes[sl].length + 1));
    return { sl, sc, el: sl, ec: sc, texte: '\n' + MORCEAUX[Math.floor(r() * MORCEAUX.length)] };
  }
  if (acte < 0.72) {                                     // collage multiligne
    const sc = Math.floor(r() * (lignes[sl].length + 1));
    const k = 2 + Math.floor(r() * 4);
    let t = '';
    for (let i = 0; i < k; i++) t += '\n' + MORCEAUX[Math.floor(r() * MORCEAUX.length)];
    return { sl, sc, el: sl, ec: sc, texte: t };
  }
  if (acte < 0.90) {                                     // suppression de lignes
    const k = 1 + Math.floor(r() * 5);
    const el = Math.min(sl + k, n - 1);
    return { sl, sc: 0, el, ec: el === n - 1 ? lignes[el].length : 0, texte: '' };
  }
  // remplacement d une portion de ligne
  const sc = Math.floor(r() * (lignes[sl].length + 1));
  const ec = Math.min(lignes[sl].length, sc + Math.floor(r() * 6));
  return { sl, sc, el: sl, ec, texte: MORCEAUX[Math.floor(r() * MORCEAUX.length)].slice(0, 4) };
}

/** Applique l edition au modele, exactement comme l editeur le ferait. */
function appliquer(lignes: string[], e: Edition): void {
  const avant = lignes[e.sl].slice(0, e.sc);
  const apres = lignes[e.el].slice(e.ec);
  const milieu = (avant + e.texte + apres).split('\n');
  lignes.splice(e.sl, e.el - e.sl + 1, ...milieu);
}

function evenement(doc: any, es: Edition[]) {
  return {
    document: doc,
    reason: undefined,
    contentChanges: es.map(e => ({
      range: { start: { line: e.sl, character: e.sc }, end: { line: e.el, character: e.ec } },
      text: e.texte, rangeOffset: 0, rangeLength: 0,
    })),
  };
}

/**
 * Un multi curseur : plusieurs editions disjointes dans UN evenement, telles
 * que l editeur les livre, c est a dire toutes en coordonnees du document
 * d avant. Elles sont tirees du bas vers le haut pour rester sans recouvrement.
 */
function tirerLot(lignes: string[], r: () => number): Edition[] {
  const lot: Edition[] = [];
  let plafond = lignes.length - 1;
  const combien = 2 + Math.floor(r() * 2);
  for (let i = 0; i < combien && plafond > 1; i++) {
    const e = tirerEdition(lignes.slice(0, plafond + 1), r);
    lot.push(e);
    plafond = e.sl - 1;
  }
  return lot;
}

function complet(Provider: any, lignes: string[]): string {
  const p = new Provider();
  const ed = editeur([...lignes]);
  (p as any)._editor = ed;
  (p as any)._fullScan(ed);
  return empreinte(ed.derniere);
}

function main(): void {
  const racine = process.argv[2];
  const quoi = process.argv[3];
  const nbFichiers = Number(process.argv[4] ?? 60);
  const nbEditions = Number(process.argv[5] ?? 40);
  const graine = Number(process.argv[6] ?? 12345);
  const multi = process.argv[7] !== 'mono';
  const temoin = process.env.KJ_TEMOIN === '1';
  const Provider = quoi === 'hex' ? HexColorFoldingProvider : NullAssertionProvider;

  const tous: string[] = [];
  walk(racine, f => tous.push(f));
  const r = rng(graine);
  const choisis: string[] = [];
  for (let i = 0; i < nbFichiers && tous.length; i++) choisis.push(tous[Math.floor(r() * tous.length)]);

  let divergences = 0, editions = 0, fichiers = 0;
  const exemples: string[] = [];

  for (const f of choisis) {
    let texte: string;
    try { texte = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const lignes = texte.split('\n');
    if (lignes.length < 4 || lignes.length > 2500) continue;
    fichiers++;

    const provider = new Provider();
    const ed = editeur(lignes);
    (provider as any)._editor = ed;
    (provider as any)._fullScan(ed);

    for (let k = 0; k < nbEditions; k++) {
      // Un tiers des evenements portent plusieurs changements, comme un
      // multi curseur : c est la ou les decalages successifs se composent.
      const lot = multi && r() < 0.34 ? tirerLot(lignes, r) : [tirerEdition(lignes, r)];
      if (lot.length === 0) continue;
      for (const e of lot) appliquer(lignes, e);   // deja tries du bas vers le haut
      // Le temoin saute la transmission, pas l'edition : le texte bouge, le
      // fournisseur ne l'apprend pas. C'est exactement la forme du defaut que
      // ce harnais existe pour attraper.
      if (!(temoin && k % 7 === 3)) {
        (provider as any)._applyChanges(evenement(ed.document, lot));
        (provider as any)._flush(ed);
      }
      editions++;
      const e = lot[0];
      const incremental = empreinte(ed.derniere);
      const reference = complet(Provider, lignes);
      if (incremental !== reference) {
        divergences++;
        if (exemples.length < 6) {
          exemples.push(`${path.relative(racine, f)} edition ${k} `
            + `(${e.sl},${e.sc})-(${e.el},${e.ec}) texte=${JSON.stringify(e.texte).slice(0, 40)}`
            + `\n      incr: ${incremental.slice(0, 160)}`
            + `\n      plein: ${reference.slice(0, 160)}`);
        }
        break;   // le fournisseur est desynchronise, la suite n apprend rien
      }
    }
  }

  console.log(JSON.stringify({ quoi, graine, temoin, fichiers, editions, divergences }, null, 0));
  for (const x of exemples) console.log('  ' + x);
}

main();
