package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertAll
import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.util.concurrent.TimeUnit

@DisplayName("Advanced JUnit 5 assertions — assertThrows, assumeTrue, assertAll, @Timeout")
class AdvancedAssertionsTest {

    // ── assertThrows ──────────────────────────────────────────────────────────

    @Test
    @Tag("boundary")
    @DisplayName("Invalid type name throws IllegalArgumentException")
    fun `valueOf with invalid type name throws IllegalArgumentException`() {
        assertThrows(IllegalArgumentException::class.java) {
            PokemonType.valueOf("INVALID")
        }
    }

    @Test
    @Tag("boundary")
    fun `valueOf with empty string throws IllegalArgumentException`() {
        assertThrows(IllegalArgumentException::class.java) {
            PokemonType.valueOf("")
        }
    }

    @Test
    @Tag("boundary")
    fun `valueOf with lowercase name throws IllegalArgumentException`() {
        assertThrows(IllegalArgumentException::class.java) {
            PokemonType.valueOf("fire")  // enum names are uppercase
        }
    }

    // ── assertDoesNotThrow ────────────────────────────────────────────────────

    @Test
    fun `creating pokemon with extreme integer values does not throw`() {
        assertDoesNotThrow {
            Pokemon(Int.MAX_VALUE, "MaxPokemon", FIRE, Int.MAX_VALUE, Int.MAX_VALUE)
        }
    }

    @Test
    fun `creating pokemon with minimum integer values does not throw`() {
        assertDoesNotThrow {
            Pokemon(Int.MIN_VALUE, "MinPokemon", WATER, Int.MIN_VALUE, Int.MIN_VALUE)
        }
    }

    @Test
    fun `findById with negative id does not throw and returns null`() {
        val storage = PokemonStorage()
        assertDoesNotThrow { storage.findById(-1) }
        assertNull(storage.findById(-1))
    }

    @Test
    fun `remove on non-existent id does not throw`() {
        val storage = PokemonStorage()
        assertDoesNotThrow { storage.remove(999) }
        assertEquals(0, storage.count())
    }

    // ── assumeTrue / assumeFalse ──────────────────────────────────────────────

    @Test
    @DisplayName("Skipped: storage is empty so assumption fails")
    fun `test only runs when storage has content`() {
        val storage = PokemonStorage()
        assumeTrue(storage.count() > 0, "Storage is empty — skipping this test")
        // Unreachable: assumption always fails for a fresh storage
        assertNotNull(storage.findById(1))
    }

    @Test
    @DisplayName("Passes: PSYCHIC has no advantage so assumeFalse continues")
    fun `test continues because psychic has no type advantage`() {
        // PSYCHIC.isStrongAgainst(FIRE) is false → assumeFalse(false) → test continues
        assumeFalse(PSYCHIC.isStrongAgainst(FIRE), "PSYCHIC has advantage — unexpected")
        assertFalse(PSYCHIC.isStrongAgainst(GRASS))
        assertFalse(PSYCHIC.isStrongAgainst(WATER))
        assertFalse(PSYCHIC.isStrongAgainst(DRAGON))
    }

    // ── assertAll ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("All Pikachu fields are correct — assertAll reports every failure at once")
    fun `all pikachu fields are correct`() {
        val pikachu = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        assertAll(
            "pikachu",
            { assertEquals(25,        pikachu.id)    },
            { assertEquals("Pikachu", pikachu.name)  },
            { assertEquals(ELECTRIC,  pikachu.type)  },
            { assertEquals(25,        pikachu.level) },
            { assertEquals(100,       pikachu.hp)    },
        )
    }

    @Test
    fun `all type enum values can be retrieved by name`() {
        assertAll(
            { assertNotNull(PokemonType.valueOf("FIRE"))     },
            { assertNotNull(PokemonType.valueOf("WATER"))    },
            { assertNotNull(PokemonType.valueOf("GRASS"))    },
            { assertNotNull(PokemonType.valueOf("ELECTRIC")) },
            { assertNotNull(PokemonType.valueOf("PSYCHIC"))  },
            { assertNotNull(PokemonType.valueOf("DRAGON"))   },
        )
    }

    @Test
    fun `storage sequence of operations all succeed`() {
        val storage = PokemonStorage()
        val pikachu = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        storage.save(pikachu)
        assertAll(
            "storage after save",
            { assertEquals(1,         storage.count())        },
            { assertNotNull(           storage.findById(25))   },
            { assertEquals("Pikachu", storage.findById(25)?.name) },
            { assertEquals(1,         storage.getAll().size)  },
        )
    }

    // ── @Timeout ──────────────────────────────────────────────────────────────

    @Test
    @Timeout(value = 2, unit = TimeUnit.SECONDS)
    fun `saving 1000 pokemon completes within 2 seconds`() {
        val storage = PokemonStorage()
        repeat(1000) { i ->
            storage.save(Pokemon(i, "Pokemon$i", GRASS, 1, 10))
        }
        assertEquals(1000, storage.count())
        storage.clear()
        assertEquals(0, storage.count())
    }

    @Test
    @Timeout(value = 1, unit = TimeUnit.SECONDS)
    fun `type effectiveness checks complete within 1 second`() {
        val types = PokemonType.entries
        var checks = 0
        for (atk in types) {
            for (def in types) {
                atk.isStrongAgainst(def)
                checks++
            }
        }
        assertEquals(36, checks) // 6×6 = 36 combinations
    }
}
