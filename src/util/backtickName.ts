/**
 * Les noms Kotlin ecrits entre accents graves.
 *
 * Kotlin autorise `fun ` + ACCENT + `given a when b then c` + ACCENT + `()`. Le curseur pose dedans
 * n'y capte qu'UN mot, et traiter ce mot comme un symbole ordinaire envoie
 * chaque fonctionnalite vers un homonyme sans rapport. Mesure sur un projet
 * reel de 1095 noms de ce genre, curseur au milieu du nom : 312 cibles fausses
 * pour Ctrl+clic et 305 racines fausses pour la hierarchie d'appels.
 *
 * Une seule implementation de la regle, partagee, pour qu'aucune copie ne
 * derive.
 */
import * as vscode from 'vscode';
import { sanitizeForUsageScan } from './kotlinScan';

export const ACCENT = String.fromCharCode(96);
const EST_IDENTIFIANT = /^[A-Za-z_]\w*$/;

export interface PorteeAccentuee {
  /** Colonne du premier caractere du contenu. */
  start: number;
  /** Colonne juste apres le dernier caractere du contenu. */
  end: number;
  content: string;
}

/** La portee entre accents graves qui contient `col`, bornes du CONTENU. */
export function porteeAccentuee(lineText: string, col: number): PorteeAccentuee | undefined {
  let i = 0;
  while (i < lineText.length) {
    const ouvre = lineText.indexOf(ACCENT, i);
    if (ouvre < 0) return undefined;
    const ferme = lineText.indexOf(ACCENT, ouvre + 1);
    if (ferme < 0) return undefined;
    if (col > ouvre && col <= ferme) {
      return { start: ouvre + 1, end: ferme, content: lineText.slice(ouvre + 1, ferme) };
    }
    i = ferme + 1;
  }
  return undefined;
}

/**
 * Le curseur est il dans un nom accentue qui n'est PAS un simple identifiant ?
 *
 * ACCENT + `is` + ACCENT reste un cas ordinaire : le mot sous le curseur et le nom complet
 * coincident, donc rien ne derape. Un accent grave dans un commentaire ou une
 * chaine n'est pas un identifiant non plus, c'est du Markdown de KDoc ; la
 * garde de ligne ne suffit pas a le voir, une ligne de continuation de KDoc ne
 * portant ni `//` ni `/*`, donc c'est `sanitizeForUsageScan` qui tranche.
 */
export function nomAccentueComposite(
  document: vscode.TextDocument,
  position: vscode.Position,
): PorteeAccentuee | undefined {
  if (document.languageId !== 'kotlin') return undefined;
  const portee = porteeAccentuee(document.lineAt(position.line).text, position.character);
  if (!portee || portee.content === '') return undefined;
  if (EST_IDENTIFIANT.test(portee.content)) return undefined;
  const propre = sanitizeForUsageScan(document.getText()).split(String.fromCharCode(10));
  if ((propre[position.line] ?? '')[portee.start - 1] !== ACCENT) return undefined;
  return portee;
}

/**
 * Les plages du CONTENU de ce nom, la ou il apparait LITTERALEMENT dans ce
 * document, accents graves exclus.
 *
 * Le fichier suffit : 1086 des 1090 noms accentues distincts d'un projet reel
 * n'existent que dans un seul fichier, et les 4 restants sont des tests
 * homonymes de classes differentes, qu'il ne faut surtout pas relier.
 */
export function plagesDuNomAccentue(
  document: vscode.TextDocument,
  contenu: string,
): vscode.Range[] {
  const litteral = ACCENT + contenu + ACCENT;
  const out: vscode.Range[] = [];
  for (let l = 0; l < document.lineCount; l++) {
    const texte = document.lineAt(l).text;
    let at = texte.indexOf(litteral);
    while (at >= 0) {
      out.push(new vscode.Range(l, at + 1, l, at + litteral.length - 1));
      at = texte.indexOf(litteral, at + litteral.length);
    }
  }
  return out;
}
