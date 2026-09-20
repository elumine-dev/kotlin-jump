import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-069 — le post seul dans un `finally` emporte le bloc, ou tout l habillage.
 *
 * `findUnheardEvents` prouve que l evenement n a aucun abonne, puis refuse le
 * post parce qu il est le seul contenu de son bloc : le retirer laisse
 * `finally {\n}` vide et une locale ecrite jamais lue. Sur le projet de
 * reference, l humain a aplati le try/finally ; la commande, elle, laissait la
 * coquille, et un relecteur l aurait renvoyee.
 *
 * Deux formes, et rien d autre. Avec des `catch`, la queue `finally { … }`
 * part et le try/catch reste entier. Sans `catch`, `try { A } finally { post }`
 * EST `A` une fois le post parti : le corps remonte d un niveau et l habillage
 * disparait. Tout ce qui rend l identite douteuse est retenu avec sa raison.
 *
 * La remontee voyage dans `rewriteStart/rewriteEnd/rewriteText` et laisse
 * `removeStart` a -1 : un consommateur qui ne sait que supprimer une plage ne
 * fait rien, plutot que de supprimer le corps du `try`.
 */

const mod: any = await importOrNull('src/providers/unheardEvents');
const commande: any = await importOrNull('src/commands/RemoveEverythingUnused');
const plan: any = await importOrNull('src/providers/removalCascade');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const BASE = [
  f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n"),
  f(`${MAIN}/EventBus.java`,
    'package com.x;\n\npublic class EventBus {\n    public static EventBus getDefault() { return null; }\n'
    + '    public void post(Object e) {}\n    public void register(Object o) {}\n}\n'),
  f(`${MAIN}/Other.java`, 'package com.x;\n\npublic class Other {}\n'),
  f(`${MAIN}/Hears.java`,
    'package com.x;\n\nclass Hears {\n    void start() { EventBus.getDefault().register(this); }\n'
    + '    @Subscribe void on(Other e) {}\n}\n'),
  f(`${MAIN}/Orphan.java`, 'package com.x;\n\npublic class Orphan {}\n'),
];

const trouve = (poster: { path: string; text: string }) => {
  const r = mod.findUnheardEvents({ sources: [...BASE, poster], testSourceSets: ['/src/test/'] });
  expect(r.events.map((e: any) => e.name)).toEqual(['Orphan']);
  return r.events[0];
};

const apres = (poster: { path: string; text: string }) => {
  const e = trouve(poster);
  if (e.rewriteText !== undefined) {
    return poster.text.slice(0, e.rewriteStart) + e.rewriteText + poster.text.slice(e.rewriteEnd);
  }
  expect(e.removeStart).toBeGreaterThanOrEqual(0);
  return poster.text.slice(0, e.removeStart) + poster.text.slice(e.removeEnd);
};

const POST_JAVA = '            EventBus.getDefault().post(new Orphan());';
const POST_KT = '            EventBus.getDefault().post(Orphan())';

