package com.example.data

class PokemonStorage {
    private val captured = mutableMapOf<Int, Pokemon>()

    fun save(pokemon: Pokemon) {
        captured[pokemon.id] = pokemon
    }

    fun remove(id: Int) {
        captured.remove(id)
    }

    fun getAll(): List<Pokemon> = captured.values.toList()

    fun count(): Int = captured.size

    fun findById(id: Int): Pokemon? = captured[id]

    fun clear() = captured.clear()
}
