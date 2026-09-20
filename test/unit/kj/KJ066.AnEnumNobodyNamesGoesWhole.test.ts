import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-066 — l enum imbrique dont toutes les entrees meurent part en entier.
 *
 * La famille travaille par entree, et rien ne regardait combien il en restait.
 * Sur le projet de reference, `enum OrderBy { CREATED_ASC, CREATED_DESC,
 * LAST_ACCESSED }`, imbrique dans une interface Java, perdait ses trois
 * entrees et laissait `enum OrderBy {\n\n}` : un relecteur l a renvoye avec
 * « ici ca a mal delete OrderBy ».
 *
 * Un enum de PREMIER niveau est deja le gibier de KJ-032, avec des gardes que
 * cette famille ne porte pas, et la passe de chevauchement fait deja tomber
 * ses entrees dans la coupe du type. Seul l enum imbrique n appartenait a
 * personne. Le fait qui autorise la coupe est un comptage : le sac de noms
 * ecrit le nom du type UNE fois, celle de sa declaration.
 */

const mod: any = await importOrNull('src/providers/unusedEnumEntries');
const commande: any = await importOrNull('src/commands/RemoveEverythingUnused');
const collecterUnePasse = (s: any, t: any) => commande.collecterUnePasse(s, t);

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

// Quelqu un tient l interface, et ce quelqu un est un point d entree Android :
// sans ca l interface meurt aussi, et l enum imbrique disparait dans une coupe
// qui n est pas la sienne (KJ-032 pour le type, KJ-046 pour l ilot des deux).
const CLIENT = f(`${MAIN}/Client.java`,
  'package com.x;\n\nimport android.app.Activity;\n\npublic class Client extends Activity {\n    Repo repo;\n}\n');

const passe = (...sources: { path: string; text: string }[]) =>
  mod.scanEnums({ sources: [...sources, CLIENT, GRADLE], testSourceSets: ['/src/test/'] }) as any;

const scan = (...sources: { path: string; text: string }[]) => passe(...sources).entries as any[];

const entier = (...sources: { path: string; text: string }[]) => passe(...sources).emptied as any[];

const REPO_JAVA = [
  'package com.x;',
  '',
  'public interface Repo {',
  '',
  '    enum OrderBy {',
  '        CREATED_ASC, CREATED_DESC, LAST_ACCESSED',
  '    }',
  '',
  '    void save(String url);',
  '}',
  '',
].join('\n');

