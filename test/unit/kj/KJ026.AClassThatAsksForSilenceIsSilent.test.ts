import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';

/**
 * Une classe dont l auteur demande le silence ne voit rien signaler dedans.
 *
 * Deux trous dans le correctif de 1.42.321, qui voulait respecter
 * `@Suppress("unused")` sur une classe.
 *
 * Le premier : seul le mot `unused` comptait. Un projet qui fait tourner
 * detekt ecrit `@Suppress("UnusedPrivateMember")` ou
 * `@Suppress("UnusedPrivateProperty")`, et le projet de reference en porte sur
 * trois classes. Depuis 1.42.320 leurs proprietes privees mortes sortaient de
 * nouveau ; 1.42.319 les gardait.
 *
 * Le second : la protection passait par la regle de reflexion, qui ne couvre
 * que les proprietes. Les fonctions privees d une classe sous
 * `@Suppress("unused")` sont toujours sorties, dans toutes les versions, et
 * les notes de 1.42.321 disaient la classe protegee.
 */

const noms = (src: string) => (findUnusedDeclarations(src) as any[]).map(d => d.name).sort();
const classe = (anno: string) =>
  `package x\n\n${anno}class C {\n    private val MORT = "a"\n    private fun morte() = 1\n    fun vivant() = 2\n}\n`;

describe('une demande de silence porte sur tout le corps de la classe', () => {
  it('temoin : sans annotation, la propriete et la fonction sortent', () => {
    expect(noms(classe(''))).toEqual(['MORT', 'morte']);
  });

  for (const anno of [
    '@Suppress("unused")',
    '@SuppressWarnings("unused")',
    '@Suppress("UnusedPrivateMember")',
    '@Suppress("UnusedPrivateProperty")',
    '@Suppress("UnusedPrivateFunction")',
    '@Suppress("TooManyFunctions", "UnusedPrivateProperty", "AlsoCouldBeApply")',
  ]) {
    it(`${anno} : ni la propriete ni la fonction`, () => {
      expect(noms(classe(`${anno}\n`))).toEqual([]);
    });
  }

  for (const anno of ['@Suppress("UnusedParameter")', '@Suppress("MagicNumber")', '@OptIn(X::class)']) {
    it(`${anno} ne demande pas ce silence la`, () => {
      // `UnusedParameter` contient `Unused` : le nom entier est exige.
      expect(noms(classe(`${anno}\n`))).toEqual(['MORT', 'morte']);
    });
  }

  it('une classe imbriquee dans une classe sous silence est couverte', () => {
    const src = `package x\n\n@Suppress("UnusedPrivateMember")\nclass C {\n    class D {\n        private fun morte() = 1\n    }\n}\n`;
    expect(noms(src)).toEqual([]);
  });

  it('le silence s arrete a l accolade : la classe voisine reste surveillee', () => {
    const src = `package x\n\n@Suppress("unused")\nclass C {\n    private fun calme() = 1\n}\n\nclass D {\n    private fun morte() = 2\n}\n`;
    expect(noms(src)).toEqual(['morte']);
  });

  it('le meme silence ecrit pour tout le fichier', () => {
    const src = `@file:Suppress("UnusedPrivateMember")\n\npackage x\n\nclass C {\n    private val MORT = "a"\n    private fun morte() = 1\n}\n`;
    expect(noms(src)).toEqual([]);
  });

  it('en Java, SuppressWarnings sur la classe', () => {
    const src = `package x;\n\n@SuppressWarnings("unused")\nclass C {\n    private int mort = 1;\n    private int morte() { return 1; }\n}\n`;
    expect((findUnusedDeclarations(src, 'java') as any[]).map(d => d.name)).toEqual([]);
  });
});

describe('le silence s arrete a la classe qui le demande', () => {
  // L etendue de la classe etait prise a la premiere accolade apres son nom.
  // Une classe sans corps n en a pas : c etait celle de la classe SUIVANTE, et
  // la demande de silence couvrait ses membres prives morts.
  it('une classe sans corps ne fait pas taire la classe d apres', () => {
    const src = 'package x\n\n@Suppress("unused")\nclass A(private val injecte: Int)\n\nclass B {\n    private fun morte() = 1\n    fun vivant() = 2\n}\n';
    expect(noms(src)).toEqual(['morte']);
  });

  it('meme chose avec un constructeur sur plusieurs lignes', () => {
    const src = 'package x\n\n@Suppress("unused")\nclass A(\n    private val injecte: Int,\n)\n\nclass B {\n    private fun morte() = 1\n}\n';
    expect(noms(src)).toEqual(['morte']);
  });

  it('un constructeur sur plusieurs lignes PUIS un corps : le corps reste couvert', () => {
    // Les parametres du constructeur sont a la profondeur de la classe : les
    // prendre pour la declaration voisine laissait le corps hors du silence.
    const src = 'package x\n\n@Suppress("unused")\nclass A(\n    private val injecte: Int,\n) {\n    private fun garde() = 1\n}\n\nclass B {\n    private fun morte() = 1\n}\n';
    expect(noms(src)).toEqual(['morte']);
  });

  it('temoin : une classe avec corps reste couverte jusqu a son accolade', () => {
    const src = 'package x\n\n@Suppress("unused")\nclass A {\n    private fun garde() = 1\n}\n\nclass B {\n    private fun morte() = 1\n}\n';
    expect(noms(src)).toEqual(['morte']);
  });
});

