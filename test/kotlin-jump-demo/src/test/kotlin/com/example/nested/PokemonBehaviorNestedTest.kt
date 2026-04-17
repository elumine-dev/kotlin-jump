package com.example.nested

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test

/**
 * Nested test classes — 3 levels deep.
 * Tests the extension's Feature B: inner classes appear nested in the Test Explorer.
 * XML classnames use '$': "PokemonBehaviorNestedTest$WhenStorageIsEmpty$AndWeSaveOnePokemon"
 * which the extension normalises to "PokemonBehaviorNestedTest.WhenStorageIsEmpty.AndWeSaveOnePokemon".
 */
class PokemonBehaviorNestedTest {

    @Test
    fun `root level - type system is defined`() {
        assertTrue(FIRE.isStrongAgainst(GRASS))
    }

    @Test
    fun `root level - fire has no advantage over water`() {
        assertFalse(FIRE.isStrongAgainst(WATER))
    }

    @Nested
    inner class WhenStorageIsEmpty {

        private lateinit var storage: PokemonStorage

        @BeforeEach
        fun setup() { storage = PokemonStorage() }

        @Test
        fun `count is zero`() {
            assertEquals(0, storage.count())
        }

        @Test
        fun `findById returns null`() {
            assertNull(storage.findById(1))
        }

        @Test
        fun `getAll returns empty list`() {
            assertTrue(storage.getAll().isEmpty())
        }

        @Nested
        inner class AndWeSaveOnePokemon {

            private lateinit var storage: PokemonStorage
            private val pikachu = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)

            @BeforeEach
            fun setup() {
                storage = PokemonStorage()
                storage.save(pikachu)
            }

            @Test
            fun `count becomes one`() {
                assertEquals(1, storage.count())
            }

            @Test
            fun `findById finds the pokemon`() {
                assertEquals("Pikachu", storage.findById(25)?.name)
            }

            @Test
            fun `getAll contains the pokemon`() {
                assertEquals(1, storage.getAll().size)
                assertEquals(pikachu, storage.getAll().first())
            }

            @Test
            fun `after remove count returns to zero`() {
                storage.remove(25)
                assertEquals(0, storage.count())
            }
        }
    }

    @Nested
    inner class WhenTypesAreConsidered {

        @Test
        fun `fire is strong against grass`() {
            assertTrue(FIRE.isStrongAgainst(GRASS))
        }

        @Test
        fun `water is strong against fire`() {
            assertTrue(WATER.isStrongAgainst(FIRE))
        }

        @Test
        fun `electric is strong against water`() {
            assertTrue(ELECTRIC.isStrongAgainst(WATER))
        }

        @Test
        fun `same type has no advantage`() {
            assertFalse(FIRE.isStrongAgainst(FIRE))
            assertFalse(WATER.isStrongAgainst(WATER))
        }

        @Test
        fun `dragon has no advantage over anything`() {
            assertFalse(DRAGON.isStrongAgainst(FIRE))
            assertFalse(DRAGON.isStrongAgainst(WATER))
            assertFalse(DRAGON.isStrongAgainst(GRASS))
        }
    }
}
