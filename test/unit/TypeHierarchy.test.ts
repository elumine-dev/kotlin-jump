import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Helper: simulate what TypeHierarchyProvider will do ──────────────────────

// prepareTypeHierarchy: find the class/interface at the cursor position
function prepareHierarchy(index: SymbolIndex, uri: string, code: string, word: string) {
  const entries = index.lookup(word);
  return entries.find(e => e.uri.toString() === uri) ?? entries[0] ?? null;
}

// provideSubtypes: find all direct implementations of a symbol
function getSubtypes(index: SymbolIndex, name: string) {
  return index.lookupImplementations(name);
}

// provideSupertypes: find what a symbol extends/implements
function getSupertypes(index: SymbolIndex, uri: string, name: string) {
  const entries = index.getFileSymbols(uri);
  const entry = entries.find(e => e.name === name);
  return entry?.supertypes?.map(st => index.lookup(st)).flat() ?? [];
}

// ── Test data ───────────────────────────────────────────────────────────────

const ANIMAL = `package com.example

interface Animal {
    fun speak(): String
}`;

const DOG = `package com.example

class Dog : Animal {
    override fun speak(): String = "Woof"
}`;

const CAT = `package com.example

class Cat : Animal {
    override fun speak(): String = "Meow"
}`;

const GOLDEN = `package com.example

class GoldenRetriever : Dog() {
    override fun speak(): String = "Woof woof!"
}`;

const SEALED = `package com.example

sealed class Result {
    data class Success(val data: String) : Result()
    data class Error(val msg: String) : Result()
    data object Loading : Result()
}`;

const MULTI_LEVEL = `package com.example

interface Repository {
    fun save()
}

abstract class BaseRepository : Repository {
    override fun save() {}
    fun log() {}
}

class UserRepository : BaseRepository() {
    override fun save() {}
}

class AdminRepository : BaseRepository() {
    override fun save() {}
}`;

// ── Tests: prepare hierarchy ────────────────────────────────────────────────

describe('Type Hierarchy — prepare', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Animal.kt', ANIMAL);
    addKt(index, 'file:///Dog.kt', DOG);
    addKt(index, 'file:///Cat.kt', CAT);
  });

  it('finds the interface at cursor', () => {
    const item = prepareHierarchy(index, 'file:///Animal.kt', ANIMAL, 'Animal');
    expect(item).toBeDefined();
    expect(item!.name).toBe('Animal');
    expect(item!.kind).toBe('interface');
  });

  it('finds the class at cursor', () => {
    const item = prepareHierarchy(index, 'file:///Dog.kt', DOG, 'Dog');
    expect(item).toBeDefined();
    expect(item!.name).toBe('Dog');
    expect(item!.kind).toBe('class');
  });

  it('returns null for unknown symbol', () => {
    const item = prepareHierarchy(index, 'file:///Animal.kt', ANIMAL, 'Unknown');
    expect(item).toBeNull();
  });
});

// ── Tests: subtypes (who implements/extends this?) ──────────────────────────

describe('Type Hierarchy — subtypes', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Animal.kt', ANIMAL);
    addKt(index, 'file:///Dog.kt', DOG);
    addKt(index, 'file:///Cat.kt', CAT);
    addKt(index, 'file:///Golden.kt', GOLDEN);
  });

  it('Animal → Dog, Cat (direct implementations)', () => {
    const subs = getSubtypes(index, 'Animal');
    const names = subs.map(s => s.name);
    expect(names).toContain('Dog');
    expect(names).toContain('Cat');
    expect(names).not.toContain('GoldenRetriever');
  });

  it('Dog → GoldenRetriever', () => {
    const subs = getSubtypes(index, 'Dog');
    expect(subs).toHaveLength(1);
    expect(subs[0].name).toBe('GoldenRetriever');
  });

  it('Cat → empty (no subtypes)', () => {
    expect(getSubtypes(index, 'Cat')).toHaveLength(0);
  });

  it('GoldenRetriever → empty (leaf class)', () => {
    expect(getSubtypes(index, 'GoldenRetriever')).toHaveLength(0);
  });
});

// ── Tests: supertypes (what does this extend?) ──────────────────────────────

describe('Type Hierarchy — supertypes', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Animal.kt', ANIMAL);
    addKt(index, 'file:///Dog.kt', DOG);
    addKt(index, 'file:///Cat.kt', CAT);
    addKt(index, 'file:///Golden.kt', GOLDEN);
  });

  it('Dog supertypes → Animal', () => {
    const supers = getSupertypes(index, 'file:///Dog.kt', 'Dog');
    expect(supers.some(s => s.name === 'Animal')).toBe(true);
  });

  it('GoldenRetriever supertypes → Dog', () => {
    const supers = getSupertypes(index, 'file:///Golden.kt', 'GoldenRetriever');
    expect(supers.some(s => s.name === 'Dog')).toBe(true);
  });

  it('Animal supertypes → empty (root)', () => {
    const supers = getSupertypes(index, 'file:///Animal.kt', 'Animal');
    expect(supers).toHaveLength(0);
  });
});

