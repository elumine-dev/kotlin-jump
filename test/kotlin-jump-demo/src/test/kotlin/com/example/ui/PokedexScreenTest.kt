package com.example.ui

import com.example.app.R
import com.example.data.BattleResult
import com.example.data.Pokemon
import com.example.data.PokemonRepository
import com.example.data.PokemonType
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.io.ByteArrayOutputStream
import java.io.PrintStream

/**
 * Verifies PokedexScreen — the primary file used for the string-folding GIF demo.
 *
 * Key checks:
 *  - All R.string constants referenced by the screen are valid (>= 0, not -1).
 *  - showBattleResult() handles every BattleResult branch without throwing.
 *  - showError() handles both network and unknown error cases.
 */
class PokedexScreenTest {

    private val pikachu  = Pokemon(25, "Pikachu",   PokemonType.ELECTRIC, level = 50, hp = 100)
    private val bulba    = Pokemon(1,  "Bulbasaur",  PokemonType.GRASS,    level = 20, hp = 80)

    private val fakeRepository = object : PokemonRepository {
        override suspend fun catch(id: Int) = pikachu
        override suspend fun release(pokemon: Pokemon) {}
        override fun getPokedex() = listOf(pikachu, bulba)
        override fun battle(attacker: Pokemon, defender: Pokemon) = BattleResult.Draw
    }

    private lateinit var screen: PokedexScreen

    @BeforeEach
    fun setUp() {
        screen = PokedexScreen(PokedexViewModel(fakeRepository))
    }

    // ── R.string validity — string folding only works for IDs >= 0 ────────────

    @Test
    fun `companion object constants are valid R string IDs`() {
        assertTrue(PokedexScreen.SCREEN_TITLE  >= 0, "SCREEN_TITLE maps to a real string")
        assertTrue(PokedexScreen.ACTION_ADD    >= 0, "ACTION_ADD maps to a real string")
        assertTrue(PokedexScreen.ACTION_BATTLE >= 0, "ACTION_BATTLE maps to a real string")
    }

    @Test
    fun `all R string IDs used in showBattleResult are valid`() {
        assertTrue(R.string.msg_battle_won  >= 0)
        assertTrue(R.string.msg_battle_lost >= 0)
        assertTrue(R.string.msg_battle_draw >= 0)
    }

    @Test
    fun `all R string IDs used in showError are valid`() {
        assertTrue(R.string.error_network >= 0)
        assertTrue(R.string.error_unknown >= 0)
        assertTrue(R.string.action_retry  >= 0)
    }

    @Test
    fun `all R string IDs used in displayCard are valid`() {
        assertTrue(R.string.label_pokemon_type  >= 0)
        assertTrue(R.string.label_pokemon_level >= 0)
        assertTrue(R.string.label_pokemon_hp    >= 0)
        assertTrue(R.string.type_fire     >= 0)
        assertTrue(R.string.type_water    >= 0)
        assertTrue(R.string.type_grass    >= 0)
        assertTrue(R.string.type_electric >= 0)
        assertTrue(R.string.type_psychic  >= 0)
        assertTrue(R.string.type_dragon   >= 0)
    }

    // ── showBattleResult — sealed class exhaustiveness ────────────────────────

    @Test
    fun `showBattleResult handles Victory without throwing`() {
        assertDoesNotThrow {
            screen.showBattleResult(BattleResult.Victory(pikachu))
        }
    }

    @Test
    fun `showBattleResult prints winner name for Victory`() {
        val output = captureOutput { screen.showBattleResult(BattleResult.Victory(pikachu)) }
        assertTrue(output.contains("Pikachu"), "Victory output should contain the winner's name")
    }

    @Test
    fun `showBattleResult handles Defeat without throwing`() {
        assertDoesNotThrow {
            screen.showBattleResult(BattleResult.Defeat(bulba))
        }
    }

    @Test
    fun `showBattleResult prints loser name for Defeat`() {
        val output = captureOutput { screen.showBattleResult(BattleResult.Defeat(bulba)) }
        assertTrue(output.contains("Bulbasaur"), "Defeat output should contain the loser's name")
    }

    @Test
    fun `showBattleResult handles Draw without throwing`() {
        assertDoesNotThrow {
            screen.showBattleResult(BattleResult.Draw)
        }
    }

    // ── showError ─────────────────────────────────────────────────────────────

    @ParameterizedTest(name = "isNetworkError={0}")
    @ValueSource(booleans = [true, false])
    fun `showError does not throw for either error type`(isNetworkError: Boolean) {
        assertDoesNotThrow { screen.showError(isNetworkError) }
    }

    // ── render ────────────────────────────────────────────────────────────────

    @Test
    fun `render does not throw with a populated pokedex`() {
        assertDoesNotThrow { screen.render() }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private fun captureOutput(block: () -> Unit): String {
        val original = System.out
        val buffer   = ByteArrayOutputStream()
        System.setOut(PrintStream(buffer))
        try { block() } finally { System.setOut(original) }
        return buffer.toString()
    }
}
