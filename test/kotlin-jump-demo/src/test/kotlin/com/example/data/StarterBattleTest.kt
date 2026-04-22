package com.example.data

import com.example.data.PokemonType.FIRE
import com.example.data.PokemonType.WATER
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/**
 * The starter rivalry: Charizard (Fire) vs Blastoise (Water).
 *
 * Water douses fire — Blastoise always wins by type advantage.
 * Two short tests, fast Gradle warm-up, iconic matchup.
 */
class StarterBattleTest {

    private val engine = BattleEngine()

    private val charizard = Pokemon(6, "Charizard", FIRE,  50, 100)
    private val blastoise = Pokemon(9, "Blastoise", WATER, 50, 100)

    @Test
    fun `Blastoise beats Charizard — water douses fire`() {
        val result = engine.fight(blastoise, charizard) as BattleResult.Victory
        assertEquals(blastoise, result.winner)
    }

    @Test
    fun `Charizard loses to Blastoise — fire cannot melt water`() {
        val result = engine.fight(charizard, blastoise) as BattleResult.Defeat
        assertEquals(charizard, result.loser)
    }
}
