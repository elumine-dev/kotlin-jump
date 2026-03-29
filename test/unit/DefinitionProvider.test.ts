import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { Location } from './__mocks__/vscode';

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Demo project source ─────────────────────────────────────────────────────

const POKEMON_KT = `package com.example.data

data class Pokemon(val id: Int, val name: String)

enum class PokemonType { FIRE, WATER, GRASS }

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}`;

const REPO_KT = `package com.example.data

interface PokemonRepository {
    fun getPokedex(): List<Pokemon>
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}`;

const REPO_IMPL_KT = `package com.example.data

class PokemonRepositoryImpl(
    private val storage: PokemonStorage,
) : PokemonRepository {
    override fun getPokedex(): List<Pokemon> {
        return storage.getAll()
    }
    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return BattleResult.Draw
    }
}`;

const STORAGE_KT = `package com.example.data

class PokemonStorage {
    fun getAll(): List<Pokemon> = emptyList()
    fun save(pokemon: Pokemon) {}
}`;

const VIEWMODEL_KT = `package com.example.ui

import com.example.data.Pokemon
import com.example.data.PokemonRepository
import com.example.data.BattleResult

class PokedexViewModel(private val repository: PokemonRepository) {
    suspend fun catchPokemon(id: Int): Pokemon {
        return repository.getPokedex().first()
    }
    fun startBattle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return repository.battle(attacker, defender)
    }
}`;

const APP_KT = `package com.example.app

import com.example.data.PokemonRepositoryImpl
import com.example.data.PokemonStorage

fun main() {
    val storage = PokemonStorage()
    val repository = PokemonRepositoryImpl(storage)
}`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Go to Definition (Cmd+Click from usage)', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///data/PokemonStorage.kt', STORAGE_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    addFile(index, 'file:///app/App.kt', APP_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('1. App.kt → PokemonRepositoryImpl → jumps to definition', () => {
    const doc = mockDocument('file:///app/App.kt', APP_KT);
    const pos = positionOf(APP_KT, 'PokemonRepositoryImpl', 2); // usage, not import
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });

  it('2. App.kt → PokemonStorage → jumps to definition', () => {
    const doc = mockDocument('file:///app/App.kt', APP_KT);
    const pos = positionOf(APP_KT, 'PokemonStorage', 2); // usage, not import
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonStorage.kt')).toBe(true);
  });

  it('3. ViewModel → PokemonRepository → jumps to interface', () => {
    const doc = mockDocument('file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    const pos = positionOf(VIEWMODEL_KT, 'PokemonRepository', 2); // usage in constructor
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepository.kt')).toBe(true);
  });
});

describe('Go to Implementation (Cmd+Click on declaration)', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///data/PokemonStorage.kt', STORAGE_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('4. PokemonRepository interface → jumps to PokemonRepositoryImpl', () => {
    const doc = mockDocument('file:///data/PokemonRepository.kt', REPO_KT);
    const pos = positionOf(REPO_KT, 'PokemonRepository');
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });

  it('5. battle() method in interface → jumps to override', () => {
    const doc = mockDocument('file:///data/PokemonRepository.kt', REPO_KT);
    const pos = positionOf(REPO_KT, 'battle');
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });
});

describe('Cmd+Click on declaration with no implementation', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('7. Pokemon data class → returns self (pending nav set for Find Usages)', () => {
    const doc = mockDocument('file:///data/Pokemon.kt', POKEMON_KT);
    const pos = positionOf(POKEMON_KT, 'Pokemon');
    const result = provider.provideDefinition(doc, pos) as Location;
    // Returns self location (pending nav handles Find Usages on actual click)
    expect(result).toBeDefined();
    expect(result.uri.toString()).toBe('file:///data/Pokemon.kt');
  });

  it('8. Victory in BattleResult → returns self', () => {
    const doc = mockDocument('file:///data/Pokemon.kt', POKEMON_KT);
    const pos = positionOf(POKEMON_KT, 'Victory');
    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
  });

  it('9. catchPokemon → returns self', () => {
    const doc = mockDocument('file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    const pos = positionOf(VIEWMODEL_KT, 'catchPokemon');
    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
  });
});

describe('Edge cases', () => {
  it('returns null for single-char words', () => {
    const index = new SymbolIndex();
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///test.kt', 'val x = 1');
    const result = provider.provideDefinition(doc, positionOf('val x = 1', 'x'));
    expect(result).toBeNull();
  });

  it('returns null for unknown symbols', () => {
    const index = new SymbolIndex();
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///test.kt', 'val foo = UnknownClass()');
    const result = provider.provideDefinition(doc, positionOf('val foo = UnknownClass()', 'UnknownClass'));
    expect(result).toBeNull();
  });
});
