package com.example.demo

import com.example.data.Pokemon
import com.example.data.PokemonType
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource

/**
 * Verifies the helper functions in InlayHintsDemo.kt.
 *
 * These functions exist to produce call sites where the extension shows:
 *   - parameter name hints  (id:, name:, type:, times:)
 *   - inferred type hints   (: Pokemon, : Int, : Boolean, : String)
 *
 * Tests confirm the functions behave correctly so the demo file is trustworthy.
 */
class InlayHintsDemoTest {

    // ── makePokemon ───────────────────────────────────────────────────────────

    @Test
    fun `makePokemon creates a Pokemon with the given id, name and type`() {
        val p = makePokemon(25, "Pikachu", PokemonType.ELECTRIC)
        assertEquals(25, p.id)
        assertEquals("Pikachu", p.name)
        assertEquals(PokemonType.ELECTRIC, p.type)
    }

    @Test
    fun `makePokemon sets level 1 and hp 100 as defaults`() {
        val p = makePokemon(1, "Bulbasaur", PokemonType.GRASS)
        assertEquals(1, p.level)
        assertEquals(100, p.hp)
    }

    // ── getLevel ──────────────────────────────────────────────────────────────

    @Test
    fun `getLevel returns the pokemon level`() {
        val p = Pokemon(6, "Charizard", PokemonType.FIRE, level = 100, hp = 266)
        assertEquals(100, getLevel(p))
    }

    // ── isElectric ────────────────────────────────────────────────────────────

    @Test
    fun `isElectric returns true for ELECTRIC type`() {
        assertTrue(isElectric(PokemonType.ELECTRIC))
    }

    @ParameterizedTest(name = "{0} is not electric")
    @EnumSource(PokemonType::class, names = ["ELECTRIC"], mode = EnumSource.Mode.EXCLUDE)
    fun `isElectric returns false for non-ELECTRIC types`(type: PokemonType) {
        assertFalse(isElectric(type))
    }

    // ── greet ─────────────────────────────────────────────────────────────────

    @Test
    fun `greet repeats the name the given number of times`() {
        assertEquals("Ash! Ash! Ash!", greet("Ash", 3))
    }

    @Test
    fun `greet with times 1 returns just the name`() {
        assertEquals("Pikachu!", greet("Pikachu", 1))
    }

    @Test
    fun `greet trims trailing whitespace`() {
        val result = greet("Gary", 2)
        assertFalse(result.endsWith(" "), "Result should not end with a space")
    }

    // ── demo functions run without throwing ───────────────────────────────────

    @Test
    fun `demoInferredTypes runs without throwing`() {
        assertDoesNotThrow { demoInferredTypes() }
    }

    @Test
    fun `demoParamNames runs without throwing`() {
        assertDoesNotThrow { demoParamNames() }
    }

    @Test
    fun `demoStringFolding runs without throwing`() {
        assertDoesNotThrow { demoStringFolding() }
    }
}
