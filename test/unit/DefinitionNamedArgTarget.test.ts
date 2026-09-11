/**
 * Ctrl+clic sur le nom d'un argument nomme, quand plusieurs fonctions du
 * workspace portent le meme nom.
 *
 * `resolveParamInIndexedFunction` renvoyait la ligne de declaration de
 * CHAQUE fonction homonyme, sans jamais verifier qu'elle possede le
 * parametre en question. Son commentaire presentait cela comme « une nette
 * amelioration par rapport a l'absence de resultat » ; la mesure dit le
 * contraire. Sur un projet reel de 3187 fichiers Kotlin, 266 des 651 clics
 * concernes, soit 41 %, atterrissaient sur une fonction sans ce parametre :
 * cliquer `margin` ouvrait `PhotoObjectModel(url, width, ...)` dans un autre
 * module. Etre envoye au mauvais endroit est pire que de ne pas bouger.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Position, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';

const NL = String.fromCharCode(10);
const posDe = (r: any) => (r?.start ? r.start : r);
afterEach(() => vi.restoreAllMocks());

// Deux `assembler` homonymes : seul celui de B porte `margin`.
const A = ['package p', '', 'fun assembler(url: String, width: Int) {}'].join(NL);
const B = ['package p', '', 'fun assembler(', '    margin: Int,', '    padding: Int,', ') {}'].join(NL);

async function clic(code: string, mot: string, fichiers: Array<[string, string]>): Promise<string> {
  const index = new SymbolIndex();
  for (const [u, c] of fichiers) index.add(parse(u, c));
  index.add(parse('file:///n/Use.kt', code));
  index.finalize();
  const tous = new Map<string, string>([...fichiers, ['file:///n/Use.kt', code]]);
  vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    const t = tous.get(uri);
    return t === undefined ? null : (mockDocument(uri, t) as any);
  });
  const lignes = code.split(NL);
  let ligne = -1, col = -1;
  lignes.forEach((L, i) => { const c = L.indexOf(mot); if (c >= 0 && ligne < 0) { ligne = i; col = c; } });
  const r: any = await new KotlinDefinitionProvider(index)
    .provideDefinition(mockDocument('file:///n/Use.kt', code) as any, new Position(ligne, col + 1) as any,
      { isCancellationRequested: false } as any);
  const loc = Array.isArray(r) ? r[0] : r;
  return loc ? String(loc.uri.path) + ':' + (posDe(loc.range).line + 1) : 'rien';
}

const APPEL = ['package p', '', 'fun go() {', '    assembler(', '        margin = 1,', '    )', '}'].join(NL);

describe('un argument nomme et plusieurs fonctions homonymes', () => {
  it('mene a la fonction qui porte VRAIMENT le parametre', async () => {
    expect(await clic(APPEL, 'margin', [['file:///n/A.kt', A], ['file:///n/B.kt', B]]))
      .toBe('/n/B.kt:4');
  });

  it('meme si la mauvaise candidate est indexee en premier', async () => {
    expect(await clic(APPEL, 'margin', [['file:///n/B.kt', B], ['file:///n/A.kt', A]]))
      .toBe('/n/B.kt:4');
  });

  it('et ne mene NULLE PART si aucune ne le porte', async () => {
    // Ne pas bouger vaut mieux qu'ouvrir un fichier sans rapport.
    const appel = ['package p', '', 'fun go() {', '    assembler(', '        inconnu = 1,', '    )', '}'].join(NL);
    expect(await clic(appel, 'inconnu', [['file:///n/A.kt', A]])).toBe('rien');
  });

  it('une seule candidate, qui porte le parametre, marche toujours', async () => {
    expect(await clic(APPEL, 'margin', [['file:///n/B.kt', B]])).toBe('/n/B.kt:4');
  });

  it('la fonction du MEME fichier reste prioritaire', async () => {
    const local = ['package p', '', 'fun assembler(margin: Int) {}', '', 'fun go() {', '    assembler(', '        margin = 1,', '    )', '}'].join(NL);
    expect(await clic(local, 'margin', [['file:///n/A.kt', A]])).toBe('/n/Use.kt:3');
  });
});
