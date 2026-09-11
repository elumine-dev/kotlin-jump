/**
 * Invariants du scanner qui colore et replie `*.versions.toml`.
 *
 * Ce scanner sert DEUX consommateurs : la coloration semantique et, depuis
 * v1.42.105, la navigation dans le fichier. Un jeton qui deborde de sa ligne
 * colore de travers ; deux jetons qui se chevauchent donnent une couleur
 * indeterminee ; et si `tokenAt` ne rend pas le meme jeton que le scan, un
 * mot colore devient injoignable au Ctrl+clic, ou l'inverse.
 *
 * Rien de tout cela n'a besoin d'une reference exterieure : ce sont des
 * proprietes que le resultat doit verifier tout seul, donc on peut les
 * imposer sur n'importe quelle entree, y compris un fichier reel de 292
 * lignes.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { scanVersionCatalog, tokenAt } from '../../src/providers/versionCatalogSyntax';

const NL = String.fromCharCode(10);
const APO = String.fromCharCode(39);

/** Chaque violation, en clair, pour qu'un echec se lise sans deboguer. */
function violations(texte: string): string[] {
  const lignes = texte.split(NL).map(l => l.replace(/\r$/, ''));
  const { tokens, regions } = scanVersionCatalog(texte);
  const pb: string[] = [];

  for (const t of tokens) {
    const L = lignes[t.line];
    if (L === undefined) { pb.push('ligne ' + t.line + ' hors du document'); continue; }
    if (t.start < 0 || t.length <= 0) pb.push('L' + t.line + ' borne absurde ' + t.start + '+' + t.length);
    if (t.start + t.length > L.length) {
      pb.push('L' + t.line + ' deborde de la ligne : ' + t.start + '+' + t.length + ' > ' + L.length);
      continue;
    }
    const brut = L.slice(t.start, t.start + t.length);
    if (t.type === 'comment' && !brut.startsWith('#')) pb.push('L' + t.line + ' comment sans # : ' + JSON.stringify(brut));
    if (t.type === 'namespace' && !brut.startsWith('[')) pb.push('L' + t.line + ' namespace sans [ : ' + JSON.stringify(brut));
    if (['string', 'number', 'enumMember'].includes(t.type) && !/^["']/.test(brut)) {
      pb.push('L' + t.line + ' ' + t.type + ' sans guillemet ouvrant : ' + JSON.stringify(brut));
    }
  }

  const parLigne = new Map<number, typeof tokens>();
  for (const t of tokens) { const a = parLigne.get(t.line) ?? []; a.push(t); parLigne.set(t.line, a); }
  for (const [l, a] of parLigne) {
    const tri = [...a].sort((x, y) => x.start - y.start);
    for (let i = 1; i < tri.length; i++) {
      if (tri[i].start < tri[i - 1].start + tri[i - 1].length) {
        pb.push('L' + l + ' jetons qui se chevauchent : ' + JSON.stringify(lignes[l]));
        break;
      }
    }
  }

  for (const r of regions) {
    if (r.start < 0 || r.end >= lignes.length || r.start >= r.end) {
      pb.push('repli absurde ' + r.start + '..' + r.end + ' pour ' + lignes.length + ' lignes');
    }
  }

  for (const t of tokens) {
    const col = t.length > 1 ? t.start + 1 : t.start; // a l interieur, pas sur un bord
    const h = tokenAt(texte, t.line, col);
    if (!h || h.start !== t.start || h.length !== t.length || h.type !== t.type) {
      pb.push('L' + t.line + ' col ' + col + ' : le scan dit ' + t.type + '@' + t.start + '+' + t.length
        + ', tokenAt dit ' + (h ? h.type + '@' + h.start + '+' + h.length : 'rien'));
    }
  }
  return pb;
}

const CAS: Array<[string, string]> = [
  ['un crochet jamais ferme',    '[libraries]' + NL + 'a = { module = "g:a"' + NL + 'b = "1.0"'],
  ['un diese dans une chaine',   '[libraries]' + NL + 'a = { module = "g:a#frag", version = "1" }'],
  ['des apostrophes',            '[versions]' + NL + 'k = ' + APO + '1.9.0' + APO],
  ['une chaine jamais fermee',   '[versions]' + NL + 'k = "1.9.0'],
  ['un tableau multiligne',      '[bundles]' + NL + 'ui = [' + NL + '  "a",' + NL + '  "b",' + NL + ']'],
  ['un entete a double crochet', '[[plugins]]' + NL + 'p = "x"'],
  ['des fins de ligne CRLF',     '[versions]\r' + NL + 'k = "1.0"\r'],
  ['un document vide',           ''],
  ['un commentaire seul',        '# rien'],
  ['un egal sans cle',           '[versions]' + NL + ' = "1.0"'],
  ['un antislash final',         '[versions]' + NL + 'k = "a\\\\"'],
  ['une table vide',             '[versions]' + NL + NL + '[libraries]' + NL + 'a = "1"'],
];

describe('le scanner de catalogue respecte ses propres invariants', () => {
  for (const [nom, texte] of CAS) {
    it('sur ' + nom, () => expect(violations(texte)).toEqual([]));
  }
});

/**
 * Le vrai fichier vaut mieux que douze fixtures : 292 lignes, 1128 jetons.
 * Absent d'une machine de CI, on saute plutot que d'echouer sur une absence
 * qui n'est pas un defaut.
 */
const REEL = '/Users/kevin/Desktop/work/lapresse/gradle/libs.versions.toml';
const present = fs.existsSync(REEL);

describe.skipIf(!present)('sur un catalogue reel', () => {
  it('aucune violation sur les 292 lignes', () => {
    const texte = fs.readFileSync(REEL, 'utf8');
    const { tokens } = scanVersionCatalog(texte);
    expect(tokens.length, 'le fichier doit vraiment etre parcouru').toBeGreaterThan(500);
    expect(violations(texte)).toEqual([]);
  });
});
