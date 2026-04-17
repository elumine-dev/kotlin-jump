package com.example.data

/**
 * Deterministic fake for use in unit and integration tests.
 *
 * Pre-seeded with a fixed Pokédex so tests never rely on network or
 * disk I/O. Battle outcomes are always [BattleResult.Victory] for
 * predictable assertions.
 *
 * Usage:
 * ```kotlin
 * val repo = FakePokemonRepository()
 * repo.addPokemon(fakePikachu)
 * viewModel = PokedexViewModel(repo)
 * ```
 */
class FakePokemonRepository : PokemonRepository {

    private val pokedex = mutableListOf<Pokemon>()
    var releaseCallCount = 0

    fun addPokemon(pokemon: Pokemon) {
        pokedex.add(pokemon)
    }

    override suspend fun catch(id: Int): Pokemon {
        return pokedex.firstOrNull { it.id == id }
            ?: Pokemon(id, "Unknown-$id", PokemonType.PSYCHIC, level = 1, hp = 10)
    }

    override suspend fun release(pokemon: Pokemon) {
        releaseCallCount++
        pokedex.removeAll { it.id == pokemon.id }
    }

    override fun getPokedex(): Pokedex = pokedex.toList()

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult =
        BattleResult.Victory(attacker)
}
