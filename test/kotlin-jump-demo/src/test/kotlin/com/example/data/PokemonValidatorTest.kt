package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

/**
 * PokemonValidator — boundary value tests, assertThrows for each constraint.
 */
class PokemonValidatorTest {

    private fun valid() = Pokemon(1, "Bulbasaur", GRASS, 1, 1)

    // ── isValid — happy path ──────────────────────────────────────────────────

    @Test
    fun `valid pokemon passes validation`() {
        assertTrue(PokemonValidator.isValid(Pokemon(1, "Bulbasaur", GRASS, 1, 45)))
        assertTrue(PokemonValidator.isValid(Pokemon(Int.MAX_VALUE, "Max", FIRE, 100, 999)))
    }

    // ── id boundary ───────────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(ints = [0, -1, -100, Int.MIN_VALUE])
    fun `non-positive id fails validation`(id: Int) {
        assertFalse(PokemonValidator.isValid(Pokemon(id, "Test", FIRE, 1, 1)))
    }

    @ParameterizedTest
    @ValueSource(ints = [0, -1, -100])
    fun `non-positive id throws with message`(id: Int) {
        val ex = assertThrows<IllegalArgumentException> {
            PokemonValidator.validate(Pokemon(id, "Test", FIRE, 1, 1))
        }
        assertTrue(ex.message!!.contains("positive"), "Message: ${ex.message}")
    }

    @Test
    fun `id of 1 passes validation`() {
        assertTrue(PokemonValidator.isValid(Pokemon(1, "Test", FIRE, 1, 1)))
    }

    // ── name boundary ─────────────────────────────────────────────────────────

    @Test
    fun `blank name fails validation`() {
        assertFalse(PokemonValidator.isValid(Pokemon(1, "   ", FIRE, 1, 1)))
        assertFalse(PokemonValidator.isValid(Pokemon(1, "", FIRE, 1, 1)))
    }

    @Test
    fun `blank name throws with message`() {
        val ex = assertThrows<IllegalArgumentException> {
            PokemonValidator.validate(Pokemon(1, "  ", FIRE, 1, 1))
        }
        assertTrue(ex.message!!.contains("blank"), "Message: ${ex.message}")
    }

    @Test
    fun `single character name passes validation`() {
        assertTrue(PokemonValidator.isValid(Pokemon(1, "A", FIRE, 1, 1)))
    }

    // ── level boundary ────────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(ints = [0, -1, 101, 200])
    fun `level outside 1-100 fails validation`(level: Int) {
        assertFalse(PokemonValidator.isValid(Pokemon(1, "Test", FIRE, level, 1)))
    }

    @ParameterizedTest
    @ValueSource(ints = [1, 50, 100])
    fun `level within 1-100 passes validation`(level: Int) {
        assertTrue(PokemonValidator.isValid(Pokemon(1, "Test", FIRE, level, 1)))
    }

    @Test
    fun `level 0 throws with message`() {
        val ex = assertThrows<IllegalArgumentException> {
            PokemonValidator.validate(Pokemon(1, "Test", FIRE, 0, 1))
        }
        assertTrue(ex.message!!.contains("level"), "Message: ${ex.message}")
    }

    // ── hp boundary ───────────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(ints = [0, -1, -100])
    fun `non-positive hp fails validation`(hp: Int) {
        assertFalse(PokemonValidator.isValid(Pokemon(1, "Test", FIRE, 1, hp)))
    }

    @Test
    fun `hp of 1 passes validation`() {
        assertTrue(PokemonValidator.isValid(Pokemon(1, "Test", FIRE, 1, 1)))
    }

    // ── multiple violations ───────────────────────────────────────────────────

    @Test
    fun `pokemon with multiple violations still throws on first`() {
        // id=0, blank name, level=0, hp=0 — validate throws on the first failure
        assertThrows<IllegalArgumentException> {
            PokemonValidator.validate(Pokemon(0, "", FIRE, 0, 0))
        }
    }
}
