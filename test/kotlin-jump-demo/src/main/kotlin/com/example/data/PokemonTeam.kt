package com.example.data

/**
 * A team of Pokemon. Max size defaults to 6 (standard Pokemon rules).
 * Throws [IllegalStateException] when adding to a full team.
 * Throws [IllegalArgumentException] when adding a duplicate ID.
 */
class PokemonTeam(val maxSize: Int = 6) {
    private val members = mutableListOf<Pokemon>()

    val size: Int get() = members.size
    val isEmpty: Boolean get() = members.isEmpty()
    val isFull: Boolean get() = members.size >= maxSize

    fun add(pokemon: Pokemon) {
        check(!isFull) { "Team is full (max $maxSize members)" }
        require(members.none { it.id == pokemon.id }) {
            "Pokemon with id ${pokemon.id} (${pokemon.name}) is already on the team"
        }
        members.add(pokemon)
    }

    fun remove(id: Int): Boolean = members.removeIf { it.id == id }

    fun contains(id: Int): Boolean = members.any { it.id == id }

    fun getAll(): List<Pokemon> = members.toList()

    fun strongest(): Pokemon? = members.maxByOrNull { it.level }

    fun weakest(): Pokemon? = members.minByOrNull { it.level }

    fun byType(type: PokemonType): List<Pokemon> = members.filter { it.type == type }
}
