package com.example.junit4

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.BeforeClass
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

/**
 * JUnit 4 lifecycle annotations.
 * Verifies that @Before/@After/@BeforeClass/@AfterClass do NOT appear in the Test Explorer
 * (isLifecycle flag), and that @Ignore appears but is marked skipped.
 */
@RunWith(JUnit4::class)
class LifecycleJUnit4Test {

    companion object {
        private var suiteSetupCalled = false

        @BeforeClass @JvmStatic
        fun setupSuite() {
            suiteSetupCalled = true
        }

        @AfterClass @JvmStatic
        fun teardownSuite() {
            suiteSetupCalled = false
        }
    }

    private lateinit var storage: PokemonStorage

    @Before
    fun setUp() {
        storage = PokemonStorage()
    }

    @After
    fun tearDown() {
        storage.clear()
    }

    @Test
    fun `storage starts empty after setup`() {
        assertEquals(0, storage.count())
    }

    @Test
    fun `saving one pokemon increases count to one`() {
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        assertEquals(1, storage.count())
    }

    @Test
    fun `findById returns the saved pokemon`() {
        val charmander = Pokemon(4, "Charmander", FIRE, 5, 39)
        storage.save(charmander)
        assertNotNull(storage.findById(4))
        assertEquals("Charmander", storage.findById(4)?.name)
    }

    @Test
    fun `suite setup was called before any test`() {
        assertEquals(true, suiteSetupCalled)
    }

    @Ignore("Evolution logic not yet implemented")
    @Test
    fun `evolving charmander yields charmeleon`() {
        // TODO: implement evolution chain
    }
}
