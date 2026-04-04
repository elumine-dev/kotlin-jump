import { describe, it, expect, beforeEach } from 'vitest';

import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

function addFile(index: SymbolIndex, uri: string, code: string) {
  const parsed = parse(uri, code);
  index.add(parsed);
}

// ── Demo project files ──────────────────────────────────────────────────────

const POKEMON_KT = `package com.example.data

data class Pokemon(
    val id: Int,
    val name: String,
    val type: PokemonType,
    val level: Int,
    val hp: Int,
)

enum class PokemonType {
    FIRE,
    WATER,
    GRASS,
    ELECTRIC,
    PSYCHIC,
    DRAGON,
}

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}

typealias Pokedex = List<Pokemon>`;

const POKEMON_REPO_KT = `package com.example.data

interface PokemonRepository {
    suspend fun catch(id: Int): Pokemon
    suspend fun release(pokemon: Pokemon)
    fun getPokedex(): Pokedex
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}`;

const POKEMON_REPO_IMPL_KT = `package com.example.data

class PokemonRepositoryImpl(
    private val api: PokeApiService,
    private val storage: PokemonStorage,
) : PokemonRepository {

    override suspend fun catch(id: Int): Pokemon {
        return api.fetchPokemon(id)
    }

    override suspend fun release(pokemon: Pokemon) {
        storage.remove(pokemon.id)
    }

    override fun getPokedex(): Pokedex {
        return storage.getAll()
    }

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return BattleResult.Draw
    }
}`;

const POKE_API_KT = `package com.example.data

interface PokeApiService {
    suspend fun fetchPokemon(id: Int): Pokemon
    suspend fun searchByType(type: PokemonType): List<Pokemon>
}

class PokeApiServiceImpl(private val baseUrl: String) : PokeApiService {

    override suspend fun fetchPokemon(id: Int): Pokemon {
        return Pokemon(id, "Pikachu", PokemonType.ELECTRIC, level = 25, hp = 100)
    }

    override suspend fun searchByType(type: PokemonType): List<Pokemon> {
        return emptyList()
    }
}`;

const VIEWMODEL_KT = `package com.example.ui

import com.example.data.BattleResult
import com.example.data.Pokemon
import com.example.data.PokemonRepository

class PokedexViewModel(
    private val repository: PokemonRepository,
) {
    suspend fun catchPokemon(id: Int): Pokemon {
        return repository.catch(id)
    }

    fun startBattle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return repository.battle(attacker, defender)
    }

    fun getPokedex() = repository.getPokedex()
}`;

const APP_KT = `package com.example.app

import com.example.data.PokeApiServiceImpl
import com.example.data.PokemonRepositoryImpl
import com.example.data.PokemonStorage

fun main() {
    val api = PokeApiServiceImpl("https://pokeapi.co/api/v2")
    val storage = PokemonStorage()
    val repository = PokemonRepositoryImpl(api, storage)
}`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SymbolIndex — Go to Definition', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', POKEMON_REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', POKEMON_REPO_IMPL_KT);
    addFile(index, 'file:///data/PokeApiService.kt', POKE_API_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    addFile(index, 'file:///app/App.kt', APP_KT);
  });

  // Cases 1-3: Go to Definition from usage
  it('1. lookup PokemonRepositoryImpl → finds it', () => {
    const results = index.lookup('PokemonRepositoryImpl');
    expect(results).toHaveLength(1);
    expect(results[0].uri.toString()).toBe('file:///data/PokemonRepositoryImpl.kt');
  });

  it('2. lookup PokemonStorage → finds it', () => {
    addFile(index, 'file:///data/PokemonStorage.kt', 'package com.example.data\n\nclass PokemonStorage {\n  fun save(pokemon: Pokemon) {}\n}');
    const results = index.lookup('PokemonStorage');
    expect(results.length).toBeGreaterThan(0);
  });

  it('3. lookup PokemonRepository → finds interface', () => {
    const results = index.lookup('PokemonRepository');
    const iface = results.find(r => r.kind === 'interface');
    expect(iface).toBeDefined();
    expect(iface!.uri.toString()).toBe('file:///data/PokemonRepository.kt');
  });

  // FQN lookup
  it('lookupFqn resolves fully qualified name', () => {
    const entry = index.lookupFqn('com.example.data.Pokemon');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('dataClass');
  });
});

