import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';
import { collecterUnePasse, resumeDesFamilles } from '../../../src/commands/RemoveEverythingUnused';

/**
 * KJ-058 : un parametre de constructeur primaire que personne ne lit.
 *
 * `open class Post(..., readingTime: Int? = null, audio: Audio? = null) : Base(...)`
 * ou ni l'appel du supertype, ni un bloc init, ni le corps ne nomment les
 * deux. KJ-025 les voit dans le fichier, mais ne peut rien couper : les
 * arguments vivent aux sites de construction, hors de sa vue.
 *
 * La famille lit tout le corpus et retire les DEUX bouts : la ligne du
 * parametre, et a chaque site la ligne de l'argument nomme. Elle se tait des
 * qu'un site n'est pas prouvablement sur : un argument positionnel a l'index
 * du parametre ou au dela, une expression qui appelle quelque chose, une
 * liste d'arguments illisible, un appel Java, une mention qu'aucun import ni
 * paquet ne rattache a cette declaration.
 *
 * Sur le projet de reference : deux parametres d'un modele de fil, un seul
 * site les passe, par nom, chacun sur sa ligne. La personne a retire quatre
 * lignes.
 */

const mod: any = await importOrNull('src/providers/unusedConstructorParameters');

const MAIN = '/w/app/src/main/java/com/x';
const kt = (nom: string, texte: string) => ({ path: `${MAIN}/${nom}`, text: texte });
const scan = (sources: { path: string; text: string }[]) => mod.findUnusedConstructorParameters({ sources });
const coupe = (texte: string, f: { removeStart: number; removeEnd: number }) => texte.slice(f.removeStart, f.removeEnd);

/** Le texte une fois les coupes appliquees, de la derniere a la premiere. */
function applique(texte: string, coupes: readonly { removeStart: number; removeEnd: number }[]): string {
  let out = texte;
  for (const c of [...coupes].sort((a, b) => b.removeStart - a.removeStart)) {
    out = out.slice(0, c.removeStart) + out.slice(c.removeEnd);
  }
  return out;
}

