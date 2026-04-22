package com.example.data

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * Behavioural tests for [PokemonRepository.catch] across the concrete
 * implementations. Each case exercises `.catch(...)` on a real instance
 * to verify the contract holds — and, as a side effect, populates the
 * Find Usages panel with visible test callers of the `catch` method.
 */
class PokemonCatchBehaviorTest {

    private lateinit var fake:     FakePokemonRepository
    private lateinit var inMemory: InMemoryPokemonRepository

    private val pikachu = Pokemon(25, "Pikachu", PokemonType.ELECTRIC, level = 50, hp = 100)
    private val bulba   = Pokemon(1,  "Bulbasaur", PokemonType.GRASS,  level = 20, hp = 80)

    @BeforeEach
    fun setUp() {
        fake = FakePokemonRepository().apply {
            addPokemon(pikachu)
            addPokemon(bulba)
        }
        inMemory = InMemoryPokemonRepository()
    }

    // ── Direct calls to .catch(...) on each impl ──────────────────────────────

    @Test
    fun `fake catch returns the seeded Pokemon when id matches`() = runBlocking {
        val caught = fake.catch(25)
        assertEquals("Pikachu", caught.name)
        assertEquals(PokemonType.ELECTRIC, caught.type)
    }

    @Test
    fun `fake catch returns an Unknown placeholder when id is missing`() = runBlocking {
        val caught = fake.catch(9999)
        assertEquals("Unknown-9999", caught.name)
        assertEquals(PokemonType.PSYCHIC, caught.type)
    }

    @Test
    fun `fake catch is deterministic across repeated calls`() = runBlocking {
        val first  = fake.catch(25)
        val second = fake.catch(25)
        assertEquals(first.name, second.name)
        assertEquals(first.level, second.level)
    }

    @Test
    fun `in-memory catch returns a non-null Pokemon for any id`() = runBlocking {
        val caught = inMemory.catch(42)
        assertNotNull(caught)
    }

    @Test
    fun `in-memory catch produces different ids for different inputs`() = runBlocking {
        val a = inMemory.catch(1)
        val b = inMemory.catch(2)
        assertNotSame(a, b)
    }

    // ── Cached decorator — verifies .catch(...) memoisation ───────────────────

    @Test
    fun `cached catch delegates to inner repository on first call`() = runBlocking {
        val cached = CachedPokemonRepository(delegate = fake)
        val caught = cached.catch(25)
        assertEquals("Pikachu", caught.name)
    }

    @Test
    fun `cached catch returns the same instance on repeated ids`() = runBlocking {
        val cached = CachedPokemonRepository(delegate = fake)
        val first  = cached.catch(25)
        val second = cached.catch(25)
        assertSame(first, second, "cache hit must return the memoised Pokemon")
    }

    @Test
    fun `cached catch fetches separately for distinct ids`() = runBlocking {
        val cached = CachedPokemonRepository(delegate = fake)
        val p25 = cached.catch(25)
        val p1  = cached.catch(1)
        assertEquals("Pikachu",   p25.name)
        assertEquals("Bulbasaur", p1.name)
    }
}
