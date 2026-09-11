/**
 * Deux symboles declares sur la MEME ligne dans le plan du document.
 *
 * L'etendue d'un symbole va de son nom jusqu'a la FIN de la ligne qui ferme
 * son corps. Quand plusieurs declarations partagent une ligne, chacune allait
 * donc jusqu'au bout de cette ligne et avalait ses voisines :
 *
 *     data class Quadruple(val top: Int, val end: Int, val bottom: Int)
 *     enum class Type { LINEAR, RADIAL; ... }
 *
 * VS Code choisit, pour le fil d'Ariane et pour le suivi du curseur dans la
 * vue Plan, le premier symbole dont l'etendue contient le curseur. Le curseur
 * pose sur `RADIAL` affichait donc `LINEAR`.
 *
 * Mesure sur un projet reel de 5088 sources et 67519 symboles de plan : 359
 * paires de freres qui se chevauchent.
 */
import { describe, it, expect } from 'vitest';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';

const NL = String.fromCharCode(10);
const URI = 'file:///p/app/src/main/java/com/x/M.kt';

function plan(code: string) {
  const index = new SymbolIndex();
  index.add(parse(URI, code));
  index.finalize();
  return new KotlinDocumentSymbolProvider(index)
    .provideDocumentSymbols(mockDocument(URI, code) as any, {} as any);
}

/** Tout symbole, a plat, avec son chemin. */
function aPlat(liste: any[], prefixe = ''): Array<{ nom: string; s: any }> {
  const out: Array<{ nom: string; s: any }> = [];
  for (const s of liste) {
    out.push({ nom: prefixe + s.name, s });
    out.push(...aPlat(s.children ?? [], prefixe + s.name + ' > '));
  }
  return out;
}

/** Le symbole que VS Code retiendrait pour le curseur : le plus profond qui contient. */
function sousLeCurseur(liste: any[], ligne: number, col: number): string | undefined {
  for (const s of liste) {
    const r = s.range;
    const dedans = (r.start.line < ligne || (r.start.line === ligne && r.start.character <= col))
      && (ligne < r.end.line || (ligne === r.end.line && col <= r.end.character));
    if (!dedans) continue;
    return sousLeCurseur(s.children ?? [], ligne, col) ?? s.name;
  }
  return undefined;
}

const QUADRUPLE = [
  'package com.x',
  '',
  'data class Quadruple(val top: Int, val end: Int, val bottom: Int, val start: Int)',
].join(NL);

const ENUM = [
  'package com.x',
  '',
  'enum class Type {',
  '    LINEAR, RADIAL;',
  '',
  '    fun libelle(): String = name',
  '}',
].join(NL);

describe('des freres sur une meme ligne ne se chevauchent pas', () => {
  it('quatre proprietes de constructeur primaire', () => {
    const racines = plan(QUADRUPLE);
    const noms = aPlat(racines).map(x => x.nom);
    expect(noms, 'les quatre proprietes sont dans le plan').toEqual(
      expect.arrayContaining(['Quadruple', 'Quadruple > top', 'Quadruple > end', 'Quadruple > bottom', 'Quadruple > start']),
    );
    const enfants = racines[0].children;
    for (let i = 1; i < enfants.length; i++) {
      const g = enfants[i - 1], d = enfants[i];
      const chevauche = g.range.end.line > d.range.start.line
        || (g.range.end.line === d.range.start.line && g.range.end.character > d.range.start.character);
      expect(chevauche, `${g.name} deborde sur ${d.name}`).toBe(false);
    }
  });

  it('le curseur sur une propriete designe CETTE propriete', () => {
    const racines = plan(QUADRUPLE);
    const ligne = QUADRUPLE.split(NL)[2];
    for (const nom of ['top', 'end', 'bottom', 'start']) {
      const col = ligne.indexOf(' ' + nom + ':') + 1;
      expect(sousLeCurseur(racines, 2, col), 'curseur sur ' + nom).toBe(nom);
    }
  });

  it('deux entrees d enum sur une ligne', () => {
    const racines = plan(ENUM);
    const ligne = ENUM.split(NL)[3];
    expect(sousLeCurseur(racines, 3, ligne.indexOf('LINEAR'))).toBe('LINEAR');
    expect(sousLeCurseur(racines, 3, ligne.indexOf('RADIAL'))).toBe('RADIAL');
  });

  it('et une declaration seule sur sa ligne garde tout son corps', () => {
    const racines = plan(ENUM);
    const type = racines[0];
    expect(type.name).toBe('Type');
    expect(type.range.end.line, 'Type couvre jusqu a sa derniere ligne').toBe(6);
    const libelle = aPlat(racines).find(x => x.nom.endsWith('libelle'));
    expect(libelle, 'la fonction est presente').toBeDefined();
    expect(libelle!.s.range.end.line).toBe(5);
  });
});
