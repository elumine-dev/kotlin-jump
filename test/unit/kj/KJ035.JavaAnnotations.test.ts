import { describe, it, expect } from 'vitest';
import { parseJava } from '../../../src/indexer/JavaParser';

/**
 * KJ-035 — les annotations Java.
 *
 * Le parser lisait `@Override` et jetait tout le reste : les annotations de
 * classe étaient collectées puis effacées. Résultat, une classe de test Java
 * n'avait pas de lens « Run Test » et un type Java déprécié pas de hover,
 * alors que leurs équivalents Kotlin les avaient. Mesuré sur un vrai projet :
 * 304 fichiers de test Java, 148 classes @RunWith, 46 @Deprecated.
 */

const find = (text: string, name: string) =>
  parseJava('file:///T.java', text).symbols.find(s => s.name === name);

describe('les tests JUnit', () => {
  it('une méthode @Test est marquée comme test', () => {
    const s = find([
      'public class SampleTest {',
      '    @Test',
      '    public void checksSomething() {}',
      '}',
    ].join('\n'), 'checksSomething');
    expect(s?.isTest).toBe(true);
  });

  it('une méthode JUnit 5 sans modificateur aussi', () => {
    // C'est le style moderne : package-private, donc une autre branche du
    // parser. La rater laisserait tout JUnit 5 sans lens.
    const s = find([
      'class SampleTest {',
      '    @Test',
      '    void checksSomething() {}',
      '}',
    ].join('\n'), 'checksSomething');
    expect(s?.isTest).toBe(true);
  });

  it('les variantes paramétrées comptent', () => {
    for (const anno of ['@ParameterizedTest', '@RepeatedTest(3)', '@TestFactory']) {
      const s = find(`class T {\n    ${anno}\n    void run() {}\n}`, 'run');
      expect(s?.isTest, anno).toBe(true);
    }
  });

  it('une classe @RunWith est une classe de test', () => {
    const s = find([
      '@RunWith(AndroidJUnit4.class)',
      'public class SampleTest {',
      '}',
    ].join('\n'), 'SampleTest');
    expect(s?.isTestClass).toBe(true);
  });

  it('les méthodes de cycle de vie sont distinguées des tests', () => {
    for (const anno of ['@Before', '@BeforeEach', '@After', '@AfterClass']) {
      const s = find(`class T {\n    ${anno}\n    public void setUp() {}\n}`, 'setUp');
      expect(s?.isLifecycle, anno).toBe(true);
      expect(s?.isTest, anno).toBeUndefined();
    }
  });

  it('@Ignore et @Disabled sont reconnus', () => {
    for (const anno of ['@Ignore', '@Disabled']) {
      const s = find(`class T {\n    ${anno}\n    @Test\n    public void skipped() {}\n}`, 'skipped');
      expect(s?.isIgnored, anno).toBe(true);
    }
  });
});

describe('la dépréciation', () => {
  it('une classe @Deprecated est marquée', () => {
    const s = find('@Deprecated\npublic class OldApi {\n}', 'OldApi');
    expect(s?.isDeprecated).toBe(true);
  });

  it('une méthode @Deprecated aussi', () => {
    const s = find('class T {\n    @Deprecated\n    public void oldWay() {}\n}', 'oldWay');
    expect(s?.isDeprecated).toBe(true);
  });

  it('une déclaration sans annotation ne l’est pas', () => {
    expect(find('public class Fresh {\n}', 'Fresh')?.isDeprecated).toBeUndefined();
  });
});

describe('la fenêtre d’annotations', () => {
  it('une classe JUnit réelle en porte quatre, et la première compte', () => {
    // Avec une fenêtre de trois, @RunWith aurait été perdu en silence.
    const s = find([
      '@RunWith(AndroidJUnit4.class)',
      '@Config(sdk = 33)',
      '@LargeTest',
      '@Ignore("flaky")',
      'public class SampleTest {',
      '}',
    ].join('\n'), 'SampleTest');
    expect(s?.isTestClass).toBe(true);
    expect(s?.isIgnored).toBe(true);
  });

  it('une annotation ne déborde pas sur la déclaration suivante', () => {
    const src = [
      'class T {',
      '    @Test',
      '    public void tested() {}',
      '',
      '    public void plain() {}',
      '}',
    ].join('\n');
    expect(find(src, 'tested')?.isTest).toBe(true);
    expect(find(src, 'plain')?.isTest).toBeUndefined();
  });

  it('une annotation sur la même ligne que la déclaration ne perturbe rien', () => {
    const s = find('class T {\n    @Deprecated public void oldWay() {}\n}', 'oldWay');
    expect(s).toBeDefined();
  });
});
