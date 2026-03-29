package com.example.data

class PokemonRepositoryImpl(
    private val api: PokeApiService,
    private val storage: PokemonStorage,
) : PokemonRepository {

    override suspend fun catch(id: Int): Pokemon {
        val pokemon = api.fetchPokemon(id)
        storage.save(pokemon)
        return pokemon
    }

    override suspend fun release(pokemon: Pokemon) {
        storage.remove(pokemon.id)
    }

    override fun getPokedex(): Pokedex {
        return storage.getAll()
    }

    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        val damage = calculateDamage(attacker, defender)
        return when {
            damage > defender.hp -> BattleResult.Victory(attacker)
            damage < attacker.hp -> BattleResult.Defeat(attacker)
            else -> BattleResult.Draw
        }
    }

    private fun calculateDamage(attacker: Pokemon, defender: Pokemon): Int {
        val typeBonus = if (isEffective(attacker.type, defender.type)) 2 else 1
        return attacker.level * typeBonus
    }

    private fun isEffective(attack: PokemonType, defense: PokemonType): Boolean = when (attack) {
        PokemonType.FIRE -> defense == PokemonType.GRASS
        PokemonType.WATER -> defense == PokemonType.FIRE
        PokemonType.GRASS -> defense == PokemonType.WATER
        PokemonType.ELECTRIC -> defense == PokemonType.WATER
        else -> false
    }
}