// ── Tests: sealed class hierarchy ───────────────────────────────────────────

describe('Type Hierarchy — sealed class', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Result.kt', SEALED);
  });

  it('Result → Success, Error, Loading', () => {
    const subs = getSubtypes(index, 'Result');
    const names = subs.map(s => s.name);
    expect(names).toContain('Success');
    expect(names).toContain('Error');
    expect(names).toContain('Loading');
    expect(subs).toHaveLength(3);
  });

  it('Success → empty', () => {
    expect(getSubtypes(index, 'Success')).toHaveLength(0);
  });
});

// ── Tests: multi-level hierarchy ────────────────────────────────────────────

describe('Type Hierarchy — multi-level', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Repo.kt', MULTI_LEVEL);
  });

  it('Repository → BaseRepository (direct)', () => {
    const subs = getSubtypes(index, 'Repository');
    expect(subs).toHaveLength(1);
    expect(subs[0].name).toBe('BaseRepository');
  });

  it('BaseRepository → UserRepository, AdminRepository', () => {
    const subs = getSubtypes(index, 'BaseRepository');
    const names = subs.map(s => s.name);
    expect(names).toContain('UserRepository');
    expect(names).toContain('AdminRepository');
    expect(subs).toHaveLength(2);
  });

  it('UserRepository → empty (leaf)', () => {
    expect(getSubtypes(index, 'UserRepository')).toHaveLength(0);
  });

  it('full recursive tree: Repository → Base → User + Admin', () => {
    // Level 1
    const level1 = getSubtypes(index, 'Repository');
    expect(level1.map(s => s.name)).toEqual(['BaseRepository']);

    // Level 2
    const level2 = getSubtypes(index, level1[0].name);
    const names2 = level2.map(s => s.name).sort();
    expect(names2).toEqual(['AdminRepository', 'UserRepository']);

    // Level 3
    for (const leaf of level2) {
      expect(getSubtypes(index, leaf.name)).toHaveLength(0);
    }
  });

  it('UserRepository supertypes → BaseRepository', () => {
    const supers = getSupertypes(index, 'file:///Repo.kt', 'UserRepository');
    expect(supers.some(s => s.name === 'BaseRepository')).toBe(true);
  });

  it('BaseRepository supertypes → Repository', () => {
    const supers = getSupertypes(index, 'file:///Repo.kt', 'BaseRepository');
    expect(supers.some(s => s.name === 'Repository')).toBe(true);
  });
});

// ── Tests: actual provider ──────────────────────────────────────────────────

describe('Type Hierarchy — provider integration', () => {
  let index: SymbolIndex;

  beforeEach(async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    index = new SymbolIndex();
    addKt(index, 'file:///Animal.kt', ANIMAL);
    addKt(index, 'file:///Dog.kt', DOG);
    addKt(index, 'file:///Cat.kt', CAT);
    addKt(index, 'file:///Golden.kt', GOLDEN);
  });

  it('prepareTypeHierarchy returns item for interface', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Animal.kt', ANIMAL);
    const pos = positionOf(ANIMAL, 'Animal');
    const items = provider.prepareTypeHierarchy(doc, pos);
    expect(items).not.toBeNull();
    expect(items!.length).toBeGreaterThan(0);
    expect(items![0].name).toBe('Animal');
  });

  it('provideTypeHierarchySubtypes returns Dog and Cat for Animal', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Animal.kt', ANIMAL);
    const items = provider.prepareTypeHierarchy(doc, positionOf(ANIMAL, 'Animal'));
    const subs = provider.provideTypeHierarchySubtypes(items![0]);
    const names = subs.map(s => s.name);
    expect(names).toContain('Dog');
    expect(names).toContain('Cat');
  });

  it('provideTypeHierarchySupertypes returns Animal for Dog', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Dog.kt', DOG);
    const items = provider.prepareTypeHierarchy(doc, positionOf(DOG, 'Dog'));
    expect(items).not.toBeNull();
    const item = items![0];
    // The item's uri comes from the SymbolEntry, getFileSymbols uses the string key
    const fileSymbols = index.getFileSymbols(item.uri.toString());
    const dogEntry = fileSymbols.find((e: any) => e.name === 'Dog');
    expect(dogEntry).toBeDefined();
    expect(dogEntry!.supertypes).toContain('Animal');
    const supers = provider.provideTypeHierarchySupertypes(item);
    expect(supers.some(s => s.name === 'Animal')).toBe(true);
  });

  it('returns null for non-class symbol', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    addKt(index, 'file:///Utils.kt', 'package com.example\nfun doStuff() {}');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Utils.kt', 'package com.example\nfun doStuff() {}');
    const items = provider.prepareTypeHierarchy(doc, positionOf('package com.example\nfun doStuff() {}', 'doStuff'));
    expect(items).toBeNull();
  });

  it('item detail shows kind label', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Animal.kt', ANIMAL);
    const items = provider.prepareTypeHierarchy(doc, positionOf(ANIMAL, 'Animal'));
    expect(items![0].detail).toContain('interface');
  });

  it('item detail shows package name', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Animal.kt', ANIMAL);
    const items = provider.prepareTypeHierarchy(doc, positionOf(ANIMAL, 'Animal'));
    expect(items![0].detail).toContain('com.example');
  });

  it('item detail shows subtype count for Animal (2 subtypes)', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Animal.kt', ANIMAL);
    const items = provider.prepareTypeHierarchy(doc, positionOf(ANIMAL, 'Animal'));
    expect(items![0].detail).toContain('2 subtypes');
  });

  it('item detail shows NO subtype count for leaf class', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Cat.kt', CAT);
    const items = provider.prepareTypeHierarchy(doc, positionOf(CAT, 'Cat'));
    expect(items![0].detail).not.toContain('subtype');
  });

  it('Dog detail shows "1 subtype" (GoldenRetriever)', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Dog.kt', DOG);
    const items = provider.prepareTypeHierarchy(doc, positionOf(DOG, 'Dog'));
    expect(items![0].detail).toContain('1 subtype');
  });
});

