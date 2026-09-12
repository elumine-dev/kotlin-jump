/**
 * Blanchir ne doit changer NI la longueur NI le nombre de lignes.
 *
 * `sanitizeForUsageScan` rend une copie ou commentaires et contenus de chaine
 * sont remplaces par des espaces, longueurs gardees, pour que tout offset
 * calcule dessus designe le meme caractere du texte reel. Trois detecteurs de
 * code mort construisent en plus leur table de lignes SUR CETTE COPIE
 * (`unusedDtoFields`, `unusedMembers`, `deadIslands`) et y expriment leurs
 * suppressions ; l action d arguments nommes en lit une ligne par indice.
 *
 * La branche d echappement consommait deux caracteres sans les regarder. Un
 * antislash en fin de ligne dans une chaine avalait donc le retour a la ligne :
 * la longueur restait juste, et toutes les lignes d en dessous remontaient
 * d une. Une suppression exprimee en lignes tombait alors a cote.
 *
 * Zero fichier de /Users/kevin/Desktop/work/lapresse produit cette forme, elle
 * ne compile pas. Un fichier en cours de frappe, si.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForUsageScan } from '../../../src/util/kotlinScan';

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const Q = String.fromCharCode(39);

/** Longueur et nombre de lignes, des deux cotes. */
function garde(src: string): { longueur: boolean; lignes: boolean } {
  const out = sanitizeForUsageScan(src);
  return {
    longueur: out.length === src.length,
    lignes: out.split(NL).length === src.split(NL).length,
  };
}

describe('sanitizeForUsageScan garde la forme du fichier', () => {
  it('un antislash en fin de ligne dans une chaine n avale pas le retour', () => {
    expect(garde('val a = "abc' + BS + NL + 'val b = 1' + NL)).toEqual({ longueur: true, lignes: true });
  });

  it('et la ligne suivante redevient du code', () => {
    // Sans le retour a la ligne, la chaine restait ouverte et tout le reste du
    // fichier disparaissait du balayage.
    const out = sanitizeForUsageScan('val a = "abc' + BS + NL + 'fun visible() = 1' + NL);
    expect(out).toContain('fun visible() = 1');
  });

  it('un antislash devant un retour dans un litteral de caractere non plus', () => {
    expect(garde('val c = ' + Q + BS + NL + Q + NL + 'fun f() = 1' + NL)).toEqual({ longueur: true, lignes: true });
  });

  it('temoin : les formes non fermees ordinaires gardaient deja la forme', () => {
    for (const src of [
      'val e = "abc' + NL + 'fun h() = 3' + NL,
      '/' + '* ouvert' + NL + 'fun i() = 4' + NL,
      'val f = """abc' + NL + 'fun j() = 5' + NL,
      'val d = ' + Q + 'x' + NL + 'fun g() = 2' + NL,
    ]) expect(garde(src), src).toEqual({ longueur: true, lignes: true });
  });

  it('un antislash final ne pousse pas deux caracteres pour un', () => {
    // La sortie etait plus LONGUE que l entree, l autre moitie du meme oubli.
    expect(garde('val s = "a' + BS)).toEqual({ longueur: true, lignes: true });
  });

  it('temoin : un echappement ordinaire reste blanchi sur deux caracteres', () => {
    expect(sanitizeForUsageScan('val s = "a' + BS + '"b"')).toBe('val s =       ');
  });

  it('sur mille textes tordus tires au hasard, la forme tient', () => {
    // Graine fixe : la meme suite a chaque execution.
    let etat = 987654321;
    const suivant = () => (etat = (etat * 1103515245 + 12345) >>> 0) / 4294967296;
    const alphabet = ['"', Q, BS, '/', '*', '$', '{', '}', NL, 'a', ' ', '"""'];
    for (let n = 0; n < 1000; n++) {
      let src = '';
      const taille = 4 + Math.floor(suivant() * 40);
      for (let k = 0; k < taille; k++) src += alphabet[Math.floor(suivant() * alphabet.length)];
      expect(garde(src), JSON.stringify(src)).toEqual({ longueur: true, lignes: true });
    }
  });
});
