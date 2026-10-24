import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';
import { sweepFile } from '../../../src/providers/DeadCodeSweep';

/**
 * G50 — un champ Java ecrit et jamais lu.
 *
 * Sur le projet de reference, `PageDownloadEvent.sectionProgress` est
 * `private final`, ecrit une fois dans le constructeur depuis le parametre
 * homonyme, et lu nulle part. Le correctif a la main de trois autres
 * (`AdsModelAssemblerResourceProvider.adsSpotKind`, `adsRequestKind`,
 * `FileValidationStatus.errorReason`) a retire le champ et son affectation.
 * KJ-028 ne connaissait que Kotlin : le balayage Java sortait avant.
 *
 * Regle : un champ `private`, non annote, dont chaque mention hors de sa
 * declaration est une ecriture (`this.f = ...`, ou `f = ...` sans parametre
 * homonyme). `f++`, `this.f` lu, `autre.f` sont des lectures. Une methode qui
 * declare une locale homonyme fait abandonner. Un fichier qui serialise ou
 * reflechit est hors de portee. L affectation part ; un appel a droite reste
 * en instruction, un `new` garde le champ (il tient peut etre la seule
 * reference). Limite assumee : un serialiseur d un autre fichier.
 *
 * Hors de ce correctif, dit dans la file : la cascade (le parametre devenu
 * inutile, les cles d enum, les `.properties`, les bouchons de test).
 */

const mod: any = await importOrNull('src/providers/javaWriteOnlyFields');
const cls = (body: string[]) => ['package p;', '', 'public class Event {', ...body.map(l => `\t${l}`), '}', ''].join('\n');
const champs = (text: string) => (mod?.findJavaWriteOnlyFields?.(text) ?? []).map((f: any) => f.name);
const apres = (text: string) => {
  const f = (mod?.findJavaWriteOnlyFields?.(text) ?? []) as any[];
  let t = text;
  for (const e of f.flatMap(x => x.edits).sort((a: any, b: any) => b.start - a.start)) t = t.slice(0, e.start) + e.text + t.slice(e.end);
  return t;
};

const PAGE = cls([
  'private final int index;',
  'private final float sectionProgress;',
  '',
  'public Event(final int index, final float sectionProgress) {',
  '\tthis.index = index;',
  '\tthis.sectionProgress = sectionProgress;',
  '}',
  '',
  'public int getIndex() {',
  '\treturn index;',
  '}',
]);

describe('G50, le motif reel', () => {
  it('sectionProgress est ecrit et jamais lu', () => {
    expect(champs(PAGE)).toEqual(['sectionProgress']);
  });

  it('le champ et son affectation partent, le reste reste', () => {
    const t = apres(PAGE);
    expect(t).not.toContain('sectionProgress;\n');
    expect(t).not.toContain('this.sectionProgress');
    expect(t).toContain('this.index = index;');
    expect(t).toContain('public Event(final int index, final float sectionProgress) {');
  });

  it('le balayage Java le rapporte en writeOnly', () => {
    expect(sweepFile(PAGE, 'java').filter(f => f.detector === 'writeOnly').map(f => f.name)).toEqual(['sectionProgress']);
  });

  it('une ecriture sans this, hors de toute ombre', () => {
    expect(champs(cls(['private int n;', '', 'void reset() {', '\tn = 0;', '}']))).toEqual(['n']);
  });

  it('un appel a droite reste en instruction', () => {
    const t = apres(cls(['private Object o;', '', 'void init(Service s) {', '\tthis.o = s.load();', '}']));
    expect(t).toContain('\t\ts.load();\n');
    expect(t).not.toContain('this.o');
  });
});

