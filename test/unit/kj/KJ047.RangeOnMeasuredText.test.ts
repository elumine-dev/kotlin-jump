import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { makeRangeOf } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Un offset n'est valide que contre le texte sur lequel il a ete mesure.
 *
 * La premiere version demandait `isDirty`, qui repond « est ce que l'editeur
 * l'a modifie », pas « est ce que c'est encore ce que j'ai mesure ». Un
 * document recharge depuis le disque, par un checkout ou par un autre outil,
 * est PROPRE et a un contenu different, et le corpus garde sa copie une
 * minute. Les positions etaient donc calculees sur le texte perime puis
 * appliquees au document vivant.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/A.kt';
const MESURE = 'package com.x\n\nclass A\n\nclass B\n';

function doc(text: string, isDirty: boolean) {
  const lignes = text.split('\n');
  return {
    uri: vscodeMock.Uri.file(CHEMIN),
    isDirty,
    getText: () => text,
    positionAt: (offset: number) => {
      let reste = offset;
      for (let l = 0; l < lignes.length; l++) {
        if (reste <= lignes[l].length) return new vscodeMock.Position(l, reste);
        reste -= lignes[l].length + 1;
      }
      return new vscodeMock.Position(lignes.length - 1, 0);
    },
  } as any;
}

const ouvre = (docs: any[]) =>
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(docs as any);

const debut = MESURE.indexOf('class B');
const fin = MESURE.length;
const textes = new Map([[CHEMIN, MESURE]]);

afterEach(() => vi.restoreAllMocks());

describe('makeRangeOf', () => {
  it('un document ouvert dont le texte a change est saute, meme PROPRE', () => {
    ouvre([doc('package com.x\n\nclass A\n', false)]);
    expect(makeRangeOf(textes)(CHEMIN, debut, fin)).toBeUndefined();
  });

  it('un document ouvert et sale est saute', () => {
    ouvre([doc('package com.x\n\nclass A\n\nclass B\nclass C\n', true)]);
    expect(makeRangeOf(textes)(CHEMIN, debut, fin)).toBeUndefined();
  });

  it('temoin : un document ouvert identique donne la plage', () => {
    ouvre([doc(MESURE, false)]);
    const r = makeRangeOf(textes)(CHEMIN, debut, fin);
    expect(r).toBeDefined();
    expect(r!.start.line).toBe(4);
    expect(r!.start.character).toBe(0);
  });

  it('temoin : sans document ouvert, la plage vient du texte mesure', () => {
    ouvre([]);
    const r = makeRangeOf(textes)(CHEMIN, debut, fin);
    expect(r).toBeDefined();
    expect(r!.start.line).toBe(4);
  });

  it('temoin : un chemin que le scan n a pas mesure ne donne rien', () => {
    ouvre([]);
    expect(makeRangeOf(textes)('/w/inconnu.kt', 0, 1)).toBeUndefined();
  });
});
