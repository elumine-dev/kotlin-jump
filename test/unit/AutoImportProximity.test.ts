/**
 * L'ordre des imports proposes par Ctrl+.
 *
 * Le classement ne regardait que la NATURE du symbole : classe et interface
 * devant, puis composable, puis objet, puis le reste. A egalite de nature,
 * rien ne departageait, donc l'ordre etait celui de l'index, c'est a dire
 * arbitraire. La premiere proposition est pourtant celle que l'utilisateur
 * prend.
 *
 * Mesure sur un projet reel, par un aller retour a reponse connue : on retire
 * un import du fichier, on redemande l'action, la bonne reponse est l'import
 * qu'on vient de retirer. Sur 5177 imports, le bon arrivait en tete 4711 fois
 * et tombait 16 fois hors des huit places offertes. Avec le departage par
 * module puis par paquet : 4955 en tete et 4 absents.
 *
 * Le departage est un RAFFINEMENT : il n'ordonne que ce qui ne l'etait pas.
 * Faire passer la proximite AVANT la nature gagnait 15 cas de plus sur 5177,
 * mais renversait un choix delibere, donc ce n'est pas ce qui est retenu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position, Range, CodeActionTriggerKind } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { AutoImportProvider } from '../../src/providers/AutoImportProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

function reglages() {
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
    update: async () => {},
  } as any);
}

const USAGE = ['package app.ecran.detail', '', 'fun go() {', '    val v = Reglage()', '}'].join(NL);
const ICI = '/p/app/src/main/java/app/ecran/detail/Detail.kt';

/** Les titres proposes, dans l'ordre, pour `Reglage` depuis `ICI`. */
function titres(declarations: Array<[string, string]>): string[] {
  reglages();
  const index = new SymbolIndex();
  for (const [u, c] of declarations) index.add(parse('file://' + u, c));
  index.add(parse('file://' + ICI, USAGE));
  index.finalize();
  const col = USAGE.split(NL)[3].indexOf('Reglage');
  const actions = new AutoImportProvider(index).provideCodeActions(
    mockDocument('file://' + ICI, USAGE) as any,
    new Range(new Position(3, col) as any, new Position(3, col) as any) as any,
    { triggerKind: CodeActionTriggerKind.Invoke, diagnostics: [] } as any,
    {} as any,
  );
  return (actions ?? []).map(a => String(a.title));
}

const cls = (pkg: string) => ['package ' + pkg, '', 'class Reglage'].join(NL);

describe('a nature egale, le plus proche passe devant', () => {
  // `lib.x` et `lib.y` partagent tous deux ZERO segment avec `app.ecran.detail`.
  // Le critere de paquet est donc muet, et seul celui du module peut trancher.
  // Sans cette precaution les deux cas passaient sans exercer le module.
  const MEME_MODULE  = ['/p/app/src/main/java/lib/x/Reglage.kt', cls('lib.x')] as [string, string];
  const AUTRE_MODULE = ['/p/coeur/src/main/java/lib/y/Reglage.kt', cls('lib.y')] as [string, string];

  it('le meme module bat un autre module', () => {
    expect(titres([AUTRE_MODULE, MEME_MODULE])[0]).toBe("Add import 'lib.x.Reglage'");
  });

  it('et l ordre de l index n y change rien', () => {
    expect(titres([MEME_MODULE, AUTRE_MODULE])[0]).toBe("Add import 'lib.x.Reglage'");
  });

  it('dans le meme module, le paquet le plus voisin gagne', () => {
    expect(titres([
      ['/p/app/src/main/java/app/loin/Reglage.kt', cls('app.loin')],
      ['/p/app/src/main/java/app/ecran/reglages/Reglage.kt', cls('app.ecran.reglages')],
    ])[0]).toBe("Add import 'app.ecran.reglages.Reglage'");
  });

  it('mais la NATURE reste le critere premier : une classe lointaine bat une fonction voisine', () => {
    const fonction = ['package app.ecran.reglages', '', 'fun Reglage() {}'].join(NL);
    expect(titres([
      ['/p/app/src/main/java/app/ecran/reglages/R.kt', fonction],
      ['/p/coeur/src/main/java/coeur/n/Reglage.kt', cls('coeur.n')],
    ])[0]).toBe("Add import 'coeur.n.Reglage'");
  });
});
