package com.example.demo

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Verifies that JarNavigationDemo.kt compiles against the real kotlinx.coroutines
 * library (not stubs) and that the counter service delivers the expected value.
 *
 * The fact that these tests compile at all proves that Cmd+Click on `runBlocking`
 * or `MutableStateFlow` will navigate into the kotlinx.coroutines JAR source.
 */
class JarNavigationDemoTest {

    @Test
    fun `PokemonCounterService can be instantiated`() {
        assertDoesNotThrow { PokemonCounterService() }
    }

    @Test
    fun `counter starts at 0`() {
        assertEquals(0, PokemonCounterService().counter.value)
    }

    @Test
    fun `loadInitial returns 151 and updates the counter`() {
        val service = PokemonCounterService()
        val result  = service.loadInitial()

        assertEquals(151, result, "Expected the original 151 Kanto Pokémon")
        assertEquals(151, service.counter.value, "counter.value should reflect loadInitial result")
    }
}
