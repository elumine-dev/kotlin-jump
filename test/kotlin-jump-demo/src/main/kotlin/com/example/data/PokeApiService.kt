package com.example.data

interface PokeApiService {
    suspend fun fetchPokemon(id: Int): Pokemon
    suspend fun searchByType(type: PokemonType): List<Pokemon>
}

class PokeApiServiceImpl(@Suppress("unused") private val baseUrl: String) : PokeApiService {

    override suspend fun fetchPokemon(id: Int): Pokemon {
        // GET $baseUrl/pokemon/$id
        return Pokemon(id, "Pikachu", PokemonType.ELECTRIC, level = 25, hp = 100)
    }

    override suspend fun searchByType(type: PokemonType): List<Pokemon> {
        // GET $baseUrl/pokemon?type=$type
        return emptyList()
    }
}
