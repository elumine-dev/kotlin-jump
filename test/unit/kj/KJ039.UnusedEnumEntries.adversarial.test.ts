import { describe, it, expect } from 'vitest';
import { findUnusedEnumEntries, explainEnumEntries } from '../../../src/providers/unusedEnumEntries';

/**
 * KJ-039 — les entrées d'enum que rien ne nomme.
 *
 * Un enum accumule des variantes mortes plus vite que n'importe quelle autre
 * construction : retirer le dernier usage d'une entrée laisse la déclaration
 * compiler, et rien dans le build ne s'en plaint.
 *
 * Le point de conception : les gardes portent sur l'ENUM, pas sur l'entrée.
 * `values()`, `valueOf()` et la sérialisation rendent TOUTES les variantes
 * atteignables sans qu'aucune ne soit écrite. Juger entrée par entrée
 * signalerait celle qui n'apparaît pas alors que ses sœurs apparaissent, ce
 * qui est la pire forme d'erreur : elle est plausible.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });

const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedEnumEntries({ sources, testSourceSets: TEST_SETS, ...extra });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  find(sources, extra).map((e: any) => `${e.enumName}.${e.name}`);
const why = (sources: any[], entry: string) =>
  explainEnumEntries({ sources, testSourceSets: TEST_SETS })
    .filter(e => e.name === entry).map(e => e.outcome);

const mode = f(`${MAIN}/Mode.kt`, [
  'package com.x',
  '',
  'enum class Mode {',
  '    ALLOW,',
  '    DENY,',
  '}',
].join('\n'));

describe('le cas de base', () => {
  it('une entrée que rien ne nomme est signalée', () => {
    const user = f(`${MAIN}/Gate.kt`,
      'package com.x\n\nclass Gate {\n    fun check() = Mode.ALLOW\n}\n');
    expect(names([mode, user])).toEqual(['Mode.DENY']);
  });

  it('les deux entrées nommées, rien n’est signalé', () => {
    const user = f(`${MAIN}/Gate.kt`, [
      'package com.x',
      '',
      'class Gate {',
      '    fun check(open: Boolean) = if (open) Mode.ALLOW else Mode.DENY',
      '}',
    ].join('\n'));
    expect(names([mode, user])).toEqual([]);
  });

  it('aucune entrée nommée : les deux sont signalées', () => {
    expect(names([mode])).toEqual(['Mode.ALLOW', 'Mode.DENY']);
  });
});

describe('les gardes portent sur l’enum entier', () => {
  const cases: [string, string][] = [
    ['values()', 'for (m in Mode.values()) println(m)'],
    ['entries', 'val all = Mode.entries'],
    ['valueOf', 'val m = Mode.valueOf(fromServer)'],
    ['référence de classe', 'val k = Mode::class.java'],
  ];

  for (const [label, line] of cases) {
    it(`${label} rend toutes les entrées atteignables`, () => {
      const user = f(`${MAIN}/Walker.kt`,
        `package com.x\n\nclass Walker {\n    fun go(fromServer: String) {\n        ${line}\n    }\n}\n`);
      expect(names([mode, user])).toEqual([]);
      expect(why([mode, user], 'DENY')).toEqual(['E1:walked-as-whole']);
    });
  }

  it('`Mode.ALLOW.ordinal` ne protège que ce qu’il nomme', () => {
    // Lire l'ordinal d'une entrée qu'on tient déjà ne dit rien des autres.
    // Reprendre une entrée par position passe par `values()[i]`, déjà couvert.
    const user = f(`${MAIN}/Walker.kt`,
      'package com.x\n\nclass Walker {\n    fun go() = Mode.ALLOW.ordinal\n}\n');
    expect(names([mode, user])).toEqual(['Mode.DENY']);
  });

  it('un `values()` sur autre chose ne fait rien taire', () => {
    // La garde est ancrée sur le nom de l'enum, sinon n'importe quel
    // `list.values()` dans le projet désarmerait la détection partout.
    const user = f(`${MAIN}/Other.kt`, [
      'package com.x',
      '',
      'class Other {',
      '    fun go(map: Map<String, Int>) {',
      '        for (v in map.values()) println(v)',
      '        println(Mode.ALLOW)',
      '    }',
      '}',
    ].join('\n'));
    expect(names([mode, user])).toEqual(['Mode.DENY']);
  });

  it('une annotation hors allowlist protège tout l’enum', () => {
    // Un sérialiseur mappe les noms sans qu'aucun n'apparaisse dans le code.
    for (const anno of ['@Serializable', '@JsonClass', '@Entity', '@TypeConverters']) {
      const annotated = f(`${MAIN}/Mode.kt`,
        `package com.x\n\n${anno}\nenum class Mode {\n    ALLOW,\n    DENY,\n}\n`);
      expect(names([annotated]), anno).toEqual([]);
    }
  });

  it('mais @Deprecated ne protège pas : déprécié ET mort est la meilleure trouvaille', () => {
    const deprecated = f(`${MAIN}/Mode.kt`,
      'package com.x\n\n@Deprecated("old")\nenum class Mode {\n    ALLOW,\n    DENY,\n}\n');
    expect(names([deprecated])).toEqual(['Mode.ALLOW', 'Mode.DENY']);
  });
});

describe('ce qui compte comme une mention', () => {
  it('une chaîne littérale suffit', () => {
    // La désérialisation par nom passe par là, et le sac de jetons la voit.
    const user = f(`${MAIN}/Gate.kt`,
      'package com.x\n\nclass Gate {\n    val raw = "DENY"\n    fun go() = Mode.ALLOW\n}\n');
    expect(names([mode, user])).toEqual([]);
  });

  it('une mention en XML suffit', () => {
    const layout = f('/w/app/src/main/res/layout/a.xml',
      '<View app:mode="DENY" />');
    const user = f(`${MAIN}/Gate.kt`, 'package com.x\n\nclass Gate {\n    fun go() = Mode.ALLOW\n}\n');
    expect(names([mode, user, layout])).toEqual([]);
  });

  it('un commentaire ne suffit PAS', () => {
    const user = f(`${MAIN}/Gate.kt`,
      'package com.x\n\nclass Gate {\n    // DENY was handled here once\n    fun go() = Mode.ALLOW\n}\n');
    expect(names([mode, user])).toEqual(['Mode.DENY']);
  });
});

describe('les homonymes entre enums', () => {
  const other = f(`${MAIN}/Access.kt`,
    'package com.x\n\nenum class Access {\n    ALLOW,\n    DENY,\n}\n');

  it('deux enums partageant leurs noms d’entrée, zéro mention : tout est signalé', () => {
    // Même raisonnement que KJ-036 : ne pas savoir LAQUELLE une mention
    // désigne est sans objet quand il n'y a aucune mention.
    expect(names([mode, other]).sort())
      .toEqual(['Access.ALLOW', 'Access.DENY', 'Mode.ALLOW', 'Mode.DENY']);
  });

  it('une seule mention ambiguë neutralise les deux', () => {
    const user = f(`${MAIN}/Gate.kt`, 'package com.x\n\nclass Gate {\n    fun go() = ALLOW\n}\n');
    expect(names([mode, other, user])).not.toContain('Mode.ALLOW');
    expect(names([mode, other, user])).not.toContain('Access.ALLOW');
  });
});

describe('les tests', () => {
  it('un enum déclaré dans un source set de test est hors périmètre', () => {
    const inTest = f('/w/app/src/test/kotlin/com/x/Mode.kt',
      'package com.x\n\nenum class Mode {\n    ALLOW,\n}\n');
    expect(names([inTest])).toEqual([]);
  });

  it('une entrée que seuls les tests nomment a son propre verdict', () => {
    const test = f('/w/app/src/test/kotlin/com/x/GateTest.kt',
      'package com.x\n\nclass GateTest {\n    fun t() = Mode.DENY\n}\n');
    const user = f(`${MAIN}/Gate.kt`, 'package com.x\n\nclass Gate {\n    fun go() = Mode.ALLOW\n}\n');
    const found = find([mode, user, test]);
    expect(found.map(e => e.name)).toEqual(['DENY']);
    expect(found[0].verdict).toBe('testOnly');
  });

  it('et on peut les exclure', () => {
    const test = f('/w/app/src/test/kotlin/com/x/GateTest.kt',
      'package com.x\n\nclass GateTest {\n    fun t() = Mode.DENY\n}\n');
    const user = f(`${MAIN}/Gate.kt`, 'package com.x\n\nclass Gate {\n    fun go() = Mode.ALLOW\n}\n');
    expect(names([mode, user, test], { includeTestOnly: false })).toEqual([]);
  });
});

describe('Java', () => {
  it('un enum Java se lit comme un enum Kotlin', () => {
    const javaEnum = f('/w/app/src/main/java/com/x/Level.java',
      'package com.x;\n\npublic enum Level {\n    LOW,\n    HIGH\n}\n');
    const user = f('/w/app/src/main/java/com/x/Use.java',
      'package com.x;\n\nclass Use {\n    Level l = Level.LOW;\n}\n');
    expect(names([javaEnum, user])).toEqual(['Level.HIGH']);
  });

  it('et son `values()` protège tout autant', () => {
    const javaEnum = f('/w/app/src/main/java/com/x/Level.java',
      'package com.x;\n\npublic enum Level {\n    LOW,\n    HIGH\n}\n');
    const user = f('/w/app/src/main/java/com/x/Use.java',
      'package com.x;\n\nclass Use {\n    void go() { for (Level l : Level.values()) {} }\n}\n');
    expect(names([javaEnum, user])).toEqual([]);
  });
});

describe('l’étendue de suppression', () => {
  it('une entrée seule sur sa ligne est supprimable', () => {
    expect(find([mode])[0].removeStart).toBeGreaterThanOrEqual(0);
  });

  it('plusieurs entrées sur une ligne le sont aussi, virgule comprise', () => {
    // Ce test disait l'inverse jusqu'a 1.42.232 : recoller la ligne n'etait pas
    // fait, donc le correctif abandonnait. Six des neuf trouvailles restantes
    // sur /Users/kevin/Desktop/work/lapresse etaient exactement cette forme,
    // que les enums Java prennent des que la liste est courte.
    const packed = f(`${MAIN}/Level.kt`, 'package com.x\n\nenum class Level {\n    LOW, HIGH,\n}\n');
    const trouves = find([packed]);
    expect(trouves.length, 'sans entree trouvee, le verdict ne prouve rien').toBeGreaterThan(0);
    for (const e of trouves) expect(e.removeStart, e.name).toBeGreaterThanOrEqual(0);
  });

  it('la coupe emporte UNE virgule et laisse la liste valide', () => {
    const texte = 'package com.x\n\nenum class Level {\n    LOW, MID, HIGH,\n}\n';
    const packed = f(`${MAIN}/Level.kt`, texte);
    const mid = find([packed]).find(e => e.name === 'MID');
    expect(mid, 'MID doit etre trouve').toBeDefined();
    const apres = texte.slice(0, mid!.removeStart) + texte.slice(mid!.removeEnd);
    expect(apres).toContain('LOW, HIGH,');
    expect(apres).not.toContain('MID');
  });

  it('la DERNIERE entree emporte la virgule qui la precede', () => {
    // LOW est utilise : HIGH est la seule morte, donc aucune voisine ne lui
    // dispute la virgule et la regle de la derniere entree s applique seule.
    const texte = 'package com.x\n\nenum class Level {\n    LOW, HIGH\n}\n';
    const packed = f(`${MAIN}/Level.kt`, texte);
    const user = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go() = Level.LOW\n');
    const high = find([packed, user]).find(e => e.name === 'HIGH');
    expect(high, 'HIGH doit etre trouve').toBeDefined();
    const apres = texte.slice(0, high!.removeStart) + texte.slice(high!.removeEnd);
    expect(apres).toContain('    LOW\n');
    expect(apres).not.toContain('HIGH');
  });

  it('en Java, le point virgule qui ouvre les membres est preserve', () => {
    const texte = 'package com.x;\n\npublic enum Level {\n    LOW, HIGH;\n    int v;\n}\n';
    const packed = f('/w/app/src/main/java/com/x/Level.java', texte);
    const user = f('/w/app/src/main/java/com/x/Use.java',
      'package com.x;\n\nclass Use { Level l = Level.LOW; }\n');
    const high = find([packed, user]).find(e => e.name === 'HIGH');
    expect(high, 'HIGH doit etre trouve').toBeDefined();
    const apres = texte.slice(0, high!.removeStart) + texte.slice(high!.removeEnd);
    expect(apres).toContain('LOW;');
    expect(apres).not.toContain('HIGH');
  });

  it('deux voisines mortes ne se disputent pas la meme virgule', () => {
    // `enum SortOrder { ASC, DESC }` : ASC reclame la virgule comme separateur
    // suivant, DESC la reclame comme separateur precedent. Une ampoule a la
    // fois, c'est sans consequence ; appliquees ensemble, la seconde coupe
    // mangeait l'accolade fermante. Vu sur
    // /Users/kevin/Desktop/work/lapresse dans LogDatabaseCriteria.java.
    const texte = 'package com.x\n\nenum class SortOrder { ASC, DESC }\n';
    const packed = f(`${MAIN}/SortOrder.kt`, texte);
    const trouves = find([packed]).filter(e => e.removeStart >= 0)
      .sort((a, b) => a.removeStart - b.removeStart);
    expect(trouves.length, 'les deux entrees doivent etre trouvees').toBe(2);
    for (let i = 1; i < trouves.length; i++) {
      expect(trouves[i].removeStart, 'chevauchement').toBeGreaterThanOrEqual(trouves[i - 1].removeEnd);
    }
    let apres = texte;
    for (const e of [...trouves].reverse()) apres = apres.slice(0, e.removeStart) + apres.slice(e.removeEnd);
    const solde = (t: string) => [...t].reduce((a, c) => a + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
    expect(solde(apres), apres).toBe(solde(texte));
    expect(apres).not.toContain('ASC');
    expect(apres).not.toContain('DESC');
  });

  it('une entree a CORPS sur une ligne partagee n est pas devinee', () => {
    // `A { override fun f() = 1 }, B` : la coupe doit passer le corps, et si
    // elle ne sait pas le fermer elle abandonne plutot que de trancher dedans.
    const texte = 'package com.x\n\nenum class Level {\n    LOW { fun f() = 1 }, HIGH,\n}\n';
    const packed = f(`${MAIN}/Level.kt`, texte);
    for (const e of find([packed])) {
      if (e.removeStart < 0) continue;
      const apres = texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);
      const solde = (t: string) => [...t].reduce((a, c) => a + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
      expect(solde(apres), e.name).toBe(solde(texte));
    }
  });

  it('une entrée avec des arguments reste supprimable', () => {
    const withArgs = f(`${MAIN}/Level.kt`,
      'package com.x\n\nenum class Level(val v: Int) {\n    LOW(1),\n    HIGH(2),\n}\n');
    expect(find([withArgs]).every(e => e.removeStart >= 0)).toBe(true);
  });
});

describe('les fichiers qu’un générateur possède', () => {
  it('un en-tête « auto generated » met le fichier hors périmètre', () => {
    // Le prochain build le réécrit, donc agir dessus est perdu. Et les
    // conventions d'un générateur (une variante par valeur du schéma,
    // `@SerializedName` sur chacune) ressemblent exactement à du code mort.
    const generated = f(`${MAIN}/Mode.kt`, [
      '/**',
      ' * NOTE: This class is auto generated by OpenAPI Generator.',
      ' * Do not edit the class manually.',
      ' */',
      'package com.x',
      '',
      'enum class Mode {',
      '    ALLOW,',
      '}',
    ].join('\n'));
    expect(names([generated])).toEqual([]);
  });

  it('mais un « DO NOT EDIT » loin dans le fichier ne compte pas', () => {
    // Une mise en garde sur une section n'est pas une déclaration sur le
    // fichier entier. Seul l'en-tête est lu.
    const body = 'package com.x\n\nenum class Mode {\n    ALLOW,\n}\n' + '// filler\n'.repeat(200) + '// DO NOT EDIT\n';
    expect(names([f(`${MAIN}/Mode.kt`, body)])).toEqual(['Mode.ALLOW']);
  });

  it('une annotation sur UNE entrée protège tout l’enum', () => {
    // `@SerializedName("circle")` sur une variante dit que les autres
    // reviennent de JSON de la même façon.
    const serialized = f(`${MAIN}/Mode.kt`, [
      'package com.x',
      '',
      'enum class Mode {',
      '    @SerializedName("allow")',
      '    ALLOW,',
      '    DENY,',
      '}',
    ].join('\n'));
    expect(names([serialized])).toEqual([]);
  });
});

