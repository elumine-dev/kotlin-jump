package com.example.ui

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
}
