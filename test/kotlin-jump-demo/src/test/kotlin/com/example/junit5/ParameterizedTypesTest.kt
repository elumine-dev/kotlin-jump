package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.extension.ExtensionContext
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.CsvSource
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import java.util.stream.Stream

/**
 * JUnit 5 @ParameterizedTest with three different argument sources.
 * XML produces "methodName(Type)[N] - value" entries which the extension
 * must normalise to "methodName" and aggregate into a single pass/fail result.
 */
class ParameterizedTypesTest {

    // ── @ValueSource ─────────────────────────────────────────────────────────

    @ParameterizedTest
    @ValueSource(strings = ["Pikachu", "Charmander", "Bulbasaur", "Squirtle", "Eevee"])
    fun `pokemon name is not blank`(name: String) {
        assertTrue(name.isNotBlank())
    }

    @ParameterizedTest
    @ValueSource(ints = [1, 4, 7, 25, 133])
    fun `pokemon id is positive`(id: Int) {
        assertTrue(id > 0)
    }

    // ── @CsvSource ────────────────────────────────────────────────────────────

    @ParameterizedTest
    @CsvSource(
        "FIRE,    GRASS,    true",
        "WATER,   FIRE,     true",
        "GRASS,   WATER,    true",
        "ELECTRIC,WATER,    true",
        "FIRE,    WATER,    false",
        "PSYCHIC, FIRE,     false",
        "DRAGON,  ELECTRIC, false",
        "GRASS,   GRASS,    false",
    )
    fun `type advantage matches expectation`(atk: String, def: String, expected: Boolean) {
        val attacker = PokemonType.valueOf(atk.trim())
        val defender = PokemonType.valueOf(def.trim())
        assertEquals(expected, attacker.isStrongAgainst(defender))
    }

    // ── @MethodSource ─────────────────────────────────────────────────────────

    @ParameterizedTest
    @MethodSource("pokemonAndExpectedType")
    fun `pokemon has the correct type`(pokemon: Pokemon, expectedType: PokemonType) {
        assertEquals(expectedType, pokemon.type)
    }

    @ParameterizedTest
    @MethodSource("typeStrongPairs")
    fun `strong type beats weak type`(strong: PokemonType, weak: PokemonType) {
        assertTrue(strong.isStrongAgainst(weak))
    }

    @ParameterizedTest
    @MethodSource("typeNeutralPairs")
    fun `neutral type has no advantage`(a: PokemonType, b: PokemonType) {
        assertFalse(a.isStrongAgainst(b))
    }

    companion object {
        @JvmStatic
        fun pokemonAndExpectedType(): Stream<Arguments> = Stream.of(
            Arguments.of(Pokemon(25, "Pikachu",   ELECTRIC, 25, 100), ELECTRIC),
            Arguments.of(Pokemon(4,  "Charmander", FIRE,    10,  39), FIRE),
            Arguments.of(Pokemon(7,  "Squirtle",   WATER,   10,  44), WATER),
            Arguments.of(Pokemon(1,  "Bulbasaur",  GRASS,    5,  45), GRASS),
        )

        @JvmStatic
        fun typeStrongPairs(): Stream<Arguments> = Stream.of(
            Arguments.of(FIRE, GRASS),
            Arguments.of(WATER, FIRE),
            Arguments.of(GRASS, WATER),
            Arguments.of(ELECTRIC, WATER),
        )

        @JvmStatic
        fun typeNeutralPairs(): Stream<Arguments> = Stream.of(
            Arguments.of(FIRE, WATER),
            Arguments.of(PSYCHIC, FIRE),
            Arguments.of(DRAGON, ELECTRIC),
        )
    }
}