describe('deux limites connues, assumées par le contrat', () => {
  it('une chaîne qui contient le nom par hasard fait vivre l’entrée', () => {
    // Une requête SQL `ORDER BY date DESC` garde `SortOrder.DESC` en vie.
    // C'est le prix du sac de jetons, et c'est la direction sûre : compter
    // les chaînes est ce qui couvre la désérialisation par nom.
    const order = f(`${MAIN}/SortOrder.kt`,
      'package com.x\n\nenum class SortOrder {\n    ASC,\n    DESC,\n}\n');
    const dao = f(`${MAIN}/Dao.kt`,
      'package com.x\n\nclass Dao {\n    val q = "SELECT * FROM t ORDER BY d DESC"\n}\n');
    expect(names([order, dao])).toEqual(['SortOrder.ASC']);
  });

  it('un homonyme d’enum parcouru ailleurs protège les deux', () => {
    // `Version.entries` dans un module ne dit rien du `Version` de l'autre,
    // mais rien dans le texte ne permet de les distinguer. Protéger les deux
    // perd une trouvaille ; n'en protéger qu'un en inventerait une.
    const a = f('/w/a/src/main/kotlin/com/a/Version.kt',
      'package com.a\n\nenum class Version {\n    V1,\n    V2,\n}\n');
    const b = f('/w/b/src/main/kotlin/com/b/Version.kt',
      'package com.b\n\nenum class Version {\n    OLD,\n    NEW,\n}\n');
    const walker = f('/w/b/src/main/kotlin/com/b/Use.kt',
      'package com.b\n\nclass Use {\n    val all = Version.entries\n}\n');
    expect(names([a, b, walker])).toEqual([]);
  });
});

describe('le contrat', () => {
  it('un corpus tronqué ne produit rien', () => {
    expect(names([mode])).toHaveLength(2);
    expect(names([mode], { truncated: true })).toEqual([]);
  });

  it('le marqueur inline tait le fichier', () => {
    const marked = f(`${MAIN}/Mode.kt`,
      'package com.x\n\n// kotlin-jump:ignore unused-enum-entry\nenum class Mode {\n    ALLOW,\n}\n');
    expect(names([marked])).toEqual([]);
  });

  it('@file:Suppress("unused") aussi', () => {
    const suppressed = f(`${MAIN}/Mode.kt`,
      '@file:Suppress("unused")\n\npackage com.x\n\nenum class Mode {\n    ALLOW,\n}\n');
    expect(names([suppressed])).toEqual([]);
  });

  it('un nom d’enum ou une entrée qualifiée peuvent être ignorés', () => {
    expect(names([mode], { ignoreNames: ['Mode'] })).toEqual([]);
    expect(names([mode], { ignoreNames: ['Mode.DENY'] })).toEqual(['Mode.ALLOW']);
  });
});
