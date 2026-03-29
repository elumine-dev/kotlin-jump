package com.example.ui

import com.example.data.BattleResult
import com.example.data.Pokemon
import com.example.data.PokemonType

class PokedexScreen(private val viewModel: PokedexViewModel) {

    fun render() {
        val pokedex = viewModel.getPokedex()

        println("=== Pokedex (${pokedex.size} Pokemon) ===")
        for (pokemon in pokedex) {
            displayCard(pokemon)
        }
    }

    private fun displayCard(pokemon: Pokemon) {
        val typeIcon = when (pokemon.type) {
            PokemonType.FIRE -> "🔥"
            PokemonType.WATER -> "💧"
            PokemonType.GRASS -> "🌿"
            PokemonType.ELECTRIC -> "⚡"
            PokemonType.PSYCHIC -> "🔮"
            PokemonType.DRAGON -> "🐉"
        }
        println("$typeIcon ${pokemon.name} (Lv.${pokemon.level})")
    }

    fun showBattleResult(result: BattleResult) {
        when (result) {
            is BattleResult.Victory -> println("${result.winner.name} wins!")
            is BattleResult.Defeat -> println("${result.loser.name} lost...")
            is BattleResult.Draw -> println("It's a draw!")
        }
    }
}
