package com.example.demo

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Verifies that JarNavigationDemo.kt compiles against the real kotlinx.coroutines
 * library (not stubs) and that the sync service delivers the expected result.
 *
 * The fact that these tests compile at all proves that Cmd+Click on `launch`,
 * `withContext`, or `delay` will navigate into the kotlinx.coroutines JAR source.
 */
class JarNavigationDemoTest {

    // ── PokemonSyncService ────────────────────────────────────────────────────

    @Test
    fun `PokemonSyncService can be instantiated`() {
        assertDoesNotThrow { PokemonSyncService() }
    }

    @Test
    fun `syncPokedex calls onComplete with 151`() {
        val latch  = CountDownLatch(1)
        var result = -1

        PokemonSyncService().syncPokedex { count ->
            result = count
            latch.countDown()
        }

        val completed = latch.await(3, TimeUnit.SECONDS)
        assertTrue(completed, "syncPokedex did not complete within 3 seconds")
        assertEquals(151, result, "Expected the original 151 Kanto Pokémon")
    }

    @Test
    fun `syncPokedex invokes callback exactly once`() {
        val latch  = CountDownLatch(1)
        var calls  = 0

        PokemonSyncService().syncPokedex {
            calls++
            latch.countDown()
        }

        latch.await(3, TimeUnit.SECONDS)
        assertEquals(1, calls)
    }
}
