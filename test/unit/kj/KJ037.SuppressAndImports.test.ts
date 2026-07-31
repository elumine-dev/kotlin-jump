import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, explainSymbols } from '../../../src/providers/unusedSymbols';
import { suppressesDiagnostic, UNUSED_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE } from '../../../src/util/kotlinScan';
import { collectAnnotationTargets, sanitizeForUsageScan } from '../../../src/util/kotlinScan';

/**
 * KJ-037 — deux défauts trouvés en auditant un vrai monorepo.
 *
 * 1. `@Suppress` était traité comme une annotation de framework, donc comme un
 *    point d'entrée. `@Suppress("UNUSED_PARAMETER")` rendait la déclaration
 *    intouchable alors qu'elle ne dit rien sur son atteignabilité. Et au niveau
 *    fichier, un `/unused/i` naïf ne distinguait pas `"unused"` de
 *    `"UNUSED_PARAMETER"` : un fichier qui taisait l'avertissement du
 *    compilateur sur un paramètre désactivait au passage la détection de code
 *    mort sur tout son contenu.
 *
 * 2. La moisson jetait la ligne d'import entière. Or `import p.Outer.Nested`
 *    nomme `Outer` structurellement : le fichier casse si `Outer` disparaît,
 *    même si son corps n'écrit jamais que `Nested`. Sept types vivants du
 *    monorepo étaient signalés à tort, tous des sealed class dont les variantes
 *    sont importées exactement comme ça.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const j = (path: string, text: string) => ({ path, text });
const names = (sources: any[]) =>
  findUnusedSymbols({ sources, testSourceSets: TEST_SETS }).map((f: any) => f.name);
const why = (sources: any[], name: string) =>
  explainSymbols({ sources, testSourceSets: TEST_SETS }).filter(e => e.name === name).map(e => e.outcome);

describe('suppressesDiagnostic distingue les diagnostics', () => {
  it('« unused » est l’opt-out de tout le monde', () => {
    for (const set of [UNUSED_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE]) {
      expect(suppressesDiagnostic('"unused"', set)).toBe(true);
    }
  });

  it('UNUSED_PARAMETER ne vaut que pour le détecteur de paramètres', () => {
    expect(suppressesDiagnostic('"UNUSED_PARAMETER"', UNUSED_PARAMETER)).toBe(true);
    expect(suppressesDiagnostic('"UNUSED_PARAMETER"', UNUSED_DECLARATION)).toBe(false);
    expect(suppressesDiagnostic('"UNUSED_PARAMETER"', UNUSED_VARIABLE)).toBe(false);
  });

  it('le préfixe partagé ne suffit pas : « _ » est un caractère de mot', () => {
    // C'est exactement ce que /unused/i ratait.
    expect(suppressesDiagnostic('"UNUSED_VARIABLE"', UNUSED_DECLARATION)).toBe(false);
    expect(suppressesDiagnostic('"UNUSED_EXPRESSION"', UNUSED_DECLARATION)).toBe(false);
    expect(suppressesDiagnostic('"unusedThing"', UNUSED_DECLARATION)).toBe(false);
  });

  it('un argument parmi plusieurs suffit', () => {
    expect(suppressesDiagnostic('"TooManyFunctions", "unused"', UNUSED_DECLARATION)).toBe(true);
  });

  it('la casse ne compte pas', () => {
    expect(suppressesDiagnostic('"UNUSED"', UNUSED_DECLARATION)).toBe(true);
  });
});

describe('les arguments d’annotation se lisent sur le texte brut', () => {
  it('collectAnnotationTargets rend des offsets valides contre l’original', () => {
    // Le sanitizer blanchit le CORPS des chaînes en préservant les longueurs :
    // découper `clean` rendrait `"       "`, d'où l'obligation de découper le
    // texte d'origine avec les mêmes offsets.
    const text = '@Suppress("unused")\nclass Foo\n';
    const [anno] = collectAnnotationTargets(sanitizeForUsageScan(text));
    expect(anno.name).toBe('Suppress');
    expect(text.slice(anno.argStart, anno.argEnd)).toBe('"unused"');
  });

  it('une annotation sans arguments rend -1', () => {
    const [anno] = collectAnnotationTargets(sanitizeForUsageScan('@Composable\nfun F() {}\n'));
    expect(anno.argStart).toBe(-1);
    expect(anno.argEnd).toBe(-1);
  });

  it('une annotation multiligne reste correctement délimitée', () => {
    const text = '@Suppress(\n    "unused",\n    "TooManyFunctions",\n)\nclass Foo\n';
    const [anno] = collectAnnotationTargets(sanitizeForUsageScan(text));
    expect(text.slice(anno.argStart, anno.argEnd)).toContain('"unused"');
  });
});

describe('@Suppress au niveau déclaration', () => {
  const decl = (anno: string) =>
    [j('/w/a/src/main/kotlin/A.kt', `package a\n\n${anno}\nfun ghost(x: Any) {\n}\n`)];

  it('@Suppress("UNUSED_PARAMETER") ne protège plus la déclaration', () => {
    // Le cas réel : deux stubs de variante de build portaient cette annotation
    // et passaient pour des points d'entrée.
    expect(names(decl('@Suppress("UNUSED_PARAMETER")'))).toEqual(['ghost']);
  });

  it('@Suppress("unused") reste un opt-out explicite', () => {
    expect(names(decl('@Suppress("unused")'))).toEqual([]);
    expect(why(decl('@Suppress("unused")'), 'ghost')).toEqual(['F12:suppress-unused']);
  });

  it('@SuppressWarnings("unused") vaut pareil côté Java', () => {
    const sources = [j('/w/a/src/main/java/G.java',
      'package a;\n\n@SuppressWarnings("unused")\npublic class Ghost {\n}\n')];
    expect(names(sources)).toEqual([]);
  });

  it('une annotation de framework protège toujours', () => {
    expect(names(decl('@Entity'))).toEqual([]);
  });
});

describe('@file:Suppress ne fait taire que ce qu’il nomme', () => {
  it('« UNUSED_PARAMETER » au niveau fichier ne cache plus le code mort', () => {
    const sources = [j('/w/a/src/main/kotlin/A.kt',
      '@file:Suppress("UNUSED_PARAMETER")\n\npackage a\n\nclass Ghost\n')];
    expect(names(sources)).toEqual(['Ghost']);
  });

  it('« unused » au niveau fichier tait toujours tout le fichier', () => {
    const sources = [j('/w/a/src/main/kotlin/A.kt',
      '@file:Suppress("unused", "TooManyFunctions")\n\npackage a\n\nclass Ghost\n')];
    expect(names(sources)).toEqual([]);
  });
});

describe('les segments d’un import nommant un type', () => {
  const sealed = j('/w/a/src/main/kotlin/Events.kt', [
    'package a',
    '',
    'sealed class LoginEvent {',
    '    object Opened : LoginEvent()',
    '    object Closed : LoginEvent()',
    '}',
  ].join('\n'));

  it('`import p.Outer.Nested` garde `Outer` en vie', () => {
    // Le corps n'écrit jamais `LoginEvent`, mais le supprimer casserait ce
    // fichier. Sept types vivants étaient signalés à cause de ça.
    const sources = [
      sealed,
      j('/w/b/src/main/kotlin/B.kt',
        'package b\n\nimport a.LoginEvent.Opened\n\nfun handle() {\n    println(Opened)\n}\n'),
    ];
    expect(names(sources)).not.toContain('LoginEvent');
  });

  it('mais le DERNIER segment ne suffit toujours pas', () => {
    // Un fichier qui importe un type sans jamais l'utiliser porte un import
    // mort : le type reste non référencé, et l'import fait partie du correctif.
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nclass Ghost\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nimport a.Ghost\n\nclass Other\n'),
    ];
    const found = findUnusedSymbols({ sources, testSourceSets: TEST_SETS })
      .find((f: any) => f.name === 'Ghost');
    expect(found).toBeDefined();
    expect(found!.staleImports.map(s => s.path)).toEqual(['/w/b/src/main/kotlin/B.kt']);
  });

  it('un segment de package en minuscules n’est pas pris pour un type', () => {
    const sources = [
      j('/w/a/src/main/kotlin/A.kt', 'package a\n\nclass Ghost\n'),
      j('/w/b/src/main/kotlin/B.kt', 'package b\n\nimport a.ghost.Thing\n\nclass Other\n'),
    ];
    expect(names(sources)).toContain('Ghost');
  });

  it('un import statique Java nomme aussi son type porteur', () => {
    const sources = [
      j('/w/a/src/main/java/Consts.java', 'package a;\n\npublic class Consts {\n    public static final int MAX = 1;\n}\n'),
      j('/w/b/src/main/java/B.java', 'package b;\n\nimport static a.Consts.MAX;\n\npublic class B {\n    int v = MAX;\n}\n'),
    ];
    expect(names(sources)).not.toContain('Consts');
  });
});
