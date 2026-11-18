import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';
import { isCopiedNotCompiled } from '../../../src/util/testPaths';

/**
 * An open source app keeps boundary fixtures under
 * `feature/live/src/test/resources/boundary-fixtures/`: `.kt` files that
 * break its architecture rules on purpose (`import com.streamvault.app.App`),
 * read as text by a Gradle task that checks its own boundary checker.
 *
 * The pass read them as code. Their imports were unused, so it removed them,
 * and the five `verify…Boundary` tasks failed with "fixtures are not
 * detected". Gradle copies `resources/` and `assets/` into the artifact and
 * compiles nothing there.
 */

const MAIN = '/w/app/src/main/kotlin/com/x';
const FIXTURES = '/w/feature/live/src/test/resources/boundary-fixtures';
const SEGS = ['test/java', 'test/kotlin'];

describe('code under resources/ or assets/ is data, not source', () => {
  it('the predicate', () => {
    expect(isCopiedNotCompiled(`${FIXTURES}/AppPackageImport.kt`)).toBe(true);
    expect(isCopiedNotCompiled('/w/app/src/main/assets/scripts/Init.java')).toBe(true);
    expect(isCopiedNotCompiled('/w/app/src/main/resources/templates/Build.kts')).toBe(true);
    expect(isCopiedNotCompiled(`${MAIN}/App.kt`)).toBe(false);
    // A package that happens to be called `resources` is code.
    expect(isCopiedNotCompiled('/w/app/src/main/kotlin/com/x/resources/Strings.kt')).toBe(false);
    expect(isCopiedNotCompiled('/w/app/src/main/res/values/strings.xml')).toBe(false);
  });

  it('a fixture with an unused import is neither swept nor deleted', () => {
    const sources = [
      { path: `${FIXTURES}/AppPackageImport.kt`, text: 'package fixture\n\nimport com.x.App\n' },
      { path: `${FIXTURES}/DeadFixture.kt`, text: 'package fixture\n\nclass DeadFixture\n' },
      { path: `${MAIN}/App.kt`, text: 'package com.x\n\nclass App\n\nfun main() = App()\n' },
    ];
    const { parFichier, fichiersMorts } = collecterUnePasse(sources, SEGS);
    expect([...parFichier.keys()].filter(isCopiedNotCompiled)).toEqual([]);
    expect([...fichiersMorts].filter(isCopiedNotCompiled)).toEqual([]);
  });

  it('a mention inside a fixture keeps nothing alive', () => {
    const sources = [
      { path: `${FIXTURES}/Uses.kt`, text: 'package fixture\n\nimport com.x.Lonely\n\nval l = Lonely()\n' },
      { path: `${MAIN}/Lonely.kt`, text: 'package com.x\n\nclass Lonely\n' },
      { path: `${MAIN}/App.kt`, text: 'package com.x\n\nfun main() = 1\n' },
    ];
    const { parFichier, fichiersMorts } = collecterUnePasse(sources, SEGS);
    const touched = [...parFichier.keys(), ...fichiersMorts];
    expect(touched.some(p => p.endsWith('/Lonely.kt'))).toBe(true);
  });
});
