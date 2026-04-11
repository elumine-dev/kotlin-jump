/**
 * Tests adversariaux pour TypeHierarchyProvider.
 *
 * Bugs couverts :
 *   TH-1 — subtypes : collision de noms entre packages → faux positifs
 *           `lookupImplementations("Handler")` retournait les implementors
 *           de TOUTES les classes nommées "Handler", peu importe le package.
 *
 *   TH-2 — supertypes : collision de noms → tous les matches montrés
 *           `lookup("Animal")` retournait toutes les classes nommées "Animal",
 *           pas seulement celle du bon package.
 *
 * Les deux bugs partagent la même cause : le parser stocke les supertypes
 * comme noms simples (pas des FQN). Fix : heuristique same-package quand
 * il y a collision.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinTypeHierarchyProvider } from '../../src/providers/TypeHierarchyProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { TypeHierarchyItem, Range, Position, Uri } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function makeItem(index: SymbolIndex, uri: string, name: string): TypeHierarchyItem {
  const sym = index.getFileSymbols(uri).find(s => s.name === name);
  if (!sym) throw new Error(`Symbol "${name}" not found in ${uri}`);
  const range = new Range(new Position(sym.line, sym.character), new Position(sym.line, sym.character + name.length));
  return new TypeHierarchyItem(0, name, '', sym.uri, range, range);
}

// ── TH-1 — subtypes : collision de noms entre packages ───────────────────────

describe('TH-1 — subtypes : collision de noms entre packages', () => {
  //
  // Deux classes "Handler" dans deux packages distincts.
  // Chaque package a sa propre sous-classe de Handler.
  // Les subtypes de com.a.Handler ne doivent PAS inclure
  // la sous-classe de com.b.Handler.
  //
  // AVANT fix : lookupImplementations("Handler") retournait [HandlerA, HandlerB]
  // APRÈS fix  : filtrage same-package → retourne [HandlerA] seulement

  const URI_A_BASE = 'file:///a/BaseHandler.kt';
  const URI_A_IMPL = 'file:///a/HandlerA.kt';
  const URI_B_BASE = 'file:///b/BaseHandler.kt';
  const URI_B_IMPL = 'file:///b/HandlerB.kt';

  let index: SymbolIndex;
  let provider: KotlinTypeHierarchyProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, URI_A_BASE, 'package com.a\nclass Handler');
    addKt(index, URI_A_IMPL, 'package com.a\nclass HandlerA : Handler()');
    addKt(index, URI_B_BASE, 'package com.b\nclass Handler');
    addKt(index, URI_B_IMPL, 'package com.b\nclass HandlerB : Handler()');
    provider = new KotlinTypeHierarchyProvider(index);
  });

  it('subtypes de com.a.Handler → seulement HandlerA (pas HandlerB)', () => {
    const item = makeItem(index, URI_A_BASE, 'Handler');
    const subs = provider.provideTypeHierarchySubtypes(item as any);
    const names = subs.map(s => s.name);

    expect(names).toContain('HandlerA');
    // BUG (avant fix) : names incluait aussi 'HandlerB'
    expect(names).not.toContain('HandlerB');
  });

  it('subtypes de com.b.Handler → seulement HandlerB (pas HandlerA)', () => {
    const item = makeItem(index, URI_B_BASE, 'Handler');
    const subs = provider.provideTypeHierarchySubtypes(item as any);
    const names = subs.map(s => s.name);

    expect(names).toContain('HandlerB');
    expect(names).not.toContain('HandlerA');
  });

  it('sans collision : tous les subtypes sont retournés', () => {
    // Quand un seul "Animal" existe, aucun filtrage ne doit s'appliquer
    const URI_ANIMAL = 'file:///animal/Animal.kt';
    const URI_DOG    = 'file:///animal/Dog.kt';
    const URI_CAT    = 'file:///animal/Cat.kt';
    const idx = new SymbolIndex();
    addKt(idx, URI_ANIMAL, 'package com.zoo\ninterface Animal');
    addKt(idx, URI_DOG, 'package com.zoo\nclass Dog : Animal');
    addKt(idx, URI_CAT, 'package com.zoo\nclass Cat : Animal');
    const p = new KotlinTypeHierarchyProvider(idx);

    const item = makeItem(idx, URI_ANIMAL, 'Animal');
    const subs = p.provideTypeHierarchySubtypes(item as any);
    const names = subs.map(s => s.name);

    expect(names).toContain('Dog');
    expect(names).toContain('Cat');
    expect(subs.length).toBe(2);
  });

  it('cross-package subtype inclus quand le package de l\'impl n\'a pas de classe du même nom', () => {
    // com.c.BridgeImpl extends Handler (mais com.c n'a pas de Handler local)
    // → doit être inclus comme subtype de com.a.Handler
    const URI_C_IMPL = 'file:///c/BridgeImpl.kt';
    addKt(index, URI_C_IMPL, 'package com.c\nclass BridgeImpl : com.a.Handler()');
    // Note: le parser capture "Handler" comme supertype (pas le FQN complet)
    // On re-crée l'index proprement
    const idx2 = new SymbolIndex();
    addKt(idx2, URI_A_BASE, 'package com.a\nclass Handler');
    addKt(idx2, URI_B_BASE, 'package com.b\nclass Handler');
    // com.c.BridgeImpl : supertypes = ["Handler"], packageName = "com.c"
    // com.c n'a PAS de classe Handler → doit passer le filtre cross-package
    addKt(idx2, URI_C_IMPL, 'package com.c\nclass BridgeImpl : Handler()');
    const p2 = new KotlinTypeHierarchyProvider(idx2);

    const itemA = makeItem(idx2, URI_A_BASE, 'Handler');
    const subs = p2.provideTypeHierarchySubtypes(itemA as any);
    const names = subs.map(s => s.name);

    // BridgeImpl est dans com.c (pas de Handler local) → inclus pour com.a.Handler
    expect(names).toContain('BridgeImpl');
  });
});

// ── TH-2 — supertypes : collision de noms entre packages ─────────────────────

describe('TH-2 — supertypes : collision de noms entre packages', () => {
  //
  // Deux packages ont chacun une classe "Animal".
  // Dog est dans com.a et extends Animal → doit montrer com.a.Animal seulement.
  //
  // AVANT fix : lookup("Animal") retournait les deux Animal
  // APRÈS fix  : préférence same-package → retourne com.a.Animal seulement

  const URI_A_ANIMAL = 'file:///a/Animal.kt';
  const URI_B_ANIMAL = 'file:///b/Animal.kt';
  const URI_DOG      = 'file:///a/Dog.kt';

  let index: SymbolIndex;
  let provider: KotlinTypeHierarchyProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, URI_A_ANIMAL, 'package com.a\ninterface Animal');
    addKt(index, URI_B_ANIMAL, 'package com.b\ninterface Animal');
    addKt(index, URI_DOG, 'package com.a\nclass Dog : Animal');
    provider = new KotlinTypeHierarchyProvider(index);
  });

  it('supertypes de com.a.Dog → seulement com.a.Animal (pas com.b.Animal)', () => {
    const item = makeItem(index, URI_DOG, 'Dog');
    const supers = provider.provideTypeHierarchySupertypes(item as any);
    const names = supers.map(s => s.name);

    // Doit montrer Animal, mais seulement 1 (le com.a.Animal same-package)
    expect(names).toContain('Animal');
    // BUG (avant fix) : supers.length === 2 (les deux Animal)
    expect(supers.length).toBe(1);

    // Vérifier que c'est le bon Animal (com.a.Animal, même package que Dog)
    expect(supers[0].detail).toContain('com.a');
  });

  it('sans collision : supertype unique affiché normalement', () => {
    const URI_SINGLE = 'file:///single/Base.kt';
    const URI_IMPL   = 'file:///single/Impl.kt';
    const idx = new SymbolIndex();
    addKt(idx, URI_SINGLE, 'package com.s\ninterface Base');
    addKt(idx, URI_IMPL, 'package com.s\nclass Impl : Base');
    const p = new KotlinTypeHierarchyProvider(idx);

    const item = makeItem(idx, URI_IMPL, 'Impl');
    const supers = p.provideTypeHierarchySupertypes(item as any);

    expect(supers.length).toBe(1);
    expect(supers[0].name).toBe('Base');
  });

  it('supertype cross-package inclus quand aucune collision dans le package courant', () => {
    // com.c.MyImpl extends Animal, mais com.c n'a pas de Animal local
    // → doit quand même trouver un supertype (retourne tous les Animal comme fallback)
    const URI_C_IMPL = 'file:///c/MyImpl.kt';
    const idx = new SymbolIndex();
    addKt(idx, URI_A_ANIMAL, 'package com.a\ninterface Animal');
    addKt(idx, URI_B_ANIMAL, 'package com.b\ninterface Animal');
    addKt(idx, URI_C_IMPL, 'package com.c\nclass MyImpl : Animal');
    const p = new KotlinTypeHierarchyProvider(idx);

    const item = makeItem(idx, URI_C_IMPL, 'MyImpl');
    const supers = p.provideTypeHierarchySupertypes(item as any);

    // com.c n'a pas de Animal : pas de préférence same-package → fallback → tous retournés
    expect(supers.length).toBe(2);
    expect(supers.map(s => s.name).every(n => n === 'Animal')).toBe(true);
  });
});
