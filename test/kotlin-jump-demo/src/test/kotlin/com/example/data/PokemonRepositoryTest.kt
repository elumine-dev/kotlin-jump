package com.example.data

import org.junit.Before
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue

@RunWith(JUnit4::class)
class PokemonRepositoryTest {

    private lateinit var storage: PokemonStorage

    @Before
    fun setUp() {
        storage = PokemonStorage()
    }

    @Test
    fun testCatchPokemon_savesToStorage() {
        val pikachu = Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 25, hp = 100)
        storage.save(pikachu)
        assertEquals(1, storage.count())
    }

    @Test
    fun testFindPokemon_returnsCorrectPokemon() {
        val charmander = Pokemon(4, "Charmander", PokemonType.FIRE, level = 10, hp = 50)
        storage.save(charmander)
        val found = storage.findById(4)
        assertNotNull(found)
        assertEquals("Charmander", found?.name)
    }

    @Test
    fun testBattle_fireBeatsGrass() {
        val charizard = Pokemon(6, "Charizard", PokemonType.FIRE, level = 50, hp = 200)
        val venusaur  = Pokemon(3, "Venusaur",  PokemonType.GRASS, level = 45, hp = 180)
        // Type advantage: FIRE > GRASS
        assertTrue(charizard.type.isStrongAgainst(venusaur.type))
    }

    @Test
    fun testStorage_clearRemovesAll() {
        storage.save(Pokemon(1, "Bulbasaur", PokemonType.GRASS, level = 5, hp = 45))
        storage.save(Pokemon(4, "Charmander", PokemonType.FIRE, level = 5, hp = 39))
        storage.clear()
        assertEquals(0, storage.count())
    }

    @Test
    @Ignore("Not yet implemented — API integration pending")
    fun testEvolvePokemon_evolveToNextStage() {
        // TODO: implement evolution logic
    }
}
