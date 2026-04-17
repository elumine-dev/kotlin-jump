package com.example.junit4

import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import org.junit.runners.Parameterized.Parameters

/**
 * JUnit 4 @RunWith(Parameterized) — each row is a separate test case.
 * XML names will be: "type advantage is correctly computed[FIRE vs GRASS]" etc.
 * Tests the extension's normalisation of "[N]" suffixes and result aggregation.
 */
@RunWith(Parameterized::class)
class TypeMatchupParamTest(
    private val attacker: PokemonType,
    private val defender: PokemonType,
    private val expected: Boolean,
) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0} vs {1}")
        fun parameters() = listOf(
            arrayOf(FIRE,     GRASS,    true),
            arrayOf(WATER,    FIRE,     true),
            arrayOf(GRASS,    WATER,    true),
            arrayOf(ELECTRIC, WATER,    true),
            arrayOf(FIRE,     WATER,    false),
            arrayOf(ELECTRIC, GRASS,    false),
            arrayOf(PSYCHIC,  FIRE,     false),
            arrayOf(DRAGON,   ELECTRIC, false),
        )
    }

    @Test
    fun `type advantage is correctly computed`() {
        assertEquals(expected, attacker.isStrongAgainst(defender))
    }
}
