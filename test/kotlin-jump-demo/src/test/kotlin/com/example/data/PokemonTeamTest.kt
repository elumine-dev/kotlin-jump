package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/**
 * PokemonTeam — boundary tests, duplicate detection, assertThrows for illegal operations.
 */
class PokemonTeamTest {

    private lateinit var team: PokemonTeam

    @BeforeEach
    fun setUp() { team = PokemonTeam() }

    // ── Initial state ─────────────────────────────────────────────────────────

    @Test fun `new team is empty`()         { assertTrue(team.isEmpty) }
    @Test fun `new team size is zero`()     { assertEquals(0, team.size) }
    @Test fun `new team is not full`()      { assertFalse(team.isFull) }
    @Test fun `new team maxSize is 6`()     { assertEquals(6, team.maxSize) }

    // ── Add and query ─────────────────────────────────────────────────────────

    @Nested
    inner class WhenAddingPokemon {

        @Test
        fun `size increases after add`() {
            team.add(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
            assertEquals(1, team.size)
            assertFalse(team.isEmpty)
        }

        @Test
        fun `contains returns true for added pokemon`() {
            team.add(Pokemon(4, "Charmander", FIRE, 10, 39))
            assertTrue(team.contains(4))
        }

        @Test
        fun `contains returns false for non-member`() {
            assertFalse(team.contains(99))
        }

        @Test
        fun `getAll returns all added pokemon`() {
            team.add(Pokemon(1,  "Bulbasaur",  GRASS, 5, 45))
            team.add(Pokemon(4,  "Charmander", FIRE,  5, 39))
            team.add(Pokemon(7,  "Squirtle",   WATER, 5, 44))
            assertEquals(3, team.getAll().size)
        }

        @Test
        fun `duplicate id throws IllegalArgumentException`() {
            team.add(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
            assertThrows<IllegalArgumentException> {
                team.add(Pokemon(25, "Pikachu-Clone", ELECTRIC, 30, 120))
            }
            assertEquals(1, team.size)  // team unchanged after failed add
        }
    }

    // ── Full team boundary ────────────────────────────────────────────────────

    @Nested
    inner class WhenTeamIsFull {

        @BeforeEach
        fun fillTeam() {
            listOf(
                Pokemon(1, "Bulbasaur",  GRASS,    5,  45),
                Pokemon(4, "Charmander", FIRE,     5,  39),
                Pokemon(7, "Squirtle",   WATER,    5,  44),
                Pokemon(25,"Pikachu",    ELECTRIC, 25, 100),
                Pokemon(39,"Jigglypuff", PSYCHIC,  10,  55),
                Pokemon(147,"Dratini",   DRAGON,    1,  41),
            ).forEach { team.add(it) }
        }

        @Test
        fun `team with 6 members is full`() {
            assertTrue(team.isFull)
            assertEquals(6, team.size)
        }

        @Test
        fun `adding to full team throws IllegalStateException`() {
            assertThrows<IllegalStateException> {
                team.add(Pokemon(152, "Chikorita", GRASS, 5, 45))
            }
        }

        @Test
        fun `error message mentions max size`() {
            val ex = assertThrows<IllegalStateException> {
                team.add(Pokemon(152, "Chikorita", GRASS, 5, 45))
            }
            assertTrue(ex.message!!.contains("6"), "Error should mention max size 6: ${ex.message}")
        }

        @Test
        fun `team size unchanged after failed add`() {
            try { team.add(Pokemon(152, "Chikorita", GRASS, 5, 45)) } catch (_: Exception) {}
            assertEquals(6, team.size)
        }
    }

    // ── Remove ────────────────────────────────────────────────────────────────

    @Nested
    inner class WhenRemovingPokemon {

        @Test
        fun `remove existing pokemon returns true and decreases size`() {
            team.add(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
            val removed = team.remove(25)
            assertTrue(removed)
            assertEquals(0, team.size)
            assertFalse(team.contains(25))
        }

        @Test
        fun `remove non-existent id returns false`() {
            val removed = team.remove(99)
            assertFalse(removed)
        }

        @Test
        fun `can add same pokemon again after removing it`() {
            team.add(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
            team.remove(25)
            team.add(Pokemon(25, "Pikachu", ELECTRIC, 30, 120))
            assertEquals(1, team.size)
        }
    }

    // ── strongest / weakest ───────────────────────────────────────────────────

    @Test
    fun `strongest returns null for empty team`() {
        assertNull(team.strongest())
    }

    @Test
    fun `weakest returns null for empty team`() {
        assertNull(team.weakest())
    }

    @Test
    fun `strongest returns highest level pokemon`() {
        team.add(Pokemon(1, "Weak",   GRASS, 10, 45))
        team.add(Pokemon(2, "Strong", FIRE,  50, 100))
        team.add(Pokemon(3, "Mid",    WATER, 30, 70))
        assertEquals("Strong", team.strongest()?.name)
    }

    @Test
    fun `byType filters correctly`() {
        team.add(Pokemon(1, "Charmander", FIRE, 10, 39))
        team.add(Pokemon(2, "Charmeleon", FIRE, 25, 58))
        team.add(Pokemon(7, "Squirtle",   WATER, 5, 44))
        val fireTypes = team.byType(FIRE)
        assertEquals(2, fireTypes.size)
        assertTrue(fireTypes.all { it.type == FIRE })
    }

    // ── Custom maxSize ────────────────────────────────────────────────────────

    @Test
    fun `custom maxSize of 1 allows only one pokemon`() {
        val soloTeam = PokemonTeam(maxSize = 1)
        soloTeam.add(Pokemon(25, "Pikachu", ELECTRIC, 25, 100))
        assertTrue(soloTeam.isFull)
        assertThrows<IllegalStateException> {
            soloTeam.add(Pokemon(4, "Charmander", FIRE, 10, 39))
        }
    }
}
