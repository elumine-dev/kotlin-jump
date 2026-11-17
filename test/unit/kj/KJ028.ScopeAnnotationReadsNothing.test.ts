import { describe, it, expect } from 'vitest';
import { findWriteOnlyVariables } from '../../../src/providers/writeOnlyVariables';
import { findUnusedDeclarations } from '../../../src/providers/unusedDeclarations';

/**
 * Une annotation de portee sur la classe ne fait lire aucun membre prive.
 *
 * Sur la reference, `@ScopeApplication` sur un view model gardait vivant un
 * champ `Job` que cinq affectations ecrivaient et que rien ne lisait.
 */

const klass = (annotation: string) =>
  `${annotation}\nclass Wall @Inject constructor() {\n  private var job: Any? = null\n  fun start() {\n    job = null\n  }\n}\n`;
const writeOnly = (text: string) => findWriteOnlyVariables(text).map(v => v.name);

describe('une portee ou un marqueur de lint ne protege pas un champ ecrit seul', () => {
  for (const a of ['@ScopeApplication', '@Singleton', '@ActivityScoped', '@FragmentScope', '@HiltViewModel', '@MainThread', '@Deprecated("old")']) {
    it(a, () => expect(writeOnly(klass(a))).toEqual(['job']));
  }
  it('ni une propriete privee que rien ne nomme', () => {
    const text = '@ScopeApplication\nclass Wall {\n  private val unread = 1\n  fun go() = 2\n}\n';
    expect(findUnusedDeclarations(text).map(d => d.name)).toEqual(['unread']);
  });
});

describe('une annotation qui peut lire par reflexion protege toujours', () => {
  for (const a of ['@Entity', '@Serializable', '@Keep', '@JsonClass(generateAdapter = true)', '@Scopeless', '@Telescope']) {
    it(a, () => expect(writeOnly(klass(a))).toEqual([]));
  }
});
