package com.example.backtick

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.Test

/**
 * BDD-style backtick-named tests.
 * Backtick names contain spaces: the extension's RE_GRADLE_RESULT uses lazy `.+?`
 * so "ClassName > given X when Y then Z PASSED" is parsed correctly.
 * In the XML the names appear without backticks.
 * The private function at the bottom must NOT appear in the Test Explorer.
 */
class BddStyleTest {

    private lateinit var storage: PokemonStorage

    @BeforeEach
    fun setup() {
        storage = PokemonStorage()
    }

    @AfterEach
    fun cleanup() {
        storage.clear()
    }

    @Test
    fun `given storage is empty when we count then result should be zero`() {
        assertEquals(0, storage.count())
    }

    @Test
    fun `given pikachu is saved when we find by id 25 then we get pikachu`() {
        storage.save(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        val found = storage.findById(25)
        assertNotNull(found)
        assertEquals("Pikachu", found?.name)
    }

    @Test
    fun `given two pokemon are saved when we clear then count should be zero`() {
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        storage.save(Pokemon(4, "Charmander", FIRE, 5, 39))
        storage.clear()
        assertEquals(0, storage.count())
    }

    @Test
    fun `given fire type when battling grass type then fire should win`() {
        assertTrue(FIRE.isStrongAgainst(GRASS))
    }

    @Test
    fun `given water type when battling fire type then water should win`() {
        assertTrue(WATER.isStrongAgainst(FIRE))
    }

    @Test
    fun `given electric type when battling water type then electric should win`() {
        assertTrue(ELECTRIC.isStrongAgainst(WATER))
    }

    @Test
    fun `given fire type when battling water type then fire should not win`() {
        assertFalse(FIRE.isStrongAgainst(WATER))
    }

    @Test
    fun `given pokemon with id 99 when searching empty storage then result is null`() {
        assertNull(storage.findById(99))
    }

    @Disabled("Battle simulation not yet implemented")
    @Test
    fun `given two pokemon of opposing types when they battle then strong type wins`() {
        // TODO: implement battle() method on Pokemon
    }

    @Test
    fun `regular style mixed with bdd tests - all six types exist`() {
        assertEquals(6, PokemonType.entries.size)
    }

    // Private method — must NOT appear in the Test Explorer (isPrivate = true)
    @Suppress("unused")
    private fun `this is private and should not appear as a test`() {
        // The extension filters out private functions regardless of annotations
    }
}
