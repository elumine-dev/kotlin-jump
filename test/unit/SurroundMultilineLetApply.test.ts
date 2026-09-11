/**
 * « Surround with » sur une selection MULTILIGNE.
 *
 * `let` et `apply` sont des fonctions d'EXTENSION de la bibliotheque standard :
 * elles n'existent qu'appelees sur un recepteur. Sur une selection d'une seule
 * ligne, le fournisseur le sait et produit `expr.let { }`. Sur plusieurs
 * lignes il produisait :
 *
 *     let {
 *         <selection>
 *     }
 *
 * qui ne compile pas, faute de recepteur. `run` n'a pas ce probleme, la
 * bibliotheque en declare une version racine ; `if`, `when` et `try` non plus.
 *
 * La regle vaut aux deux entrees : la liste des actions rapides et la liste
 * deroulante du raccourci clavier.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position, Range } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import {
  surroundSelection, SurroundWithProvider, SURROUND_TEMPLATES,
} from '../../src/providers/SurroundWithProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

const SRC = [
  'fun go() {',
  '    val a = 1',
  '    val b = 2',
  '}',
].join(NL);

function offertes(debut: [number, number], fin: [number, number]) {
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, d: any) => d, update: async () => {},
  } as any);
  const r = new SurroundWithProvider().provideCodeActions(
    mockDocument('file:///p/app/src/main/java/com/x/A.kt', SRC) as any,
    new Range(new Position(debut[0], debut[1]) as any, new Position(fin[0], fin[1]) as any) as any,
    {} as any, {} as any,
  );
  return (r ?? []).map(a => String(a.title));
}

describe('let et apply ne sont pas offerts sur plusieurs lignes', () => {
  it('une selection de deux lignes', () => {
    const titres = offertes([1, 4], [2, 13]);
    expect(titres.some(t => t.includes('.let')), 'let est retire').toBe(false);
    expect(titres.some(t => t.includes('.apply')), 'apply est retire').toBe(false);
    expect(titres).toHaveLength(SURROUND_TEMPLATES.length - 2);
  });

  it('mais tout reste offert sur une seule ligne', () => {
    const titres = offertes([1, 4], [1, 13]);
    expect(titres).toHaveLength(SURROUND_TEMPLATES.length);
    expect(titres.some(t => t.includes('.let'))).toBe(true);
  });

  /**
   * Selectionner une ligne entiere pose souvent la fin en colonne 0 de la
   * ligne SUIVANTE. La commande ramene cette fin avant d'agir ; la liste des
   * actions doit raisonner pareil, sinon elle cache `let` sur le geste le plus
   * courant qui soit.
   */
  it('une ligne entiere dont la selection deborde sur la suivante reste une ligne', () => {
    const titres = offertes([1, 4], [2, 0]);
    expect(titres).toHaveLength(SURROUND_TEMPLATES.length);
  });
});

describe('et le texte produit ne ment pas', () => {
  it('sur une ligne, let et apply gardent leur recepteur', () => {
    expect(surroundSelection('let', 'valeur', '')).toBe('valeur.let { $0 }');
    expect(surroundSelection('apply', 'valeur', '')).toBe('valeur.apply { $0 }');
  });

  it('sur plusieurs lignes, let et apply ne fabriquent rien', () => {
    const sel = ['val a = 1', 'val b = 2'].join(NL);
    expect(surroundSelection('let', sel, ''), 'aucun let sans recepteur').toBe(sel);
    expect(surroundSelection('apply', sel, ''), 'aucun apply sans recepteur').toBe(sel);
  });

  it('run et les structures de controle restent intacts sur plusieurs lignes', () => {
    const sel = ['val a = 1', 'val b = 2'].join(NL);
    expect(surroundSelection('run', sel, '')).toContain('run {');
    expect(surroundSelection('if', sel, '')).toContain('if ($1) {');
    expect(surroundSelection('when', sel, '')).toContain('when ($1) {');
    expect(surroundSelection('tryCatch', sel, '')).toContain('try {');
  });
});
