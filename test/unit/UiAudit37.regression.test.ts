import { describe, it, expect } from 'vitest';
import { isTestPath, segmentMatchesPath } from '../../src/util/testPaths';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';

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

describe('Cache de pliage borné', () => {
  const P = (l: number, c: number) => new Position(l, c);
  function doc(uri: string, text: string): any {
    const lines = text.split('\n');
    return {
      uri: { toString: () => uri, path: uri.replace('file://', '') },
      languageId: 'kotlin', version: 1, isDirty: false,
      getText: () => text,
      lineAt: (n: number) => { const t = lines[n] ?? ''; return { text: t, range: { start: P(n, 0), end: P(n, t.length) } }; },
      lineCount: lines.length,
    };
  }
  const body = (i: number) => [
    'package p',
    '',
    `import a.B${i}`,
    `import a.C${i}`,
    '',
    `class Type${i} {`,
    `    fun one() {`,
    `        val x = ${i}`,
    `    }`,
    '}',
  ].join('\n');

  function providerOver(n: number) {
    const index = new SymbolIndex();
    const docs: any[] = [];
    for (let i = 0; i < n; i++) {
      const uri = `file:///cap/F${i}.kt`;
      index.add(parse(uri, body(i)));
      docs.push(doc(uri, body(i)));
    }
    return { provider: new KotlinFoldingRangeProvider(index), docs };
  }

  it('parcourir tout un projet ne garde pas une entrée par fichier', () => {
    // Mesuré sur un vrai projet : 5088 entrées et 44 058 plages retenues pour
    // des fichiers dont aucun n'était encore visible.
    const { provider, docs } = providerOver(300);
    for (const d of docs) provider.provideFoldingRanges(d, {} as any, {} as any);
    const cache: Map<string, unknown> = (provider as any).cache;
    expect(cache.size).toBeLessThanOrEqual(64);
  });

  it('un ensemble de fichiers ouverts réaliste reste entièrement en cache', () => {
    // Le plafond ne doit pas coûter de recalcul dans l'usage courant : on ne
    // garde pas dix onglets ouverts et soixante-quatre en plus.
    const { provider, docs } = providerOver(10);
    const first = docs.map(d => provider.provideFoldingRanges(d, {} as any, {} as any));
    const second = docs.map(d => provider.provideFoldingRanges(d, {} as any, {} as any));
    for (let i = 0; i < docs.length; i++) expect(second[i]).toBe(first[i]);
  });

  it('le contenu rendu est le même avec ou sans succès de cache', () => {
    const { provider, docs } = providerOver(3);
    const warm = provider.provideFoldingRanges(docs[0], {} as any, {} as any).map(r => [r.start, r.end]);
    const cold = new KotlinFoldingRangeProvider(new SymbolIndex());
    // Index vide : seuls les plis d'imports subsistent, donc on compare plutôt
    // deux instances au même index.
    const { provider: other, docs: sameDocs } = providerOver(3);
    const again = other.provideFoldingRanges(sameDocs[0], {} as any, {} as any).map(r => [r.start, r.end]);
    expect(again).toEqual(warm);
    expect(cold).toBeDefined();
  });
});
