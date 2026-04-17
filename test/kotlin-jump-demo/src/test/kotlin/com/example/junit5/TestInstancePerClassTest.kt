package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance

/**
 * @TestInstance(Lifecycle.PER_CLASS) — one instance shared across all test methods.
 * Allows @BeforeAll and @AfterAll without companion object or @JvmStatic.
 * The storage is populated once and reused by all tests.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@DisplayName("Shared Pokédex — storage populated once for all tests")
class TestInstancePerClassTest {

    private val storage = PokemonStorage()

    @BeforeAll  // No companion object needed — PER_CLASS shares the instance
    fun populatePokedex() {
        storage.save(Pokemon(1,  "Bulbasaur",  GRASS,    5,  45))
        storage.save(Pokemon(4,  "Charmander", FIRE,     5,  39))
        storage.save(Pokemon(7,  "Squirtle",   WATER,    5,  44))
        storage.save(Pokemon(25, "Pikachu",    ELECTRIC, 25, 100))
        storage.save(Pokemon(39, "Jigglypuff", PSYCHIC,  10,  55))
        storage.save(Pokemon(147,"Dratini",    DRAGON,    1,  41))
    }

    @AfterAll
    fun clearPokedex() {
        storage.clear()
    }

    @Test fun `pokedex has six entries`()           { assertEquals(6, storage.count()) }
    @Test fun `bulbasaur is in pokedex`()           { assertNotNull(storage.findById(1)) }
    @Test fun `charmander has fire type`()          { assertEquals(FIRE, storage.findById(4)?.type) }
    @Test fun `squirtle has water type`()           { assertEquals(WATER, storage.findById(7)?.type) }
    @Test fun `pikachu has electric type`()         { assertEquals(ELECTRIC, storage.findById(25)?.type) }
    @Test fun `jigglypuff has psychic type`()       { assertEquals(PSYCHIC, storage.findById(39)?.type) }
    @Test fun `dratini has dragon type`()           { assertEquals(DRAGON, storage.findById(147)?.type) }
    @Test fun `unknown id returns null`()           { assertNull(storage.findById(999)) }
    @Test fun `negative id returns null`()          { assertNull(storage.findById(-1)) }
    @Test fun `zero id returns null`()              { assertNull(storage.findById(0)) }

    @Test
    fun `all six pokemon types are represented in the pokedex`() {
        val types = storage.getAll().map { it.type }.toSet()
        assertEquals(6, types.size, "Expected one Pokemon per type but got: $types")
    }

    @Test
    fun `pokedex entries are retrievable by name`() {
        val names = storage.getAll().map { it.name }
        assertEquals(setOf("Bulbasaur", "Charmander", "Squirtle", "Pikachu", "Jigglypuff", "Dratini"), names.toSet())
    }
}
