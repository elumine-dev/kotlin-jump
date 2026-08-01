import { describe, it, expect } from 'vitest';
import { findUnusedDeclarations } from '../../../src/providers/UnusedDeclarationProvider';
import { sweepFile } from '../../../src/providers/DeadCodeSweep';

/**
 * KJ-043 — KJ-026 et KJ-030 étendus au Java.
 *
 * Le trou révélé par le croisement avec l'outil concurrent : 24 de ses
 * trouvailles étaient des membres PRIVÉS Java, que KJ-042 délègue à KJ-026,
 * lequel ne parsait que du Kotlin. Aucun détecteur ne les couvrait.
 *
 * La question est la même et la réponse aussi : un membre privé qu'aucun mot
 * de son propre fichier ne nomme. Les gardes se traduisent directement, et un
 * constructeur privé est neutralisé gratuitement par la règle 6 : son nom est
 * celui de la classe, que la déclaration de classe compte déjà.
 */

const java = (text: string) => findUnusedDeclarations(text, 'java');
const names = (text: string) => java(text).map(d => d.name);

describe('le cas de base', () => {
  it('une méthode privée que rien ne nomme est signalée', () => {
    const text = [
      'package p;',
      'public final class Utils {',
      '    private String slugify(String s) {',
      '        return s;',
      '    }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual(['slugify']);
  });

  it('un champ privé jamais lu est signalé', () => {
    const text = [
      'package p;',
      'public class Config {',
      '    private static final String LEGACY_KEY = "legacy";',
      '    public String active() { return "active"; }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual(['LEGACY_KEY']);
  });

  it('un membre privé utilisé dans son fichier est vivant', () => {
    const text = [
      'package p;',
      'public class Config {',
      '    private static final String KEY = "k";',
      '    public String read() { return KEY; }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('un usage via this compte', () => {
    const text = [
      'package p;',
      'public class A {',
      '    private int count;',
      '    public void bump() { this.count++; }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });
});

describe('les gardes traduites', () => {
  it('un constructeur privé n’est jamais signalé : règle 6, son nom est celui de la classe', () => {
    // Le patron classe-utilitaire : `private Utils() {}` est là précisément
    // pour ne jamais être appelé.
    const text = [
      'package p;',
      'public final class Utils {',
      '    private Utils() {}',
      '    public static String x() { return ""; }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('une méthode native privée est liée à un symbole C invisible', () => {
    const text = [
      'package p;',
      'public class Jni {',
      '    private native int fastPath(int a);',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('un champ annoté est hors périmètre : Gson le remplit par réflexion', () => {
    const text = [
      'package p;',
      'public class Dto {',
      '    @SerializedName("v")',
      '    private String value;',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('les champs d’une classe Serializable sont hors périmètre', () => {
    const text = [
      'package p;',
      'public class State implements Serializable {',
      '    private long stamp;',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('serialVersionUID n’est jamais signalé', () => {
    const text = [
      'package p;',
      'public class E extends Exception {',
      '    private static final long serialVersionUID = 1L;',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('deux surcharges privées partagent leur nom : règle 6, silence', () => {
    const text = [
      'package p;',
      'public class A {',
      '    private void log(String s) {}',
      '    private void log(int i) {}',
      '}',
    ].join('\n');
    expect(names(text)).toEqual([]);
  });

  it('une mention en commentaire ne compte pas : la trouvaille tient', () => {
    const text = [
      'package p;',
      'public class A {',
      '    // slugify was used by the old exporter',
      '    private String slugify(String s) { return s; }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual(['slugify']);
  });

  it('une mention en chaîne ne compte PAS : la sémantique livrée de KJ-026', () => {
    // Différence assumée avec les détecteurs workspace : file-local, les
    // chaînes sont blanchies avant le scan, en Kotlin comme en Java. Le
    // membre atteint par réflexion locale reste signalable, et l'annotation
    // @Keep ou le marqueur d'ignore sont la réponse.
    const text = [
      'package p;',
      'public class A {',
      '    private String hook() { return ""; }',
      '    public Object grab() throws Exception { return getClass().getDeclaredMethod("hook"); }',
      '}',
    ].join('\n');
    expect(names(text)).toEqual(['hook']);
  });

  it('@SuppressWarnings("unused") au niveau fichier tait tout', () => {
    const text = [
      'package p;',
      'public class A {',
      '    @SuppressWarnings("unused")',
      '    private String ghost() { return ""; }',
      '}',
    ].join('\n');
    // L'annotation sur le membre le protège (garde annotations non bénignes).
    expect(names(text)).toEqual([]);
  });
});

describe('le sweep KJ-030 en Java', () => {
  it('ne fait tourner que le détecteur declarations', () => {
    const text = [
      'package p;',
      'import java.util.List;',
      'public class A {',
      '    private String dead() { return ""; }',
      '    public void live(String unusedParam) {}',
      '}',
    ].join('\n');
    const findings = sweepFile(text, 'java');
    // `import java.util.List` est mort et `unusedParam` aussi, mais les
    // détecteurs imports/parameters portent des hypothèses Kotlin : les faire
    // tourner sur du Java troquerait la justesse contre la couverture.
    expect(findings.map(f => f.detector)).toEqual(['declarations']);
    expect(findings[0].name).toBe('dead');
  });

  it('propose une édition de suppression exploitable', () => {
    const text = [
      'package p;',
      'public class A {',
      '    private String dead() {',
      '        return "";',
      '    }',
      '}',
    ].join('\n');
    const [finding] = sweepFile(text, 'java');
    expect(finding.edits).toHaveLength(1);
    const after = text.slice(0, finding.edits[0].start) + text.slice(finding.edits[0].end);
    expect(after).not.toContain('dead');
    expect(after).toContain('class A');
  });

  it('le kotlin reste inchangé : cinq détecteurs', () => {
    const text = 'import java.util.List\n\nclass A {\n    private fun dead() {}\n}\n';
    const detectors = new Set(sweepFile(text, 'kotlin').map(f => f.detector));
    expect(detectors.has('declarations')).toBe(true);
    expect(detectors.has('imports')).toBe(true);
  });
});
