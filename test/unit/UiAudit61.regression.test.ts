import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { bodyEndLine } from '../../src/util/symbolRanges';
import { KotlinFoldingRangeProvider } from '../../src/providers/FoldingRangeProvider';

// Audit 61 : l'etendue d'une declaration s'arretait a sa premiere ligne quand
// l'en tete etait replie apres une annotation. `class Foo @Inject` suivi de
// `constructor(...)` est la forme que ktlint impose sur un constructeur
// injecte : la classe recevait une etendue d'UNE ligne, donc dans l'Outline
// et le fil d'Ariane tous ses membres debordaient de leur parent, et replier
// la classe ne repliait rien. 154 cas sur les 3187 fichiers de LaPresse.

const CODE = [
  'package p',
  '',
  'class AdsDataStoreFactory @Inject',
  'constructor(',
  '    private val a: A,',
  ') {',
  '    private val vide = Empty()',
  '',
  '    fun recuperer(): Store {',
  '        return vide',
  '    }',
  '}',
].join('\n');

const URI = 'file:///a61/Fabrique.kt';

function doc(uri: string, texte: string): any {
  const l = texte.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: 'kotlin', version: 1, isDirty: false, lineCount: l.length,
    getText: () => texte,
    lineAt: (n: number) => ({ text: l[n] ?? '', range: { end: { line: n, character: (l[n] ?? '').length } } }),
  };
}

describe('Un en tete replie apres une annotation ne clot pas la declaration', () => {
  it('la classe couvre son corps entier', () => {
    const lignes = CODE.split('\n');
    const syms = parse(URI, CODE).symbols;
    const i = syms.findIndex(s => s.name === 'AdsDataStoreFactory');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(11);
  });

  it('aucun membre ne deborde de sa classe dans l\'Outline', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE), {} as any);
    const classe = arbre.find(n => n.name === 'AdsDataStoreFactory')!;
    expect(classe).toBeDefined();
    expect(classe.children.length).toBeGreaterThan(0);
    for (const enfant of classe.children) {
      expect(enfant.range.start.line).toBeGreaterThanOrEqual(classe.range.start.line);
      expect(enfant.range.end.line).toBeLessThanOrEqual(classe.range.end.line);
    }
  });

  it('les annotations qualifiees et parametrees comptent aussi', () => {
    for (const entete of ['class F @field:Inject', 'class F @Suppress("a", "b")', 'class F @get:JvmName("x")']) {
      const code = ['package p', '', entete, 'constructor(val a: Int) {', '    fun m() {}', '}'].join('\n');
      const lignes = code.split('\n');
      const syms = parse(URI, code).symbols;
      const i = syms.findIndex(s => s.name === 'F');
      expect([entete, bodyEndLine(lignes, syms, i, lignes.length - 1)]).toEqual([entete, 5]);
    }
  });

  it('une declaration d\'une seule ligne garde son etendue d\'une ligne', () => {
    const code = ['package p', '', 'class Petit', '', 'val x = 1'].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'Petit');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(2);
  });

  it('une annotation posee AVANT une declaration ne rallonge pas la precedente', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    val a = 1',
      '',
      '    @Inject',
      '    fun m() {}',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'a');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(3);
  });
});

describe('L\'arbre de l\'Outline garantit que chaque enfant tient dans son parent', () => {
  // La profondeur d'accolades ne suffit pas : un `object :` dans un bloc `init`
  // est un cran plus profond que le corps de la classe, donc il se rattachait a
  // la derniere propriete vue, dont l'etendue etait close depuis longtemps. Le
  // fil d'Ariane annoncait alors `Holder > disposable > object : Callback`.
  const CODE_INIT = [
    'package p',
    '',
    'class Holder(root: View) {',
    '    private val disposable = CompositeDisposable()',
    '',
    '    init {',
    '        vm.visible.addCallback(object : Observable.OnPropertyChangedCallback {',
    '            override fun onChanged() {}',
    '        })',
    '    }',
    '}',
  ].join('\n');

  it('l\'objet anonyme d\'un bloc init est enfant de la classe, pas de la propriete', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_INIT));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_INIT), {} as any);
    const classe = arbre.find(n => n.name === 'Holder')!;
    const propriete = classe.children.find(n => n.name === 'disposable')!;
    expect(propriete).toBeDefined();
    expect(propriete.children.map(c => c.name)).toEqual([]);
    expect(classe.children.map(c => c.name)).toContain('object : Observable.OnPropertyChangedCallback');
  });

  it('tout enfant tient dans son parent, a tous les niveaux', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_INIT));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_INIT), {} as any);
    const verifie = (n: any, parent: any) => {
      if (parent) {
        expect(n.range.start.line).toBeGreaterThanOrEqual(parent.range.start.line);
        expect(n.range.end.line).toBeLessThanOrEqual(parent.range.end.line);
      }
      for (const c of n.children ?? []) verifie(c, n);
    };
    for (const n of arbre) verifie(n, undefined);
  });

  it('une imbrication legitime reste imbriquee', () => {
    const code = [
      'package p',
      '',
      'class Externe {',
      '    class Interne {',
      '        fun m() {}',
      '    }',
      '}',
    ].join('\n');
    const index = new SymbolIndex();
    index.add(parse(URI, code));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, code), {} as any);
    expect(arbre.map(n => n.name)).toEqual(['Externe']);
    expect(arbre[0].children.map(n => n.name)).toEqual(['Interne']);
    expect(arbre[0].children[0].children.map(n => n.name)).toEqual(['m']);
  });
});

