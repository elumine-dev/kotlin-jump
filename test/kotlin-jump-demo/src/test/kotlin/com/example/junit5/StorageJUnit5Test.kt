package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test

/**
 * JUnit 5 style with @BeforeEach / @AfterEach lifecycle.
 * Verifies lifecycle annotations are excluded from Test Explorer.
 * @Disabled test appears in tree but is skipped at runtime.
 */
class StorageJUnit5Test {

    private lateinit var storage: PokemonStorage

    @BeforeEach
    fun setUp() {
        storage = PokemonStorage()
    }

    @AfterEach
    fun tearDown() {
        storage.clear()
    }

    @Test
    fun `storage is empty on init`() {
        assertEquals(0, storage.count())
    }

    @Test
    fun `save increases count by one`() {
        storage.save(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        assertEquals(1, storage.count())
    }

    @Test
    fun `saving two different pokemon gives count of two`() {
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        storage.save(Pokemon(4, "Charmander", FIRE, 5, 39))
        assertEquals(2, storage.count())
    }

    @Test
    fun `findById returns null when absent`() {
        assertNull(storage.findById(99))
    }

    @Test
    fun `findById returns correct pokemon after save`() {
        storage.save(Pokemon(7, "Squirtle", WATER, 5, 44))
        val result = storage.findById(7)
        assertNotNull(result)
        assertEquals("Squirtle", result?.name)
    }

    @Test
    fun `clear resets count to zero`() {
        storage.save(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        storage.clear()
        assertEquals(0, storage.count())
    }

    @Test
    fun `saving same id overwrites existing entry`() {
        storage.save(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        storage.save(Pokemon(25, "Pikachu-Alola", ELECTRIC, 30, 120))
        assertEquals(1, storage.count())
        assertEquals("Pikachu-Alola", storage.findById(25)?.name)
    }

    @Disabled("Cache eviction policy not yet implemented")
    @Test
    fun `eviction removes oldest entry when capacity exceeded`() {
        // TODO: implement LRU cache eviction
    }
}
