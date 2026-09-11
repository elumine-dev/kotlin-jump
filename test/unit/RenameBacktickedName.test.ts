/**
 * F2 sur un nom de test Kotlin ecrit entre accents graves.
 *
 * Kotlin autorise `fun \`given state is empty when loaded then shows error\`()`.
 * Le curseur y capte un SEUL mot, et `prepareRename` acceptait ce mot comme
 * s'il s'agissait d'un symbole ordinaire : le renommage partait alors reecrire
 * toutes les declarations homonymes du workspace, et la declaration visee
 * n'etait elle meme que partiellement reecrite, donc cassee.
 *
 * Mesure sur un projet reel : 1102 noms entre accents graves contenant une
 * espace, dans 184 fichiers, pour 5670 occurrences de mots qui sont aussi des
 * symboles indexes. `event` en compte 146 declarations, `state` 146, `data` 70.
 * Le balayage du renommage a produit 128 editions dans des fichiers Java sans
 * aucun rapport a partir du seul mot `given`.
 *
 * Le nom entre accents graves se renomme donc en entier, et seulement la ou il
 * apparait litteralement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinRenameProvider } from '../../src/providers/RenameProvider';

const NL = String.fromCharCode(10);
const AG = String.fromCharCode(96);
const TEST_URI = 'file:///p/app/src/test/java/com/x/EcranTest.kt';
const PROD_URI = 'file:///p/app/src/main/java/com/x/Etat.kt';
const NOM = 'given state is empty when loaded then shows error';

const TEST_KT = [
  'package com.x',
  '',
  'class EcranTest {',
  '    fun ' + AG + NOM + AG + '() {',
  '    }',
  '}',
].join(NL);

// Un vrai symbole de production qui porte l'un des mots du nom de test.
const PROD_KT = ['package com.x', '', 'class Etat {', '    fun state() {}', '}'].join(NL);

afterEach(() => vi.restoreAllMocks());

function contexte() {
  const index = new SymbolIndex();
  index.add(parse(TEST_URI, TEST_KT));
  index.add(parse(PROD_URI, PROD_KT));
  index.finalize();
  const textes = new Map([[TEST_URI, TEST_KT], [PROD_URI, PROD_KT]]);
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
    update: async () => {},
  } as any);
  vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
    const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
    const t = textes.get(uri);
    return t === undefined ? null : (mockDocument(uri, t) as any);
  });
  (workspace as any).fs = {
    readFile: async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      const t = textes.get(uri);
      if (t === undefined) throw new Error('ENOENT');
      return new TextEncoder().encode(t);
    },
  };
  return index;
}

/** La colonne du mot `state` DANS le nom entre accents graves. */
const LIGNE_DECL = 3;
const COL_STATE = TEST_KT.split(NL)[LIGNE_DECL].indexOf('state');

/**
 * L'accent grave est AUSSI la syntaxe Markdown des KDoc. La detection du nom
 * accentue avait ete placee AVANT la garde qui refuse commentaires et chaines,
 * donc F2 sur un extrait de code d'une KDoc proposait de renommer ce texte, et
 * l'edition ne touchait que le commentaire en laissant le vrai symbole intact.
 *
 * Mesure sur un projet reel : 1126 portees accentuees composites, dont 1102
 * vraies declarations et 15 extraits de code dans des KDoc.
 *
 * La garde de ligne ne suffit pas : une ligne de continuation de KDoc ne porte
 * ni `//` ni `/*`. C'est `sanitizeForUsageScan`, deja partage par les scanners
 * d'usages, qui tranche : il blanchit commentaires et chaines en preservant les
 * longueurs, donc l'accent grave n'y survit que s'il est du code.
 */
describe('un accent grave de KDoc n est pas un identifiant', () => {
  function refuse(lignes: string[], ligne: number, aiguille: string) {
    const src = lignes.join(NL);
    const uri = 'file:///p/app/src/main/java/com/x/Doc.kt';
    const index = new SymbolIndex();
    index.add(parse(uri, src));
    index.finalize();
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
      update: async () => {},
    } as any);
    const col = lignes[ligne].indexOf(aiguille);
    expect(col, 'aiguille presente dans la ligne').toBeGreaterThanOrEqual(0);
    return new KotlinRenameProvider(index).prepareRename(
      mockDocument(uri, src) as any,
      new Position(ligne, col + 1) as any,
    );
  }

  it('une ligne de continuation de KDoc est refusee', () => {
    expect(refuse([
      'package com.x',
      '',
      '/**',
      ' * Le lecteur utilise ' + AG + 'extraire le JSON' + AG + ' pour isoler la charge.',
      ' */',
      'fun lire() {}',
    ], 3, 'extraire')).toBeNull();
  });

  it('une ligne de commentaire simple est refusee', () => {
    expect(refuse([
      'package com.x',
      '',
      '// voir ' + AG + 'a b c' + AG + ' plus bas',
      'fun lire() {}',
    ], 2, 'a b c')).toBeNull();
  });

  it('une chaine de caracteres est refusee', () => {
    expect(refuse([
      'package com.x',
      '',
      'val requete = "select ' + AG + 'ma colonne' + AG + ' from t"',
    ], 2, 'ma colonne')).toBeNull();
  });

  it('mais une declaration accentuee sur la meme ligne qu un commentaire reste acceptee', () => {
    const prep = refuse([
      'package com.x',
      '',
      'class T {',
      '    fun ' + AG + 'given a when b' + AG + '() {} // voir plus bas',
      '}',
    ], 3, 'given a when b');
    expect(prep?.placeholder).toBe('given a when b');
  });
});

