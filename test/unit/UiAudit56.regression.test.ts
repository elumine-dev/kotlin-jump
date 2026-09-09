import { describe, it, expect } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// Audit 56 : le parseur émettait bien un symbole synthétique pour
// `object : Interface`, mais seulement depuis deux endroits de la boucle. Toute
// ligne qui matchait une autre branche (`fun`, `class`, entrée d'enum) sortait
// par son propre `continue` avant l'appel, et toute ligne écartée par le
// préfiltre O(1) n'y arrivait jamais. Sur LaPresse : 79 des 276 objets anonymes
// n'étaient pas comptés, dont la forme Dagger
// `fun provideX(): X = object : X {` que Kevin a signalée sur AdProvider
// (1 annoncée, 3 réelles) et AudioRepository (3 annoncées, 5 réelles).

function anons(code: string) {
  return parse('file:///a56/T.kt', code).symbols.filter(s => s.name.startsWith('$anon$'));
}

describe('Objets anonymes comptés quelle que soit la ligne qui les porte', () => {
  it('forme Dagger : fun provideX(): X = object : X', () => {
    const code = [
      'interface AdProvider { fun load() }',
      'class MainActivityModule {',
      '    @Provides',
      '    fun provideEmptyAdProvider(): AdProvider = object : AdProvider {',
      '        override fun load() {}',
      '    }',
      '}',
    ].join('\n');
    const a = anons(code);
    expect(a.length).toBe(1);
    expect(a[0].supertypes).toContain('AdProvider');
    // La fonction reste indexée : l'objet anonyme ne la remplace pas.
    expect(parse('file:///a56/T.kt', code).symbols.some(s => s.name === 'provideEmptyAdProvider')).toBe(true);
  });

  it('argument d\'appel : addOnPreDrawListener(object : OnPreDrawListener {', () => {
    const code = [
      'class ViewExt {',
      '    fun attach(v: View) {',
      '        v.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {',
      '            override fun onPreDraw() = true',
      '        })',
      '    }',
      '}',
    ].join('\n');
    const a = anons(code);
    expect(a.length).toBe(1);
    expect(a[0].supertypes).toContain('OnPreDrawListener');
  });

  it('return object : Sink — la ligne commence par r, hors préfiltre', () => {
    const code = [
      'interface Sink { fun consume() }',
      'fun wrap(): Sink {',
      '    return object : Sink {',
      '        override fun consume() {}',
      '    }',
      '}',
    ].join('\n');
    expect(anons(code).map(s => s.supertypes?.[0])).toEqual(['Sink']);
  });

  it('appel chaîné : .setListener(object : AnimatorListenerAdapter() {', () => {
    const code = [
      'class Anim {',
      '    fun go(v: View) {',
      '        v.animate()',
      '            .setListener(object : AnimatorListenerAdapter() {',
      '                override fun onAnimationEnd(a: Animator) {}',
      '            })',
      '    }',
      '}',
    ].join('\n');
    expect(anons(code).map(s => s.supertypes?.[0])).toEqual(['AnimatorListenerAdapter']);
  });

  it('companion object : Factory reste un seul symbole Companion', () => {
    const code = [
      'interface Factory { fun create(): String }',
      'class Widget {',
      '    companion object : Factory {',
      '        override fun create() = "w"',
      '    }',
      '}',
    ].join('\n');
    const syms = parse('file:///a56/T.kt', code).symbols;
    expect(syms.filter(s => s.name.startsWith('$anon$'))).toEqual([]);
    const comp = syms.filter(s => s.name === 'Companion');
    expect(comp.length).toBe(1);
    expect(comp[0].supertypes).toContain('Factory');
  });

  it('object : X en commentaire de fin de ligne — pas compté', () => {
    const code = [
      'interface Fake { fun f() }',
      'class C {',
      '    fun go() = Unit // avant on écrivait object : Fake ici',
      '}',
    ].join('\n');
    expect(anons(code)).toEqual([]);
  });

  it('object : X dans un littéral de chaîne — pas compté', () => {
    const code = [
      'interface Fake { fun f() }',
      'class C {',
      '    val gabarit = "object : Fake { }"',
      '}',
    ].join('\n');
    expect(anons(code)).toEqual([]);
  });

  it('le compte d\'implémentations de l\'interface inclut l\'objet anonyme', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///a56/AdProvider.kt', 'package p\n\ninterface AdProvider {\n    fun load()\n}\n'));
    index.add(parse('file:///a56/Real.kt', 'package p\n\nclass RealAdProvider : AdProvider {\n    override fun load() {}\n}\n'));
    index.add(parse(
      'file:///a56/Module.kt',
      'package p\n\nclass DebugModule {\n    fun provideEmptyAdProvider(): AdProvider = object : AdProvider {\n        override fun load() {}\n    }\n}\n',
    ));
    index.finalize();
    const iface = index.lookup('AdProvider').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(iface).length).toBe(2);
  });
});
