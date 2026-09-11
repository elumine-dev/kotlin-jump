/**
 * Quelle racine « Afficher la hierarchie de types » ouvre-t-elle ?
 *
 * `prepareTypeHierarchy` rendait TOUTES les classes du workspace portant ce
 * nom simple. Sur des noms de variantes de `sealed class`, tres repetes, cela
 * ouvrait la vue sur une hierarchie sans rapport : la premiere racine gagne.
 *
 * Mesure sur un projet reel, 745 types interroges : 109 rendaient plusieurs
 * racines, et dans 68 cas la declaration SOUS LE CURSEUR n'etait pas la
 * premiere. `Success` en rendait 11, la bonne en cinquieme position, la
 * premiere venant d'un `RemoteImage` sans rapport ; `Builder` en rendait 15.
 *
 * La resolution des supertypes, elle, est saine : 416 rendus depuis la bonne
 * racine, aucun qui ne figure dans la clause d'heritage.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinTypeHierarchyProvider } from '../../src/providers/TypeHierarchyProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

const AUTRE = 'file:///p/app/src/main/java/com/image/RemoteImage.kt';
const AUTRE_KT = [
  'package com.image', '', 'sealed class LoadState {',
  '    data class Success(val bitmap: Int) : LoadState()', '}',
].join(NL);

const MIEN = 'file:///p/app/src/main/java/com/login/SignInResult.kt';
const MIEN_KT = [
  'package com.login', '', 'sealed class SignInResult {',
  '    data class Success(val token: String) : SignInResult()', '}',
].join(NL);

function contexte(...fichiers: Array<[string, string]>) {
  const index = new SymbolIndex();
  for (const [u, c] of fichiers) index.add(parse(u, c));
  index.finalize();
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? [] : defaut),
    update: async () => {},
  } as any);
  return index;
}

/** Les racines rendues pour le mot a (ligne, colonne) de `uri`. */
function racines(index: SymbolIndex, uri: string, code: string, mot: string, ligne: number) {
  const col = code.split(NL)[ligne].indexOf(mot);
  const r = new KotlinTypeHierarchyProvider(index).prepareTypeHierarchy(
    mockDocument(uri, code) as any, new Position(ligne, col + 1) as any,
  );
  return (r ?? []).map((x: any) => String(x.uri) + ':' + (x.range.start.line + 1));
}

describe('la hierarchie de types s ouvre sur le type vise', () => {
  it('le curseur sur une declaration ne rend QUE cette declaration', () => {
    const index = contexte([AUTRE, AUTRE_KT], [MIEN, MIEN_KT]);
    expect(racines(index, MIEN, MIEN_KT, 'Success', 3)).toEqual([MIEN + ':4']);
  });

  /**
   * Deux homonymes dans le MEME fichier : la preference « meme fichier » de
   * `resolveSearchTarget` ne suffit plus, seule la ligne du curseur tranche.
   * Mesure sur un projet reel : 48 paires fichier plus nom portent deux
   * declarations ou plus, dont un `Companion` present quatre fois.
   */
  it('deux homonymes dans un meme fichier : la LIGNE du curseur tranche', () => {
    const UN = 'file:///p/app/src/main/java/com/deux/Deux.kt';
    const UN_KT = [
      'package com.deux', '',
      'sealed class Premier {',
      '    data class Succes(val a: Int) : Premier()',
      '}', '',
      'sealed class Second {',
      '    data class Succes(val b: Int) : Second()',
      '}',
    ].join(NL);
    const index = contexte([UN, UN_KT]);
    expect(racines(index, UN, UN_KT, 'Succes', 3)).toEqual([UN + ':4']);
    expect(racines(index, UN, UN_KT, 'Succes', 7)).toEqual([UN + ':8']);
  });

  it('et l ordre d indexation n y change rien', () => {
    const index = contexte([MIEN, MIEN_KT], [AUTRE, AUTRE_KT]);
    expect(racines(index, AUTRE, AUTRE_KT, 'Success', 3)).toEqual([AUTRE + ':4']);
  });

  it('depuis un USAGE, l import explicite tranche', () => {
    const USAGE = 'file:///p/app/src/main/java/com/ecran/Ecran.kt';
    const USAGE_KT = [
      'package com.ecran', '', 'import com.login.SignInResult.Success', '',
      'fun go(s: Success) {}',
    ].join(NL);
    const index = contexte([AUTRE, AUTRE_KT], [MIEN, MIEN_KT], [USAGE, USAGE_KT]);
    expect(racines(index, USAGE, USAGE_KT, 'Success', 4)).toEqual([MIEN + ':4']);
  });

  it('sans rien pour trancher, les candidates restent toutes offertes', () => {
    const USAGE = 'file:///p/app/src/main/java/com/ecran/Flou.kt';
    const USAGE_KT = ['package com.ecran', '', 'fun go(s: Success) {}'].join(NL);
    const index = contexte([AUTRE, AUTRE_KT], [MIEN, MIEN_KT], [USAGE, USAGE_KT]);
    expect(racines(index, USAGE, USAGE_KT, 'Success', 2)).toHaveLength(2);
  });
});
