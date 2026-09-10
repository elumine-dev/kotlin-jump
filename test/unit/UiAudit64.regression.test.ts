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
