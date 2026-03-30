import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Helper: build the full hierarchy tree (supertypes + self + subtypes) ────

interface HierarchyNode {
  name: string;
  kind: string;
  section: 'supertype' | 'current' | 'subtype';
  children: HierarchyNode[];
}

function buildFullHierarchy(index: SymbolIndex, name: string): { supertypes: HierarchyNode[]; current: HierarchyNode | null; subtypes: HierarchyNode[] } {
  const entries = index.lookup(name).filter(e =>
    ['class','interface','object','enum','dataClass','sealedClass','annotation'].includes(e.kind)
  );
  if (entries.length === 0) return { supertypes: [], current: null, subtypes: [] };

  const entry = entries[0];

  // Build supertypes (recursive upward)
  function buildSupertypes(e: typeof entry): HierarchyNode[] {
    if (!e.supertypes) return [];
    return e.supertypes.flatMap(st => {
      const matches = index.lookup(st).filter(m =>
        ['class','interface','object','enum','dataClass','sealedClass','annotation'].includes(m.kind)
      );
      return matches.map(m => ({
        name: m.name,
        kind: m.kind,
        section: 'supertype' as const,
        children: buildSupertypes(m),
      }));
    });
  }

  // Build subtypes (recursive downward)
  function buildSubtypes(parentName: string): HierarchyNode[] {
    return index.lookupImplementations(parentName).map(sub => ({
      name: sub.name,
      kind: sub.kind,
      section: 'subtype' as const,
      children: buildSubtypes(sub.name),
    }));
  }

  return {
    supertypes: buildSupertypes(entry),
    current: { name: entry.name, kind: entry.kind, section: 'current', children: [] },
    subtypes: buildSubtypes(entry.name),
  };
}

// ── Test data ───────────────────────────────────────────────────────────────

const HIERARCHY = `package com.example

interface Serializable

interface Repository : Serializable {
    fun save()
}

abstract class BaseRepository : Repository {
    override fun save() {}
}

class UserRepository : BaseRepository() {
    override fun save() {}
}

class AdminRepository : BaseRepository() {
    override fun save() {}
}`;

const SEALED = `package com.example

sealed class State {
    data object Loading : State()
    data class Success(val data: String) : State()
    data class Error(val msg: String) : State()
}`;

const DIAMOND = `package com.example

interface A
interface B : A
interface C : A
class D : B, C`;

// ── Tests: full hierarchy tree ──────────────────────────────────────────────

describe('Full Hierarchy — tree structure', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///hierarchy.kt', HIERARCHY);
  });

  it('UserRepository full hierarchy: supertypes + current + subtypes', () => {
    const tree = buildFullHierarchy(index, 'UserRepository');
    expect(tree.current!.name).toBe('UserRepository');
    expect(tree.current!.section).toBe('current');
    expect(tree.subtypes).toHaveLength(0); // leaf class
    expect(tree.supertypes).toHaveLength(1); // BaseRepository
    expect(tree.supertypes[0].name).toBe('BaseRepository');
  });

  it('BaseRepository: supertypes = Repository, subtypes = User + Admin', () => {
    const tree = buildFullHierarchy(index, 'BaseRepository');
    expect(tree.supertypes).toHaveLength(1);
    expect(tree.supertypes[0].name).toBe('Repository');
    expect(tree.subtypes).toHaveLength(2);
    const subNames = tree.subtypes.map(s => s.name).sort();
    expect(subNames).toEqual(['AdminRepository', 'UserRepository']);
  });

  it('Repository: supertypes = Serializable, subtypes = BaseRepository', () => {
    const tree = buildFullHierarchy(index, 'Repository');
    expect(tree.supertypes).toHaveLength(1);
    expect(tree.supertypes[0].name).toBe('Serializable');
    expect(tree.subtypes).toHaveLength(1);
    expect(tree.subtypes[0].name).toBe('BaseRepository');
  });

  it('Serializable: root of hierarchy (no supertypes)', () => {
    const tree = buildFullHierarchy(index, 'Serializable');
    expect(tree.supertypes).toHaveLength(0);
    expect(tree.subtypes).toHaveLength(1);
    expect(tree.subtypes[0].name).toBe('Repository');
  });

  it('recursive: Repository subtypes have their own subtypes', () => {
    const tree = buildFullHierarchy(index, 'Repository');
    expect(tree.subtypes[0].name).toBe('BaseRepository');
    expect(tree.subtypes[0].children).toHaveLength(2);
    const leafNames = tree.subtypes[0].children.map(c => c.name).sort();
    expect(leafNames).toEqual(['AdminRepository', 'UserRepository']);
  });

  it('recursive supertypes: UserRepository → BaseRepository → Repository → Serializable', () => {
    const tree = buildFullHierarchy(index, 'UserRepository');
    expect(tree.supertypes[0].name).toBe('BaseRepository');
    expect(tree.supertypes[0].children).toHaveLength(1);
    expect(tree.supertypes[0].children[0].name).toBe('Repository');
    expect(tree.supertypes[0].children[0].children).toHaveLength(1);
    expect(tree.supertypes[0].children[0].children[0].name).toBe('Serializable');
  });
});

describe('Full Hierarchy — sealed class', () => {
  it('sealed class shows all subtypes as complete set', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///State.kt', SEALED);
    const tree = buildFullHierarchy(index, 'State');
    expect(tree.subtypes).toHaveLength(3);
    const names = tree.subtypes.map(s => s.name).sort();
    expect(names).toEqual(['Error', 'Loading', 'Success']);
    expect(tree.supertypes).toHaveLength(0);
  });
});

describe('Full Hierarchy — diamond inheritance', () => {
  it('D has 2 supertypes: B and C', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Diamond.kt', DIAMOND);
    const tree = buildFullHierarchy(index, 'D');
    const superNames = tree.supertypes.map(s => s.name).sort();
    expect(superNames).toEqual(['B', 'C']);
  });

  it('A has 2 subtypes: B and C', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Diamond.kt', DIAMOND);
    const tree = buildFullHierarchy(index, 'A');
    const subNames = tree.subtypes.map(s => s.name).sort();
    expect(subNames).toEqual(['B', 'C']);
  });

  it('B subtypes: D', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Diamond.kt', DIAMOND);
    const tree = buildFullHierarchy(index, 'B');
    expect(tree.subtypes).toHaveLength(1);
    expect(tree.subtypes[0].name).toBe('D');
  });
});

describe('Full Hierarchy — edge cases', () => {
  it('standalone class with no hierarchy', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Lone.kt', 'package com.example\nclass LoneClass');
    const tree = buildFullHierarchy(index, 'LoneClass');
    expect(tree.current!.name).toBe('LoneClass');
    expect(tree.supertypes).toHaveLength(0);
    expect(tree.subtypes).toHaveLength(0);
  });

  it('unknown symbol returns null current', () => {
    const index = new SymbolIndex();
    const tree = buildFullHierarchy(index, 'NonExistent');
    expect(tree.current).toBeNull();
  });
});
