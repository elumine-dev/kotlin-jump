@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.demo

import com.example.app.R
import com.example.data.Pokemon
import com.example.data.PokemonType

// ─────────────────────────────────────────────────────────────────────────────
// DEMO: Inlay Hints — inferred types + parameter names
//
// To see the hints:
//   1. Cmd+Shift+P → "Developer: Reload Window"
//   2. Open this file
//   3. Grey hints appear automatically inline
// ─────────────────────────────────────────────────────────────────────────────

// ── Utility functions defined here (single definition = no ambiguity) ─────────

fun makePokemon(id: Int, name: String, type: PokemonType): Pokemon =
    Pokemon(id, name, type, level = 1, hp = 100)

fun getLevel(pokemon: Pokemon): Int = pokemon.level

fun isElectric(type: PokemonType): Boolean = type == PokemonType.ELECTRIC

fun greet(name: String, times: Int): String = "$name! ".repeat(times).trim()

fun demoInferredTypes() {
    val pikachu  = makePokemon(25, "Pikachu", PokemonType.ELECTRIC) // : Pokemon
    val lvl          = getLevel(pikachu) // : Int
    val electric = isElectric(PokemonType.ELECTRIC) // : Boolean
    val msg       = greet("Trainer", 3) // : String
}

fun demoParamNames() {
    //                           id:    name:             type:
    val p = makePokemon(1, "Bulbasaur", PokemonType.GRASS)

    //                           name:        times:
    val message = greet("Gary", 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO: String Resource Folding
//
// Each R.string.xxx below should display its actual value as an overlay.
// Move cursor onto a line → original code reappears.
// Move cursor away → value overlay is shown again.
// ─────────────────────────────────────────────────────────────────────────────

fun demoStringFolding() {
    // ── Titles & labels ───────────────────────────────────────────────────
    val screenTitle   = R.string.title_pokedex
    val teamTitle     = R.string.title_team
    val battleTitle   = R.string.title_battle
    val nameLabel     = R.string.label_pokemon_name
    val levelLabel    = R.string.label_pokemon_level
    val typeLabel     = R.string.label_pokemon_type
    val hpLabel       = R.string.label_pokemon_hp

    // ── Actions ───────────────────────────────────────────────────────────
    val addAction     = R.string.action_add_pokemon
    val battleAction  = R.string.action_start_battle
    val catchAction   = R.string.action_catch_pokemon
    val releaseAction = R.string.action_release_pokemon
    val cancelAction  = R.string.action_cancel
    val confirmAction = R.string.action_confirm
    val retryAction   = R.string.action_retry

    // ── Messages ──────────────────────────────────────────────────────────
    val loading       = R.string.msg_loading
    val emptyTeam     = R.string.msg_empty_team
    val battleWon     = R.string.msg_battle_won
    val battleLost    = R.string.msg_battle_lost
    val pokemonCaught = R.string.msg_pokemon_caught
    val invalidName   = R.string.msg_invalid_name
    val teamFull      = R.string.msg_team_full

    // ── Errors ────────────────────────────────────────────────────────────
    val networkError  = R.string.error_network
    val notFound      = R.string.error_not_found
    val unknownError  = R.string.error_unknown

    // ── Truncation (value > 40 chars → truncated with …) ─────────────────
    val disclaimer    = R.string.disclaimer_long

    // ── Unknown key (no decoration expected) ──────────────────────────────
    val missing       = R.string.key_does_not_exist

    // ── Multiple references on the same line ──────────────────────────────
    println("${R.string.action_confirm} / ${R.string.action_cancel}")
}
