package com.example.demo

import com.example.data.Pokemon
import com.example.data.PokemonType
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Verifies that WelcomeDemo.kt — the "Get Started" walkthrough entry point — is
 * structurally correct and its business logic produces the expected results.
 *
 * Code lenses and sealed-class exhaustiveness are verified at compile time;
 * these tests cover the runtime behaviour visible in the demo recording.
 */
class WelcomeDemoTest {

    private val pikachu = Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 50, hp = 100)
    private val brock   = GymLeader("Brock", Badge.Boulder, pikachu)

    // ── GymLeader.challenge() ─────────────────────────────────────────────────

    @Test
    fun `challenge returns Lost when challenger has no team`() {
        val challenger = Trainer(id = 1, name = "Ash")
        assertInstanceOf(TrainerEvent.Lost::class.java, brock.challenge(challenger))
    }

    @Test
    fun `challenge returns Won when challenger has a team`() {
        val challenger = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        assertInstanceOf(TrainerEvent.Won::class.java, brock.challenge(challenger))
    }

    @Test
    fun `Won event carries correct trainer references`() {
        val challenger = Trainer(id = 1, name = "Ash", team = listOf(pikachu))
        val event = brock.challenge(challenger) as TrainerEvent.Won
        assertEquals(challenger, event.trainer)
    }

    @Test
    fun `Lost event carries correct trainer references`() {
        val challenger = Trainer(id = 1, name = "Ash")
        val event = brock.challenge(challenger) as TrainerEvent.Lost
        assertEquals(challenger, event.trainer)
    }

    // ── Sealed class exhaustiveness ───────────────────────────────────────────

    @Test
    fun `all TrainerEvent branches are covered in a when expression`() {
        val withTeam   = Trainer(id = 1, name = "Ash",  team = listOf(pikachu))
        val withoutTeam = Trainer(id = 2, name = "Gary")

        val events = listOf(brock.challenge(withTeam), brock.challenge(withoutTeam))
        val labels = events.map { event ->
            // Compiler enforces exhaustiveness — missing branch = compile error
            when (event) {
                is TrainerEvent.Won  -> "won"
                is TrainerEvent.Lost -> "lost"
                TrainerEvent.Tied    -> "tied"
            }
        }
        assertTrue(labels.contains("won"))
        assertTrue(labels.contains("lost"))
    }

    // ── GymLeader implements TrainerService ───────────────────────────────────

    @Test
    fun `GymLeader satisfies the TrainerService contract`() {
        val service: TrainerService = brock
        assertNull(service.findTrainer(42))
        assertTrue(service.registerTrainer(Trainer(id = 99, name = "Red")))
        assertTrue(service.getLeaderboard().isEmpty())
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
    fun `strongestPokemon returns the highest-level Pokemon`() {
        val caterpie  = Pokemon(10, "Caterpie",  PokemonType.GRASS,  level = 5,   hp = 45)
        val charizard = Pokemon(6,  "Charizard", PokemonType.FIRE,   level = 100, hp = 266)
        val trainer   = Trainer(id = 1, name = "Ash", team = listOf(caterpie, charizard))
        assertEquals(charizard, trainer.strongestPokemon())
    }

    @Test
    fun `strongestPokemon returns null for an empty team`() {
        assertNull(Trainer(id = 1, name = "Ash").strongestPokemon())
    }

    // ── Badge ─────────────────────────────────────────────────────────────────

    @Test
    fun `Badge enum has exactly 8 values — one per gym`() {
        assertEquals(8, Badge.entries.size)
    }

    @Test
    fun `isEarned returns true when trainer holds the badge`() {
        val trainer = Trainer(id = 1, name = "Ash", badges = setOf(Badge.Boulder))
        assertTrue(Badge.Boulder.isEarned(trainer))
    }

    @Test
    fun `isEarned returns false when trainer does not hold the badge`() {
        val trainer = Trainer(id = 1, name = "Ash", badges = setOf(Badge.Boulder))
        assertFalse(Badge.Cascade.isEarned(trainer))
    }
}
