import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

// Audit 64 : aucun type ne peut etre son propre supertype. Pourtant 32 le
// sont sur LaPresse. Cause : `lookAheadSupertypes` cherche `) : Types` sur les
// 20 lignes qui suivent un constructeur multi ligne, sans s'arreter au `)` qui
// ferme CE constructeur. Une `sealed class X(` sans liste de supertypes
// heritait donc de celle de sa premiere variante imbriquee, c'est a dire
// d'elle meme. La classe se retrouvait sous son propre nom dans `bySuper`, et
// le panneau de hierarchie de types l'affichait comme son propre sous type.

const URI = 'file:///a64/LoginUiModel.kt';
const CODE = [
  'package p',
  '',
  'sealed class LoginUiModel(',
  '    val peutEtreSaute: Boolean,',
  ') {',
  '    abstract val enCharge: Boolean',
  '',
  '    data class Initial(',
  '        override val enCharge: Boolean,',
  '    ) : LoginUiModel(true)',
  '',
  '    object Succes : LoginUiModel(false) {',
  '        override val enCharge = false',
  '    }',
  '}',
].join('\n');

describe('Une classe n\'herite pas de la liste de supertypes de sa variante', () => {
  it('la sealed class n\'a aucun supertype', () => {
    const syms = parse(URI, CODE).symbols;
    const racine = syms.find(s => s.name === 'LoginUiModel')!;
    expect(racine).toBeDefined();
    expect(racine.supertypes).toBeUndefined();
  });

  it('les variantes gardent le leur', () => {
    const syms = parse(URI, CODE).symbols;
    expect(syms.find(s => s.name === 'Initial')!.supertypes).toEqual(['LoginUiModel']);
    expect(syms.find(s => s.name === 'Succes')!.supertypes).toEqual(['LoginUiModel']);
  });

  it('elle n\'est pas son propre sous type', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    const noms = index.lookupImplementations('LoginUiModel').map(e => e.name).sort();
    expect(noms).toEqual(['Initial', 'Succes']);
  });

  it('un vrai constructeur multi ligne suivi de supertypes marche toujours', () => {
    const code = [
      'package p',
      '',
      'class Ecran @Inject constructor(',
      '    private val a: A,',
      '    private val b: B,',
      ') : Base(),',
      '    Ecoutable {',
      '    fun m() {}',
      '}',
    ].join('\n');
    const s = parse(URI, code).symbols.find(x => x.name === 'Ecran')!;
    expect(s.supertypes).toEqual(['Base', 'Ecoutable']);
  });

  it('un constructeur multi ligne ferme sans supertype n\'en invente pas', () => {
    const code = [
      'package p',
      '',
      'data class Point(',
      '    val x: Int,',
      '    val y: Int,',
      ')',
      '',
      'class Autre : Point(0, 0)',
    ].join('\n');
    const s = parse(URI, code).symbols.find(x => x.name === 'Point')!;
    expect(s.supertypes).toBeUndefined();
  });
});

describe('La hierarchie de types applique la meme regle que le reste', () => {
  // `interface Factory : AndroidInjector.Factory<X>` implemente vraiment un
  // type nomme `Factory`, mais pas LUI MEME. Le panneau l'affichait comme son
  // propre sous type, et deplier bouclait. 21 types sur LaPresse.
  const CODES: Record<string, string> = {
    'file:///a64b/Injector.kt':
      'package dagger\n\ninterface AndroidInjector<T> {\n    interface Factory<T> {\n        fun create(): T\n    }\n}\n',
    'file:///a64b/Sub.kt':
      'package p\n\nimport dagger.AndroidInjector\n\ninterface Subcomponent : AndroidInjector<Act> {\n    interface Factory : AndroidInjector.Factory<Act>\n}\n',
  };

  function indexDe(codes: Record<string, string>): SymbolIndex {
    const index = new SymbolIndex();
    for (const [uri, code] of Object.entries(codes)) index.add(parse(uri, code));
    index.finalize();
    return index;
  }

  it('un type n\'est jamais son propre sous type', () => {
    const index = indexDe(CODES);
    const local = index.lookup('Factory').find(e => e.fqn === 'p.Subcomponent.Factory')!;
    expect(local).toBeDefined();
    const brut = index.lookupImplementations('Factory');
    // L'index brut le contient : c'est la vue qui doit trancher.
    expect(brut.some(e => e.fqn === 'p.Subcomponent.Factory')).toBe(true);
    expect(index.lookupImplementationsDeep(local).map(e => e.fqn)).toEqual([]);
  });

  it('le vrai parent voit bien son sous type', () => {
    const index = indexDe(CODES);
    const dagger = index.lookup('Factory').find(e => e.fqn === 'dagger.AndroidInjector.Factory')!;
    expect(dagger).toBeDefined();
    expect(index.lookupImplementationsDeep(dagger).map(e => e.fqn)).toEqual(['p.Subcomponent.Factory']);
  });
});