/** La forme du projet de reference : un modele abstrait et le seul sous-type qui passe les deux. */
const POST = kt('Post.kt', [
  'package com.x',
  '',
  'open class Post(',
  '    id: Int,',
  '    val kind: String,',
  '    blockName: String,',
  '    nextLink: String = "",',
  '    readingTime: Int? = null,',
  '    audio: Audio? = null,',
  ') : Base(id, blockName, nextLink) {',
  '    override fun uniqueId(): String {',
  '        return "$kind-$id"',
  '    }',
  '}',
  '',
  'open class Live(',
  '    id: Int,',
  '    kind: String,',
  '    blockName: String,',
  '    nextLink: String = "",',
  '    val readingTime: Int? = null,',
  '    val audio: Audio? = null,',
  ') : Post(',
  '    id = id,',
  '    kind = kind,',
  '    blockName = blockName,',
  '    nextLink = nextLink,',
  '    readingTime = readingTime,',
  '    audio = audio,',
  ') {',
  '    companion object {',
  '        val EMPTY = Live(id = 0, kind = "post", blockName = "b")',
  '    }',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('findUnusedConstructorParameters', () => {
  it('la forme du projet de reference : deux parametres, un site nomme, quatre lignes exactes', () => {
    const found = scan([POST]);
    expect(found.map((f: any) => `${f.className}.${f.name}`)).toEqual(['Post.readingTime', 'Post.audio']);
    const [readingTime, audio] = found;
    expect(coupe(POST.text, readingTime)).toBe('    readingTime: Int? = null,\n');
    expect(coupe(POST.text, audio)).toBe('    audio: Audio? = null,\n');
    expect(readingTime.sites).toHaveLength(1);
    expect(audio.sites).toHaveLength(1);
    expect(coupe(POST.text, readingTime.sites[0])).toBe('    readingTime = readingTime,\n');
    expect(coupe(POST.text, audio.sites[0])).toBe('    audio = audio,\n');
    // `nextLink` est lu par l'appel du supertype, `kind` est une propriete.
    expect(found.map((f: any) => f.name)).not.toContain('nextLink');
    expect(found.map((f: any) => f.name)).not.toContain('kind');
  });

  it('les quatre coupes appliquees laissent un parametre du milieu et un dernier parametre valides', () => {
    const found = scan([POST]);
    const coupes = found.flatMap((f: any) => [f, ...f.sites]);
    const apres = applique(POST.text, coupes);
    expect(apres).toContain('    nextLink: String = "",\n) : Base(id, blockName, nextLink) {');
    expect(apres).toContain('    nextLink = nextLink,\n) {');
    expect(apres).not.toContain('readingTime = readingTime');
    // `Live` keeps its `val audio` property: only the plain parameter goes.
    expect(apres).not.toContain('\n    audio: Audio? = null,\n');
    expect(apres).toContain('\n    val audio: Audio? = null,\n');
  });

  it('un parametre lu par un appel du supertype qui s etale sur plusieurs lignes n est pas reporte', () => {
    // La forme ou `declarationSpan` s arrete a la ligne du `)` et manquerait
    // la lecture : pas de corps, l appel du supertype sur les lignes d apres.
    const header = kt('Header.kt', [
      'package com.x',
      '',
      'class Header(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(',
      '    id = id,',
      '    x = x,',
      ')',
      '',
      'val h = Header(id = 1)',
      '',
    ].join('\n'));
    expect(scan([header])).toEqual([]);
  });

  it('sans valeur par defaut, rien : un site qui l omet ne compilerait plus', () => {
    const src = kt('A.kt', [
      'package com.x',
      '',
      'class A(',
      '    id: Int,',
      '    x: Int,',
      ') : Base(id)',
      '',
      'val a = A(',
      '    id = 1,',
      '    x = 2,',
      ')',
      '',
    ].join('\n'));
    expect(scan([src])).toEqual([]);
  });

  it('un site positionnel a l index du parametre le disqualifie ; un site qui l omet, non', () => {
    const thing = [
      'package com.x',
      '',
      'class Thing(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
    ].join('\n');
    expect(scan([kt('Thing.kt', thing + 'val t = Thing(1, 2)\n')])).toEqual([]);
    const found = scan([kt('Thing.kt', thing + 'val t = Thing(1)\n')]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('x');
    expect(found[0].sites).toEqual([]);
    expect(found[0].siteCount).toBe(1);
  });

  it('un argument nomme dont l expression appelle quelque chose n est pas retire', () => {
    const src = kt('B.kt', [
      'package com.x',
      '',
      'class B(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
      'val b = B(',
      '    id = 1,',
      '    x = compute(),',
      ')',
      '',
    ].join('\n'));
    expect(scan([src])).toEqual([]);
  });

  it('une data class n est jamais concernee', () => {
    const src = kt('D.kt', [
      'package com.x',
      '',
      'data class D(',
      '    val id: Int,',
      '    x: Int = 0,',
      ')',
      '',
      'val d = D(id = 1)',
      '',
    ].join('\n'));
    expect(scan([src])).toEqual([]);
  });

  it('un constructeur injecte est construit par le graphe, pas par un appel nomme', () => {
    const inject = kt('Repo.kt', [
      'package com.x',
      '',
      'class Repo @Inject constructor(',
      '    api: Api,',
      '    x: Int = 0,',
      ') : Base(api)',
      '',
    ].join('\n'));
    expect(scan([inject])).toEqual([]);
    const hilt = kt('Vm.kt', [
      'package com.x',
      '',
      '@HiltViewModel',
      'class Vm(',
      '    api: Api,',
      '    x: Int = 0,',
      ') : Base(api)',
      '',
    ].join('\n'));
    expect(scan([hilt])).toEqual([]);
  });

  it('un site Java disqualifie le parametre : Java n a pas d argument nomme', () => {
    const cls = kt('Thing.kt', [
      'package com.x',
      '',
      'class Thing(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
    ].join('\n'));
    const java = {
      path: `${MAIN}/Caller.java`,
      text: 'package com.x;\n\nclass Caller {\n    Thing t = new Thing(1, 2);\n}\n',
    };
    expect(scan([cls])).toHaveLength(1);
    expect(scan([cls, java])).toEqual([]);
  });

  it('dernier parametre, virgule finale : la ligne entiere part et le code reste valide', () => {
    // Le parametre est le DERNIER et la ligne d avant finit par une virgule ;
    // au site, l argument est le dernier et n a pas de virgule finale.
    const src = kt('Tail.kt', [
      'package com.x',
      '',
      'class Tail(',
      '    id: Int,',
      '    x: Int = 0',
      ') : Base(id)',
      '',
      'val t = Tail(',
      '    id = 1,',
      '    x = 2',
      ')',
      '',
    ].join('\n'));
    const found = scan([src]);
    expect(found).toHaveLength(1);
    expect(coupe(src.text, found[0])).toBe('    x: Int = 0\n');
    expect(coupe(src.text, found[0].sites[0])).toBe('    x = 2\n');
    expect(applique(src.text, [found[0], ...found[0].sites])).toBe([
      'package com.x',
      '',
      'class Tail(',
      '    id: Int,',
      ') : Base(id)',
      '',
      'val t = Tail(',
      '    id = 1,',
      ')',
      '',
    ].join('\n'));
  });

  it('un homonyme dans un autre paquet : un site qui importe l autre n est pas le notre', () => {
    // Le projet de reference declare deux `PostItemModel` dans deux paquets.
    // Le nom seul ne tranche pas, les imports si.
    const ours = { path: '/w/base/src/main/java/com/a/Post.kt', text: [
      'package com.a',
      '',
      'open class Post(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
    ].join('\n') };
    const theirs = { path: '/w/card/src/main/java/com/b/Post.kt', text: 'package com.b\n\ndata class Post(val id: Int, val x: Int = 0)\n' };
    const useTheirs = { path: '/w/app/src/main/java/com/c/Use.kt', text: [
      'package com.c',
      '',
      'import com.b.Post',
      '',
      'val p = Post(',
      '    id = 1,',
      '    x = compute(),',
      ')',
      '',
    ].join('\n') };
    const found = scan([ours, theirs, useTheirs]);
    expect(found.map((f: any) => f.path)).toEqual([ours.path]);
    expect(found[0].sites).toEqual([]);

    // Le meme site sous un import etoile : rien ne dit a qui il est.
    const useStar = { ...useTheirs, text: useTheirs.text.replace('import com.b.Post', 'import com.a.*') };
    expect(scan([ours, theirs, useStar])).toEqual([]);

    // Sous un import explicite du notre, le site est lu, et son appel le disqualifie.
    const useOurs = { ...useTheirs, text: useTheirs.text.replace('import com.b.Post', 'import com.a.Post') };
    expect(scan([ours, theirs, useOurs])).toEqual([]);

    // Dans le paquet de l autre, sans import : le nom nu est le sien. C est
    // la forme qui taisait les deux constats du projet de reference.
    const samePkgAsTheirs = { path: '/w/card/src/main/java/com/b/Deco.kt', text: [
      'package com.b',
      '',
      'fun deco(p: Post): Post = Post(',
      '    id = p.id,',
      '    x = compute(),',
      ')',
      '',
    ].join('\n') };
    expect(scan([ours, theirs, samePkgAsTheirs]).map((f: any) => f.path)).toEqual([ours.path]);
  });

  it('une regle keep atteint la classe par reflexion ; une baseline detekt ne construit rien', () => {
    const cls = kt('Thing.kt', [
      'package com.x',
      '',
      'class Thing(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
    ].join('\n'));
    const baseline = { path: '/w/config/detekt/baseline.xml', text: '<SmellBaseline>\n  <ID>LongParameterList:Thing.kt$Thing$(id: Int, x: Int)</ID>\n</SmellBaseline>\n' };
    expect(scan([cls, baseline])).toHaveLength(1);
    const keep = { path: '/w/app/proguard-rules.pro', text: '-keep class com.x.Thing { <init>(...); }\n' };
    expect(scan([cls, keep])).toEqual([]);
    const layout = { path: '/w/app/src/main/res/layout/a.xml', text: '<com.x.Thing android:layout_width="1dp" />\n' };
    expect(scan([cls, layout])).toEqual([]);
  });

  /** Une classe d un autre module, declaree une seule fois dans le corpus. */
  const OURS = { path: '/w/base/src/main/java/com/a/Post.kt', text: [
    'package com.a',
    '',
    'open class Post(',
    '    id: Int,',
    '    x: Int = 0,',
    ') : Base(id)',
    '',
  ].join('\n') };
  const siteNomme = (chemin: string, entete: string[], nom = 'Post') => ({ path: chemin, text: [
    ...entete,
    '',
    `val p = ${nom}(`,
    '    id = 1,',
    '    x = 2,',
    ')',
    '',
  ].join('\n') });

  it('un import avec alias de notre classe ecrit ses sites sous l alias : rien n est reporte', () => {
    // La v1 rendait `unknown` pour cet import, mais rien ne le lisait tant
    // qu un `Post(` nu ne suivait pas, et un site sous alias n en produit
    // jamais : le fichier passait avec zero site et la ligne `x = 2` restait
    // sans parametre.
    expect(scan([OURS]).map((f: any) => f.name)).toEqual(['x']);
    const alias = siteNomme('/w/app/src/main/java/com/c/Use.kt', ['package com.c', '', 'import com.a.Post as P'], 'P');
    expect(scan([OURS, alias])).toEqual([]);
    // L alias d un homonyme ne dit rien du notre : le site nu reste le notre.
    const aliasDeLAutre = siteNomme('/w/app/src/main/java/com/a/Use.kt', ['package com.a', '', 'import com.b.Post as BPost']);
    const found = scan([OURS, aliasDeLAutre]);
    expect(found).toHaveLength(1);
    expect(found[0].sites).toHaveLength(1);
  });

  it('un sous-type sans appel du supertype construit par super(...) : generique, qualifie ou suivi d une interface', () => {
    // La garde de la v1 excluait `Name<T>` et n admettait aucun qualificatif :
    // `super(1, 5)` glissait 5 dans `y` une fois `x` coupe, et ca compilait.
    const base = { path: '/w/base/src/main/java/com/a/Base.kt', text: [
      'package com.a',
      '',
      'abstract class Base<T>(',
      '    id: Int,',
      '    x: Int = 0,',
      '    y: Int = 0,',
      ') : Root(id) {',
      '    val yy = y',
      '}',
      '',
    ].join('\n') };
    const sub = (chemin: string, entete: string[], supertypes: string) => ({ path: chemin, text: [
      ...entete,
      '',
      `class Sub : ${supertypes} {`,
      '    constructor() : super(1, 5)',
      '}',
      '',
    ].join('\n') });
    expect(scan([base]).map((f: any) => f.name)).toEqual(['x']);
    expect(scan([base, sub('/w/base/src/main/java/com/a/Sub.kt', ['package com.a'], 'Base<String>')])).toEqual([]);
    expect(scan([base, sub('/w/app/src/main/java/com/b/Sub.kt', ['package com.b'], 'com.a.Base<String>')])).toEqual([]);
    expect(scan([base, sub('/w/base/src/main/java/com/a/Sub.kt', ['package com.a'], 'Base<String>, Runnable')])).toEqual([]);
    // Un supertype APPELE avec ses arguments de type reste un site lu, meme
    // quand une autre classe du fichier appelle `super(` : la garde ne vise
    // que l appel absent.
    const appele = { path: '/w/base/src/main/java/com/a/Sub.kt', text: [
      'package com.a',
      '',
      'class Sub : Base<String>(1)',
      '',
      'class Other : Root {',
      '    constructor() : super(1)',
      '}',
      '',
    ].join('\n') };
    const found = scan([base, appele]);
    expect(found.map((f: any) => f.name)).toEqual(['x']);
    expect(found[0].siteCount).toBe(1);
  });

  it('un < de comparaison dans la liste d arguments la rend illisible : rien n est reporte', () => {
    // `splitParamSegments` ouvre une profondeur sur `<` qu une comparaison
    // ne referme jamais : tout ce qui suit fusionne en un segment, et le `3`
    // positionnel a l index de `x`, ou sa ligne `x = 3`, devenait invisible.
    const decl = [
      'package com.x',
      '',
      'class A(',
      '    id: Int,',
      '    short: Boolean = false,',
      '    x: Int = 0,',
      '    y: Int = 0,',
      ') : Base(id) {',
      '    val yy = y',
      '    val s = short',
      '}',
      '',
    ];
    expect(scan([kt('A.kt', [...decl, 'fun make(n: Int) = A(1, n < 2, 3)', ''].join('\n'))])).toEqual([]);
    expect(scan([kt('A.kt', [...decl, 'fun make(n: Int) = A(', '    id = 1,', '    short = n < 2,', '    x = 3,', ')', ''].join('\n'))])).toEqual([]);
    // Un `>` seul ne desequilibre rien : la ligne de `x` est vue et coupee.
    const src = kt('A.kt', [...decl, 'fun make(n: Int) = A(', '    id = 1,', '    short = n > 2,', '    x = 3,', ')', ''].join('\n'));
    const found = scan([src]);
    expect(found.map((f: any) => f.name)).toEqual(['x']);
    expect(coupe(src.text, found[0].sites[0])).toBe('    x = 3,\n');
  });

  it('une mention nue dans un autre paquet n est la notre que sous un import etoile de notre paquet', () => {
    // Sans import de la classe ni de son paquet, un fichier d ailleurs ne
    // peut pas la nommer nue : la mention est celle d une bibliotheque ou
    // d un import par defaut, et la v1 coupait sa ligne `x = 2` parce que le
    // corpus ne declarait le nom qu une fois.
    const entete = ['package com.c', '', 'import com.lib.*'];
    expect(scan([OURS, siteNomme('/w/app/src/main/java/com/c/Use.kt', entete)])).toEqual([]);
    expect(scan([OURS, siteNomme('/w/app/src/main/java/com/c/Use.kt', ['package com.c'])])).toEqual([]);
    const found = scan([OURS, siteNomme('/w/app/src/main/java/com/c/Use.kt', ['package com.c', '', 'import com.a.*'])]);
    expect(found.map((f: any) => f.name)).toEqual(['x']);
    expect(found[0].sites).toHaveLength(1);
    expect(found[0].sites[0].path).toBe('/w/app/src/main/java/com/c/Use.kt');
  });

  it('une incrementation ou un cast dans l expression de l argument partirait avec la ligne : rien n est reporte', () => {
    const site = (expr: string) => kt('A.kt', [
      'package com.x',
      '',
      'class A(',
      '    id: Int,',
      '    x: Int = 0,',
      ') : Base(id)',
      '',
      'var i = 0',
      'val p = A(',
      '    id = 1,',
      `    x = ${expr},`,
      ')',
      '',
    ].join('\n'));
    expect(scan([site('i++')])).toEqual([]);
    expect(scan([site('i--')])).toEqual([]);
    expect(scan([site('any as Int')])).toEqual([]);
    expect(scan([site('any as? Int')])).toEqual([]);
    // Un nom seul, ou une soustraction, ne fait rien tout seul.
    expect(scan([site('i')]).map((f: any) => f.name)).toEqual(['x']);
    expect(scan([site('i - 1')]).map((f: any) => f.name)).toEqual(['x']);
  });

  it('une delegation par objet anonyme, meme renvoyee a la ligne apres by, laisse lire le corps', () => {
    // `by` puis `object` en tete de la ligne suivante : la v1 y voyait une
    // declaration fraiche, l etendue s arretait avant le corps et `x`, lu
    // par `val y = x`, passait pour mort.
    // Le parametre sur sa propre ligne et le site qui l omet : sur la ligne
    // de la classe, ou passe sur la ligne du site, la regle de la ligne
    // entiere l ecarterait avant meme que l etendue soit lue.
    const wrapped = kt('B.kt', [
      'package com.x',
      '',
      'class B(',
      '    x: Int = 0,',
      ') : I by',
      '    object : I { override fun f() = 1 } {',
      '    val y = x',
      '}',
      '',
      'val b = B()',
      '',
    ].join('\n'));
    expect(scan([wrapped])).toEqual([]);
    const sameLine = kt('C.kt', [
      'package com.x',
      '',
      'class C(',
      '    x: Int = 0,',
      ') : I by object : I { override fun f() = 2 } {',
      '    val y = x',
      '}',
      '',
      'val c = C()',
      '',
    ].join('\n'));
    expect(scan([sameLine])).toEqual([]);
    // Un delegue sans accolade : la premiere accolade a profondeur zero est
    // le corps, et le compilateur lit pareil (kotlinc refuse
    // `by Runnable { } { ... }` a la seconde accolade). Une classe qui
    // delegue reste donc un candidat quand son corps ne lit pas `x`.
    const plain = kt('E.kt', [
      'package com.x',
      '',
      'class E(',
      '    x: Int = 0,',
      '    private val i: I,',
      ') : I by i {',
      '    val y = 1',
      '}',
      '',
      'val e = E(i = impl)',
      '',
    ].join('\n'));
    expect(scan([plain]).map((f: any) => f.name)).toEqual(['x']);
  });
});

describe.skipIf(!mod)('un site qui construit sans le nommer nu', () => {
  // Les trois formes que la relecture adversariale a trouvees : chacune passe
  // ses arguments en position sans que la garde `super(` ni la garde Java ne
  // voie le nom, et apres la coupe le `5` glissait dans le parametre suivant.
  // Un parametre par ligne : la famille retire des lignes entieres, et un
  // parametre qui partage la sienne n est jamais candidat.
  const BASE = kt('Base.kt', [
    'package com.a',
    '',
    'open class Base(',
    '    id: Int,',
    '    x: Int = 0,',
    '    y: Int = 0,',
    ') {',
    '    val yy = y',
    '}',
    '',
    'open class GBase<T>(',
    '    id: Int,',
    '    x: Int = 0,',
    '    y: Int = 0,',
    ') {',
    '    val yy = y',
    '}',
    '',
  ].join('\n'));

  it('Java, `extends com.a.Base` sans import et `new com.a.GBase<>(1, 5)` : rien', () => {
    const sub = { path: '/w/app/src/main/java/com/b/Sub.java', text: 'package com.b;\n\nclass Sub extends com.a.Base {\n\tSub() { super(1, 5); }\n}\n' };
    const use = { path: '/w/app/src/main/java/com/b/Use.java', text: 'package com.b;\n\nclass Use {\n\tObject g = new com.a.GBase<>(1, 5);\n}\n' };
    // Sans site, `x` de chaque classe est candidat ; avec le site positionnel, plus rien pour cette classe.
    expect(scan([BASE]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['Base.x', 'GBase.x']);
    expect(scan([BASE, sub]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['GBase.x']);
    expect(scan([BASE, use]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['Base.x']);
  });

  it('Kotlin, une annotation entre les deux points et le supertype : `super(1, 5)` compte', () => {
    const sub = kt('Sub.kt', 'package com.a\n\nclass Sub : @Ann Base {\n    constructor() : super(1, 5)\n}\n');
    expect(scan([BASE, sub]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['GBase.x']);
    // Temoin : le supertype APPELE passe `1` en position pour `id` seulement,
    // et `x` de `Base` reste candidat (`y` est lu par `val yy = y`).
    const called = kt('Called.kt', 'package com.a\n\nclass Called : @Ann Base(1) {\n    fun f() = 1\n}\n');
    expect(scan([BASE, called]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['Base.x', 'GBase.x']);
  });

  it('un appel infixe dans l argument nomme est un appel : la ligne reste', () => {
    const site = kt('Site.kt', [
      'package com.a',
      '',
      'fun make(ch: Channel, msg: String) = Base(',
      '    id = 1,',
      '    x = ch sendTo msg,',
      ')',
      '',
    ].join('\n'));
    expect(scan([BASE, site]).map((f: any) => `${f.className}.${f.name}`)).toEqual(['GBase.x']);
    // Temoin : le meme site avec une valeur nue, et `x` part avec sa ligne.
    const plain = kt('Site.kt', site.text.replace('x = ch sendTo msg,', 'x = 1,'));
    expect(scan([BASE, plain]).map((f: any) => `${f.className}.${f.name}:${f.sites.length}`)).toEqual(['Base.x:1', 'GBase.x:0']);
  });
});

describe.skipIf(!mod)('KJ-058 dans Remove Everything Unused', () => {
  const SEGS = ['test/java', 'test/kotlin'];
  const RACINE = kt('Main.kt', 'package com.x\n\nfun main() {\n    println(Live.EMPTY)\n}\n');
  const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

  it('la passe coupe le parametre sous une famille et l argument sous une autre, chacun avec son etiquette', () => {
    const { parFichier, tally } = collecterUnePasse([POST, RACINE, GRADLE], SEGS);
    const coupes = [...parFichier.values()].flat();
    const parametres = coupes.filter(c => c.famille === 'parametres');
    const args = coupes.filter(c => c.famille === 'arguments');
    expect(parametres.map(c => c.quoi)).toEqual([
      'constructor parameter readingTime of Post, nothing reads it',
      'constructor parameter audio of Post, nothing reads it',
    ]);
    expect(args.map(c => c.quoi)).toEqual([
      'argument readingTime, the parameter is gone',
      'argument audio, the parameter is gone',
    ]);
    expect(tally.parametres).toBe(2);
    expect(tally.arguments).toBe(2);
    for (const c of [...parametres, ...args]) expect(c.texte).toBe('');
  });

  it('le compte rendu nomme les deux sans gonfler le nombre de parametres', () => {
    const vide = Object.fromEntries(Object.keys(collecterUnePasse([GRADLE], SEGS).tally).map(k => [k, 0]));
    expect(resumeDesFamilles({ ...vide, parametres: 2, arguments: 1 }))
      .toBe('2 constructor parameters, 1 argument of a removed parameter');
    expect(resumeDesFamilles({ ...vide, parametres: 1, arguments: 2 }))
      .toBe('1 constructor parameter, 2 arguments of removed parameters');
  });
});
