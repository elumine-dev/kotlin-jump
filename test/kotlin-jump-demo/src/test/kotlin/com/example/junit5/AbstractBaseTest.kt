package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * Abstract base test — shared lifecycle + helper methods inherited by concrete subclasses.
 *
 * Pattern: the base class owns setup/teardown and common assertions.
 * Each subclass tests a different scenario (starter pokémon set, evolved set, etc.)
 * without repeating the boilerplate.
 */
abstract class StorageBaseTest {

    protected lateinit var storage: PokemonStorage

    /** Subclasses populate [storage] with their scenario's fixtures. */
    abstract fun populateStorage()

    @BeforeEach
    fun setUpStorage() {
        storage = PokemonStorage()
        populateStorage()
    }

    @AfterEach
    fun tearDownStorage() {
        storage.clear()
    }

    // ── shared assertions available to every subclass ─────────────────────────

    protected fun assertPokemonExists(id: Int, expectedName: String, expectedType: PokemonType) {
        val p = storage.findById(id)
        assertNotNull(p, "Pokemon #$id ('$expectedName') should be in storage")
        assertEquals(expectedName, p!!.name)
        assertEquals(expectedType, p.type)
    }

    protected fun assertPokemonAbsent(id: Int) {
        assertNull(storage.findById(id), "Pokemon #$id should not be in storage")
    }
}

// ── Concrete subclass A — Gen-I starters ─────────────────────────────────────

class StarterPokemonStorageTest : StorageBaseTest() {

    override fun populateStorage() {
        storage.save(Pokemon(1, "Bulbasaur",  GRASS,    5, 45))
        storage.save(Pokemon(4, "Charmander", FIRE,     5, 39))
        storage.save(Pokemon(7, "Squirtle",   WATER,    5, 44))
    }

    @Test
    fun `all three gen-1 starters are present`() {
        assertPokemonExists(1, "Bulbasaur",  GRASS)
        assertPokemonExists(4, "Charmander", FIRE)
        assertPokemonExists(7, "Squirtle",   WATER)
    }

    @Test
    fun `storage has exactly three entries`() {
        assertEquals(3, storage.count())
    }

    @Test
    fun `non-starter pokemon is absent`() {
        assertPokemonAbsent(25)
    }

    @Test
    fun `starters all start at level 5`() {
        listOf(1, 4, 7).forEach { id ->
            assertEquals(5, storage.findById(id)?.level, "Pokemon #$id should be level 5")
        }
    }
}

// ── Concrete subclass B — Evolved forms ──────────────────────────────────────

class EvolvedPokemonStorageTest : StorageBaseTest() {

    override fun populateStorage() {
        storage.save(Pokemon(2,  "Ivysaur",    GRASS,    16, 60))
        storage.save(Pokemon(5,  "Charmeleon", FIRE,     36, 58))
        storage.save(Pokemon(8,  "Wartortle",  WATER,    36, 59))
        storage.save(Pokemon(25, "Pikachu",    ELECTRIC, 25, 100))
    }

    @Test
    fun `evolved gen-1 starters are present`() {
        assertPokemonExists(2,  "Ivysaur",    GRASS)
        assertPokemonExists(5,  "Charmeleon", FIRE)
        assertPokemonExists(8,  "Wartortle",  WATER)
    }

    @Test
    fun `pikachu is present as bonus`() {
        assertPokemonExists(25, "Pikachu", ELECTRIC)
    }

    @Test
    fun `storage has exactly four entries`() {
        assertEquals(4, storage.count())
    }

    @Test
    fun `base forms are absent`() {
        assertPokemonAbsent(1)
        assertPokemonAbsent(4)
        assertPokemonAbsent(7)
    }

    @Test
    fun `evolved pokemon all have level above 15`() {
        listOf(2, 5, 8).forEach { id ->
            val level = storage.findById(id)?.level ?: 0
            assertTrue(level > 15, "Evolved pokemon #$id should be level > 15, was $level")
        }
    }
}

// ── Concrete subclass C — empty storage edge cases ───────────────────────────

class EmptyStorageTest : StorageBaseTest() {

    override fun populateStorage() {
        // intentionally empty — tests run on a fresh storage
    }

    @Test
    fun `count is zero when storage is empty`() {
        assertEquals(0, storage.count())
    }

    @Test
    fun `findById returns null on empty storage`() {
        assertPokemonAbsent(1)
        assertPokemonAbsent(999)
    }

    @Test
    fun `storage accepts a new pokemon after being empty`() {
        storage.save(Pokemon(152, "Chikorita", GRASS, 1, 45))
        assertEquals(1, storage.count())
        assertPokemonExists(152, "Chikorita", GRASS)
    }
}