describe('SymbolIndex — Go to Implementation', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', POKEMON_REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', POKEMON_REPO_IMPL_KT);
    addFile(index, 'file:///data/PokeApiService.kt', POKE_API_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
  });

  // Case 4: interface → implementing class
  it('4. PokemonRepository → PokemonRepositoryImpl', () => {
    const impls = index.lookupImplementations('PokemonRepository');
    expect(impls).toHaveLength(1);
    expect(impls[0].name).toBe('PokemonRepositoryImpl');
  });

  // Case 6: PokeApiService → PokeApiServiceImpl
  it('6. PokeApiService → PokeApiServiceImpl', () => {
    const impls = index.lookupImplementations('PokeApiService');
    expect(impls).toHaveLength(1);
    expect(impls[0].name).toBe('PokeApiServiceImpl');
  });

  // Case 5: interface method → override
  it('5. battle method → override in PokemonRepositoryImpl', () => {
    // Find the interface's battle method line
    const repoSymbols = index.getFileSymbols('file:///data/PokemonRepository.kt');
    const battleMethod = repoSymbols.find(s => s.name === 'battle');
    expect(battleMethod).toBeDefined();

    const overrides = index.lookupMethodImplementations(
      'battle',
      'file:///data/PokemonRepository.kt',
      battleMethod!.line,
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].uri.toString()).toBe('file:///data/PokemonRepositoryImpl.kt');
  });

  it('fetchPokemon method → override in PokeApiServiceImpl', () => {
    const apiSymbols = index.getFileSymbols('file:///data/PokeApiService.kt');
    const method = apiSymbols.find(s => s.name === 'fetchPokemon' && s.kind === 'fun');
    expect(method).toBeDefined();

    const overrides = index.lookupMethodImplementations(
      'fetchPokemon',
      'file:///data/PokeApiService.kt',
      method!.line,
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].uri.toString()).toBe('file:///data/PokeApiService.kt');
  });

  it('no implementations for concrete class', () => {
    const impls = index.lookupImplementations('PokemonRepositoryImpl');
    expect(impls).toHaveLength(0);
  });

  it('sealed class subtypes are implementations', () => {
    const impls = index.lookupImplementations('BattleResult');
    const names = impls.map(i => i.name);
    expect(names).toContain('Victory');
    expect(names).toContain('Defeat');
    expect(names).toContain('Draw');
  });
});

describe('SymbolIndex — search and filter', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', POKEMON_REPO_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    index.finalize();
  });

  // Case 13: @enum: filter
  it('13. filterByKind enum → PokemonType', () => {
    const enums = index.filterByKind(new Set(['enum']));
    const names = enums.map(e => e.name);
    expect(names).toContain('PokemonType');
  });

  it('fuzzy search "PR" matches PokemonRepository', () => {
    const results = index.search('PR');
    const names = results.map(r => r.name);
    expect(names).toContain('PokemonRepository');
  });
});

describe('SymbolIndex — allEntries() for composable/preview navigation', () => {
  it('returns all entries across multiple files', () => {
    const index = new SymbolIndex();
    addFile(index, 'file:///ui/MyScreen.kt', `
package com.example.ui
@Composable
fun MyScreen() {}
`);
    addFile(index, 'file:///ui/MyScreenPreview.kt', `
package com.example.ui
@Preview
@Composable
fun MyScreenPreview() {}
`);
    const all = index.allEntries();
    const names = all.map(e => e.name);
    expect(names).toContain('MyScreen');
    expect(names).toContain('MyScreenPreview');
  });

  it('allEntries() can be filtered for @Preview functions', () => {
    const index = new SymbolIndex();
    addFile(index, 'file:///ui/MyScreen.kt', `
package com.example.ui
@Composable
fun MyScreen() {}
@Preview
@Composable
fun MyScreenPreview() {}
@Preview
@Composable
fun MyScreenDarkPreview() {}
`);
    const previews = index.allEntries().filter(e => e.isPreview);
    const names = previews.map(e => e.name);
    expect(names).toContain('MyScreenPreview');
    expect(names).toContain('MyScreenDarkPreview');
    expect(names).not.toContain('MyScreen');
  });

  it('allEntries() can find preview candidates by name containment', () => {
    const index = new SymbolIndex();
    addFile(index, 'file:///ui/HomeScreen.kt', `
package com.example.ui
@Composable
fun HomeScreen() {}
`);
    addFile(index, 'file:///debug/HomeScreenPreview.kt', `
package com.example.debug
@Preview
@Composable
fun HomeScreenPreview() {}
@Preview
@Composable
fun HomeScreenDarkPreview() {}
`);
    const composableName = 'HomeScreen';
    const candidates = index.allEntries().filter(e => e.isPreview && e.name.includes(composableName));
    expect(candidates).toHaveLength(2);
    expect(candidates.map(e => e.name)).toContain('HomeScreenPreview');
    expect(candidates.map(e => e.name)).toContain('HomeScreenDarkPreview');
  });

  it('allEntries() can find composable from preview by name containment', () => {
    const index = new SymbolIndex();
    addFile(index, 'file:///ui/HomeScreen.kt', `
package com.example.ui
@Composable
fun HomeScreen() {}
`);
    addFile(index, 'file:///debug/HomeScreenPreview.kt', `
package com.example.debug
@Preview
@Composable
fun HomeScreenDarkPreview() {}
`);
    const previewName = 'HomeScreenDarkPreview';
    const candidates = index.allEntries().filter(e => e.isComposable && !e.isPreview && previewName.includes(e.name));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('HomeScreen');
  });
});

describe('SymbolIndex — remove and re-add', () => {
  it('removing a file clears its symbols from all maps', () => {
    const index = new SymbolIndex();
    addFile(index, 'file:///data/PokeApiService.kt', POKE_API_KT);

    expect(index.lookupImplementations('PokeApiService')).toHaveLength(1);

    const uri = { toString: () => 'file:///data/PokeApiService.kt', path: '/data/PokeApiService.kt', fsPath: '/data/PokeApiService.kt' } as any;
    index.remove(uri);

    expect(index.lookup('PokeApiService')).toHaveLength(0);
    expect(index.lookup('PokeApiServiceImpl')).toHaveLength(0);
    expect(index.lookupImplementations('PokeApiService')).toHaveLength(0);
  });
});