describe('Une parenthese fermante seule ne clot pas l\'en tete', () => {
  // Le correctif de la v1.42.92 s'arrete des qu'une ligne commence par `)`.
  // C'est juste pour `) {`, faux quand la liste de supertypes est renvoyee a la
  // ligne suivante, ce que Kotlin autorise. Aucun cas sur LaPresse, mais le
  // correctif perdait alors les supertypes en silence.
  const URI2 = 'file:///a64c/Foo.kt';

  it('les supertypes sur la ligne qui suit la fermeture sont lus', () => {
    const code = [
      'package p',
      '',
      'class Foo(',
      '    val a: Int',
      ')',
      '    : Bar(), Baz {',
      '    fun m() {}',
      '}',
    ].join('\n');
    expect(parse(URI2, code).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar', 'Baz']);
  });

  it('une fermeture nue suivie d\'une accolade n\'invente rien', () => {
    const code = [
      'package p',
      '',
      'class Foo(',
      '    val a: Int',
      ')',
      '{',
      '    fun m(): Resultat = TODO()',
      '}',
    ].join('\n');
    expect(parse(URI2, code).symbols.find(s => s.name === 'Foo')!.supertypes).toBeUndefined();
  });

  it('la forme courante reste inchangee', () => {
    const code = [
      'package p',
      '',
      'class Foo(',
      '    val a: Int',
      ') : Bar(), Baz {',
      '    fun m() {}',
      '}',
    ].join('\n');
    expect(parse(URI2, code).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar', 'Baz']);
  });

  it('une fermeture nue ne vole toujours pas le type de retour d\'une methode', () => {
    const code = [
      'package p',
      '',
      'class Api(',
      '    val client: Client',
      ')',
      '{',
      '    suspend fun lire(',
      '        url: String',
      '    ): PayloadDO = client.get(url)',
      '}',
    ].join('\n');
    expect(parse(URI2, code).symbols.find(s => s.name === 'Api')!.supertypes).toBeUndefined();
  });
});

describe('Seule la parenthese qui ferme le CONSTRUCTEUR termine l\'en tete', () => {
  // Un parametre dont le type est une fonction ecrite sur plusieurs lignes se
  // ferme lui aussi par `)`. La regle des v1.42.92 et 93 le prenait pour la fin
  // du constructeur et jetait la liste de supertypes. Idem quand un commentaire
  // suit la parenthese fermante. Sept lignes de cette forme sur LaPresse, aucune
  // dans un constructeur, mais les deux formes sont du Kotlin valide.
  const URI3 = 'file:///a64d/Foo.kt';

  it('un parametre de type fonction multi ligne ne ferme pas l\'en tete', () => {
    const code = [
      'package p',
      '',
      'class Foo(',
      '    val cb: (',
      '        Int',
      '    ) -> Unit,',
      '    val a: Int',
      ') : Bar(), Baz {',
      '    fun m() {}',
      '}',
    ].join('\n');
    expect(parse(URI3, code).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar', 'Baz']);
  });

  it('un commentaire apres la fermeture ne bloque pas la ligne suivante', () => {
    const code = [
      'package p',
      '',
      'class Foo(',
      '    val a: Int',
      ') // le constructeur',
      '    : Bar() {',
      '    fun m() {}',
      '}',
    ].join('\n');
    expect(parse(URI3, code).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar']);
  });

  it('le vol du type de retour reste refuse malgre le suivi de profondeur', () => {
    const code = [
      'package p',
      '',
      'class Api(',
      '    val cb: (',
      '        Int',
      '    ) -> Unit,',
      ') {',
      '    suspend fun lire(',
      '        url: String',
      '    ): PayloadDO = client.get(url)',
      '}',
    ].join('\n');
    expect(parse(URI3, code).symbols.find(s => s.name === 'Api')!.supertypes).toBeUndefined();
  });

  it('les formes deja couvertes ne bougent pas', () => {
    const base = (fin: string[]) => ['package p', '', 'class Foo(', '    val a: Int', ...fin, '    fun m() {}', '}'].join('\n');
    expect(parse(URI3, base([') : Bar() {'])).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar']);
    expect(parse(URI3, base([')', '    : Bar() {'])).symbols.find(s => s.name === 'Foo')!.supertypes).toEqual(['Bar']);
    expect(parse(URI3, base([') {'])).symbols.find(s => s.name === 'Foo')!.supertypes).toBeUndefined();
  });
});
