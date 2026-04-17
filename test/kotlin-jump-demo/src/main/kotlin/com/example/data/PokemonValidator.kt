package com.example.data

/**
 * Validates Pokemon according to game rules.
 * - id must be > 0
 * - name must not be blank
 * - level must be in 1..100
 * - hp must be > 0
 *
 * Throws [IllegalArgumentException] for any violation.
 */
object PokemonValidator {
    fun validate(pokemon: Pokemon) {
        require(pokemon.id > 0)             { "Pokemon id must be positive, got ${pokemon.id}" }
        require(pokemon.name.isNotBlank())  { "Pokemon name must not be blank" }
        require(pokemon.level in 1..100)    { "Pokemon level must be 1–100, got ${pokemon.level}" }
        require(pokemon.hp > 0)             { "Pokemon HP must be positive, got ${pokemon.hp}" }
    }

    fun isValid(pokemon: Pokemon): Boolean = try { validate(pokemon); true }
    catch (_: IllegalArgumentException) { false }
}
