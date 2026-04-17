package com.example.ui

import com.example.app.R
import com.example.data.BattleResult
import com.example.data.Pokemon
import com.example.data.PokemonType

class PokedexScreen(private val viewModel: PokedexViewModel) {

    companion object {
        val SCREEN_TITLE  = R.string.title_pokedex
        val ACTION_ADD    = R.string.action_add_pokemon
        val ACTION_BATTLE = R.string.action_start_battle
    }

    fun render() {
        val pokedex = viewModel.getPokedex()

        println("=== ${R.string.title_pokedex} (${pokedex.size}) ===")
        if (pokedex.isEmpty()) {
            println(R.string.msg_empty_team)
            return
        }
        for (pokemon in pokedex) {
            displayCard(pokemon)
        }
    }

    private fun displayCard(pokemon: Pokemon) {
        val typeIcon = when (pokemon.type) {
            PokemonType.FIRE     -> "🔥"
            PokemonType.WATER    -> "💧"
            PokemonType.GRASS    -> "🌿"
            PokemonType.ELECTRIC -> "⚡"
            PokemonType.PSYCHIC  -> "🔮"
            PokemonType.DRAGON   -> "🐉"
        }
        val typeLabel = getTypeLabel(pokemon.type)
        println("$typeIcon ${pokemon.name}  [${R.string.label_pokemon_type}: $typeLabel]  ${R.string.label_pokemon_level}: ${pokemon.level}  ${R.string.label_pokemon_hp}: ${pokemon.hp}")
    }

    private fun getTypeLabel(type: PokemonType): Int = when (type) {
        PokemonType.FIRE     -> R.string.type_fire
        PokemonType.WATER    -> R.string.type_water
        PokemonType.GRASS    -> R.string.type_grass
        PokemonType.ELECTRIC -> R.string.type_electric
        PokemonType.PSYCHIC  -> R.string.type_psychic
        PokemonType.DRAGON   -> R.string.type_dragon
    }

    fun showBattleResult(result: BattleResult) {
        when (result) {
            is BattleResult.Victory -> println("${result.winner.name} — ${R.string.msg_battle_won}")
            is BattleResult.Defeat  -> println("${result.loser.name} — ${R.string.msg_battle_lost}")
            is BattleResult.Draw    -> println("${R.string.msg_battle_draw}")
        }
    }

    fun showError(isNetworkError: Boolean) {
        val messageRes = if (isNetworkError) R.string.error_network else R.string.error_unknown
        println("Error: $messageRes  (${R.string.action_retry})")
    }
}