describe('renommer un nom de test entre accents graves', () => {
  it('propose le nom ENTIER, pas le mot sous le curseur', () => {
    const index = contexte();
    const p = new KotlinRenameProvider(index);
    const prep = p.prepareRename(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE_DECL, COL_STATE + 1) as any,
    );
    expect(prep, 'le renommage doit rester possible').not.toBeNull();
    expect(prep!.placeholder, 'le nom propose est le nom complet').toBe(NOM);
    const l = TEST_KT.split(NL)[LIGNE_DECL];
    expect(l.slice(prep!.range.start.character, prep!.range.end.character))
      .toBe(NOM);
  });

  it('ne touche a AUCUN autre fichier', async () => {
    const index = contexte();
    const we: any = await new KotlinRenameProvider(index).provideRenameEdits(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE_DECL, COL_STATE + 1) as any,
      'given state is full when loaded then shows list',
      { isCancellationRequested: false } as any,
    );
    expect(we, 'une edition doit etre produite').not.toBeNull();
    const uris = [...new Set(we.entries().map((e: any) => String(e.uri)))];
    expect(uris, 'seul le fichier du test est concerne').toEqual([TEST_URI]);
  });

  it('remplace le nom complet, et rien de partiel', async () => {
    const index = contexte();
    const NEUF = 'given state is full when loaded then shows list';
    const we: any = await new KotlinRenameProvider(index).provideRenameEdits(
      mockDocument(TEST_URI, TEST_KT) as any,
      new Position(LIGNE_DECL, COL_STATE + 1) as any,
      NEUF,
      { isCancellationRequested: false } as any,
    );
    const entrees = we.entries();
    expect(entrees).toHaveLength(1);
    const e = entrees[0];
    const ligne = TEST_KT.split(NL)[e.range.start.line];
    expect(ligne.slice(e.range.start.character, e.range.end.character)).toBe(NOM);
    expect(e.newText).toBe(NEUF);
    // Le texte resultant doit rester du Kotlin valide : accents graves intacts.
    const apres = ligne.slice(0, e.range.start.character) + NEUF + ligne.slice(e.range.end.character);
    expect(apres.trim()).toBe('fun ' + AG + NEUF + AG + '() {');
  });

  /**
   * Un nom accentue qui EST un simple identifiant doit rester un renommage
   * ORDINAIRE : le mot sous le curseur et le nom complet coincident, donc rien
   * ne derape, et les usages des autres fichiers doivent suivre. Verifier le
   * seul `placeholder` ne separait pas les deux chemins : ils rendent tous
   * deux `aide`. C'est la PORTEE des editions qui les distingue.
   */
  it('un nom accentue qui est un identifiant reste un renommage de workspace', async () => {
    const A_URI = 'file:///p/app/src/main/java/com/x/A.kt';
    const B_URI = 'file:///p/app/src/main/java/com/x/B.kt';
    const A = ['package com.x', '', 'class A {', '    fun ' + AG + 'aide' + AG + '() {}', '}'].join(NL);
    const B = ['package com.x', '', 'class B {', '    fun go(a: A) {', '        a.' + AG + 'aide' + AG + '()', '    }', '}'].join(NL);
    const index = new SymbolIndex();
    index.add(parse(A_URI, A));
    index.add(parse(B_URI, B));
    index.finalize();
    const textes = new Map([[A_URI, A], [B_URI, B]]);
    vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
      update: async () => {},
    } as any);
    vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      const t = textes.get(uri);
      return t === undefined ? null : (mockDocument(uri, t) as any);
    });
    (workspace as any).fs = {
      readFile: async (u: any) => {
        const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
        const t = textes.get(uri);
        if (t === undefined) throw new Error('ENOENT');
        return new TextEncoder().encode(t);
      },
    };
    const col = A.split(NL)[3].indexOf('aide');
    const we: any = await new KotlinRenameProvider(index).provideRenameEdits(
      mockDocument(A_URI, A) as any, new Position(3, col + 1) as any, 'secours',
      { isCancellationRequested: false } as any,
    );
    const uris = [...new Set((we?.entries() ?? []).map((e: any) => String(e.uri)))];
    expect(uris, "l'usage de l'autre fichier doit suivre").toContain(B_URI);
  });
});
