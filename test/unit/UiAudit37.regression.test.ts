import { describe, it, expect } from 'vitest';
import { isTestPath, segmentMatchesPath } from '../../src/util/testPaths';

// Audit 37 : segmentMatchesPath réécrit sans allocation par appel. Mesuré sur
// les 5088 chemins du projet LaPresse, le coût passe de 26,1 ms à 9,9 ms par
// passe complète. Pas d'assertion sur une horloge ici : ce qui est vérifié,
// c'est que la réécriture répond exactement comme avant.

describe('Segment qui ne nomme rien au delà de src', () => {
  it('src reste une correspondance exacte', () => {
    // La première réécriture retirait le `src` de tête du segment AVANT le
    // test exact, se retrouvait sans composant à comparer et refusait tout.
    // Un réglage de `src` cessait alors de classer quoi que ce soit.
    expect(segmentMatchesPath('/proj/app/src/main/kotlin/A.kt', 'src')).toBe(true);
    expect(segmentMatchesPath('/proj/app/srcs/main/A.kt', 'src')).toBe(false);
    expect(segmentMatchesPath('/proj/app/src', 'src')).toBe(true);
  });

  it('un segment vide ne classe rien', () => {
    for (const s of ['', '/', '///', '\\']) {
      expect(segmentMatchesPath('/proj/app/src/test/kotlin/A.kt', s), s).toBe(false);
    }
  });
});

describe('Formes de chemin que la marche sur src doit couvrir', () => {
  const S = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

  it('un chemin relatif, sans barre de tête', () => {
    // La marche cherche `/src/` : sans traitement du cas de tête, un chemin
    // relatif perdait sa variante.
    expect(isTestPath('src/testDebug/java/A.java', S)).toBe(true);
    expect(isTestPath('src/androidTestDebug/kotlin/A.kt', S)).toBe(true);
    expect(isTestPath('src/main/kotlin/A.kt', S)).toBe(false);
  });

  it('plusieurs composants src dans le même chemin', () => {
    expect(isTestPath('/a/src/main/kotlin/src/testDebug/java/A.java', S)).toBe(true);
    expect(isTestPath('/a/src/src/testDebug/java/A.java', S)).toBe(true);
    expect(isTestPath('/a/src/main/kotlin/src/mainDebug/java/A.java', S)).toBe(false);
  });

  it('un chemin Windows reste reconnu', () => {
    expect(isTestPath('c:\\proj\\app\\src\\testDebug\\java\\A.java', S)).toBe(true);
    expect(isTestPath('c:\\proj\\app\\src\\main\\java\\A.java', S)).toBe(false);
  });

  it('la variante en fin de chemin, sans rien derrière', () => {
    expect(isTestPath('/a/src/androidTestDebug', S)).toBe(true);
    // `test/java` exige son répertoire de langage : il n'y en a pas ici.
    expect(isTestPath('/a/src/testDebug', S)).toBe(false);
    expect(isTestPath('/a/src/testDebug/java', S)).toBe(true);
  });

  it('le suffixe doit exister et commencer par une majuscule', () => {
    expect(isTestPath('/a/src/androidTest/kotlin/A.kt', S)).toBe(true);
    expect(isTestPath('/a/src/androidTestx/kotlin/A.kt', S)).toBe(false);
    expect(isTestPath('/a/src/androidtestDebug/kotlin/A.kt', S)).toBe(false);
  });
});

describe('Réglage relu à chaque appel', () => {
  it('deux segments différents ne se contaminent pas', () => {
    // Les segments analysés sont mémorisés par chaîne. Une entrée partagée
    // par erreur ferait répondre un segment à la place d'un autre.
    expect(segmentMatchesPath('/a/src/testDebug/java/A.java', 'test/java')).toBe(true);
    expect(segmentMatchesPath('/a/src/testDebug/java/A.java', 'test/kotlin')).toBe(false);
    expect(segmentMatchesPath('/a/src/testDebug/kotlin/A.kt', 'test/kotlin')).toBe(true);
    expect(segmentMatchesPath('/a/src/testDebug/kotlin/A.kt', 'test/java')).toBe(false);
    expect(segmentMatchesPath('/a/src/androidTestDebug/A.kt', 'androidTest')).toBe(true);
    expect(segmentMatchesPath('/a/src/androidTestDebug/A.kt', 'jvmTest')).toBe(false);
  });
});
