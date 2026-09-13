import { describe, it, expect } from 'vitest';
import { findUnusedLocals } from '../../../src/providers/unusedLocals';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';
import { collectAnnotationTargets } from '../../../src/util/kotlinScan';

/**
 * Deux trous de la meme journee, sur deux detecteurs.
 *
 * Le premier : retirer une variable locale morte prenait sa ligne entiere,
 * ouverture de commentaire de bloc comprise, en laissant la fermeture seule
 * derriere. Troisieme chemin de coupe touche par cette famille.
 *
 * Le second : la garde qui protege les classes annotees, parce qu un
 * generateur peut lire leurs proprietes sans les nommer, comptait aussi
 * `@Suppress`, `@SuppressWarnings` et `@OptIn`. Ces trois la ne s adressent
 * qu au compilateur. Sur le projet de reference, un
 * `@SuppressWarnings("TooManyFunctions")` pose sur un objet cachait ses dix
 * constantes privees, dont une que detekt signalait morte au meme moment.
 */

const applique = (src: string) => {
  const l = (findUnusedLocals(src) as any[]).find(x => x.name === 'mort');
  if (!l || l.fixStart < 0) return undefined;
  return { coupe: src.slice(l.fixStart, l.fixEnd), reste: src.slice(0, l.fixStart) + l.fixText + src.slice(l.fixEnd) };
};
const equilibre = (s: string) => (s.split('/*').length - 1) === (s.split('*/').length - 1);
const fonction = (apres: string) => `package x\n\nfun g() {\n    val mort = 1${apres}\n    println(2)\n}\n`;

describe('la coupe d une locale laisse les commentaires entiers', () => {
  it('un bloc ouvert sur la ligne reste en place', () => {
    const r = applique(fonction(' /* on garde\n       as is */'))!;
    expect(r.coupe).not.toContain('/*');
    expect(equilibre(r.reste)).toBe(true);
    expect(r.reste).toContain('as is */');
  });

  for (const [nom, apres] of [
    ['un bloc ferme sur la ligne', ' /* note */'],
    ['un commentaire de ligne', ' // note'],
    ['rien', ''],
  ] as Array<[string, string]>) {
    it(`${nom} : la ligne part entiere, comme avant`, () => {
      const r = applique(fonction(apres))!;
      expect(r.coupe).toBe(`    val mort = 1${apres}\n`);
      expect(equilibre(r.reste)).toBe(true);
    });
  }

  it('la locale part, la suite reste', () => {
    for (const apres of ['', ' // note', ' /* note */', ' /* on garde\n       as is */']) {
      const r = applique(fonction(apres))!;
      expect(r.reste, apres).toContain('println(2)');
      expect(r.reste, apres).not.toMatch(/val mort/);
    }
  });
});

describe('une directive de compilation ne protege pas le corps de la classe', () => {
  const objet = (anno: string) =>
    `package x\n\n${anno}object U {\n    private const val MORT = "a.txt"\n    fun vivant() = 1\n}\n`;
  const noms = (src: string) => (findUnusedDeclarations(src) as any[]).map(d => d.name);

  for (const anno of ['@Suppress("unused")\n', '@SuppressWarnings("TooManyFunctions")\n', '@OptIn(X::class)\n']) {
    it(`${anno.trim()} ne cache pas la constante morte`, () => {
      expect(noms(objet(anno))).toContain('MORT');
    });
  }

  it('sans annotation, rien ne change', () => {
    expect(noms(objet(''))).toContain('MORT');
  });

  it('une annotation qui PEUT faire lire par reflexion protege toujours', () => {
    // Un serialiseur lit la propriete sans que la source la nomme.
    expect(noms(objet('@Serializable\n'))).not.toContain('MORT');
    expect(noms(objet('@Parcelize\n'))).not.toContain('MORT');
  });

  it('le nom qualifie arrive deja reduit, et le filtre le reconnait', () => {
    // Le collecteur rend `Suppress` pour `@kotlin.Suppress`. Ce test le
    // verifie A LA SOURCE : sans cela il passait quoi que fasse le filtre,
    // et c est exactement ce qu il faisait avant.
    expect(collectAnnotationTargets('@kotlin.Suppress("x")\nobject U {}\n').map(a => a.name)).toEqual(['Suppress']);
    expect(noms(objet('@kotlin.Suppress("unused")\n'))).toContain('MORT');
  });
});
