package com.example.data

/**
 * Fully offline implementation backed by local device storage only.
 *
 * Never makes a network call. Intended for offline-first features,
 * airplane mode support, or devices with metered connections.
 *
 * @param storage The persistent local storage to read/write Pokémon data
 */
class OfflinePokemonRepository(
    private val storage: PokemonStorage,
) : PokemonRepository {

    override suspend fun catch(id: Int): Pokemon {
        return storage.findById(id) ?: throw IllegalArgumentException("Pokemon #$id not found in local storage")
    }

    override suspend fun release(pokemon: Pokemon) {
        storage.remove(pokemon.id)
    }

    override fun getPokedex(): Pokedex = storage.getAll()

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        val attackerScore = attacker.level * attacker.hp
        val defenderScore = defender.level * defender.hp
        return when {
            attackerScore > defenderScore -> BattleResult.Victory(attacker)
            attackerScore < defenderScore -> BattleResult.Defeat(attacker)
            else -> BattleResult.Draw
        }
    }
}