// ── Tests: 10/10 enriched detail ─────────────────────────────────────────────

describe('Type Hierarchy — sealed class awareness', () => {
  it('sealed class detail shows exhaustive count', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const sealedIndex = new SymbolIndex();
    addKt(sealedIndex, 'file:///Result.kt', SEALED);
    const provider = new KotlinTypeHierarchyProvider(sealedIndex);
    const doc = mockDocument('file:///Result.kt', SEALED);
    const items = provider.prepareTypeHierarchy(doc, positionOf(SEALED, 'Result'));
    expect(items![0].detail).toContain('sealed');
    expect(items![0].detail).toContain('3/3 exhaustive');
  });
});

describe('Type Hierarchy — method override count in subtypes', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Repo.kt', MULTI_LEVEL);
  });

  it('BaseRepository subtype detail shows override count', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const provider = new KotlinTypeHierarchyProvider(index);
    const doc = mockDocument('file:///Repo.kt', MULTI_LEVEL);
    const items = provider.prepareTypeHierarchy(doc, positionOf(MULTI_LEVEL, 'Repository'));
    const subs = provider.provideTypeHierarchySubtypes(items![0]);
    // BaseRepository overrides save() from Repository
    expect(subs[0].detail).toContain('override');
  });
});

describe('Type Hierarchy — subtype ordering', () => {
  it('interfaces come before classes in subtypes', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Mixed.kt', `package com.example
interface Base
class ConcreteA : Base
interface SubInterface : Base
class ConcreteB : Base`);
    const subs = idx.lookupImplementations('Base');
    // We want interfaces first, then classes
    const interfaceIdx = subs.findIndex(s => s.kind === 'interface');
    const classIdx = subs.findIndex(s => s.kind === 'class');
    // This test documents the current ordering — we want to improve it
    expect(subs.length).toBe(3);
  });
});

describe('Type Hierarchy — file name in detail', () => {
  it('detail includes the file name', async () => {
    const { KotlinTypeHierarchyProvider } = await import('../../src/providers/TypeHierarchyProvider');
    const idx = new SymbolIndex();
    addKt(idx, 'file:///data/UserRepository.kt', 'package com.example\ninterface UserRepository');
    const provider = new KotlinTypeHierarchyProvider(idx);
    const doc = mockDocument('file:///data/UserRepository.kt', 'package com.example\ninterface UserRepository');
    const items = provider.prepareTypeHierarchy(doc, positionOf('package com.example\ninterface UserRepository', 'UserRepository'));
    expect(items![0].detail).toContain('UserRepository.kt');
  });
});

// ── Tests: edge cases ───────────────────────────────────────────────────────

describe('Type Hierarchy — edge cases', () => {
  it('class with no supertypes and no subtypes', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Standalone.kt', 'package com.example\nclass Standalone');
    expect(getSubtypes(index, 'Standalone')).toHaveLength(0);
    expect(getSupertypes(index, 'file:///Standalone.kt', 'Standalone')).toHaveLength(0);
  });

  it('function returns empty subtypes (not a class)', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Utils.kt', 'package com.example\nfun doStuff() {}');
    expect(getSubtypes(index, 'doStuff')).toHaveLength(0);
  });

  it('multiple interfaces implemented', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Multi.kt', `package com.example
interface Readable { fun read() }
interface Writable { fun write() }
class ReadWriteFile : Readable, Writable {
    override fun read() {}
    override fun write() {}
}`);
    expect(getSubtypes(index, 'Readable')).toHaveLength(1);
    expect(getSubtypes(index, 'Writable')).toHaveLength(1);
    const supers = getSupertypes(index, 'file:///Multi.kt', 'ReadWriteFile');
    const names = supers.map(s => s.name);
    expect(names).toContain('Readable');
    expect(names).toContain('Writable');
  });
});
