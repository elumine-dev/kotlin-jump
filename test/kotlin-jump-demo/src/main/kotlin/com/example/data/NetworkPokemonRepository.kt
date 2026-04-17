package com.example.data

/**
 * Pure-remote implementation that always fetches from the network.
 *
 * No local persistence — every call hits the remote API.
 * Suitable for ephemeral sessions or server-side rendering where
 * storage is managed externally.
 *
 * @param api The remote API service to use for all requests
 */
class NetworkPokemonRepository(
    private val api: PokeApiService,
) : PokemonRepository {

    private val sessionPokedex = mutableListOf<Pokemon>()

    override suspend fun catch(id: Int): Pokemon {
        return api.fetchPokemon(id).also { sessionPokedex.add(it) }
    }

    override suspend fun release(pokemon: Pokemon) {
        sessionPokedex.removeAll { it.id == pokemon.id }
    }

    override fun getPokedex(): Pokedex = sessionPokedex.toList()

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        val winner = if (attacker.level >= defender.level) attacker else defender
        return if (winner == attacker) BattleResult.Victory(attacker) else BattleResult.Defeat(attacker)
    }
}
