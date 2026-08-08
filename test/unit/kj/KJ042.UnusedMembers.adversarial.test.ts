import { describe, it, expect } from 'vitest';
import { findUnusedMembers, explainMembers } from '../../../src/providers/unusedMembers';

/**
 * KJ-042 — les membres de classe que rien ne référence.
 *
 * LE détecteur bruyant par nature : l'outil concurrent trouve 506 membres avec
 * 57% de faux positifs mesurés. Le pari inverse tient par le sac de jetons :
 * toute mention du nom, n'importe où, garde tous ses porteurs vivants.
 *
 * Deux limites structurelles assumées, documentées dans l'en-tête du module :
 * les appelants GÉNÉRÉS (Dagger, Room) sont invisibles, ce sont M4/M6 qui
 * portent la sûreté ; et une interface + son unique override meurent en
 * silence, la déclaration de l'override étant elle-même un jeton du sac.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });

const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedMembers({ sources, testSourceSets: TEST_SETS, ...extra });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  find(sources, extra).map((m: any) => `${m.container}.${m.name}`);
const why = (sources: any[], name: string) =>
  explainMembers({ sources, testSourceSets: TEST_SETS })
    .filter(e => e.name === name).map(e => e.outcome);

describe('la vérité terrain', () => {
  it('un membre public que rien ne nomme est signalé', () => {
    // La forme du premier seed vérifié à la main sur le corpus : zéro appel.
    const sources = [f(`${MAIN}/DialogHelper.kt`, [
      'package com.x',
      '',
      'class DialogHelper {',
      '    fun showAccountCollisionDialog() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual(['DialogHelper.showAccountCollisionDialog']);
    expect(find(sources)[0].verdict).toBe('unreferenced');
  });

  it('un membre appelé depuis un autre fichier est vivant', () => {
    const sources = [
      f(`${MAIN}/DialogHelper.kt`, 'package com.x\n\nclass DialogHelper {\n    fun show() {\n    }\n}\n'),
      f(`${MAIN}/Caller.kt`, 'package com.x\n\nclass Caller {\n    fun go(h: DialogHelper) = h.show()\n}\n'),
    ];
    expect(names(sources)).not.toContain('DialogHelper.show');
  });

  it('un membre appelé seulement d’un test a son verdict à part', () => {
    // La forme du troisième seed, appelé depuis un seul test.
    const sources = [
      f(`${MAIN}/ScalePhotoUseCase.kt`,
        'package com.x\n\nclass ScalePhotoUseCase {\n    fun scalePhotoImageView() {\n    }\n}\n'),
      f('/w/app/src/test/kotlin/com/x/T.kt',
        'package com.x\n\nclass T {\n    fun t() = ScalePhotoUseCase().scalePhotoImageView()\n}\n'),
    ];
    const found = find(sources);
    expect(found.map(m => m.name)).toEqual(['scalePhotoImageView']);
    expect(found[0].verdict).toBe('testOnly');
  });
});

describe('M1 — depth >= 1 ne veut pas dire membre', () => {
  it('un local de corps de fonction n’est jamais candidat', () => {
    const sources = [f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      'class A {',
      '    fun run() {',
      '        val parser = build()',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources).some(n => n.endsWith('.parser'))).toBe(false);
  });

  it('un membre d’un object-literal n’est jamais candidat', () => {
    const sources = [f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      'class A {',
      '    fun listen() {',
      '        val l = object : Listener {',
      '            fun helperNobodyCalls() {}',
      '        }',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources).some(n => n.endsWith('helperNobodyCalls'))).toBe(false);
  });
});

describe('M2/M3 — les contrats d’héritage', () => {
  it('un override Kotlin n’est jamais candidat', () => {
    const sources = [f(`${MAIN}/A.kt`,
      'package com.x\n\nclass A : Base() {\n    override fun onBindViewHolder() {\n    }\n}\n')];
    expect(why(sources, 'onBindViewHolder')).toEqual(['M2:override']);
  });

  it('Java : une classe avec un supertype met TOUS ses membres hors périmètre', () => {
    // `@Override` est optionnel en Java : impossible de distinguer une méthode
    // propre d'une implémentation non marquée qu'un SDK invoque.
    const sources = [f('/w/app/src/main/java/com/x/C.java', [
      'package com.x;',
      '',
      'public class C implements SdkCallback {',
      '    public void onDone() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'onDone')).toEqual(['M3:java-supertyped']);
  });

  it('Java : une classe SANS supertype garde ses membres candidats', () => {
    // La seule population Java admise, et celle où les morts se cachent.
    const sources = [f('/w/app/src/main/java/com/x/StringUtils.java', [
      'package com.x;',
      '',
      'public final class StringUtils {',
      '    public static String slugify(String s) {',
      '        return s;',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual(['StringUtils.slugify']);
  });
});

describe('M4/M5/M6 — frameworks et surfaces JVM', () => {
  it('une classe annotée protège tous ses membres', () => {
    // L'appelant est du code Room généré dans build/, que le sac ne lit pas.
    const sources = [f(`${MAIN}/User.kt`,
      'package com.x\n\n@Entity\nclass User {\n    var syncedAt: Long = 0\n}\n')];
    expect(names(sources)).toEqual([]);
  });

  it('l’annotation d’une OUTER class protège les membres des classes internes', () => {
    const sources = [f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      '@Module',
      'class Outer {',
      '    class Inner {',
      '        fun helper() {}',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
  });

  it('une fun interface met son membre hors périmètre', () => {
    // Implémentée par lambda : aucune implémentation n'épelle le nom.
    const sources = [f(`${MAIN}/Callback.kt`,
      'package com.x\n\nfun interface Callback {\n    fun onResult()\n}\n')];
    // Le membre abstrait n'a pas de corps : le span échoue avant même M5,
    // qui reste une ceinture. L'important est le silence.
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'onResult')).toEqual([]);
  });

  it('@JvmName sur un membre le protège : Java appelle l’autre nom', () => {
    const sources = [f(`${MAIN}/A.kt`,
      'package com.x\n\nclass A {\n    @JvmName("legacy")\n    fun newApi() {\n    }\n}\n')];
    expect(names(sources)).toEqual([]);
  });

  it('@JvmStatic est bénin : il n’altère pas le nom épelé', () => {
    const sources = [f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      'class A {',
      '    companion object {',
      '        @JvmStatic',
      '        fun ghost() {}',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources).some(n => n.endsWith('.ghost'))).toBe(true);
  });

  it('@Singleton sur la classe ne protège PAS ses membres : Dagger n’appelle que le constructeur', () => {
    const sources = [f(`${MAIN}/Auth.kt`, [
      'package com.x',
      '',
      '@Singleton',
      'class Auth {',
      '    fun deprecatedToken(): String = ""',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual(['Auth.deprecatedToken']);
  });

  it('mais un scope custom reste étranger : ensemble inconnaissable', () => {
    const sources = [f(`${MAIN}/Auth.kt`,
      'package com.x\n\n@ScopeApplication\nclass Auth {\n    fun helper() {\n    }\n}\n')];
    expect(names(sources)).toEqual([]);
  });

  it('un membre d’une classe héritant d’un type framework est protégé', () => {
    const sources = [f(`${MAIN}/V.kt`,
      'package com.x\n\nclass V : RecyclerView() {\n    fun helper() {\n    }\n}\n')];
    expect(names(sources)).toEqual([]);
  });
});

describe('M9 — le modificateur external, pas le mot', () => {
  it('un paramètre Java nommé external ne muselle pas son membre', () => {
    // Cas réel (DiskUtils.java du corpus de référence) : `long totalSpace(final
    // boolean external)` — les 3 seuls M9 du monorepo étaient ce misfire.
    const disk = f('/w/app/src/main/java/com/x/DiskUtils.java', [
      'package com.x;',
      '',
      'public class DiskUtils {',
      '    public long totalSpace(final boolean external) {',
      '        return external ? 1L : 2L;',
      '    }',
      '}',
    ].join('\n'));
    expect(names([disk])).toEqual(['DiskUtils.totalSpace']);
  });

  it('un membre external ne devient jamais candidat : M9 reste une ceinture', () => {
    // Le parseur écarte les membres `external` avant même la candidature —
    // aucune row. M9 ne sert que de ceinture aux chemins de parse dégradés,
    // et ne doit surtout pas tirer sur un PARAMÈTRE nommé external.
    const native_ = f(`${MAIN}/Native.kt`,
      'package com.x\n\nclass Native {\n    external fun nativeInit()\n}\n');
    expect(names([native_])).toEqual([]);
    expect(why([native_], 'nativeInit')).toEqual([]);
  });
});

describe('M7/M8 — les surfaces implicites de Kotlin', () => {
  it('une propriété de constructeur primaire est le territoire de KJ-025', () => {
    // `component1` la lit sans jamais l'épeler.
    const sources = [f(`${MAIN}/Point.kt`, 'package com.x\n\ndata class Point(val x: Int, val y: Int)\n')];
    expect(names(sources)).toEqual([]);
  });

  it('une propriété de CORPS de data class reste candidate', () => {
    const sources = [f(`${MAIN}/Point.kt`, [
      'package com.x',
      '',
      'data class Point(val x: Int) {',
      '    val cache: Int = 0',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual(['Point.cache']);
  });

  it('un operator fun est appelé sans être épelé', () => {
    const sources = [f(`${MAIN}/A.kt`,
      'package com.x\n\nclass A {\n    operator fun get(i: Int) = i\n}\n')];
    expect(names(sources)).toEqual([]);
  });
});

describe('ce que le sac de jetons voit', () => {
  it('android:onClick dans un layout garde le handler vivant', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun handleClick(v: View) {\n    }\n}\n'),
      f('/w/app/src/main/res/layout/a.xml', '<Button android:onClick="handleClick" />'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('une expression de data binding garde la propriété vivante', () => {
    const sources = [
      f(`${MAIN}/Vm.kt`, 'package com.x\n\nclass Vm {\n    val userName: String = ""\n}\n'),
      f('/w/app/src/main/res/layout/b.xml', '<TextView android:text="@{vm.userName}" />'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('`val isReady` lue de Java via isReady()/setReady() est vivante', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    var isReady: Boolean = false\n}\n'),
      f('/w/app/src/main/java/com/x/U.java',
        'package com.x;\n\nclass U {\n    void go(A a) { a.setReady(true); }\n}\n'),
    ];
    expect(names(sources)).not.toContain('A.isReady');
  });

  it('-keepclassmembers dans un .pro garde le membre vivant', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun nativeHook() {\n    }\n}\n'),
      f('/w/app/proguard-rules.pro', '-keepclassmembers class com.x.A { void nativeHook(); }'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('une mention seulement en commentaire ne compte pas : la trouvaille tient', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun ghost() {\n    }\n}\n'),
      f(`${MAIN}/B.kt`, 'package com.x\n\n// a.ghost() was called here once\nclass B\n'),
    ];
    expect(names(sources)).toEqual(['A.ghost']);
  });
});

describe('les homonymes et la règle des doublons muets', () => {
  it('deux classes déclarant fun reset() jamais mentionné : les deux signalées', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun reset() {\n    }\n}\n'),
      f(`${MAIN}/B.kt`, 'package com.x\n\nclass B {\n    fun reset() {\n    }\n}\n'),
    ];
    expect(names(sources).sort()).toEqual(['A.reset', 'B.reset']);
  });

  it('un troisième homonyme hors groupe rend le groupe incomplet : silence', () => {
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun reset() {\n    }\n}\n'),
      f(`${MAIN}/B.kt`, 'package com.x\n\nclass B {\n    fun reset() {\n    }\n}\n'),
      f(`${MAIN}/C.kt`, 'package com.x\n\nclass C : Base() {\n    override fun reset() {\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('M13 : un homonyme qui APPELLE l’autre bloque le groupe', () => {
    // Le faux positif trouvé sur le vrai corpus : `exportReport` appelant
    // `ReportTree...exportReport()` dans son propre corps. La mention vit
    // dans le span de l'appelant, la soustraire comme du « soi » signalait
    // le membre APPELÉ.
    const sources = [
      f(`${MAIN}/Tree.kt`, 'package com.x\n\nclass Tree {\n    fun exportReport(): String {\n        return ""\n    }\n}\n'),
      f(`${MAIN}/Vm.kt`, [
        'package com.x',
        '',
        'class Vm {',
        '    fun exportReport(): String {',
        '        return Tree().exportReport()',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un companion create parmi douze homonymes : silence, prix assumé', () => {
    const sources = [
      f(`${MAIN}/A.kt`,
        'package com.x\n\nclass A {\n    companion object {\n        fun create() = A()\n    }\n}\n'),
      f(`${MAIN}/B.kt`, 'package com.x\n\nclass B {\n    fun make() = Factory.create()\n}\n'),
    ];
    expect(names(sources).some(n => n.endsWith('.create'))).toBe(false);
  });
});

describe('interface et implémentation', () => {
  it('interface + unique override sans appelant : silence des deux, FN documenté', () => {
    const sources = [
      f(`${MAIN}/Repo.kt`, 'package com.x\n\ninterface Repo {\n    fun save()\n}\n'),
      f(`${MAIN}/RepoImpl.kt`,
        'package com.x\n\nclass RepoImpl : Repo {\n    override fun save() {\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('selfOnly — sur-exposé plutôt que mort', () => {
  it('un membre appelé du seul init de sa classe est selfOnly', () => {
    const sources = [f(`${MAIN}/Engine.kt`, [
      'package com.x',
      '',
      'class Engine {',
      '    init {',
      '        warmUp()',
      '    }',
      '',
      '    fun warmUp() {',
      '    }',
      '}',
    ].join('\n'))];
    const found = find(sources);
    expect(found.map(m => m.name)).toEqual(['warmUp']);
    expect(found[0].verdict).toBe('selfOnly');
  });

  it('un getMethod("warmUp") dans la même classe disqualifie : réflexion', () => {
    const sources = [f(`${MAIN}/Engine.kt`, [
      'package com.x',
      '',
      'class Engine {',
      '    init {',
      '        javaClass.getMethod("warmUp")',
      '    }',
      '',
      '    fun warmUp() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
  });

  it('une mention hors de la classe dans le même fichier reste vivante, pas selfOnly', () => {
    const sources = [f(`${MAIN}/A.kt`, [
      'package com.x',
      '',
      'class A {',
      '    fun helper() {',
      '    }',
      '}',
      '',
      'fun free(a: A) = a.helper()',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
  });

  it('et includeSelfOnly=false les retire', () => {
    const sources = [f(`${MAIN}/Engine.kt`,
      'package com.x\n\nclass Engine {\n    init {\n        warmUp()\n    }\n\n    fun warmUp() {\n    }\n}\n')];
    expect(names(sources, { includeSelfOnly: false })).toEqual([]);
  });
});

describe('M12 et le contrat', () => {
  it('un membre d’une classe déjà signalée par KJ-032 est silencieux', () => {
    const text = 'package com.x\n\nclass DeadWhole {\n    fun member() {\n    }\n}\n';
    const sources = [f(`${MAIN}/DeadWhole.kt`, text)];
    expect(names(sources)).toEqual(['DeadWhole.member']);
    expect(names(sources, {
      deadDeclarations: [{ path: `${MAIN}/DeadWhole.kt`, removeStart: 0, removeEnd: text.length }],
    })).toEqual([]);
  });

  it('un corpus tronqué ne produit rien', () => {
    const sources = [f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun ghost() {\n    }\n}\n')];
    expect(names(sources)).toEqual(['A.ghost']);
    expect(names(sources, { truncated: true })).toEqual([]);
  });

  it('un enum à méthode abstraite overridée par ses entrées est vivant', () => {
    const sources = [f(`${MAIN}/Op.kt`, [
      'package com.x',
      '',
      'enum class Op {',
      '    PLUS {',
      '        override fun apply(a: Int) = a',
      '    };',
      '',
      '    abstract fun apply(a: Int): Int',
      '}',
    ].join('\n'))];
    expect(names(sources).some(n => n.endsWith('.apply'))).toBe(false);
  });

  it('le marqueur inline tait le fichier', () => {
    const sources = [f(`${MAIN}/A.kt`,
      '// kotlin-jump:ignore unused-member\npackage com.x\n\nclass A {\n    fun ghost() {\n    }\n}\n')];
    expect(names(sources)).toEqual([]);
  });
});

describe('H9 inversé — le getter Java lu comme propriété Kotlin', () => {
  const holder = f('/w/app/src/main/java/com/x/Holder.java', [
    'package com.x;',
    '',
    'public class Holder {',
    '    public String getLabel() {',
    '        return "";',
    '    }',
    '}',
  ].join('\n'));

  it('un getter Java lu en propriété depuis Kotlin est vivant', () => {
    // Cas réel du corpus : IdeaProjectMapper.kt:39 écrit
    // `metadata.includedProjects` pour appeler
    // ProjectMetadata.java:30 `getIncludedProjects()`. Kotlin synthétise une
    // propriété depuis un getter JAVA, donc `h.label` est la SEULE graphie
    // possible au site d'appel.
    const sources = [
      holder,
      f(`${MAIN}/Reader.kt`, 'package com.x\n\nclass Reader {\n    fun read(h: Holder) = h.label\n}\n'),
      f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    println(Reader().read(Holder()))\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('témoin : sans le lecteur Kotlin, le même getter est bien signalé', () => {
    expect(names([holder])).toEqual(['Holder.getLabel']);
  });

  it('témoin : un getter KOTLIN garde sa règle XML-only', () => {
    // La régression qui a motivé la restriction : un nom nu qui coïncide avec
    // un local sans rapport ne doit pas sauver le getter.
    const sources = [
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass A {\n    fun getLabel(): String = ""\n}\n'),
      f(`${MAIN}/B.kt`, 'package com.x\n\nclass B {\n    fun go() {\n        val label = 1\n        println(label)\n    }\n}\n'),
      f(`${MAIN}/Main.kt`, 'package com.x\n\nfun main() {\n    B().go()\n}\n'),
    ];
    expect(names(sources)).toEqual(['A.getLabel']);
  });
});

describe('M3 — la déclaration Java tronquée', () => {
  it('une clause implements sur la ligne suivante n’est pas lue, donc silence', () => {
    // extractJavaSupertypes ne lit QUE la ligne de déclaration. Sans ce garde,
    // un simple retour à la ligne désarme M3 et livre tous les membres de la
    // classe aux candidats.
    const sources = [f('/w/app/src/main/java/com/x/Impl.java', [
      'package com.x;',
      '',
      'public class Impl',
      '        implements SdkCallback {',
      '    public void onDone() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'onDone')).toEqual(['M3:java-decl-truncated']);
  });

  it('témoin : la même classe avec le { sur la ligne reste jugée normalement', () => {
    const sources = [f('/w/app/src/main/java/com/x/Util.java', [
      'package com.x;',
      '',
      'public final class Util {',
      '    public static String slugify(String s) {',
      '        return s;',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual(['Util.slugify']);
  });
});

describe('M3 — lue après M2/M4/M6, donc mesurable', () => {
  it('un membre @Override d’une classe supertypée lit M2, pas M3', () => {
    // M3 évaluée en tête masquait M2, M4 et M6 : son compteur était opaque.
    // Mesuré sur test/kotlin-lsp-main : 56 rangées avant, 0 après, dont 43
    // absorbées par M2 et 12 par M4:F6:Serializable.
    const sources = [f('/w/app/src/main/java/com/x/C.java', [
      'package com.x;',
      '',
      'public class C implements SdkCallback {',
      '    @Override',
      '    public void onDone() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'onDone')).toEqual(['M2:override']);
  });

  it('un membre SANS marqueur d’une classe supertypée lit toujours M3', () => {
    const sources = [f('/w/app/src/main/java/com/x/C.java', [
      'package com.x;',
      '',
      'public class C implements SdkCallback {',
      '    public void onDone() {',
      '    }',
      '}',
    ].join('\n'))];
    expect(names(sources)).toEqual([]);
    expect(why(sources, 'onDone')).toEqual(['M3:java-supertyped']);
  });
});

describe('H9 inversée : ce qu’un site d’appel Kotlin peut écrire', () => {
  const JAVA = '/w/app/src/main/java/com/x/Foo.java';
  const KT = `${MAIN}/Main.kt`;

  it('un getter Java lu comme propriété depuis Kotlin est vivant', () => {
    // `getBar()` ne s’écrit jamais `getBar` côté Kotlin : la propriété
    // synthétique est le SEUL nom disponible au site d’appel.
    const sources = [
      f(JAVA, 'package com.x;\n\npublic class Foo {\n    public String getBar() { return "x"; }\n}\n'),
      f(KT, 'package com.x\n\nfun main() {\n    val f = Foo()\n    println(f.bar)\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('le setter d’une paire isX()/setX() s’écrit f.isX, pas f.x', () => {
    // Kotlin nomme `isBar` la propriété de la paire, donc l’écriture ne
    // contient jamais le jeton `bar`. Compter `bar` seul signalait `setBar`.
    const sources = [
      f(JAVA, [
        'package com.x;',
        '',
        'public class Foo {',
        '    private boolean b;',
        '    public boolean isBar() { return b; }',
        '    public void setBar(boolean v) { b = v; }',
        '}',
      ].join('\n')),
      f(KT, 'package com.x\n\nfun main() {\n    val f = Foo()\n    f.isBar = true\n    println(f.isBar)\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('témoin : la paire getX()/setX() s’écrit bien f.x', () => {
    const sources = [
      f(JAVA, [
        'package com.x;',
        '',
        'public class Foo {',
        '    private boolean b;',
        '    public boolean getBar() { return b; }',
        '    public void setBar(boolean v) { b = v; }',
        '}',
      ].join('\n')),
      f(KT, 'package com.x\n\nfun main() {\n    val f = Foo()\n    f.bar = true\n    println(f.bar)\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('témoin : un getter KOTLIN garde la règle XML seule', () => {
    // Tous les appelants d’un `getBar` Kotlin écrivent `getBar` ; un `bar` nu
    // ailleurs est une variable sans rapport et ne doit rien sauver.
    const sources = [
      f(`${MAIN}/Foo.kt`, 'package com.x\n\nclass Foo {\n    fun getBar(): String = "x"\n}\n'),
      f(KT, 'package com.x\n\nfun main() {\n    val f = Foo()\n    val bar = 1\n    println(f)\n    println(bar)\n}\n'),
    ];
    expect(names(sources)).toEqual(['Foo.getBar']);
  });
});