describe('G50, gardes', () => {
  it.each([
    ['une lecture', ['private int n;', 'void a() { n = 1; }', 'int b() { return n; }']],
    ['this.f lu', ['private int n;', 'void a() { this.n = 1; }', 'int b() { return this.n; }']],
    ['f++', ['private int n;', 'void a() {', '\tn = 1;', '}', 'void b() {', '\tn++;', '}']],
    ['f += 1', ['private int n;', 'void a() {', '\tn = 1;', '}', 'void b() {', '\tn += 1;', '}']],
    ['un champ public', ['public int n;', 'void a() {', '\tn = 1;', '}']],
    ['un champ annote', ['@Inject', 'private int n;', 'void a() {', '\tn = 1;', '}']],
    ['une locale homonyme', ['private int n;', 'void a() {', '\tn = 1;', '}', 'void b() {', '\tint n = 2;', '\tSystem.out.println(n);', '}']],
    ['une comparaison', ['private int n;', 'void a() {', '\tn = 1;', '}', 'boolean b(int m) {', '\treturn m == n;', '}']],
    ['jamais ecrit (autre detecteur)', ['private int n;']],
    ['une affectation inline', ['private int n;', 'void a() { if (true) n = 1; }']],
    ['un appel dans une expression a droite', ['private int n;', 'void a(Service s) {', '\tn = s.count() + 1;', '}']],
    ['un initialiseur appel', ['private int n = compute();', 'void a() {', '\tn = 1;', '}']],
    // Confirmes par la refutation de la premiere version.
    ['une affectation chainee', ['private int f;', 'private int g;', 'void a(int x) {', '\tf = g = x;', '}', 'int get() {', '\treturn g;', '}']],
    ['une affectation composee a droite', ['private int v;', 'private int total;', 'void a(int x) {', '\tv = total += x;', '}', 'int get() {', '\treturn total;', '}']],
    ['un increment a droite', ['private int id;', 'private static int counter;', 'void a() {', '\tid = counter++;', '}', 'int get() {', '\treturn counter;', '}']],
    ['un initialiseur a effet de bord', ['private int id = ++counter;', 'private static int counter;', 'void a() {', '\tid = 1;', '}']],
    // Confirmes par la seconde refutation.
    ['une comparaison d appels a droite', ['private boolean ok;', 'void a() {', '\tok = size() > limit();', '}']],
    ['une comparaison d appels qualifies', ['private boolean ok;', 'void a(java.util.List<String> x, java.util.List<String> y) {', '\tok = x.size() < y.size();', '}']],
    ['une classe interne qui herite', ['private int f;', 'class In extends Base {', '\tvoid m() {', '\t\tf = 1;', '\t}', '}']],
    ['une classe anonyme', ['private int f;', 'Object o() {', '\treturn new Base() {', '\t\tvoid m() {', '\t\t\tf = 1;', '\t\t}', '\t};', '}']],
    ['une annotation a parentheses imbriquees', ['@Opt(n = @N(1))', 'private int f;', 'void m() {', '\tf = 1;', '}']],
    ['une annotation sur plusieurs lignes', ['@Opt(', '\tn = 1', ')', 'private int f;', 'void m() {', '\tf = 1;', '}']],
  ])('%s : rien', (_quoi, corps) => {
    expect(champs(cls(corps as string[]))).toEqual([]);
  });

  it.each([
    ['Serializable', 'public class Event implements Serializable {'],
    ['Parcelable', 'public class Event implements Parcelable {'],
  ])('une classe %s : rien', (_quoi, entete) => {
    const t = cls(['private int n;', 'void a() {', '\tn = 1;', '}']).replace('public class Event {', entete);
    expect(champs(t)).toEqual([]);
  });

  it('un champ nomme dans une chaine (updater) : rien', () => {
    const t = cls(['private volatile int count;', 'private static final Object U = AtomicIntegerFieldUpdater.newUpdater(Event.class, "count");', 'Event() {', '\tcount = 1;', '}']);
    expect(champs(t)).toEqual([]);
  });

  it.each([['@Getter'], ['@lombok.Value'], ['@Builder'], ['@Data']])('une classe Lombok %s : rien', (anno) => {
    const t = cls(['private String name;', 'Event(String n) {', '\tthis.name = n;', '}']).replace('public class Event {', `${anno}\npublic class Event {`);
    expect(champs(t)).toEqual([]);
  });

  it('garde : une classe interne sans heritage ecrit le champ de l externe', () => {
    expect(champs(cls(['private int f;', 'class In {', '\tvoid m() {', '\t\tf = 1;', '\t}', '}']))).toEqual(['f']);
  });

  it('un new generique a droite : rien, le champ en tient peut etre la seule reference', () => {
    expect(champs(cls(['private Object o;', 'void a() {', '\to = new java.util.ArrayList<String>();', '}']))).toEqual([]);
  });

  it('un fichier qui reflechit : rien', () => {
    const t = cls(['private int n;', 'void a() {', '\tn = 1;', '}', 'Object f() throws Exception {', '\treturn getClass().getDeclaredField("n");', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('un parametre homonyme masque la lecture, pas l ecriture par this', () => {
    // Le `n` lu ici est le parametre : le champ reste ecrit et jamais lu.
    const t = cls(['private int n;', 'void a(int n) {', '\tthis.n = n;', '\tSystem.out.println(n);', '}']);
    expect(mod ? champs(t) : ['n']).toEqual(['n']);
  });

  it('un champ lu par les arguments d une classe anonyme : rien', () => {
    // `new Base(size) {` n est pas l en-tete d une methode a parametre `size`.
    const t = cls(['private int size;', 'Event(int s) {', '\tthis.size = s;', '}', 'Object make() {', '\treturn new Base(size) {', '\t};', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('deux declarateurs sur une ligne : rien', () => {
    const t = cls(['private int a, b;', 'void m() {', '\tb = 1;', '\tSystem.out.println(a);', '}']);
    expect(champs(t)).toEqual([]);
    expect(apres(t)).toBe(t);
  });

  it('garde : une virgule dans les chevrons reste un seul declarateur', () => {
    expect(champs(cls(['private java.util.Map<String, Integer> m;', 'void a() {', '\tm = null;', '}']))).toEqual(['m']);
  });

  it('une lambda en bloc sur plusieurs lignes ne laisse pas son `};`', () => {
    const t = cls(['private Callback cb;', 'void a() {', '\tthis.cb = s -> {', '\t\treturn s;', '\t};', '}']);
    const r = apres(t);
    expect(r.split('{').length).toBe(r.split('}').length);
  });

  it.each([
    ['private int a = 1, b;'],
    ['private java.util.Map<String, Integer> a = null, b;'],
  ])('deux declarateurs, la virgule dans l initialiseur : rien (%s)', (decl) => {
    const t = cls([decl, 'void s(int x) {', '\ta = x;', '}', 'int g() {', '\treturn b;', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('une classe a methode native : rien (JNI lit le champ)', () => {
    expect(champs(cls(['private long handle;', 'void rel() {', '\thandle = 0;', '}', 'native void go();']))).toEqual([]);
  });

  it.each([
    ['Object d() {\n\t\treturn java.util.Arrays.toString(getClass().getDeclaredFields());\n\t}'],
    ['public String toString() {\n\t\treturn ToStringBuilder.reflectionToString(this);\n\t}'],
    ['public boolean equals(Object o) {\n\t\treturn EqualsBuilder.reflectionEquals(this, o);\n\t}'],
    ['Object d() {\n\t\treturn getClass().getFields();\n\t}'],
  ])('une classe qui lit tous ses champs par reflexion : rien', (methode) => {
    expect(champs(cls(['private int f;', 'Event(int x) {', '\tf = x;', '}', methode]))).toEqual([]);
  });

  it('une classe sans autre methode que ses constructeurs porte des donnees : rien', () => {
    // Gson ou Retrofit la lisent par reflexion depuis un autre fichier.
    expect(champs(cls(['private String user;', 'public Event(String u) {', '\tthis.user = u;', '}']))).toEqual([]);
  });

  it('garde : un constructeur et une methode, le champ ecrit seul reste signale', () => {
    expect(champs(cls(['private String user;', 'public Event(String u) {', '\tthis.user = u;', '}', 'void go() {', '}']))).toEqual(['user']);
  });

  it.each([
    ['static class In extends Base {'],
    ['static class In {'],
  ])('this.n dans une autre classe (%s) n est pas le champ : rien', (entete) => {
    const t = cls(['private int n;', 'Event() {', '\tthis.n = 1;', '}', 'void go() {', '}', entete, '\tvoid m() {', '\t\tthis.n = 2;', '\t}', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('un ${ dans une chaine Java ne masque pas une lecture', () => {
    const t = cls(['private int n;', 'void a() {', '\tn = 1;', '}', 'boolean has(String s) { return s.contains("${"); } int get() { return n; }']);
    expect(champs(t)).toEqual([]);
  });

  it.each([
    ['new Handler(Looper.getMainLooper()) {'],
    ['new Task<Void, Void>() {'],
  ])('une classe anonyme %s herite : son ecriture nue n est pas la notre', (ouverture) => {
    const t = cls(['private int level;', 'void a() {', `\t${ouverture}`, '\t\tvoid go() {', '\t\t\tlevel = 3;', '\t\t}', '\t}.go();', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('une methode d une autre classe du fichier ne fait pas d un porteur de donnees une classe a logique', () => {
    const t = cls(['private String user;', 'public Event(String u) {', '\tthis.user = u;', '}']) + 'class Other {\n\tvoid go() {\n\t}\n}\n';
    expect(champs(t)).toEqual([]);
  });

  it('un bloc de texte avec \\""" echappe ne masque pas une lecture', () => {
    const t = cls(['private int n;', 'void s() {', '\tn = 1;', '}', 'String t = """', '\tsay \\""" hi', '\t""";', 'int g() {', '\treturn n;', '}']);
    expect(champs(t)).toEqual([]);
  });

  it('un champ qui tient la seule reference d un new : rien', () => {
    // Un listener garde contre une reference faible (SharedPreferences, Picasso).
    expect(champs(cls(['private final Object keep;', 'Event(Object p) {', '\tthis.keep = new Listener(p);', '}', 'void go() {', '}']))).toEqual([]);
  });

  it('garde : un appel a droite reste une instruction et le champ part', () => {
    const t = cls(['private Object v;', 'void a() {', '\tv = root.findViewById(1);', '}']);
    expect(champs(t)).toEqual(['v']);
    expect(apres(t)).toContain('\t\troot.findViewById(1);\n');
  });
});
