package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

/**
 * Tests the BattleEngine and exercises BattleResult sealed class.
 * Every branch of the sealed class is explicitly tested.
 */
class BattleEngineTest {

    private val engine = BattleEngine()

    // ── Type advantage → Victory ──────────────────────────────────────────────

    @ParameterizedTest(name = "{0} (lv{2}) beats {1} (lv{3}) by type")
    @MethodSource("typeAdvantageCases")
    fun `attacker wins by type advantage regardless of level`(
        atkType: PokemonType, defType: PokemonType, atkLevel: Int, defLevel: Int,
    ) {
        val attacker = Pokemon(1, "Attacker", atkType, atkLevel, 100)
        val defender = Pokemon(2, "Defender", defType, defLevel, 100)
        val result = engine.fight(attacker, defender)
        assertInstanceOf(BattleResult.Victory::class.java, result)
        assertEquals(attacker, (result as BattleResult.Victory).winner)
    }

    // ── Type disadvantage → Defeat ────────────────────────────────────────────

    @Test
    fun `attacker loses when defender has type advantage`() {
        val attacker = Pokemon(1, "Squirtle", WATER, 50, 100)  // WATER vs FIRE would win
        val defender = Pokemon(2, "Bulbasaur", GRASS, 50, 100) // GRASS beats WATER
        val result = engine.fight(attacker, defender)
        assertInstanceOf(BattleResult.Defeat::class.java, result)
        assertEquals(attacker, (result as BattleResult.Defeat).loser)
    }

    // ── Level tiebreaker (neutral types) ─────────────────────────────────────

    @Test
    fun `higher level wins when types are neutral`() {
        val strong  = Pokemon(1, "Dratini",   DRAGON, 50, 100)
        val weak    = Pokemon(2, "Jigglypuff", PSYCHIC, 30, 100)
        val result  = engine.fight(strong, weak)
        assertInstanceOf(BattleResult.Victory::class.java, result)
    }

    @Test
    fun `lower level loses when types are neutral`() {
        val weak   = Pokemon(1, "Dratini",    DRAGON, 30, 100)
        val strong = Pokemon(2, "Jigglypuff", PSYCHIC, 50, 100)
        val result = engine.fight(weak, strong)
        assertInstanceOf(BattleResult.Defeat::class.java, result)
    }

    // ── Draw ─────────────────────────────────────────────────────────────────

    @Test
    fun `draw when types are neutral and level is equal`() {
        val a = Pokemon(1, "DragonA", DRAGON, 50, 100)
        val b = Pokemon(2, "DragonB", DRAGON, 50, 200)
        val result = engine.fight(a, b)
        assertEquals(BattleResult.Draw, result)
    }

    @Test
    fun `draw when both have same type same level`() {
        val a = Pokemon(1, "FireA", FIRE, 25, 100)
        val b = Pokemon(2, "FireB", FIRE, 25, 100)
        assertEquals(BattleResult.Draw, engine.fight(a, b))
    }

    // ── Sealed class exhaustive when ──────────────────────────────────────────

    @Test
    fun `all BattleResult branches are reachable and exhaustive`() {
        val fire    = Pokemon(1, "Fire",    FIRE,   50, 100)
        val grass   = Pokemon(2, "Grass",   GRASS,  50, 100)
        val psychic = Pokemon(3, "Psychic", PSYCHIC, 30, 100)
        val dragon  = Pokemon(4, "Dragon",  DRAGON,  50, 100)

        val results = listOf(
            engine.fight(fire,    grass),    // Victory
            engine.fight(grass,   fire),     // Defeat
            engine.fight(dragon, psychic),   // Victory (level 50 > 30)
            engine.fight(dragon,  dragon.copy(id = 5, level = 50)), // Draw
        )

        // Exhaustive when — compiler would warn if a branch is missing
        val descriptions = results.map { result ->
            when (result) {
                is BattleResult.Victory -> "won by ${result.winner.name}"
                is BattleResult.Defeat  -> "lost by ${result.loser.name}"
                BattleResult.Draw       -> "draw"
            }
        }

        assertTrue(descriptions.any { it.startsWith("won") })
        assertTrue(descriptions.any { it.startsWith("lost") })
        assertTrue(descriptions.any { it == "draw" })
    }

    companion object {
        @JvmStatic
        fun typeAdvantageCases() = listOf(
            Arguments.of(FIRE,     GRASS,  10, 50),  // type advantage overrides low level
            Arguments.of(WATER,    FIRE,   10, 50),
            Arguments.of(GRASS,    WATER,  10, 50),
            Arguments.of(ELECTRIC, WATER,  10, 50),
        )
    }
}
