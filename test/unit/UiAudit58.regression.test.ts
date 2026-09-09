import { describe, it, expect } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// Audit 58 : `implementsExactly` ne regardait que les homonymes DECLARES dans
// l'espace de travail. Un `import android.view.View` ne contredisait donc rien,
// et l'interface `View` imbriquee du projet revendiquait toutes les classes qui
// etendent celle d'Android. Mesure sur LaPresse, 5088 fichiers indexes Java
// compris : 127 paires, dont 80 pour le seul nom `View`, 16 pour `Factory`,
// 12 pour `ViewHolder`.
//
// La regle de Kotlin est simple : un import explicite l'emporte sur tout le
// reste, y compris sur une declaration du meme package.

function indexDe(fichiers: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(fichiers)) index.add(parse(uri, code));
  index.finalize();
  return index;
}

describe('Un import explicite decide de ce qu\'un nom simple designe', () => {
  it('une interface imbriquee ne revendique pas les enfants d\'un type de framework', () => {
    const index = indexDe({
      'file:///a58/Contract.kt':
        'package p.nav\n\ninterface NavigatorContract {\n    interface View {\n        fun render()\n    }\n}\n',
      // Etend android.view.View, pas l'interface du contrat.
      'file:///a58/Custom.kt':
        'package p.widget\n\nimport android.view.View\n\nclass SizeWatchingView : View() {\n    fun mesure() {}\n}\n',
      // Celle-ci implemente vraiment le contrat.
      'file:///a58/Screen.kt':
        'package p.screen\n\nimport p.nav.NavigatorContract.View\n\nclass Screen : View {\n    override fun render() {}\n}\n',
    });
    const contrat = index.lookup('View').find(e => e.fqn === 'p.nav.NavigatorContract.View')!;
    expect(contrat).toBeDefined();
    expect(index.lookupImplementationsDeep(contrat).map(e => e.name)).toEqual(['Screen']);
  });

  it('un import explicite l\'emporte sur une declaration du meme package', () => {
    const index = indexDe({
      'file:///a58/Local.kt': 'package p\n\ninterface Handler {\n    fun handle()\n}\n',
      // Meme package que le Handler local, mais importe explicitement l'autre.
      'file:///a58/Impl.kt': 'package p\n\nimport android.os.Handler\n\nclass MonHandler : Handler()\n',
    });
    const local = index.lookup('Handler').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(local)).toEqual([]);
  });

  it('importer le parent lui-meme compte, meme avec un homonyme ailleurs', () => {
    const index = indexDe({
      'file:///a58/A.kt': 'package p.a\n\ninterface Repo {\n    fun get()\n}\n',
      'file:///a58/B.kt': 'package p.b\n\ninterface Repo {\n    fun get()\n}\n',
      'file:///a58/Impl.kt': 'package p.c\n\nimport p.a.Repo\n\nclass MonRepo : Repo {\n    override fun get() {}\n}\n',
    });
    const a = index.lookup('Repo').find(e => e.packageName === 'p.a')!;
    const b = index.lookup('Repo').find(e => e.packageName === 'p.b')!;
    expect(index.lookupImplementationsDeep(a).map(e => e.name)).toEqual(['MonRepo']);
    expect(index.lookupImplementationsDeep(b)).toEqual([]);
  });

  it('sans aucun import, le meme package continue de decider', () => {
    const index = indexDe({
      'file:///a58/A.kt': 'package p.a\n\ninterface Repo {\n    fun get()\n}\n',
      'file:///a58/Impl.kt': 'package p.a\n\nclass MonRepo : Repo {\n    override fun get() {}\n}\n',
    });
    const a = index.lookup('Repo').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(a).map(e => e.name)).toEqual(['MonRepo']);
  });

  it('un import etoile du package du parent suffit encore', () => {
    const index = indexDe({
      'file:///a58/A.kt': 'package p.a\n\ninterface Repo {\n    fun get()\n}\n',
      'file:///a58/Impl.kt': 'package p.z\n\nimport p.a.*\n\nclass MonRepo : Repo {\n    override fun get() {}\n}\n',
    });
    const a = index.lookup('Repo').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(a).map(e => e.name)).toEqual(['MonRepo']);
  });
});

describe('Un qualificateur est un espace de noms, pas un parent', () => {
  it('class Foo : RecyclerView.Adapter ne place pas Foo sous RecyclerView', () => {
    const index = indexDe({
      'file:///a58/Rv.kt': 'package p\n\nclass RecyclerView\n',
      'file:///a58/Ad.kt': 'package p\n\nclass MonAdapter : RecyclerView.Adapter()\n',
    });
    expect(index.lookupImplementations('RecyclerView')).toEqual([]);
    expect(index.lookupImplementations('Adapter').map(e => e.name)).toEqual(['MonAdapter']);
  });

  it('le qualificateur reste dans supertypes pour la detection de framework', () => {
    const syms = parse('file:///a58/Ad.kt', 'package p\n\nclass MonAdapter : RecyclerView.Adapter()\n').symbols;
    const ad = syms.find(s => s.name === 'MonAdapter')!;
    expect(ad.supertypes).toEqual(['RecyclerView', 'Adapter']);
    expect(ad.superQualifiers).toEqual(['RecyclerView']);
  });

  it('un nom cite comme parent ET comme qualificateur reste un parent', () => {
    const index = indexDe({
      'file:///a58/B.kt': 'package p\n\nopen class Bar\n',
      'file:///a58/F.kt': 'package p\n\nclass Foo : Bar(), Bar.Baz\n',
    });
    expect(index.lookupImplementations('Bar').map(e => e.name)).toEqual(['Foo']);
  });

  it('une classe ne devient pas sa propre descendante', () => {
    // Le cas Java qui faisait exploser le compte : une classe nommee ViewHolder
    // qui etend RecyclerView.ViewHolder se retrouvait sous son PROPRE nom.
    const index = indexDe({
      'file:///a58/Vh.kt': 'package p\n\nclass ViewHolder : RecyclerView.ViewHolder()\n',
      'file:///a58/Autre.kt': 'package p\n\nclass AutreVh : RecyclerView.ViewHolder()\n',
    });
    const vh = index.lookup('ViewHolder').find(e => e.kind === 'class')!;
    expect(index.lookupImplementationsDeep(vh)).toEqual([]);
  });
});
