package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.TestMethodOrder

/**
 * @TestMethodOrder + @Order — tests run as a deterministic sequence.
 * Combined with @TestInstance(PER_CLASS) so state accumulates across steps.
 *
 * Each step asserts a postcondition that depends on all prior steps having run.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class OrderedExecutionTest {

    private val storage = PokemonStorage()

    @Test @Order(1)
    fun `step 1 — storage starts empty before any save`() {
        assertEquals(0, storage.count())
    }

    @Test @Order(2)
    fun `step 2 — save Bulbasaur, count becomes 1`() {
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        assertEquals(1, storage.count())
    }

    @Test @Order(3)
    fun `step 3 — save Charmander, count becomes 2`() {
        storage.save(Pokemon(4, "Charmander", FIRE, 5, 39))
        assertEquals(2, storage.count())
    }

    @Test @Order(4)
    fun `step 4 — save Squirtle, count becomes 3`() {
        storage.save(Pokemon(7, "Squirtle", WATER, 5, 44))
        assertEquals(3, storage.count())
    }

    @Test @Order(5)
    fun `step 5 — all three pokemon are findable by id`() {
        assertNotNull(storage.findById(1), "Bulbasaur should exist")
        assertNotNull(storage.findById(4), "Charmander should exist")
        assertNotNull(storage.findById(7), "Squirtle should exist")
    }

    @Test @Order(6)
    fun `step 6 — findById returns correct data`() {
        val squirtle = storage.findById(7)
        assertNotNull(squirtle)
        assertEquals("Squirtle", squirtle!!.name)
        assertEquals(WATER,      squirtle.type)
    }

    @Test @Order(7)
    fun `step 7 — overwrite existing pokemon with higher level`() {
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 16, 60))
        val updated = storage.findById(1)
        assertNotNull(updated)
        assertEquals(16, updated!!.level)
        assertEquals(3, storage.count())  // overwrite, not an extra entry
    }

    @Test @Order(8)
    fun `step 8 — unknown id returns null`() {
        assertNull(storage.findById(999))
    }

    @Test @Order(9)
    fun `step 9 — clear removes all entries`() {
        storage.save(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        storage.clear()
        assertEquals(0, storage.count())
    }

    @Test @Order(10)
    fun `step 10 — storage is usable again after clear`() {
        storage.save(Pokemon(152, "Chikorita", GRASS, 1, 45))
        assertEquals(1, storage.count())
        assertEquals("Chikorita", storage.findById(152)?.name)
    }
}