describe.skipIf(!mod)('un finally vide par le retrait du post', () => {
  it('la forme du projet de reference : le corps du try remonte', () => {
    const poster = f(`${MAIN}/Poster.java`, [
      'package com.x;',
      '',
      'class Poster {',
      '    Object get() {',
      '        Object data;',
      '        try {',
      '            data = load();',
      '        } finally {',
      POST_JAVA,
      '        }',
      '        return data;',
      '    }',
      '    Object load() { return null; }',
      '}',
      '',
    ].join('\n'));
    const e = trouve(poster);
    // La remontee ne passe pas par `removeStart` : supprimer la plage
    // emporterait le corps du try.
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBeUndefined();
    expect(e.rewriteText).toBe('        data = load();\n');

    const texte = apres(poster);
    expect(texte).not.toContain('try {');
    expect(texte).not.toContain('finally');
    expect(texte).toContain('        Object data;\n        data = load();\n        return data;');
  });

  it('le corps multiligne garde son imbrication et ses lignes vides', () => {
    const poster = f(`${MAIN}/Poster.kt`, [
      'package com.x',
      '',
      'class Poster {',
      '    fun go() {',
      '        try {',
      '            val a = 1',
      '',
      '            if (a > 0) {',
      '                println(a)',
      '            }',
      '        } finally {',
      POST_KT,
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(apres(poster)).toBe([
      'package com.x',
      '',
      'class Poster {',
      '    fun go() {',
      '        val a = 1',
      '',
      '        if (a > 0) {',
      '            println(a)',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
  });

  it('avec des catch, seule la queue finally part', () => {
    const poster = f(`${MAIN}/Poster.kt`, [
      'package com.x',
      '',
      'class Poster {',
      '    fun go() {',
      '        try {',
      '            println("a")',
      '        } catch (e: Exception) {',
      '            println("b")',
      '        } finally {',
      POST_KT,
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
    const e = trouve(poster);
    // Une suppression ordinaire : tout consommateur sait l appliquer.
    expect(e.removeStart).toBeGreaterThanOrEqual(0);
    expect(e.rewriteText).toBeUndefined();
    expect(poster.text[e.removeStart - 1]).toBe('}');
    expect(apres(poster)).toBe([
      'package com.x',
      '',
      'class Poster {',
      '    fun go() {',
      '        try {',
      '            println("a")',
      '        } catch (e: Exception) {',
      '            println("b")',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
  });
});

// Un point d entree Android tient le poster : sans ca la classe entiere meurt,
// KJ-032 la coupe, et la reecriture disparait dans une coupe qui n est pas la
// sienne.
const TIENT = f(`${MAIN}/Holder.java`,
  'package com.x;\n\nimport android.app.Activity;\n\npublic class Holder extends Activity {\n'
  + '    Object go() { return new Poster().get(); }\n}\n');

describe.skipIf(!commande)('par la commande de masse', () => {
  it('la coupe est un remplacement, et la cascade ne croit pas l import orphelin', () => {
    // Simulee comme une suppression, la cascade voyait `Locale` sans usage et
    // la reecriture rendait un fichier qui ne compile plus.
    const poster = f(`${MAIN}/Poster.java`, [
      'package com.x;',
      '',
      'import java.util.Locale;',
      '',
      'class Poster {',
      '    String get() {',
      '        String data;',
      '        try {',
      '            data = "A".toLowerCase(Locale.US);',
      '        } finally {',
      POST_JAVA,
      '        }',
      '        return data;',
      '    }',
      '}',
      '',
    ].join('\n'));
    const { parFichier } = commande.collecterUnePasse([...BASE, TIENT, poster], ['/src/test/']);
    const coupes = (parFichier.get(poster.path) ?? []) as any[];
    expect(coupes.map(c => c.famille)).toEqual(['evenements']);
    expect(coupes[0].texte).toContain('Locale.US');

    const cascade = plan.planCascade(
      new Map([[poster.path, coupes.map(c => ({ start: c.start, end: c.end, replacement: c.texte === '' ? undefined : c.texte }))]]),
      new Map([[poster.path, poster.text]]),
    );
    expect(cascade.imports.has(poster.path)).toBe(false);
  });

  it('un compte de famille : la reecriture reste un post inaudible', () => {
    const poster = f(`${MAIN}/Poster.java`, [
      'package com.x;',
      '',
      'class Poster {',
      '    Object get() {',
      '        Object data;',
      '        try {',
      '            data = load();',
      '        } finally {',
      POST_JAVA,
      '        }',
      '        return data;',
      '    }',
      '    Object load() { return null; }',
      '}',
      '',
    ].join('\n'));
    const { parFichier } = commande.collecterUnePasse([...BASE, TIENT, poster], ['/src/test/']);
    const tally = commande.compteLesFamilles(parFichier);
    expect(tally.evenements).toBe(1);
    expect(tally.renommages).toBe(0);
  });
});

describe.skipIf(!mod)('ce que la remontee refuse', () => {
  const refuse = (corps: string[], raison: RegExp) => {
    const poster = f(`${MAIN}/Poster.kt`, ['package com.x', '', 'class Poster {', ...corps, '}', ''].join('\n'));
    const e = trouve(poster);
    expect(e.removeStart).toBe(-1);
    expect(e.rewriteText).toBeUndefined();
    expect(e.withheld).toMatch(raison);
  };

  it('un try avec ressources : la fermeture partirait avec', () => {
    const poster = f(`${MAIN}/Poster.java`, [
      'package com.x;',
      '',
      'class Poster {',
      '    void go() {',
      '        try (AutoCloseable c = open()) {',
      '            c.toString();',
      '        } finally {',
      POST_JAVA,
      '        }',
      '    }',
      '    AutoCloseable open() { return null; }',
      '}',
      '',
    ].join('\n'));
    const e = trouve(poster);
    expect(e.removeStart).toBe(-1);
    expect(e.rewriteText).toBeUndefined();
    expect(e.withheld).toMatch(/try with resources/);
  });

  it('un try EXPRESSION : sa valeur est ce que quelqu un recoit', () => {
    refuse([
      '    fun go(): Int {',
      '        val x = try {',
      '            1',
      '        } finally {',
      POST_KT,
      '        }',
      '        return x',
      '    }',
    ], /not a statement of its own/);
  });

  it('un return devant le try : meme raison', () => {
    refuse([
      '    fun go(): Int {',
      '        return try {',
      '            1',
      '        } finally {',
      POST_KT,
      '        }',
      '    }',
    ], /not a statement of its own/);
  });

  it('une chaine brute dans le corps : la desindenter la changerait', () => {
    refuse([
      '    fun go() {',
      '        try {',
      '            val t = """',
      '                texte',
      '            """',
      '            println(t)',
      '        } finally {',
      POST_KT,
      '        }',
      '    }',
    ], /raw string/);
  });

  it('une locale que le bloc englobant nomme deja : declaration en conflit', () => {
    refuse([
      '    fun go() {',
      '        try {',
      '            val a = 1',
      '            println(a)',
      '        } finally {',
      POST_KT,
      '        }',
      '        val a = 2',
      '        println(a)',
      '    }',
    ], /declares a, which the enclosing block already names/);
  });

  it('une ligne de suite apres l accolade se rattacherait au corps', () => {
    refuse([
      '    fun go() {',
      '        try {',
      '            compute()',
      '        } finally {',
      POST_KT,
      '        }',
      '            .also { println(it) }',
      '    }',
      '    fun compute() = 1',
    ], /would bind to its body/);
  });

  it('un try ecrit sur une seule ligne', () => {
    refuse([
      '    fun go() {',
      '        try { compute() } finally {',
      POST_KT,
      '        }',
      '    }',
      '    fun compute() = 1',
    ], /one clause per line/);
  });

  it('un corps de try vide', () => {
    refuse([
      '    fun go() {',
      '        try {',
      '        } finally {',
      POST_KT,
      '        }',
      '    }',
    ], /try body is empty/);
  });
});
