import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';

/**
 * Une classe d annotation que personne n ecrit.
 *
 * Sur la reference, `@IntDef(SwanSpruceItems.A, ...) annotation class
 * SwanSpruceItems` n etait nommee que par sa propre meta-annotation. Les
 * annotations n etaient pas candidates du tout.
 */

const SEGS = ['/src/test/'];
const f = (path: string, text: string) => ({ path, text });
const MAIN = f('/w/app/src/main/java/a/Main.kt', 'package a\n\nfun main() {\n    println(1)\n}\n');
const names = (...sources: { path: string; text: string }[]) =>
  findUnusedSymbols({ sources: [MAIN, ...sources], testSourceSets: SEGS, includeTestOnly: true })
    .map(s => `${s.name}:${s.verdict}`);

const INTDEF = [
  'package a', '', 'import androidx.annotation.IntDef', '',
  '@Retention(AnnotationRetention.SOURCE)',
  '@IntDef(', '    Mode.OFF,', '    Mode.ON,', ')',
  'annotation class Mode {', '    companion object {', '        const val OFF: Int = 0', '        const val ON: Int = 1', '    }', '}', '',
].join('\n');

describe('une annotation jamais ecrite est une declaration morte', () => {
  it('celle qui ne se nomme que dans sa propre meta-annotation', () => {
    expect(names(f('/w/app/src/main/java/a/Mode.kt', INTDEF))).toEqual(['Mode:unreferenced']);
  });

  it('une annotation nue, et une qualifiante que rien ne porte', () => {
    expect(names(f('/w/app/src/main/java/a/Marker.kt', 'package a\n\nannotation class Marker\n'))).toEqual(['Marker:unreferenced']);
    expect(names(f('/w/app/src/main/java/a/Utc.kt', 'package a\n\n@Qualifier\n@Retention(AnnotationRetention.BINARY)\nannotation class Utc\n')))
      .toEqual(['Utc:unreferenced']);
  });

  it('un @interface Java dont la retention est ecrite et ne va pas jusqu a l execution', () => {
    for (const policy of ['SOURCE', 'CLASS']) {
      const text = `package a;\n\n@Retention(RetentionPolicy.${policy})\npublic @interface Marker {\n}\n`;
      expect(names(f('/w/app/src/main/java/a/Marker.java', text)), policy).toEqual(['Marker:unreferenced']);
    }
  });

  it('ecrite seulement dans un test : tenue par les tests', () => {
    const test = f('/w/app/src/test/java/a/T.kt', 'package a\n\n@Marker\nclass T\n');
    expect(names(f('/w/app/src/main/java/a/Marker.kt', 'package a\n\nannotation class Marker\n'), test)).toEqual(['Marker:testOnly']);
  });
});

describe('une annotation ecrite quelque part reste vivante', () => {
  it('posee sur une declaration, un parametre, ou nommee par ses constantes', () => {
    const marker = f('/w/app/src/main/java/a/Marker.kt', 'package a\n\nannotation class Marker\n');
    expect(names(marker, f('/w/app/src/main/java/a/Use.kt', 'package a\n\n@Marker\nfun used() = main()\n'))).not.toContain('Marker:unreferenced');
    const mode = f('/w/app/src/main/java/a/Mode.kt', INTDEF);
    expect(names(mode, f('/w/app/src/main/java/a/Use.kt', 'package a\n\nfun pick(@Mode m: Int) = m\n')).filter(n => n.startsWith('Mode'))).toEqual([]);
    expect(names(mode, f('/w/app/src/main/java/a/Use.kt', 'package a\n\nval start = Mode.OFF\n')).filter(n => n.startsWith('Mode'))).toEqual([]);
  });

  it('nommee dans son propre fichier hors de sa declaration', () => {
    const text = INTDEF + '\nfun pick(@Mode m: Int) = m\n';
    expect(names(f('/w/app/src/main/java/a/Mode.kt', text)).filter(n => n.startsWith('Mode'))).toEqual([]);
  });
});

describe('une annotation que la reflexion peut chercher n est pas jugee', () => {
  const canari = f('/w/app/src/main/java/a/Gone.kt', 'package a\n\nannotation class Gone\n');

  it('retention RUNTIME, en Kotlin comme en Java, sur une ligne ou plusieurs', () => {
    for (const [path, text] of [
      ['/w/app/src/main/java/a/Utc.kt', 'package a\n\n@Qualifier\n@Retention(AnnotationRetention.RUNTIME)\nannotation class Utc\n'],
      ['/w/app/src/main/java/a/Utc.kt', 'package a\n\n@Retention(\n    AnnotationRetention.RUNTIME,\n)\nannotation class Utc\n'],
      ['/w/app/src/main/java/a/Utc.kt', 'package a\n\n@Retention(value = RUNTIME)\nannotation class Utc\n'],
      ['/w/app/src/main/java/a/Utc.java', 'package a;\n\n@Retention(RetentionPolicy.RUNTIME)\npublic @interface Utc {\n}\n'],
    ]) {
      expect(names(canari, f(path, text)), text).toEqual(['Gone:unreferenced']);
    }
  });

  it('un @interface Java sans retention ecrite', () => {
    expect(names(canari, f('/w/app/src/main/java/a/Marker.java', 'package a;\n\npublic @interface Marker {\n}\n'))).toEqual(['Gone:unreferenced']);
  });

  it('la retention de la voisine ne compte pas pour elle', () => {
    const text = 'package a\n\n@Retention(AnnotationRetention.RUNTIME)\nannotation class Kept\n\n@Retention(AnnotationRetention.SOURCE)\nannotation class Dead\n';
    expect(names(f('/w/app/src/main/java/a/Two.kt', text))).toEqual(['Dead:unreferenced']);
  });
});
