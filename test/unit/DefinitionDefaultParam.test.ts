/**
 * Ctrl+clic sur le TYPE d'un parametre a valeur par defaut.
 *
 *     fun ecran(
 *         vm: GameHomeViewModel = viewModel(),
 *     )
 *
 * `resolveNamedArgLhs` ne verifiait qu'une chose : le mot est suivi d'un `=`.
 * Or `vm: Type = defaut` satisfait ce test sans etre un argument nomme. Le
 * provider remontait alors jusqu'a la parenthese ouvrante, prenait `ecran`
 * pour la fonction appelee, et renvoyait vers ELLE au lieu du type.
 *
 * Un argument nomme n'est JAMAIS precede de `:` ; une annotation de type
 * l'est toujours. C'est ce qui les separe.
 *
 * Mesure sur un projet reel de 3187 fichiers Kotlin : 699 des 785 clics
 * resolus sur un type de parametre par defaut, soit 89 %, atterrissaient sur
 * la fonction englobante. `Modifier`, `Boolean`, `KeyboardOptions` : l'idiome
 * dominant de Compose.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Position, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';

const NL = String.fromCharCode(10);
const DECL = ['package p', '', 'class Reglages', '', 'fun reglages(): Reglages = Reglages()',
  '', 'fun cible(couleur: Int, taille: Int) {}'].join(NL);
const posDe = (r: any) => (r?.start ? r.start : r);
afterEach(() => vi.restoreAllMocks());

/** Ou mene un Ctrl+clic sur `mot` dans `code`, en `fichier:ligne`. */
async function clic(code: string, mot: string, occurrence = 0): Promise<string> {
  const index = new SymbolIndex();
  index.add(parse('file:///d/Decl.kt', DECL));
  index.add(parse('file:///d/Use.kt', code));
  index.finalize();
  vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    return mockDocument(uri, uri.includes('Decl') ? DECL : code) as any;
  });
  const lignes = code.split(NL);
  let ligne = -1, col = -1, vues = 0;
  for (let i = 0; i < lignes.length && ligne < 0; i++) {
    let from = 0;
    for (;;) {
      const c = lignes[i].indexOf(mot, from);
      if (c < 0) break;
      if (vues++ === occurrence) { ligne = i; col = c; break; }
      from = c + mot.length;
    }
  }
  const r: any = await new KotlinDefinitionProvider(index)
    .provideDefinition(mockDocument('file:///d/Use.kt', code) as any, new Position(ligne, col + 1) as any,
      { isCancellationRequested: false } as any);
  const loc = Array.isArray(r) ? r[0] : r;
  return loc ? String(loc.uri.path) + ':' + (posDe(loc.range).line + 1) : 'rien';
}

const TYPE = '/d/Decl.kt:3';

describe('le type d un parametre a valeur par defaut', () => {
  it('mene au type, pas a la fonction englobante', async () => {
    const code = ['package p', '', 'fun ecran(', '    r: Reglages = reglages(),', ') {}'].join(NL);
    expect(await clic(code, 'Reglages')).toBe(TYPE);
  });

  it('meme quand le defaut appelle une fonction du meme nom que le parametre', async () => {
    const code = ['package p', '', 'fun ecran(', '    reglages: Reglages = reglages(),', ') {}'].join(NL);
    expect(await clic(code, 'Reglages')).toBe(TYPE);
  });

  it('avec plusieurs parametres par defaut a la suite', async () => {
    const code = ['package p', '', 'fun ecran(', '    a: Reglages = reglages(),', '    b: Reglages = reglages(),', ') {}'].join(NL);
    expect(await clic(code, 'Reglages', 0)).toBe(TYPE);
    expect(await clic(code, 'Reglages', 1), 'le second parametre aussi').toBe(TYPE);
  });

  it('et sans valeur par defaut, comme avant', async () => {
    const code = ['package p', '', 'fun ecran(', '    r: Reglages,', ') {}'].join(NL);
    expect(await clic(code, 'Reglages')).toBe(TYPE);
  });
});

describe('un vrai argument nomme garde sa resolution', () => {
  it('le nom a gauche du egal mene au parametre de la fonction appelee', async () => {
    // C'est la raison d'etre de `resolveNamedArgLhs` : ne pas la casser.
    const code = ['package p', '', 'fun go() {', '    cible(couleur = 1, taille = 2)', '}'].join(NL);
    expect(await clic(code, 'couleur')).toBe('/d/Decl.kt:7');
  });

  it('meme quand un deux-points apparait AILLEURS sur la ligne', async () => {
    // La garde doit regarder juste avant le mot, pas n'importe ou sur la
    // ligne : ici `couleur` est bien un argument nomme malgre le `: Int`.
    const code = ['package p', '', 'fun go() {', '    val x: Int = cible(couleur = 1, taille = 2)', '}'].join(NL);
    expect(await clic(code, 'couleur')).toBe('/d/Decl.kt:7');
  });

  it('sur plusieurs lignes aussi', async () => {
    const code = ['package p', '', 'fun go() {', '    cible(', '        couleur = 1,', '        taille = 2,', '    )', '}'].join(NL);
    expect(await clic(code, 'couleur')).toBe('/d/Decl.kt:7');
  });
});

/**
 * La garde qui separe une annotation de type d'un argument nomme n'est plus
 * necessaire a la CORRECTION depuis v1.42.148 : la verification des
 * candidates rattrape le symptome. Elle est devenue le chemin rapide, et
 * plus aucun test de correction ne la protege. Celui ci s'en charge.
 */
describe('un type de parametre par defaut ne paie pas la resolution lente', () => {
  it('aucun fichier n est ouvert pour un tel clic', async () => {
    const index = new SymbolIndex();
    index.add(parse('file:///d/Decl.kt', DECL));
    const code = ['package p', '', 'fun ecran(', '    r: Reglages = reglages(),', ') {}'].join(NL);
    index.add(parse('file:///d/Use.kt', code));
    index.finalize();
    const ouvrir = vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      return mockDocument(uri, uri.includes('Decl') ? DECL : code) as any;
    });
    const lignes = code.split(NL);
    const ligne = lignes.findIndex(L => L.includes('Reglages'));
    await new KotlinDefinitionProvider(index).provideDefinition(
      mockDocument('file:///d/Use.kt', code) as any,
      new Position(ligne, lignes[ligne].indexOf('Reglages') + 1) as any,
      { isCancellationRequested: false } as any,
    );
    expect(ouvrir.mock.calls.length,
      'la resolution asynchrone ne doit pas etre empruntee pour une annotation de type').toBe(0);
  });

  it('alors qu un vrai argument nomme l emprunte bien', async () => {
    // Le temoin : sans lui, le test ci dessus passerait aussi si plus rien
    // n'ouvrait jamais de fichier.
    const index = new SymbolIndex();
    index.add(parse('file:///d/Decl.kt', DECL));
    const code = ['package p', '', 'fun go() {', '    cible(', '        couleur = 1,', '    )', '}'].join(NL);
    index.add(parse('file:///d/Use.kt', code));
    index.finalize();
    const ouvrir = vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      return mockDocument(uri, uri.includes('Decl') ? DECL : code) as any;
    });
    await new KotlinDefinitionProvider(index).provideDefinition(
      mockDocument('file:///d/Use.kt', code) as any, new Position(4, 9) as any,
      { isCancellationRequested: false } as any,
    );
    expect(ouvrir.mock.calls.length, 'un argument nomme doit ouvrir la candidate').toBeGreaterThan(0);
  });
});
