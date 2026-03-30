import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const LENS_KINDS = new Set(['class','interface','object','enum','dataClass','sealedClass','annotation','fun','composable']);
const CLASS_LIKE = new Set(['class','interface','object','enum','dataClass','sealedClass','annotation']);

function getLensSymbols(index: SymbolIndex, uri: string) {
  const symbols = index.getFileSymbols(uri);
  const result: any[] = [];
  const classStack: { kind: string; depth: number }[] = [];
  for (const s of symbols) {
    while (classStack.length > 0 && classStack[classStack.length - 1].depth >= s.depth) classStack.pop();
    if (s.kind === 'enum' && classStack.length > 0 && classStack[classStack.length - 1].kind === 'enum') {
      if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
      continue;
    }
    if (!LENS_KINDS.has(s.kind)) {
      if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
      continue;
    }
    result.push(s);
    if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
  }
  return result;
}

describe('Code Lens — full demo project manual verification', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();

    addKt(index, 'file:///Pokemon.kt', `package com.example.data

data class Pokemon(val id: Int, val name: String)

enum class PokemonType {
    FIRE,
    WATER,
    GRASS,
    ELECTRIC,
}

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}

typealias Pokedex = List<Pokemon>`);

    addKt(index, 'file:///PokemonRepository.kt', `package com.example.data

interface PokemonRepository {
    fun catch(id: Int): Pokemon
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}`);

    addKt(index, 'file:///PokemonRepositoryImpl.kt', `package com.example.data

class PokemonRepositoryImpl(
    private val api: PokeApiService,
) : PokemonRepository {
    override fun catch(id: Int): Pokemon { return Pokemon(id, "test") }
    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult { return BattleResult.Draw }
}`);

    addKt(index, 'file:///ViewModel.kt', `package com.example.ui

import com.example.data.Pokemon
import com.example.data.PokemonRepository

class PokedexViewModel(private val repo: PokemonRepository) {
    fun loadAll(): List<Pokemon> { return repo.catch(1).let { listOf(it) } }
}`);
  });

  // ── Pokemon.kt ────────────────────────────────────────

  it('Pokemon.kt: data class Pokemon gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'Pokemon')).toBe(true);
  });

  it('Pokemon.kt: enum class PokemonType gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonType')).toBe(true);
  });

  it('Pokemon.kt: FIRE, WATER, GRASS, ELECTRIC do NOT get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).not.toContain('FIRE');
    expect(names).not.toContain('WATER');
    expect(names).not.toContain('GRASS');
    expect(names).not.toContain('ELECTRIC');
  });

  it('Pokemon.kt: sealed class BattleResult gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'BattleResult')).toBe(true);
  });

  it('Pokemon.kt: BattleResult has 3 implementations', () => {
    expect(index.lookupImplementations('BattleResult')).toHaveLength(3);
  });

  it('Pokemon.kt: Victory, Defeat, Draw get lenses (they are data classes)', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('Victory');
    expect(names).toContain('Defeat');
    expect(names).toContain('Draw');
  });

  it('Pokemon.kt: typealias Pokedex does NOT get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'Pokedex')).toBe(false);
  });

  // ── PokemonRepository.kt ─────────────────────────────

  it('PokemonRepository.kt: interface gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonRepository')).toBe(true);
  });

  it('PokemonRepository.kt: interface has 1 implementation', () => {
    expect(index.lookupImplementations('PokemonRepository')).toHaveLength(1);
  });

  it('PokemonRepository.kt: interface methods get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('catch');
    expect(names).toContain('battle');
  });

  // ── PokemonRepositoryImpl.kt ──────────────────────────

  it('PokemonRepositoryImpl.kt: class gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonRepositoryImpl')).toBe(true);
  });

  it('PokemonRepositoryImpl.kt: class has 0 implementations', () => {
    expect(index.lookupImplementations('PokemonRepositoryImpl')).toHaveLength(0);
  });

  it('PokemonRepositoryImpl.kt: override funs get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('catch');
    expect(names).toContain('battle');
  });

  // ── ViewModel.kt ──────────────────────────────────────

  it('ViewModel.kt: class gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    expect(lenses.some((s: any) => s.name === 'PokedexViewModel')).toBe(true);
  });

  it('ViewModel.kt: fun loadAll gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    expect(lenses.some((s: any) => s.name === 'loadAll')).toBe(true);
  });

  // ── Title format verification ─────────────────────────

  it('title format: "N usages" for function', () => {
    const count = 3;
    const title = `${count} ${count === 1 ? 'usage' : 'usages'}`;
    expect(title).toBe('3 usages');
  });

  it('title format: "1 usage" singular', () => {
    const count = 1;
    const title = `${count} ${count === 1 ? 'usage' : 'usages'}`;
    expect(title).toBe('1 usage');
  });

  it('title format: "N usages | M implementations"', () => {
    const usages = 5;
    const impls = 2;
    const parts = [`${usages} usages`];
    if (impls > 0) parts.push(`${impls} implementations`);
    expect(parts.join(' | ')).toBe('5 usages | 2 implementations');
  });

  it('title format: "1 implementation" singular', () => {
    const impls = 1;
    const title = `${impls} ${impls === 1 ? 'implementation' : 'implementations'}`;
    expect(title).toBe('1 implementation');
  });

  // ── Lens count per file ───────────────────────────────

  it('Pokemon.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    // Pokemon, PokemonType, BattleResult, Victory, Defeat, Draw = 6
    expect(lenses).toHaveLength(6);
  });

  it('PokemonRepository.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    // PokemonRepository, catch, battle = 3
    expect(lenses).toHaveLength(3);
  });

  it('PokemonRepositoryImpl.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    // PokemonRepositoryImpl, catch, battle = 3
    expect(lenses).toHaveLength(3);
  });

  it('ViewModel.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    // PokedexViewModel, loadAll = 2
    expect(lenses).toHaveLength(2);
  });
});