describe('Un seul repli par ligne de depart', () => {
  // `class GameApi(private val client: HttpClient) {` porte deux entrees sur la
  // meme ligne : la classe et la propriete du constructeur primaire. Chacune
  // produisait un repli, l'un allant jusqu'a la fin de la classe et l'autre
  // s'arretant a la ligne qui precede le premier membre. VS Code n'affiche
  // qu'un chevron par ligne, donc replier la classe repliait un fragment.
  // 181 cas sur LaPresse. La KDoc entre l'en tete et le premier membre est ce
  // qui etire l'etendue du parametre : sans elle le defaut ne se reproduit pas.
  const CODE_CTOR = [
    'package p',
    '',
    'class GameApi(private val client: HttpClient) {',
    '',
    '    /**',
    '     * Recupere le contenu.',
    '     */',
    '    fun get(): String {',
    '        return client.get()',
    '    }',
    '',
    '    fun post(): String {',
    '        return client.post()',
    '    }',
    '}',
  ].join('\n');

  function replis(code: string) {
    const index = new SymbolIndex();
    index.add(parse(URI, code));
    index.finalize();
    return (new KotlinFoldingRangeProvider(index).provideFoldingRanges(doc(URI, code), {} as any, {} as any) as any[]);
  }

  it('la fixture porte bien deux symboles sur la ligne de la classe', () => {
    // Sans cela le test passerait sans rien prouver : c'est ce qui est arrive
    // avec une premiere fixture ou le premier membre suivait immediatement.
    const surLaLigne = parse(URI, CODE_CTOR).symbols.filter(s => s.line === 2);
    expect(surLaLigne.map(s => s.name).sort()).toEqual(['GameApi', 'client']);
  });

  it('deux entrees sur la meme ligne ne donnent qu\'un repli', () => {
    const departs = replis(CODE_CTOR).map(x => x.start);
    expect(new Set(departs).size).toBe(departs.length);
  });

  it('le repli conserve est celui de la classe, jusqu\'a son accolade fermante', () => {
    const surLaClasse = replis(CODE_CTOR).filter(x => x.start === 2);
    expect(surLaClasse).toHaveLength(1);
    expect(surLaClasse[0].end).toBe(14);
  });

  it('les replis des membres restent intacts', () => {
    const r = replis(CODE_CTOR).map(x => `${x.start}-${x.end}`);
    expect(r).toContain('7-9');
    expect(r).toContain('11-13');
  });
});

describe('La documentation d\'un voisin n\'appartient pas a la declaration en cours', () => {
  // Un parametre de constructeur finit par une virgule, donc le balayage
  // continuait dans la KDoc du parametre suivant : son repli croisait celui du
  // commentaire. 10 cas sur LaPresse.
  const CODE_DOC = [
    'package p',
    '',
    'data class AudioObjectModel(',
    '    val darkStyle: StyleModel?,',
    '    /**',
    '     * Le style clair.',
    '     */',
    '    val lightStyle: StyleModel?,',
    ')',
  ].join('\n');

  it('l\'etendue du parametre s\'arrete avant la KDoc du suivant', () => {
    const lignes = CODE_DOC.split('\n');
    const syms = parse(URI, CODE_DOC).symbols;
    const i = syms.findIndex(s => s.name === 'darkStyle');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(3);
  });

  it('aucun repli n\'en croise un autre', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_DOC));
    index.finalize();
    const r = (new KotlinFoldingRangeProvider(index)
      .provideFoldingRanges(doc(URI, CODE_DOC), {} as any, {} as any) as any[])
      .sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        if (r[j].start > r[i].end) break;
        expect(r[j].end).toBeLessThanOrEqual(r[i].end);
      }
    }
  });

  it('un commentaire de bloc DANS un corps ne raccourcit pas la declaration', () => {
    const code = [
      'package p',
      '',
      'fun calcule(): Int {',
      '    /* une note */',
      '    return 1',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'calcule');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(5);
  });
});

