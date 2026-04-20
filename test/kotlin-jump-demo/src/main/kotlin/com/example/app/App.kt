package com.example.app

import com.example.data.ApiServiceImpl
import com.example.data.PokeApiServiceImpl
import com.example.data.Pokemon
import com.example.data.PokemonRepositoryImpl
import com.example.data.PokemonStorage
import com.example.data.PokemonType
import com.example.data.UserCache
import com.example.data.UserRepositoryImpl
import com.example.ui.PokedexScreen
import com.example.ui.PokedexViewModel
import com.example.ui.UserScreen
import com.example.ui.UserViewModel

fun main() {
    // ── Pokedex ────────────────────────────────────────────────────────────────
    val api        = PokeApiServiceImpl("https://pokeapi.co/api/v2")
    val storage    = PokemonStorage()
    val repository = PokemonRepositoryImpl(api, storage)
    val pokedex    = PokedexScreen(PokedexViewModel(repository))

    storage.save(Pokemon(25, "Pikachu",   PokemonType.ELECTRIC, level = 25, hp = 100))
    storage.save(Pokemon(6,  "Charizard", PokemonType.FIRE,     level = 50, hp = 200))
    storage.save(Pokemon(9,  "Blastoise", PokemonType.WATER,    level = 48, hp = 190))

    // ── Users ──────────────────────────────────────────────────────────────────
    val userApi  = ApiServiceImpl("https://example.com/api")
    val userRepo = UserRepositoryImpl(userApi, UserCache())
    val users    = UserScreen(UserViewModel(userRepo))

    // ── Navigate ───────────────────────────────────────────────────────────────
    val navigator = AppNavigator(pokedex, users)
    navigator.navigate(Screen.POKEDEX)
    navigator.navigate(Screen.USERS)

    // Demo a battle after the tour
    val result = PokedexViewModel(repository).startBattle(
        attacker = storage.getAll().first(),
        defender = storage.getAll().last(),
    )
    pokedex.showBattleResult(result)
}
