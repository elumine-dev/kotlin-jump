package com.example.data

data class Pokemon(
    val id: Int,
    val name: String,
    val type: PokemonType,
    val level: Int,
    val hp: Int,
)

enum class  PokemonType {
    FIRE,
    WATER,
    GRASS,
    ELECTRIC,
    PSYCHIC,
    DRAGON;

    fun isStrongAgainst(other: PokemonType): Boolean = when (this) {
        FIRE    -> other == GRASS
        WATER   -> other == FIRE
        GRASS   -> other == WATER
        ELECTRIC -> other == WATER
        else    -> false
    }
}

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}

typealias Pokedex = List<Pokemon>
