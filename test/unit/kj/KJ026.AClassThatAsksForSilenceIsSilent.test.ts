import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';

/**
 * Une classe dont l auteur demande le silence voit quand meme son code mort signale.
 *
 * G59 (2026-10-14) : la directive unused ne protege plus aucune declaration,
 * fichier compris ; ces cas en sont les temoins.
 *
 * Historique, avant G59 :
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

describe('une demande de silence sur la classe ne protege plus son corps', () => {
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
    it(`${anno} : la propriete et la fonction sortent quand meme`, () => {
      expect(noms(classe(`${anno}\n`))).toEqual(['MORT', 'morte']);
    });
  }

  for (const anno of ['@Suppress("UnusedParameter")', '@Suppress("MagicNumber")', '@OptIn(X::class)']) {
    it(`${anno} ne demande pas ce silence la`, () => {
      // `UnusedParameter` contient `Unused` : le nom entier est exige.
      expect(noms(classe(`${anno}\n`))).toEqual(['MORT', 'morte']);
    });
  }

  it('une classe imbriquee dans une classe sous silence n est pas couverte', () => {
    const src = `package x\n\n@Suppress("UnusedPrivateMember")\nclass C {\n    class D {\n        private fun morte() = 1\n    }\n}\n`;
    expect(noms(src)).toEqual(['morte']);
  });

  it('la classe sous silence et sa voisine sont surveillees toutes deux', () => {
    const src = `package x\n\n@Suppress("unused")\nclass C {\n    private fun calme() = 1\n}\n\nclass D {\n    private fun morte() = 2\n}\n`;
    expect(noms(src)).toEqual(['calme', 'morte']);
  });

  it('le meme silence ecrit pour tout le fichier ne protege rien non plus', () => {
    const src = `@file:Suppress("UnusedPrivateMember")\n\npackage x\n\nclass C {\n    private val MORT = "a"\n    private fun morte() = 1\n}\n`;
    expect(noms(src)).toEqual(['MORT', 'morte']);
  });

  it('en Java, SuppressWarnings sur la classe : les membres morts sortent', () => {
    const src = `package x;\n\n@SuppressWarnings("unused")\nclass C {\n    private int mort = 1;\n    private int morte() { return 1; }\n}\n`;
    expect((findUnusedDeclarations(src, 'java') as any[]).map(d => d.name)).toEqual(['mort', 'morte']);
  });
});

describe('une classe sous silence ne cache ni son corps ni la classe d apres', () => {
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

  it('un constructeur sur plusieurs lignes PUIS un corps : le corps sort aussi', () => {
    // Les parametres du constructeur sont a la profondeur de la classe : avant
    // G59, les prendre pour la declaration voisine laissait le corps hors du silence.
    const src = 'package x\n\n@Suppress("unused")\nclass A(\n    private val injecte: Int,\n) {\n    private fun garde() = 1\n}\n\nclass B {\n    private fun morte() = 1\n}\n';
    expect(noms(src)).toEqual(['garde', 'morte']);
  });

  it('temoin : une classe avec corps sous silence voit son membre mort sortir', () => {
    const src = 'package x\n\n@Suppress("unused")\nclass A {\n    private fun garde() = 1\n}\n\nclass B {\n    private fun morte() = 1\n}\n';
    expect(noms(src)).toEqual(['garde', 'morte']);
  });
});

describe('sur la declaration elle meme, aucune directive ne protege', () => {
  // Vu sur le projet de reference : `@Suppress("MagicNumber") private fun
  // defaultDimensions()` n etait plus appelee par personne, detekt la signalait
  // (`UnusedPrivateMember`), Kotlin Jump non. La regle des classes annotees
  // (1.42.320 a 1.42.322) ne comptait deja plus `@Suppress` comme de la
  // reflexion ; celle de la declaration continuait d ecarter toute annotation.
  it('fonction privee sous @Suppress("MagicNumber") : elle sort', () => {
    expect(noms('package x\n\n@Suppress("MagicNumber")\nprivate fun morte() = 42\n\nfun vivant() = 1\n')).toEqual(['morte']);
  });

  it('propriete privee sous @Suppress("MagicNumber") : elle sort', () => {
    expect(noms('package x\n\nclass C {\n    @Suppress("MagicNumber")\n    private val MORT = 42\n    fun vivant() = 1\n}\n')).toEqual(['MORT']);
  });

  it('@OptIn ne fait rien lire non plus', () => {
    expect(noms('package x\n\n@OptIn(ExperimentalStdlibApi::class)\nprivate fun morte() = 42\n')).toEqual(['morte']);
  });

  for (const anno of ['@Suppress("unused")', '@Suppress("UnusedPrivateMember")', '@SuppressWarnings("unused")']) {
    it(`${anno} sur la declaration : elle sort quand meme`, () => {
      expect(noms(`package x\n\n${anno}\nprivate fun garde() = 42\n`)).toEqual(['garde']);
    });
  }

  it('une annotation qui peut faire lire (injection, serialisation) protege toujours', () => {
    expect(noms('package x\n\nclass C {\n    @Inject\n    private lateinit var service: Any\n    @JvmStatic\n    private fun appelee() = 1\n}\n')).toEqual([]);
  });
});
