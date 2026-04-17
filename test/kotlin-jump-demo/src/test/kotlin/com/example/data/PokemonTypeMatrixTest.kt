package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.EnumSource
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.api.Test

/**
 * Complete 6×6 type effectiveness matrix.
 * Tests every combination of attacker × defender — 36 cases total.
 * Also verifies symmetry: if A beats B, B does not beat A.
 */
class PokemonTypeMatrixTest {

    // ── Full 6×6 matrix ───────────────────────────────────────────────────────

    @ParameterizedTest(name = "{0} vs {1} → {2}")
    @MethodSource("fullTypeMatrix")
    fun `type effectiveness matrix is correct`(atk: PokemonType, def: PokemonType, expected: Boolean) {
        assertEquals(expected, atk.isStrongAgainst(def),
            "${atk}.isStrongAgainst(${def}) should be $expected")
    }

    // ── Advantage pairs — symmetry check ─────────────────────────────────────

    @ParameterizedTest(name = "{0} beats {1} but not vice versa")
    @MethodSource("advantagePairs")
    fun `type advantage is not symmetric`(strong: PokemonType, weak: PokemonType) {
        assertTrue(strong.isStrongAgainst(weak),   "$strong should beat $weak")
        assertFalse(weak.isStrongAgainst(strong),   "$weak should not beat $strong")
    }

    // ── No type beats itself ───────────────────────────────────────────────────

    @ParameterizedTest
    @EnumSource(PokemonType::class)
    fun `no type beats itself`(type: PokemonType) {
        assertFalse(type.isStrongAgainst(type), "$type should not beat itself")
    }

    // ── Types with no advantage ───────────────────────────────────────────────

    @ParameterizedTest(name = "{0} has no advantage against any type")
    @MethodSource("noAdvantagePairs")
    fun `these types have no advantage over any other type`(atk: PokemonType, def: PokemonType) {
        assertFalse(atk.isStrongAgainst(def), "$atk should not beat $def")
    }

    // ── Exactly one advantage per offensive type ──────────────────────────────

    @ParameterizedTest
    @MethodSource("advantagePairs")
    fun `each offensive type beats exactly one other type`(strong: PokemonType, weak: PokemonType) {
        val victims = PokemonType.entries.filter { strong.isStrongAgainst(it) }
        assertEquals(1, victims.size,
            "$strong should beat exactly 1 type but beats: $victims")
    }

    // ── assertAll — grouped validation ────────────────────────────────────────

    @Test
    fun `all six pokemon types are defined and accessible`() {
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
    fun `exactly four types have a type advantage`() {
        val typesWithAdvantage = PokemonType.entries.filter { atk ->
            PokemonType.entries.any { def -> atk.isStrongAgainst(def) }
        }
        assertEquals(listOf(FIRE, WATER, GRASS, ELECTRIC), typesWithAdvantage)
    }

    @Test
    fun `exactly two types have no advantage`() {
        val typesWithNoAdvantage = PokemonType.entries.filter { atk ->
            PokemonType.entries.none { def -> atk.isStrongAgainst(def) }
        }
        assertEquals(listOf(PSYCHIC, DRAGON), typesWithNoAdvantage)
    }

    companion object {
        private val ALL_ADVANTAGES = mapOf(
            FIRE     to GRASS,
            WATER    to FIRE,
            GRASS    to WATER,
            ELECTRIC to WATER,
        )

        @JvmStatic
        fun fullTypeMatrix(): List<Arguments> =
            PokemonType.entries.flatMap { atk ->
                PokemonType.entries.map { def ->
                    Arguments.of(atk, def, ALL_ADVANTAGES[atk] == def)
                }
            }

        @JvmStatic
        fun advantagePairs(): List<Arguments> =
            ALL_ADVANTAGES.map { (atk, def) -> Arguments.of(atk, def) }

        @JvmStatic
        fun noAdvantagePairs(): List<Arguments> {
            val noAdvantage = listOf(PSYCHIC, DRAGON)
            return noAdvantage.flatMap { atk ->
                PokemonType.entries.map { def -> Arguments.of(atk, def) }
            }
        }
    }
}
