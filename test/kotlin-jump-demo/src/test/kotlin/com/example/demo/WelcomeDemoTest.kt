package com.example.demo

import com.example.data.Pokemon
import com.example.data.PokemonType
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Verifies that WelcomeDemo.kt — the "Get Started" walkthrough entry point — is
 * structurally correct and its business logic produces the expected results.
 */
class WelcomeDemoTest {

    private val pikachu = Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 50, hp = 100)
    private val pewter  = PewterGym()

    // ── GymChallenge.accept() ─────────────────────────────────────────────────

    @Test
    fun `accept returns Draw when challenger has no team`() {
        val challenger = Trainer(id = 1, name = "Ash")
        assertInstanceOf(ChallengeOutcome.Draw::class.java, pewter.accept(challenger))
    }

    @Test
    fun `accept returns Victory when challenger has a team`() {
        val challenger = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        assertInstanceOf(ChallengeOutcome.Victory::class.java, pewter.accept(challenger))
    }

    @Test
    fun `Victory event carries correct trainer and prize`() {
        val challenger = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        val outcome = pewter.accept(challenger) as ChallengeOutcome.Victory
        assertEquals(challenger, outcome.winner)
        assertEquals(Badge.Boulder, outcome.prize)
    }

    @Test
    fun `Defeat event carries correct trainer and retries`() {
        val cerulean = CeruleanGym()
        val challenger = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        val outcome = cerulean.accept(challenger) as ChallengeOutcome.Defeat
        assertEquals(challenger, outcome.loser)
        assertEquals(1, outcome.retries)
    }

    // ── Sealed class exhaustiveness ───────────────────────────────────────────

    @Test
    fun `all ChallengeOutcome branches are covered in a when expression`() {
        val withTeam    = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        val withoutTeam = Trainer(id = 2, name = "Gary")

        val outcomes = listOf(pewter.accept(withTeam), pewter.accept(withoutTeam))
        val labels = outcomes.map { outcome ->
            when (outcome) {
                is ChallengeOutcome.Victory -> "victory"
                is ChallengeOutcome.Defeat  -> "defeat"
                ChallengeOutcome.Draw       -> "draw"
            }
        }
        assertTrue(labels.contains("victory"))
        assertTrue(labels.contains("draw"))
    }

    // ── GymChallenge metadata ─────────────────────────────────────────────────

    @Test
    fun `reward and gymName return expected values`() {
        assertEquals(Badge.Boulder, pewter.reward())
        assertEquals("Pewter City Gym", pewter.gymName())
    }

    // ── Trainer computed properties ───────────────────────────────────────────

    @Test
    fun `isChampion is true when all 8 badges are earned`() {
        val champion = Trainer(id = 1, name = "Red", badges = Badge.entries.toSet())
        assertTrue(champion.isChampion)
    }

    @Test
    fun `isChampion is false when fewer than 8 badges are earned`() {
        val partial = Trainer(id = 1, name = "Ash", badges = setOf(Badge.Boulder, Badge.Cascade))
        assertFalse(partial.isChampion)
    }

    @Test
    fun `canChallenge is true when trainer has a team`() {
        val trainer = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        assertTrue(trainer.canChallenge(pewter))
    }

    @Test
    fun `canChallenge is false for empty team`() {
        val trainer = Trainer(id = 1, name = "Ash")
        assertFalse(trainer.canChallenge(pewter))
    }

    // ── Badge ─────────────────────────────────────────────────────────────────

    @Test
    fun `Badge enum has exactly 8 values — one per gym`() {
        assertEquals(8, Badge.entries.size)
    }

    @Test
    fun `gymNumber is 1-based ordinal`() {
        assertEquals(1, Badge.Boulder.gymNumber)
        assertEquals(8, Badge.Earth.gymNumber)
    }
}