describe('Une ligne faite d\'annotations introduit ce qui suit', () => {
  // Contrepartie de la KDoc : `val a: String,` finit par une virgule, donc le
  // balayage continuait dans la ligne `@SerializedName("b")` du parametre
  // suivant. Replier le premier cachait l'annotation du second. 669 cas sur
  // LaPresse apres le correctif KDoc de la v1.42.86.
  const CODE_ANNO = [
    'package p',
    '',
    'data class Ticket(',
    '    @SerializedName("content_type")',
    '    val contentType: String,',
    '    @SerializedName("ticket_form_id")',
    '    val ticketFormId: Long,',
    ')',
  ].join('\n');

  it('l\'etendue du parametre s\'arrete avant l\'annotation du suivant', () => {
    const lignes = CODE_ANNO.split('\n');
    const syms = parse(URI, CODE_ANNO).symbols;
    const i = syms.findIndex(s => s.name === 'contentType');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(4);
  });

  it('un en tete replie APRES une annotation continue quand meme', () => {
    // La regle inverse doit survivre : ici l'annotation termine une ligne qui
    // a commence une declaration, elle ne l'introduit pas.
    const code = ['package p', '', 'class F @Inject', 'constructor(val a: Int) {', '    fun m() {}', '}'].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'F');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(5);
  });

  it('plusieurs annotations empilees s\'arretent aussi', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    val a = 1',
      '',
      '    @Inject',
      '    @Named("x")',
      '    lateinit var b: B',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'a');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(3);
  });
});

describe('Une regle d\'arret ne s\'applique pas dans une liste de parametres', () => {
  // La KDoc et l'annotation introduisent la declaration suivante SEULEMENT
  // hors parentheses. Dans un constructeur primaire elles introduisent le
  // parametre suivant, qui appartient encore a la classe : arreter la
  // fermait la classe sur sa premiere ligne et ses proprietes remontaient a la
  // racine de l'Outline, au meme niveau qu'elle. 151 cas avant la v1.42.86,
  // 211 apres, et 1000 si la regle annotation n'etait pas bornee.
  const CODE_DC = [
    'package p',
    '',
    'data class Ticket(',
    '    @SerializedName("content_type")',
    '    val contentType: String,',
    '    /** Le formulaire. */',
    '    val ticketFormId: Long,',
    ')',
  ].join('\n');

  it('la data class couvre toute sa liste de parametres', () => {
    const lignes = CODE_DC.split('\n');
    const syms = parse(URI, CODE_DC).symbols;
    const i = syms.findIndex(s => s.name === 'Ticket');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(7);
  });

  it('ses proprietes restent ses enfants dans l\'Outline', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_DC));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_DC), {} as any);
    expect(arbre.map(n => n.name)).toEqual(['Ticket']);
    expect(arbre[0].children.map(n => n.name)).toEqual(['contentType', 'ticketFormId']);
  });

  it('hors parentheses, la regle d\'arret tient toujours', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    val a = 1',
      '',
      '    @Inject',
      '    lateinit var b: B',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'a'), lignes.length - 1)).toBe(3);
  });
});

describe('Un en tete de classe replie sans annotation continue aussi', () => {
  // La v1.42.86 ne traitait que la forme `class Foo @Inject` / `constructor(`.
  // Sans annotation, `open class Foo` puis `constructor(` retombait dans le
  // meme trou : la classe s'arretait sur sa premiere ligne et son companion
  // remontait a la racine de l'Outline.
  const CODE_CTOR2 = [
    'package p',
    '',
    'open class CustomTargetingModel',
    'constructor(',
    '    @param:NonNull',
    '    var cible: Map<String, String>',
    ') {',
    '    companion object {',
    '        val VIDE = CustomTargetingModel(emptyMap())',
    '    }',
    '',
    '    override fun equals(other: Any?): Boolean = true',
    '}',
  ].join('\n');

  it('la classe couvre son corps', () => {
    const lignes = CODE_CTOR2.split('\n');
    const syms = parse(URI, CODE_CTOR2).symbols;
    const i = syms.findIndex(s => s.name === 'CustomTargetingModel');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(12);
  });

  it('le companion et les methodes restent dans la classe', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_CTOR2));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_CTOR2), {} as any);
    expect(arbre.map(n => n.name)).toEqual(['CustomTargetingModel']);
    expect(arbre[0].children.map(n => n.name)).toContain('Companion');
    expect(arbre[0].children.map(n => n.name)).toContain('equals');
  });

  it('une liste de supertypes repliee sur la ligne suivante continue', () => {
    const code = [
      'package p',
      '',
      'class Longue',
      '    : Base(),',
      '      Autre {',
      '    fun m() {}',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'Longue');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(6);
  });

  it('une classe sans corps garde son etendue d\'une ligne', () => {
    const code = ['package p', '', 'class Vide', '', 'class Autre'].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'Vide'), lignes.length - 1)).toBe(2);
  });
});

