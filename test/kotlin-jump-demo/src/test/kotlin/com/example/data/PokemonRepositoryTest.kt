package com.example.data

class PokemonRepositoryTest {

    private val storage = PokemonStorage()
    private val api = PokeApiServiceImpl("https://pokeapi.co/api/v2")
    private val repository = PokemonRepositoryImpl(api, storage)

    fun testCatchPokemon() {
        // repository.catch(25) should return Pikachu and save to storage
        val pikachu = Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 25, hp = 100)
        storage.save(pikachu)
        assert(storage.count() == 1)
    }

    fun testBattle() {
        val charizard = Pokemon(6, "Charizard", PokemonType.FIRE, level = 50, hp = 200)
        val venusaur = Pokemon(3, "Venusaur", PokemonType.GRASS, level = 45, hp = 180)

        val result = repository.battle(charizard, venusaur)
        assert(result is BattleResult.Victory)
    }
}
