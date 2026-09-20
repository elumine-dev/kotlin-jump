import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-068 — les imports Java, balayes comme ceux de Kotlin.
 *
 * `findUnusedImports` refusait la forme Java pour une seule raison : son
 * expression exigeait que la ligne finisse juste apres le chemin, et
 * `import a.b.C;` porte un point virgule. Le balayage sortait tot pour Java,
 * la cascade filtrait sur `.kt`. Resultat, sur le projet de reference, une
 * classe videe de ses membres gardait ses quinze imports, et un relecteur l a
 * vu avant nous.
 *
 * Le corps est deja lu par jetons sur le texte assaini, et un jeton est un
 * jeton dans les deux langages : `Map<String, C>`, `C[]`, `(C)`, `C::m`,
 * `instanceof C`, `throws C`, `catch (C e)`, `@C` et `C.class` sont tous vus.
 * Le seul vrai danger etait la documentation : `{@link C}` se resout par les
 * imports, et javadoc avec doclint refuse le fichier si le lien casse.
 */

const mod: any = await importOrNull('src/providers/unusedImports');
const sweep: any = await importOrNull('src/providers/DeadCodeSweep');
const cascade: any = await importOrNull('src/providers/removalCascade');

const morts = (texte: string): string[] =>
  mod.findUnusedImports(texte).map((i: any) => i.statement.trim());

describe.skipIf(!mod)('findUnusedImports en Java', () => {
  it('un import simple et un import statique que le corps n ecrit pas', () => {
    const texte = [
      'package p;',
      '',
      'import java.util.List;',
      'import java.io.File;',
      'import static java.lang.Math.max;',
      'import static java.lang.Math.min;',
      '',
      'public class A {',
      '    File f;',
      '    int m(int a, int b) { return max(a, b); }',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual(['import java.util.List;', 'import static java.lang.Math.min;']);
  });

  it('chaque forme d usage Java compte comme un usage', () => {
    // Un seul de ces imports est mort, et c est celui que personne n ecrit.
    const texte = [
      'package p;',
      '',
      'import java.util.List;',
      'import java.util.Map;',
      'import java.io.File;',
      'import java.io.IOException;',
      'import java.util.function.Function;',
      'import p.Ghost;',
      '',
      'public class A {',
      '    Map<String, List<File>> index;',
      '    File[] tableau;',
      '    Function<String, String> f = String::trim;',
      '    void go(Object o) throws IOException {',
      '        if (o instanceof File) { File cast = (File) o; }',
      '        try { go(null); } catch (IOException e) { }',
      '    }',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual(['import p.Ghost;']);
  });

  it('une annotation et un litteral de classe sont des usages', () => {
    const texte = [
      'package p;',
      '',
      'import p.Keep;',
      'import p.Model;',
      '',
      '@Keep',
      'public class A {',
      '    Class<?> c = Model.class;',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual([]);
  });

  it('un import cite seulement par la javadoc reste', () => {
    // javadoc avec doclint refuse un lien qui ne se resout plus, donc la
    // publication casse alors que javac, lui, compilait.
    const texte = [
      'package p;',
      '',
      'import p.Alpha;',
      'import p.Beta;',
      'import p.Gamma;',
      'import p.Delta;',
      'import p.Epsilon;',
      'import p.Zeta;',
      '',
      '/**',
      ' * Voir {@link Alpha}, {@linkplain Beta une chose}, {@value Gamma#SEUIL}.',
      ' *',
      ' * @see Delta',
      ' * @throws Epsilon si la chose arrive',
      ' */',
      'public class A {',
      '    void go() {}',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual(['import p.Zeta;']);
  });

  it('une reference javadoc nomme aussi les types de ses parametres', () => {
    // `{@link C#m(D, E)}` en nomme trois : retirer l import de D casse le lien.
    const texte = [
      'package p;',
      '',
      'import p.Cible;',
      'import p.Premier;',
      'import p.Second;',
      '',
      '/** Delegue a {@link Cible#appliquer(Premier, Second)}. */',
      'public class A {',
      '    void go() {}',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual([]);
  });

  it('un import avec joker n est jamais signale', () => {
    const texte = [
      'package p;',
      '',
      'import java.util.*;',
      'import static java.lang.Math.*;',
      '',
      'public class A {',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual([]);
  });

  it('un nom qui n apparait que dans une chaine ne sauve pas son import', () => {
    // javac est d accord : une chaine ne resout rien.
    const texte = [
      'package p;',
      '',
      'import p.Ghost;',
      '',
      'public class A {',
      '    String nom = "Ghost";',
      '    Class<?> c() throws Exception { return Class.forName("p.Ghost"); }',
      '}',
    ].join('\n');
    expect(morts(texte)).toEqual(['import p.Ghost;']);
  });

  it('un package-info ne rapporte rien : ses imports servent aux annotations', () => {
    const texte = [
      '@ParametersAreNonnullByDefault',
      'package p;',
      '',
      'import javax.annotation.ParametersAreNonnullByDefault;',
    ].join('\n');
    expect(morts(texte)).toEqual([]);
  });
});

describe.skipIf(!sweep)('le balayage d un fichier Java', () => {
  it('rend les imports avant les declarations, et rien d autre', () => {
    const texte = [
      'package p;',
      'import java.util.List;',
      'public class A {',
      '    private String morte() { return ""; }',
      '    public void vivante(String inutilise) {}',
      '}',
    ].join('\n');
    const trouves = sweep.sweepFile(texte, 'java');
    expect(trouves.map((f: any) => f.detector)).toEqual(['imports', 'declarations']);
    expect(trouves[0].name).toBe('java.util.List');
  });

  it('l edition proposee couvre la ligne entiere de l import', () => {
    const texte = ['package p;', 'import java.util.List;', 'public class A {}'].join('\n');
    const plan = sweep.planFileEdits(sweep.sweepFile(texte, 'java'));
    const apres = sweep.applyEdits(texte, plan);
    expect(apres).toBe(['package p;', 'public class A {}'].join('\n'));
  });
});

describe.skipIf(!cascade)('la cascade apres une coupe en Java', () => {
  it('un import que la coupe orpheline est signale', () => {
    const texte = [
      'package p;',
      '',
      'import java.io.File;',
      '',
      'public class A {',
      '    void go(File f) {}',
      '}',
    ].join('\n');
    const coupe = { start: texte.indexOf('    void go'), end: texte.indexOf('}\n', texte.indexOf('void go')) + 2 };
    const c = cascade.cascadeAfterRemoval(
      new Map([['a/A.java', [coupe]]]),
      new Map([['a/A.java', texte]]),
    );
    const e = (c.imports.get('a/A.java') ?? [])[0];
    expect(texte.slice(e.start, e.end)).toContain('import java.io.File;');
  });

  it('temoin : un import deja mort avant la coupe n est pas de la cascade', () => {
    // Il appartient a KJ-009, qui porte sa propre ampoule.
    const texte = [
      'package p;',
      '',
      'import java.util.List;',
      'import java.io.File;',
      '',
      'public class A {',
      '    void go(File f) {}',
      '    void reste() {}',
      '}',
    ].join('\n');
    const coupe = { start: texte.indexOf('    void go'), end: texte.indexOf('    void reste') };
    const c = cascade.cascadeAfterRemoval(
      new Map([['a/A.java', [coupe]]]),
      new Map([['a/A.java', texte]]),
    );
    const lignes = (c.imports.get('a/A.java') ?? []).map((e: any) => texte.slice(e.start, e.end));
    expect(lignes.join('')).toContain('java.io.File');
    expect(lignes.join('')).not.toContain('java.util.List');
  });
});