describe('Une annotation entre le nom de la classe et son constructeur continue l\'en tete', () => {
  // `class PageExternalUid` / `@VisibleForTesting(...)` / `constructor(...) {`
  // Ici l'annotation ne presente pas la declaration suivante : elle est DANS
  // l'en tete en cours. La distinction tient a la ligne de depart, qui declare
  // une classe sans ouvrir son corps.
  const CODE_ENTRE = [
    'package p',
    '',
    '@JsonDeserialize(using = D::class)',
    'class PageExternalUid',
    '@VisibleForTesting(otherwise = VisibleForTesting.PACKAGE_PRIVATE)',
    'constructor(id: String?) : Parcelable {',
    '    val uid = id',
    '',
    '    fun lire(): String = uid.orEmpty()',
    '}',
  ].join('\n');

  it('la classe couvre son corps', () => {
    const lignes = CODE_ENTRE.split('\n');
    const syms = parse(URI, CODE_ENTRE).symbols;
    const i = syms.findIndex(s => s.name === 'PageExternalUid');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(9);
  });

  it('ses membres restent ses enfants', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_ENTRE));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_ENTRE), {} as any);
    expect(arbre.map(n => n.name)).toEqual(['PageExternalUid']);
    expect(arbre[0].children.map(n => n.name)).toContain('lire');
  });

  it('hors en tete de classe, une annotation seule introduit toujours la suite', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    val a = 1',
      '',
      '    @Inject',
      '    lateinit var b: B',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'a'), lignes.length - 1)).toBe(3);
  });

  it('une classe sans corps suivie d\'une declaration annotee garde une ligne', () => {
    const code = ['package p', '', 'class Vide', '', '@Inject', 'lateinit var b: B'].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'Vide'), lignes.length - 1)).toBe(2);
  });
});

describe('Une accolade dans une liste de parametres n\'est pas le corps', () => {
  // `sealed class ApplicationState(initialValues: Builder.() -> Unit = {}) {`
  // Le `{}` de la valeur par defaut ouvrait et refermait la profondeur, donc la
  // classe etait declaree close sur sa premiere ligne. 42 de ses membres se
  // retrouvaient a la racine de l'Outline.
  const CODE_LAMBDA = [
    'package p',
    '',
    'sealed class ApplicationState(initialValues: Builder.() -> Unit = {}) {',
    '',
    '    val user: User',
    '',
    '    init {',
    '        user = Builder().apply(initialValues).user',
    '    }',
    '}',
  ].join('\n');

  it('la classe couvre son corps', () => {
    const lignes = CODE_LAMBDA.split('\n');
    const syms = parse(URI, CODE_LAMBDA).symbols;
    const i = syms.findIndex(s => s.name === 'ApplicationState');
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(9);
  });

  it('ses membres restent ses enfants', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE_LAMBDA));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE_LAMBDA), {} as any);
    expect(arbre.map(n => n.name)).toEqual(['ApplicationState']);
    expect(arbre[0].children.map(n => n.name)).toContain('user');
  });

  it('une lambda passee en argument sur plusieurs lignes se termine bien', () => {
    const code = [
      'package p',
      '',
      'class C {',
      '    val x = foo({',
      '        bar()',
      '    })',
      '',
      '    val y = 1',
      '}',
    ].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'x'), lignes.length - 1)).toBe(5);
  });

  it('un corps de fonction normal est toujours reconnu', () => {
    const code = ['package p', '', 'fun f(a: Int = 1) {', '    println(a)', '}'].join('\n');
    const lignes = code.split('\n');
    const syms = parse(URI, code).symbols;
    expect(bodyEndLine(lignes, syms, syms.findIndex(s => s.name === 'f'), lignes.length - 1)).toBe(4);
  });
});