describe.skipIf(!mod)('emptiedEnums', () => {
  it('l enum Java imbrique que personne ne nomme rend une coupe unique', () => {
    const source = f(`${MAIN}/Repo.java`, REPO_JAVA);
    const trouves = scan(source);
    expect(trouves.map(e => e.name)).toEqual(['CREATED_ASC', 'CREATED_DESC', 'LAST_ACCESSED']);
    expect(trouves.every(e => e.wholeEnum)).toBe(true);

    const coupes = entier(source);
    expect(coupes).toHaveLength(1);
    expect(coupes[0].enumName).toBe('OrderBy');
    const apres = REPO_JAVA.slice(0, coupes[0].removeStart) + REPO_JAVA.slice(coupes[0].removeEnd);
    expect(apres).not.toContain('OrderBy');
    expect(apres).toContain('void save(String url);');
  });

  it('par la commande de masse : une seule coupe, et pas de trou de lignes vides', () => {
    // Les trois coupes d entrees tombent dans celle du type : elle commence
    // avant elles, et la passe de chevauchement garde la premiere.
    const source = f(`${MAIN}/Repo.java`, REPO_JAVA);
    const { parFichier } = collecterUnePasse([source, CLIENT, GRADLE], ['/src/test/']);
    const coupes = parFichier.get(source.path) ?? [];
    expect(coupes.map((c: any) => c.famille)).toEqual(['enums']);
    expect(coupes[0].quoi).toBe('enum OrderBy');
    // `sansTrouDeLignesVides` absorbe l une des deux lignes vides qui
    // encadraient la declaration : detekt refuse deux blanches de suite.
    const plage = commande.sansTrouDeLignesVides(REPO_JAVA, coupes, [])[0];
    const apres = REPO_JAVA.slice(0, plage.start) + REPO_JAVA.slice(plage.end);
    expect(apres).not.toContain('OrderBy');
    expect(apres).not.toMatch(/\n\n\n/);
  });

  it('la coupe emporte la documentation du type', () => {
    const texte = [
      'package com.x',
      '',
      'class Config {',
      '',
      '    /** Comment on trie. */',
      '    enum class Mode {',
      '        RAPIDE,',
      '        LENT,',
      '    }',
      '',
      '    fun go() = Unit',
      '}',
      '',
    ].join('\n');
    const source = f(`${MAIN}/Config.kt`, texte);
    const tient = f(`${MAIN}/Tient.kt`,
      'package com.x\n\nimport android.app.Activity\n\nclass Tient : Activity() {\n    fun go(c: Config) = c.go()\n}\n');
    const coupes = entier(source, tient);
    expect(coupes).toHaveLength(1);
    const apres = texte.slice(0, coupes[0].removeStart) + texte.slice(coupes[0].removeEnd);
    expect(apres).not.toContain('Comment on trie');
    expect(apres).not.toContain('enum class Mode');
    expect(apres).toContain('fun go() = Unit');
  });

  it('une coquille deja videe a la main part aussi', () => {
    // C est l etat exact que la revue a renvoye : quelqu un avait coupe les
    // trois entrees, et l accolade vide est restee.
    const texte = [
      'package com.x;',
      '',
      'public interface Repo {',
      '',
      '    enum OrderBy {',
      '',
      '    }',
      '',
      '    void save(String url);',
      '}',
      '',
    ].join('\n');
    const source = f(`${MAIN}/Repo.java`, texte);
    expect(scan(source)).toEqual([]);
    const coupes = entier(source);
    expect(coupes).toHaveLength(1);
    expect(coupes[0].enumName).toBe('OrderBy');
    const apres = texte.slice(0, coupes[0].removeStart) + texte.slice(coupes[0].removeEnd);
    expect(apres).not.toContain('OrderBy');
    expect(apres).toContain('void save(String url);');
  });

  it('temoin : une coquille vide dont le type est nomme reste', () => {
    const texte = [
      'package com.x;',
      '',
      'public interface Repo {',
      '',
      '    enum OrderBy {',
      '',
      '    }',
      '}',
      '',
    ].join('\n');
    const source = f(`${MAIN}/Repo.java`, texte);
    const usage = f(`${MAIN}/Sort.java`, 'package com.x;\n\nclass Sort {\n    Repo.OrderBy champ;\n}\n');
    expect(entier(source, usage)).toEqual([]);
  });

  it('temoin : un enum vide d entrees mais qui porte un membre reste', () => {
    const texte = [
      'package com.x;',
      '',
      'public interface Repo {',
      '',
      '    enum OrderBy {',
      '        ;',
      '        static int total() { return 0; }',
      '    }',
      '}',
      '',
    ].join('\n');
    expect(entier(f(`${MAIN}/Repo.java`, texte))).toEqual([]);
  });

  it('un enum de premier niveau est laisse a KJ-032', () => {
    const texte = ['package com.x', '', 'enum class Mode {', '    RAPIDE,', '    LENT,', '}', ''].join('\n');
    const source = f(`${MAIN}/Mode.kt`, texte);
    expect(scan(source).map(e => e.name)).toEqual(['RAPIDE', 'LENT']);
    expect(entier(source)).toEqual([]);
  });

  it('une seule mention du type, ou qu elle soit, retient la coupe', () => {
    const source = f(`${MAIN}/Repo.java`, REPO_JAVA);
    const usages = [
      f(`${MAIN}/Sort.java`, 'package com.x;\n\nclass Sort {\n    Repo.OrderBy champ;\n}\n'),
      f(`${MAIN}/Trace.java`, 'package com.x;\n\nclass Trace {\n    String nom = "OrderBy";\n}\n'),
      f('/w/app/src/main/res/layout/a.xml', '<View android:tag="OrderBy" />\n'),
      f('/w/app/proguard-rules.pro', '-keep class com.x.Repo$OrderBy { *; }\n'),
    ];
    for (const usage of usages) {
      expect(entier(source, usage), usage.path).toEqual([]);
      // Les entrees, elles, restent mortes : seul le TYPE est retenu.
      expect(scan(source, usage).length).toBe(3);
    }
  });

  it('une entree encore vivante ou nommee par un test retient la coupe', () => {
    const source = f(`${MAIN}/Repo.java`, REPO_JAVA);
    const vivante = f(`${MAIN}/Use.java`, 'package com.x;\n\nclass Use {\n    Object o = CREATED_ASC;\n}\n');
    expect(entier(source, vivante)).toEqual([]);

    const test = f('/w/app/src/test/java/com/x/RepoTest.java',
      'package com.x;\n\nclass RepoTest {\n    Object o = LAST_ACCESSED;\n}\n');
    expect(entier(source, test)).toEqual([]);
  });

  it('un import du type imbrique retient la coupe', () => {
    // Le couper sous l import arrete le compilateur. L import est la trouvaille
    // de KJ-009 ce tour ci, et le point fixe reprend l enum au suivant.
    const source = f(`${MAIN}/Repo.java`, REPO_JAVA);
    const importeur = f(`${MAIN}/Autre.kt`, 'package com.y\n\nimport com.x.Repo.OrderBy\n\nfun go() = Unit\n');
    expect(entier(source, importeur)).toEqual([]);
  });

  it('une annotation etrangere sur la classe englobante retient la coupe', () => {
    // La classe est peut etre lue par reflexion depuis un fichier hors corpus.
    const texte = [
      'package com.x',
      '',
      '@Keep',
      'class Config {',
      '    enum class Mode {',
      '        RAPIDE,',
      '        LENT,',
      '    }',
      '}',
      '',
    ].join('\n');
    const source = f(`${MAIN}/Config.kt`, texte);
    const tient = f(`${MAIN}/Tient.kt`,
      'package com.x\n\nimport android.app.Activity\n\nclass Tient : Activity() {\n    fun go(c: Config) = c.toString()\n}\n');
    expect(scan(source, tient).length).toBe(2);
    expect(entier(source, tient)).toEqual([]);
  });
});
