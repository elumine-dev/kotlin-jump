import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';

/**
 * KJ-034 — le code mort Java.
 *
 * Le corpus contenait déjà les `.java` et la moisson les lisait déjà : seule
 * la découverte des candidats les jetait. Le périmètre tombe juste tout seul,
 * puisque `parseJava` émet méthodes et champs à une profondeur >= 1 et que le
 * filtre existant ne garde que le niveau fichier.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/java/com/x';
const j = (path: string, text: string) => ({ path, text });
const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedSymbols({ sources, testSourceSets: TEST_SETS, ...extra });
const flagged = (sources: any[], name: string) => find(sources).some((f: any) => f.name === name);

const ghost = (body = 'public class Ghost {\n}') =>
  j(`${MAIN}/Ghost.java`, `package com.x;\n\n${body}\n`);

describe('périmètre', () => {
  it('une classe Java que rien ne nomme est signalée', () => {
    expect(flagged([ghost()], 'Ghost')).toBe(true);
  });

  it('une classe Java référencée depuis du Kotlin est vivante', () => {
    const sources = [
      ghost(),
      j('/w/app/src/main/kotlin/com/x/User.kt', 'package com.x\n\nval g = Ghost()\n'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('une classe Kotlin référencée depuis du Java est vivante', () => {
    const sources = [
      j('/w/app/src/main/kotlin/com/x/Api.kt', 'package com.x\n\nclass Api\n'),
      j(`${MAIN}/Caller.java`, 'package com.x;\n\nimport com.x.Api;\n\npublic class Caller {\n    Api a = new Api();\n}\n'),
    ];
    expect(flagged(sources, 'Api')).toBe(false);
  });

  it('les MEMBRES Java restent hors périmètre : ils vivent à une profondeur > 0', () => {
    const sources = [
      ghost('public class Ghost {\n    public void neverCalled() {}\n    private int unusedField = 1;\n}'),
      j('/w/app/src/main/kotlin/com/x/U.kt', 'package com.x\n\nval g = Ghost()\n'),
    ];
    const names = find(sources).map((f: any) => f.name);
    expect(names).not.toContain('neverCalled');
    expect(names).not.toContain('unusedField');
  });

  it('une classe déclarée dans un source set de test n’est pas candidate', () => {
    const sources = [j('/w/app/src/test/java/com/x/GhostTest.java', 'package com.x;\n\npublic class GhostTest {\n}\n')];
    expect(find(sources)).toEqual([]);
  });
});

describe('les points d’entrée Java', () => {
  it('une classe portant un main() est un point d’entrée', () => {
    const sources = [ghost('public class Ghost {\n    public static void main(String[] args) {}\n}')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('et elle protège tout le fichier, pas seulement elle-même', () => {
    const sources = [j(`${MAIN}/Tool.java`, [
      'package com.x;',
      '',
      'class Helper {',
      '}',
      '',
      'public class Tool {',
      '    public static void main(String[] args) {}',
      '}',
    ].join('\n'))];
    expect(find(sources)).toEqual([]);
  });

  it('une méthode native est liée à un symbole C que le corpus ne lit pas', () => {
    const sources = [ghost('public class Ghost {\n    public native int compute(int a);\n}')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });

  it('un @Test sans annotation de classe suffit, comme JUnit 5 l’autorise', () => {
    const sources = [ghost('public class Ghost {\n    @Test\n    void checks() {}\n}')];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });
});

describe('les gardes héritées valent aussi pour Java', () => {
  it('une annotation hors allowlist rend vivant', () => {
    for (const anno of ['@Entity', '@Module', '@Keep', '@Singleton']) {
      expect(flagged([ghost(`${anno}\npublic class Ghost {\n}`)], 'Ghost'), anno).toBe(false);
    }
  });

  it('implements Serializable rend vivant', () => {
    expect(flagged([ghost('public class Ghost implements Serializable {\n}')], 'Ghost')).toBe(false);
  });

  it('extends Fragment rend vivant', () => {
    expect(flagged([ghost('public class Ghost extends Fragment {\n}')], 'Ghost')).toBe(false);
  });

  it('un nom déclaré des deux côtés de la frontière est neutralisé', () => {
    // Une mention quelque part, et rien ne dit laquelle des deux elle nomme.
    // Sans mention du tout, KJ-036 signale les deux (aucune n'est référencée).
    const sources = [
      ghost(),
      j('/w/app/src/main/kotlin/com/y/Ghost.kt', 'package com.y\n\nclass Ghost\n'),
      j('/w/app/src/main/kotlin/com/y/Use.kt', 'package com.y\n\nval held: Ghost? = null\n'),
    ];
    expect(find(sources).map((f: any) => f.name)).not.toContain('Ghost');
  });

  it('une classe nommée dans le manifest est vivante', () => {
    const sources = [
      ghost(),
      j('/w/app/src/main/AndroidManifest.xml', '<manifest><service android:name=".Ghost" /></manifest>'),
    ];
    expect(flagged(sources, 'Ghost')).toBe(false);
  });
});

describe('l’en-tête Java sur plusieurs lignes', () => {
  it('un extends sur la ligne suivante ne tronque pas l’étendue', () => {
    // Kotlin termine la ligne par « : » ou « , » ; Java commence la suivante
    // par extends. Sans cette règle, l'étendue s'arrêtait à la première ligne,
    // le corps n'était pas blanchi et le type paraissait vivant.
    const sources = [j(`${MAIN}/Wrapped.java`, [
      'package com.x;',
      '',
      'public class Wrapped',
      '        extends Base',
      '        implements Runnable {',
      '    void run() { Wrapped self = null; }',
      '}',
    ].join('\n'))];
    expect(flagged(sources, 'Wrapped')).toBe(true);
  });
});
