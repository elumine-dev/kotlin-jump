/**
 * Une etiquette qui repete le nom de l'argument n'apprend rien.
 *
 * `provide(actionListener, viewModelFactory)` affichait
 * `actionListener: actionListener`, `viewModelFactory: viewModelFactory`. La
 * ligne est visuellement doublee et le signal utile, celui qui nomme un
 * argument dont la forme ne dit rien (`true`, `0`, `it`), se noie dedans.
 *
 * IntelliJ et le fournisseur TypeScript de VS Code suppriment ce cas par
 * defaut. Mesure sur un projet reel de 3187 fichiers Kotlin : 4375 des 15943
 * etiquettes de nom de parametre, soit 27 %, etaient dans ce cas.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Position, Range, workspace } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';

const NL = String.fromCharCode(10);
const token = { isCancellationRequested: false } as any;
let seq = 0;
afterEach(() => vi.restoreAllMocks());

async function etiquettes(declCode: string, callCode: string): Promise<string[]> {
  const declUri = `file:///redund/decl_${seq++}.kt`;
  const callUri = `file:///redund/call_${seq++}.kt`;
  const index = new SymbolIndex();
  index.add(parse(declUri, declCode));
  vi.spyOn(workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, declCode) as any);
  const provider = new KotlinInlayHintsProvider(index);
  const lignes = callCode.split(NL);
  const range = new Range(new Position(0, 0), new Position(lignes.length - 1, lignes[lignes.length - 1].length));
  const hints = await provider.provideInlayHints(mockDocument(callUri, callCode), range, token);
  return hints.map(h => (h.label as any[])[0].value);
}

const DECL = [
  'package p',
  'fun provide(actionListener: String, viewModelFactory: Int, enabled: Boolean) {}',
].join(NL);

/** Le provider n'etiquette qu'un appel sur sa propre ligne : toutes les
 *  fixtures utilisent donc la forme multiligne. */
function appelAvec(...args: string[]): string {
  return ['package p', 'val actionListener = "a"', 'val viewModelFactory = 1',
    'val enabled = true', 'val ecouteur = "a"', 'val ActionListener = "a"',
    'fun go() {', '    provide(', ...args.map(a => '        ' + a + ','), '    )', '}'].join(NL);
}

/** Sans virgule finale : le DERNIER argument est alors suivi de `)`, pas de
 *  `,`, et c'est la forme la plus courante. */
function appelSansVirguleFinale(...args: string[]): string {
  const lignes = args.map((a, i) => '        ' + a + (i === args.length - 1 ? '' : ','));
  return ['package p', 'val actionListener = "a"', 'val viewModelFactory = 1',
    'val enabled = true', 'fun go() {', '    provide(', ...lignes, '    )', '}'].join(NL);
}

describe('etiquette de parametre redondante', () => {
  it('un argument du meme nom que le parametre n est pas etiquete', async () => {
    expect(await etiquettes(DECL, appelAvec('actionListener', '1', 'true')))
      .toEqual(['viewModelFactory:', 'enabled:']);
  });

  it('tous les arguments du meme nom disparaissent', async () => {
    expect(await etiquettes(DECL, appelAvec('actionListener', 'viewModelFactory', 'enabled')))
      .toEqual([]);
  });

  it('le DERNIER argument compte aussi, suivi d une parenthese', async () => {
    // Sans virgule finale, l'argument est suivi de `)`. Une normalisation qui
    // ne retire que la virgule laissait passer la moitie des cas reels.
    expect(await etiquettes(DECL, appelSansVirguleFinale('"x"', '1', 'enabled')))
      .toEqual(['actionListener:', 'viewModelFactory:']);
  });

  it('un appel entier sur une ligne, dernier argument compris', async () => {
    expect(await etiquettes(DECL, appelSansVirguleFinale('actionListener', 'viewModelFactory', 'enabled')))
      .toEqual([]);
  });

  it('un argument qui est lui meme un appel reste etiquete', async () => {
    // `builder()` n'est pas `actionListener` : ne pas supprimer par accident
    // en grignotant une parenthese fermante.
    expect(await etiquettes(DECL, appelSansVirguleFinale('builder()', '1', 'true')))
      .toContain('actionListener:');
  });

  it('un lambda en fin d appel ne masque pas la redondance', async () => {
    // Forme reelle : `Provide(dimensions) { ... }`. Le texte de l'argument
    // traine la suite de la ligne, ce qui laissait passer 730 cas.
    const decl = ['package p', 'fun withBloc(dimensions: Int, bloc: () -> Unit) {}'].join(NL);
    const appel = ['package p', 'val dimensions = 1', 'fun go() {',
      '    withBloc(dimensions) {', '        println(1)', '    }', '}'].join(NL);
    expect(await etiquettes(decl, appel)).toEqual([]);
  });

  it('un appel chaine apres l argument non plus', async () => {
    const decl = ['package p', 'fun app(context: String) {}'].join(NL);
    const appel = ['package p', 'val context = "c"', 'fun go() {', '    app(context).inject(this)', '}'].join(NL);
    expect(await etiquettes(decl, appel)).toEqual([]);
  });

  it('mais un nom DIFFERENT reste etiquete', async () => {
    expect(await etiquettes(DECL, appelAvec('ecouteur', '1', 'true')))
      .toEqual(['actionListener:', 'viewModelFactory:', 'enabled:']);
  });

  it('une difference de casse seule ne suffit pas a supprimer', async () => {
    // `ActionListener` n'est pas `actionListener` : l'etiquette apprend encore
    // quelque chose, et supprimer sur une comparaison laxiste ferait perdre du
    // signal.
    expect(await etiquettes(DECL, appelAvec('ActionListener', '1', 'true')))
      .toContain('actionListener:');
  });

  it('une expression qui CONTIENT le nom reste etiquetee', async () => {
    // `actionListener.name` n'est pas `actionListener` : la valeur passee
    // n'est plus la variable, donc l'etiquette garde son sens.
    expect(await etiquettes(DECL, appelAvec('actionListener.name', '1', 'true')))
      .toContain('actionListener:');
  });
});
