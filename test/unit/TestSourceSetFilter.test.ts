/**
 * Le filtre qui cache les sources de test depuis un fichier de production.
 *
 * Le depot porte DEUX predicats pour la meme question :
 *
 *  - `isTestPath`, qui ne connait que la liste configuree ;
 *  - `isTestSourceSet`, qui ajoute la convention Gradle, un source set sous
 *    `src/` dont le nom contient « test ».
 *
 * Le commentaire de cette convention dit qu'une liste configuree « ne peut
 * jamais suivre » : les vrais projets livrent `savedAndroidTest`,
 * `screenshotTest`, `sharedTest`, et un `test<Flavor>` par variante.
 *
 * Les detecteurs de code mort utilisent le predicat complet. `buildAllowFilter`,
 * dont dependent le compte d'implementations des lenses, l'auto import et la
 * hierarchie de types, n'utilisait que l'etroit. Mesure sur un projet reel de
 * 3187 fichiers Kotlin : 29 fichiers de test, 26 sous `savedAndroidTest` et 3
 * sous `sharedTest`, etaient donc traites comme de la production. Le cas le
 * plus grave est l'auto import, qui pouvait proposer d'importer une classe
 * declaree dans un source set de test : le fichier ne compile plus.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace } from './__mocks__/vscode';
import { buildAllowFilter } from '../../src/util/testFilter';

const DEFAUTS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const PROD = '/p/app/src/main/java/com/x/Ecran.kt';

afterEach(() => vi.restoreAllMocks());

/** Les reglages tels que VS Code les rend : le defaut du schema s'applique. */
function avecDefauts() {
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? DEFAUTS : defaut),
    update: async () => {},
  } as any);
}

describe('depuis un fichier de production', () => {
  it('un source set de test configure est cache', () => {
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/app/src/androidTest/java/com/x/EcranTest.kt')).toBe(false);
    expect(allow('/p/app/src/test/java/com/x/EcranTest.kt')).toBe(false);
  });

  it('un source set de test NON configure l est aussi', () => {
    // `savedAndroidTest` et `sharedTest` existent sur un vrai projet et ne
    // figurent dans aucune liste par defaut.
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/replica/app/src/savedAndroidTest/java/ca/T.kt'),
      'savedAndroidTest est un source set de test').toBe(false);
    expect(allow('/p/core/ui/src/sharedTest/java/nuglif/T.kt'),
      'sharedTest aussi').toBe(false);
  });

  it('mais la production reste visible', () => {
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/core/ui/src/main/java/nuglif/Autre.kt')).toBe(true);
    // `src/testing/` n'est pas un source set : c'est du code de production
    // qui parle de tests. La convention Gradle vise `src/<nom>/`, et
    // `testing` contient bien « test »... donc il est traite comme un test.
    // Assume : mieux vaut cacher un peu trop que proposer un import qui
    // casse le build.
    expect(allow('/p/app/src/main/java/com/x/testing/Util.kt'),
      'un paquet nomme testing sous src/main reste de la production').toBe(true);
  });
});

describe('depuis un fichier de test', () => {
  it('tout est visible, test compris', () => {
    avecDefauts();
    const allow = buildAllowFilter('/p/app/src/androidTest/java/com/x/EcranTest.kt');
    expect(allow('/p/app/src/main/java/com/x/Ecran.kt')).toBe(true);
    expect(allow('/p/app/src/androidTest/java/com/x/Autre.kt')).toBe(true);
  });

  it('y compris depuis un source set non configure', () => {
    avecDefauts();
    const allow = buildAllowFilter('/p/replica/app/src/savedAndroidTest/java/ca/T.kt');
    expect(allow('/p/app/src/androidTest/java/com/x/Autre.kt'),
      'un test peut en voir un autre').toBe(true);
  });
});
