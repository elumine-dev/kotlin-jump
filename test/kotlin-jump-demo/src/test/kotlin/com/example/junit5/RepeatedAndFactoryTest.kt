package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.RepeatedTest
import org.junit.jupiter.api.RepetitionInfo
import org.junit.jupiter.api.TestFactory

/**
 * @RepeatedTest and @TestFactory patterns.
 * @RepeatedTest XML: "storage handles repeated saves (repetition N of 5)" — normalised to base name.
 * @TestFactory XML: each DynamicTest appears as a child testcase under the factory method name.
 */
class RepeatedAndFactoryTest {

    @RepeatedTest(5)
    fun `storage handles repeated saves`(info: RepetitionInfo) {
        val storage = PokemonStorage()
        repeat(info.currentRepetition) { i ->
            storage.save(Pokemon(i + 1, "Pokemon$i", GRASS, 1, 10))
        }
        assertEquals(info.currentRepetition, storage.count())
    }

    @RepeatedTest(3)
    fun `type effectiveness is deterministic`() {
        assertTrue(FIRE.isStrongAgainst(GRASS))
        assertTrue(WATER.isStrongAgainst(FIRE))
        assertTrue(GRASS.isStrongAgainst(WATER))
    }

    @TestFactory
    fun `type effectiveness dynamic tests`(): List<DynamicTest> = listOf(
        DynamicTest.dynamicTest("fire beats grass")     { assertTrue(FIRE.isStrongAgainst(GRASS))     },
        DynamicTest.dynamicTest("water beats fire")     { assertTrue(WATER.isStrongAgainst(FIRE))     },
        DynamicTest.dynamicTest("grass beats water")    { assertTrue(GRASS.isStrongAgainst(WATER))    },
        DynamicTest.dynamicTest("electric beats water") { assertTrue(ELECTRIC.isStrongAgainst(WATER)) },
    )

    @TestFactory
    fun `storage dynamic tests`(): List<DynamicTest> {
        val storage = PokemonStorage()
        val pikachu = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        return listOf(
            DynamicTest.dynamicTest("empty storage has count 0")  { assertEquals(0, storage.count()) },
            DynamicTest.dynamicTest("after save count becomes 1") { storage.save(pikachu); assertEquals(1, storage.count()) },
            DynamicTest.dynamicTest("findById returns pikachu")   { assertEquals("Pikachu", storage.findById(25)?.name) },
            DynamicTest.dynamicTest("after clear count is 0")     { storage.clear(); assertEquals(0, storage.count()) },
        )
    }
}
