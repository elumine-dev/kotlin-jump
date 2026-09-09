import { describe, it, expect } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

// Audit 55 : le compte « N implementations » ne lisait que les supertypes
// DIRECTS. Une classe qui implémente une interface à travers une classe
// intermédiaire n'était pas comptée : sur LaPresse, `BindableModule` affichait
// 2 implémentations là où 33 classes l'implémentent, toutes via
// `ModuleViewHolderBase`. 60 interfaces sur 394 étaient sous évaluées.

function indexDe(fichiers: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(fichiers)) index.add(parse(uri, code));
  index.finalize();
  return index;
}

describe('Implémentations à travers une classe intermédiaire', () => {
  const FICHIERS = {
    'file:///a55/Bindable.kt': 'package p\n\ninterface Bindable {\n    fun bind()\n}\n',
    'file:///a55/Base.kt': 'package p\n\nabstract class Base : Bindable {\n    override fun bind() {}\n}\n',
    'file:///a55/Concrete.kt': 'package p\n\nclass Concrete : Base() {\n    override fun bind() {}\n}\n',
    'file:///a55/Deeper.kt': 'package p\n\nclass Deeper : Concrete()\n',
  };

  it('les compte toutes, quel que soit le nombre de niveaux', () => {
    const index = indexDe(FICHIERS);
    const iface = index.lookup('Bindable').find(e => e.kind === 'interface')!;
    // Direct : Base seule. Avec la chaîne : Base, Concrete, Deeper.
    expect(index.lookupImplementations('Bindable').length).toBe(1);
    expect(index.lookupImplementationsDeep(iface).map(e => e.name).sort())
      .toEqual(['Base', 'Concrete', 'Deeper']);
  });

  it('les implémentations d\'une méthode suivent la même chaîne', () => {
    const index = indexDe(FICHIERS);
    const impls = index.lookupMethodImplementations('bind', 'file:///a55/Bindable.kt', 2);
    // Avant : la seule surcharge de Base. Concrete redéfinit bind() aussi.
    expect(impls.map(e => e.fqn).sort()).toEqual(['p.Base.bind', 'p.Concrete.bind']);
  });

  it('un homonyme d\'un autre package ne rentre pas dans la chaîne', () => {
    const index = indexDe({
      ...FICHIERS,
      'file:///a55/autre/Bindable.kt': 'package q\n\ninterface Bindable {\n    fun bind()\n}\n',
      'file:///a55/autre/AutreImpl.kt': 'package q\n\nclass AutreImpl : Bindable {\n    override fun bind() {}\n}\n',
    });
    const iface = index.lookup('Bindable').find(e => e.packageName === 'p')!;
    const noms = index.lookupImplementationsDeep(iface).map(e => e.name);
    expect(noms).not.toContain('AutreImpl');
    expect(noms.sort()).toEqual(['Base', 'Concrete', 'Deeper']);
  });

  it('un cycle de supertypes ne boucle pas', () => {
    const index = indexDe({
      'file:///a55/A.kt': 'package p\n\ninterface A : B\n',
      'file:///a55/B.kt': 'package p\n\ninterface B : A\n',
    });
    const a = index.lookup('A').find(e => e.kind === 'interface')!;
    const out = index.lookupImplementationsDeep(a);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.map(e => e.name)).toContain('B');
  });

  it('le plafond borne une hiérarchie pathologique', () => {
    const fichiers: Record<string, string> = {
      'file:///a55/Root.kt': 'package p\n\ninterface Root\n',
    };
    for (let i = 0; i < 30; i++) fichiers[`file:///a55/C${i}.kt`] = `package p\n\nclass C${i} : Root\n`;
    const index = indexDe(fichiers);
    const root = index.lookup('Root').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(root).length).toBe(30);
    expect(index.lookupImplementationsDeep(root, 10).length).toBe(10);
  });
});
