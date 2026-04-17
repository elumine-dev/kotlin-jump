package com.example.data

/**
 * Lightweight in-memory repository with no external dependencies.
 *
 * All data lives in a simple [MutableMap] and is lost on process death.
 * Ideal for Compose Previews, sample data, and rapid prototyping where
 * persistence and network latency are irrelevant.
 */
class InMemoryPokemonRepository : PokemonRepository {

    private val store = mutableMapOf<Int, Pokemon>()

    override suspend fun catch(id: Int): Pokemon {
        val pokemon = Pokemon(id, "Pokemon #$id", PokemonType.PSYCHIC, level = id % 100, hp = 45)
        store[id] = pokemon
        return pokemon
    }

    override suspend fun release(pokemon: Pokemon) {
        store.remove(pokemon.id)
    }

    override fun getPokedex(): Pokedex = store.values.toList()

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult = when {
        attacker.hp > defender.hp -> BattleResult.Victory(attacker)
        attacker.hp < defender.hp -> BattleResult.Defeat(attacker)
        else -> BattleResult.Draw
    }
}
