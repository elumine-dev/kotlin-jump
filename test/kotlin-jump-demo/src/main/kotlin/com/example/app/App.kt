package com.example.app

import com.example.data.PokeApiServiceImpl
import com.example.data.PokemonRepositoryImpl
import com.example.data.PokemonStorage
import com.example.data.PokemonType
import com.example.data.Pokemon
import com.example.demo.PokemonSyncService
import com.example.ui.PokedexScreen
import com.example.ui.PokedexViewModel

fun main() {
    val api = PokeApiServiceImpl("https://pokeapi.co/api/v2")
    val storage = PokemonStorage()
    val repository = PokemonRepositoryImpl(api, storage)
    val viewModel = PokedexViewModel(repository)
    val screen = PokedexScreen(viewModel)

    // Pre-load some Pokemon
    storage.save(Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 25, hp = 100))
    storage.save(Pokemon(6, "Charizard", PokemonType.FIRE, level = 50, hp = 200))
    storage.save(Pokemon(9, "Blastoise", PokemonType.WATER, level = 48, hp = 190))

    PokemonSyncService().syncPokedex { count ->
        println("Synced $count Pokémon from server")
    }

    screen.render()

    // Battle!
    val result = viewModel.startBattle(
        attacker = storage.getAll().first(),
        defender = storage.getAll().last(),
    )
    screen.showBattleResult(result)
}
